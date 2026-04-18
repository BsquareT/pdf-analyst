import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import Layout from '../components/Layout';

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

  const token = session?.access_token;

  const loadSources = useCallback(async () => {
    if (!token) return;
    setLoadingSources(true);
    const res = await fetch('/api/sources/list', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setSources(data.sources || []);
    setLoadingSources(false);
  }, [token]);

  useEffect(() => {
    if (token) loadSources();
  }, [token]);

  const processFile = useCallback(async (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['pdf', 'pptx'].includes(ext)) { setError('Only PDF and PPTX files are supported.'); return; }
    setUploading(true); setError(null);
    setUploadProgress('Uploading file…');

    const formData = new FormData();
    formData.append('file', f);

    try {
      setUploadProgress('Extracting text from all pages…');
      const extractRes = await fetch('/api/extract', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const extractData = await extractRes.json();
      if (extractData.error) throw new Error(extractData.error);

      setUploadProgress('Saving to your library…');
      const saveRes = await fetch('/api/sources/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fileName: f.name,
          chunks: extractData.chunks,
          totalPages: extractData.totalPages,
        }),
      });
      const saveData = await saveRes.json();
      if (saveData.error) throw new Error(saveData.error);

      await loadSources();
      setUploadProgress('');
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }, [token, loadSources]);

  const deleteSource = async (id) => {
    if (!confirm('Remove this source from your library?')) return;
    setDeleting(id);
    await fetch('/api/sources/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
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

          {/* Header */}
          <div style={{ marginBottom: 40, paddingBottom: 24, borderBottom: '1px solid #1e1e1e' }}>
            <h1 style={{ ...serif, fontWeight: 400, fontSize: '2rem', color: '#e2ddd6', letterSpacing: '-0.02em' }}>
              My <em style={{ color: '#c9a86c' }}>Sources</em>
            </h1>
            <p style={{ ...m, fontSize: '0.65rem', color: '#555', marginTop: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Upload PDFs & PPTXs · Stored permanently · Analyze across multiple sources
            </p>
          </div>

          {/* Upload zone */}
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (!uploading) processFile(e.dataTransfer.files[0]); }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => !uploading && fileRef.current.click()}
            style={{ opacity: uploading ? 0.6 : 1, cursor: uploading ? 'not-allowed' : 'pointer' }}
          >
            <input ref={fileRef} type="file" accept=".pdf,.pptx" style={{ display: 'none' }} onChange={e => processFile(e.target.files[0])} />

            {uploading ? (
              <>
                <div style={{ width: 32, height: 32, border: '2px solid #2a2a2a', borderTopColor: '#c9a86c', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.7s linear infinite' }} />
                <p style={{ ...serif, fontSize: '1.1rem', color: '#e2ddd6', marginBottom: 6 }}>Processing…</p>
                <p style={{ ...m, fontSize: '0.7rem', color: '#666' }}>{uploadProgress}</p>
              </>
            ) : (
              <>
                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📚</div>
                <p style={{ ...serif, fontSize: '1.2rem', color: '#e2ddd6', marginBottom: 8 }}>Add a source</p>
                <p style={{ ...m, fontSize: '0.72rem', color: '#666' }}>
                  Drop here or <strong style={{ color: '#c9a86c' }}>tap to browse</strong> — PDF or PPTX
                </p>
                <p style={{ ...m, fontSize: '0.65rem', color: '#444', marginTop: 8 }}>
                  Files are saved permanently to your library
                </p>
              </>
            )}
          </div>

          {error && (
            <div style={{ background: '#140d0d', border: '1px solid #3a1515', borderRadius: 8, padding: '12px 16px', marginBottom: 18, ...m, fontSize: '0.75rem', color: '#d95f5f' }}>
              ⚠ {error}
            </div>
          )}

          {/* Sources list */}
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
              {sources.map(s => (
                <div key={s.id} style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ fontSize: '1.3rem', flexShrink: 0 }}>
                    {s.file_name.endsWith('.pptx') ? '📊' : '📄'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ ...m, fontSize: '0.82rem', color: '#e2ddd6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                      {s.file_name}
                    </p>
                    <p style={{ ...m, fontSize: '0.62rem', color: '#555' }}>
                      {s.total_pages} pages · {s.chunk_count} chunks · Added {new Date(s.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteSource(s.id)}
                    disabled={deleting === s.id}
                    style={{
                      background: 'none', border: '1px solid #2a2a2a', borderRadius: 6,
                      color: deleting === s.id ? '#333' : '#555', cursor: deleting === s.id ? 'not-allowed' : 'pointer',
                      padding: '6px 12px', ...m, fontSize: '0.68rem', transition: 'all 0.15s',
                    }}
                    onMouseOver={e => e.target.style.borderColor = '#d95f5f'}
                    onMouseOut={e => e.target.style.borderColor = '#2a2a2a'}
                  >
                    {deleting === s.id ? '…' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {sources.length > 0 && (
            <div style={{ marginTop: 28, background: '#17150e', border: '1px solid #3a3020', borderRadius: 10, padding: '16px 20px' }}>
              <p style={{ ...m, fontSize: '0.72rem', color: '#c9a86c', marginBottom: 4 }}>✓ Sources ready</p>
              <p style={{ ...m, fontSize: '0.68rem', color: '#666' }}>
                Go to <Link href="/" style={{ color: '#c9a86c', textDecoration: 'none' }}>Dashboard</Link> to select sources and analyze them.
              </p>
            </div>
          )}
        </div>
      </Layout>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
