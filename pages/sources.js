import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import Layout from '../components/Layout';

// ── CLIENT-SIDE TEXT EXTRACTION ──────────────────────────────────────────────

async function loadScript(src, checkGlobal) {
  if (window[checkGlobal]) return;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function extractPdfClientSide(file, onProgress) {
  await loadScript(
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'pdfjsLib'
  );
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const sections = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    if (i % 10 === 0 || i === 1) onProgress(`Extracting page ${i} of ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map(item => item.str).join(' ').trim();
    if (text) sections.push({ source: `Page ${i}`, text });
  }

  return { sections, totalPages: pdf.numPages };
}

async function extractPptxClientSide(file, onProgress) {
  await loadScript(
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'JSZip'
  );
  onProgress('Reading PowerPoint slides…');

  const arrayBuffer = await file.arrayBuffer();
  const zip = await window.JSZip.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

  const sections = [];
  for (const fp of slideFiles) {
    const xml = await zip.files[fp].async('string');
    const matches = [...xml.matchAll(/<a:t[^>]*>([^<]+)<\/a:t>/g)];
    const text = matches.map(m => m[1].trim()).filter(Boolean).join(' ');
    if (text.trim()) sections.push({ source: `Slide ${fp.match(/\d+/)[0]}`, text });
  }
  return { sections, totalPages: slideFiles.length };
}

function chunkSections(sections, size = 3000, overlap = 300) {
  const chunks = [];
  for (const { source, text } of sections) {
    if (!text.trim()) continue;
    if (text.length <= size) { chunks.push({ source, text: text.trim() }); continue; }
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      chunks.push({ source, text: text.slice(start, end).trim() });
      if (end === text.length) break;
      start += size - overlap;
    }
  }
  return chunks;
}

export default function Sources() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sources, setSources] = useState([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setSession(session);
      const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (!p?.approved) { await supabase.auth.signOut(); router.replace('/pending'); return; }
      setProfile(p);
      setAuthLoading(false);
    });
  }, []);

  const loadSources = useCallback(async () => {
    if (!session) return;
    setLoadingSources(true);
    const { data } = await supabase
      .from('sources')
      .select('id, file_name, total_pages, chunk_count, created_at')
      .order('created_at', { ascending: false });
    setSources(data || []);
    setLoadingSources(false);
  }, [session]);

  useEffect(() => { if (session) loadSources(); }, [session]);

  const processFile = useCallback(async (f) => {
    if (!f || !session) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['pdf', 'pptx'].includes(ext)) { setError('Only PDF and PPTX files are supported.'); return; }

    setUploading(true); setError(null);
    setUploadProgress('Starting…');

    try {
      // ── Step 1: Extract text in the browser ──────────────────────────
      let extracted;
      if (ext === 'pdf') {
        extracted = await extractPdfClientSide(f, setUploadProgress);
      } else {
        extracted = await extractPptxClientSide(f, setUploadProgress);
      }

      setUploadProgress(`Chunking ${extracted.totalPages} pages…`);
      const chunks = chunkSections(extracted.sections);

      // ── Step 2: Save DIRECTLY to Supabase (bypasses Vercel 4.5MB limit) ──
      setUploadProgress(`Saving ${chunks.length} chunks to your library…`);

      // Remove existing source with same name
      await supabase
        .from('sources')
        .delete()
        .eq('user_id', session.user.id)
        .eq('file_name', f.name);

      const { error: saveErr } = await supabase.from('sources').insert({
        user_id: session.user.id,
        file_name: f.name,
        total_pages: extracted.totalPages,
        chunk_count: chunks.length,
        chunks: chunks, // stored as JSONB in Supabase — no size limit
      });

      if (saveErr) throw new Error(saveErr.message);

      await loadSources();
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }, [session, loadSources]);

  const deleteSource = async (id) => {
    if (!confirm('Remove this source from your library?')) return;
    setDeleting(id);
    await supabase.from('sources').delete().eq('id', id);
    await loadSources();
    setDeleting(null);
  };

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: '#0c0c0c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: '#555' }}>Loading…</p>
    </div>
  );

  const m = { fontFamily: "'IBM Plex Mono',monospace" };
  const serif = { fontFamily: "'Playfair Display',serif" };

  return (
    <>
      <Head><title>Sources — PDF Analyst</title></Head>
      <Layout user={session?.user} profile={profile}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '40px 20px 80px 72px' }}>

          <div style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #1e1e1e' }}>
            <h1 style={{ ...serif, fontWeight: 400, fontSize: '2rem', color: '#e2ddd6', letterSpacing: '-0.02em' }}>
              My <em style={{ color: '#c9a86c' }}>Sources</em>
            </h1>
            <p style={{ ...m, fontSize: '0.65rem', color: '#555', marginTop: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Any size PDF or PPTX · Extracted in browser · Saved directly to database
            </p>
          </div>

          {/* Upload zone */}
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (!uploading) processFile(e.dataTransfer.files[0]); }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => !uploading && fileRef.current.click()}
            style={{ opacity: uploading ? 0.8 : 1, cursor: uploading ? 'default' : 'pointer' }}
          >
            <input ref={fileRef} type="file" accept=".pdf,.pptx" style={{ display: 'none' }}
              onChange={e => processFile(e.target.files[0])} />

            {uploading ? (
              <>
                <div style={{ width: 32, height: 32, border: '2px solid #2a2a2a', borderTopColor: '#c9a86c', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.7s linear infinite' }} />
                <p style={{ ...serif, fontSize: '1.1rem', color: '#e2ddd6', marginBottom: 8 }}>Processing…</p>
                <p style={{ ...m, fontSize: '0.7rem', color: '#c9a86c', marginBottom: 4 }}>{uploadProgress}</p>
                <p style={{ ...m, fontSize: '0.62rem', color: '#555' }}>Extracted in your browser · No file size limit</p>
              </>
            ) : (
              <>
                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📚</div>
                <p style={{ ...serif, fontSize: '1.2rem', color: '#e2ddd6', marginBottom: 8 }}>Add a source</p>
                <p style={{ ...m, fontSize: '0.72rem', color: '#666' }}>
                  Drop here or <strong style={{ color: '#c9a86c' }}>tap to browse</strong>
                </p>
                <p style={{ ...m, fontSize: '0.65rem', color: '#444', marginTop: 8 }}>
                  PDF or PPTX · Any size · 1000 page textbooks work fine
                </p>
              </>
            )}
          </div>

          {error && (
            <div style={{ background: '#140d0d', border: '1px solid #3a1515', borderRadius: 8, padding: '12px 16px', marginBottom: 18, ...m, fontSize: '0.75rem', color: '#d95f5f' }}>
              ⚠ {error}
            </div>
          )}

          <div style={{ ...m, fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c9a86c', marginBottom: 14 }}>
            Your Library — {sources.length} source{sources.length !== 1 ? 's' : ''}
          </div>

          {loadingSources ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ width: 24, height: 24, border: '2px solid #2a2a2a', borderTopColor: '#c9a86c', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.7s linear infinite' }} />
            </div>
          ) : sources.length === 0 ? (
            <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
              <p style={{ ...m, fontSize: '0.78rem', color: '#444' }}>No sources yet — upload your first PDF or PPTX above.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sources.map(src => (
                <div key={src.id} style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>{src.file_name.endsWith('.pptx') ? '📊' : '📄'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ ...m, fontSize: '0.82rem', color: '#e2ddd6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                      {src.file_name}
                    </p>
                    <p style={{ ...m, fontSize: '0.62rem', color: '#555' }}>
                      {src.total_pages} pages · {src.chunk_count} chunks · {new Date(src.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteSource(src.id)}
                    disabled={deleting === src.id}
                    style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, color: '#555', cursor: 'pointer', padding: '6px 12px', ...m, fontSize: '0.68rem' }}
                    onMouseOver={e => e.target.style.borderColor = '#d95f5f'}
                    onMouseOut={e => e.target.style.borderColor = '#2a2a2a'}
                  >
                    {deleting === src.id ? '…' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {sources.length > 0 && (
            <div style={{ marginTop: 28, background: '#17150e', border: '1px solid #3a3020', borderRadius: 10, padding: '16px 20px' }}>
              <p style={{ ...m, fontSize: '0.72rem', color: '#c9a86c', marginBottom: 4 }}>✓ Sources ready</p>
              <p style={{ ...m, fontSize: '0.68rem', color: '#666' }}>
                Go to <Link href="/" style={{ color: '#c9a86c', textDecoration: 'none' }}>Dashboard</Link> to select and analyze them.
              </p>
            </div>
          )}
        </div>
      </Layout>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .drop-zone { border: 1.5px dashed #2a2a2a; border-radius:12px; background:#141414; padding:48px 20px; text-align:center; transition:all 0.2s; margin-bottom:18px; }
        .drop-zone:hover, .drop-zone.drag-over { border-color:#c9a86c; background:#17150e; }
      `}</style>
    </>
  );
}
