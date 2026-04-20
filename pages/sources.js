import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import Layout from '../components/Layout';

const CHUNKS_PER_BATCH = 50;
const IMG_SCALE = 1.2;        // render scale for PDF pages (higher = better quality but larger)
const IMG_QUALITY = 0.75;     // JPEG quality 0-1
const MAX_IMG_PAGES = 200;    // max pages to render as images per document

// ── SCRIPT LOADER ─────────────────────────────────────────────────────────────
async function loadScript(src, checkGlobal) {
  if (window[checkGlobal]) return;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { setTimeout(resolve, 500); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── PDF TEXT EXTRACTION ───────────────────────────────────────────────────────
async function extractPdfClientSide(file, onProgress) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjsLib');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const sections = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    if (i === 1 || i % 20 === 0 || i === pdf.numPages)
      onProgress(`Reading page ${i} of ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map(item => item.str).join(' ').trim();
    if (text) sections.push({ source: `Page ${i}`, text });
  }
  return { sections, totalPages: pdf.numPages, pdfDoc: pdf };
}

// ── PDF IMAGE EXTRACTION (render pages to JPEG) ───────────────────────────────
async function extractPdfImages(pdfDoc, userId, groupId, fileName, onProgress) {
  const images = [];
  const pagesToRender = Math.min(pdfDoc.numPages, MAX_IMG_PAGES);

  for (let i = 1; i <= pagesToRender; i++) {
    if (i % 10 === 0 || i === 1)
      onProgress(`Rendering page image ${i} of ${pagesToRender}…`);

    try {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: IMG_SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;

      // Convert to blob
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', IMG_QUALITY));
      if (!blob || blob.size < 5000) continue; // skip mostly blank pages

      images.push({
        pageNumber: i,
        blob,
        width: viewport.width,
        height: viewport.height,
        storagePath: `${userId}/${groupId}/page_${i}.jpg`,
      });
    } catch (err) {
      console.warn(`Could not render page ${i}:`, err.message);
    }
  }
  return images;
}

// ── PPTX TEXT EXTRACTION ──────────────────────────────────────────────────────
async function extractPptxClientSide(file, onProgress) {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'JSZip');
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
  return { sections, totalPages: slideFiles.length, zip };
}

// ── PPTX IMAGE EXTRACTION ─────────────────────────────────────────────────────
async function extractPptxImages(zip, userId, groupId, onProgress) {
  onProgress('Extracting slide images…');
  const mediaFiles = Object.keys(zip.files).filter(f =>
    f.startsWith('ppt/media/') && /\.(png|jpg|jpeg|gif|webp)$/i.test(f)
  );

  // Also map slide relationships to know which image is on which slide
  const slideRels = {};
  const relFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(f));
  for (const rf of relFiles) {
    const slideNum = parseInt(rf.match(/slide(\d+)/)[1]);
    const xml = await zip.files[rf].async('string');
    const imgMatches = [...xml.matchAll(/Target="\.\.\/media\/([^"]+)"/g)];
    for (const m of imgMatches) {
      const mediaName = m[1];
      if (!slideRels[mediaName]) slideRels[mediaName] = [];
      slideRels[mediaName].push(slideNum);
    }
  }

  const images = [];
  for (const mediaPath of mediaFiles.slice(0, MAX_IMG_PAGES)) {
    try {
      const mediaName = mediaPath.replace('ppt/media/', '');
      const ext = mediaName.split('.').pop().toLowerCase();
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/gif';
      const data = await zip.files[mediaPath].async('arraybuffer');
      const blob = new Blob([data], { type: mimeType });
      if (blob.size < 3000) continue; // skip tiny icons

      const slideNum = (slideRels[mediaName] || [])[0] || null;
      const storageExt = ext === 'jpeg' ? 'jpg' : ext;
      images.push({
        pageNumber: slideNum,
        blob,
        width: null,
        height: null,
        storagePath: `${userId}/${groupId}/${mediaName}`,
      });
    } catch (err) {
      console.warn('Could not extract image:', err.message);
    }
  }
  return images;
}

// ── UPLOAD IMAGES TO SUPABASE STORAGE ─────────────────────────────────────────
async function uploadImages(images, userId, groupId, fileName, onProgress) {
  const saved = [];
  for (let idx = 0; idx < images.length; idx++) {
    const img = images[idx];
    if (idx % 5 === 0) onProgress(`Uploading image ${idx + 1} of ${images.length}…`);
    try {
      const { error: upErr } = await supabase.storage
        .from('source-images')
        .upload(img.storagePath, img.blob, { upsert: true, contentType: img.blob.type });
      if (upErr) { console.warn('Image upload failed:', upErr.message); continue; }

      const { data: urlData } = supabase.storage
        .from('source-images')
        .getPublicUrl(img.storagePath);

      const { error: dbErr } = await supabase.from('source_images').insert({
        user_id: userId,
        source_group_id: groupId,
        file_name: fileName,
        page_number: img.pageNumber,
        storage_path: img.storagePath,
        public_url: urlData.publicUrl,
        width: img.width,
        height: img.height,
      });
      if (!dbErr) saved.push({ pageNumber: img.pageNumber, url: urlData.publicUrl });
    } catch (err) {
      console.warn('Image processing error:', err.message);
    }
  }
  return saved;
}

// ── CHUNK SECTIONER ───────────────────────────────────────────────────────────
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

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function Sources() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sources, setSources] = useState([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadPhase, setUploadPhase] = useState(''); // text | images | saving
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [extractImages, setExtractImages] = useState(true);
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
      .select('id, file_name, total_pages, chunk_count, created_at, source_group_id, part_index, total_parts')
      .eq('user_id', session.user.id)
      .eq('part_index', 0)
      .order('created_at', { ascending: false });
    setSources(data || []);
    setLoadingSources(false);
  }, [session]);

  useEffect(() => { if (session) loadSources(); }, [session]);

  const processFile = useCallback(async (f) => {
    if (!f || !session) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['pdf', 'pptx'].includes(ext)) { setError('Only PDF and PPTX files are supported.'); return; }

    setUploading(true); setError(null); setUploadPercent(0);
    setUploadProgress('Starting…'); setUploadPhase('text');

    try {
      const groupId = crypto.randomUUID();
      const userId = session.user.id;

      // ── Extract text ──────────────────────────────────────────────────
      let extracted;
      let pdfDocRef = null;
      let zipRef = null;

      if (ext === 'pdf') {
        extracted = await extractPdfClientSide(f, setUploadProgress);
        pdfDocRef = extracted.pdfDoc;
      } else {
        extracted = await extractPptxClientSide(f, setUploadProgress);
        zipRef = extracted.zip;
      }

      setUploadProgress('Chunking content…');
      const chunks = chunkSections(extracted.sections);
      const totalBatches = Math.ceil(chunks.length / CHUNKS_PER_BATCH);

      // ── Extract + upload images ───────────────────────────────────────
      if (extractImages) {
        setUploadPhase('images');
        setUploadProgress('Extracting images from document…');
        let rawImages = [];
        if (ext === 'pdf' && pdfDocRef) {
          rawImages = await extractPdfImages(pdfDocRef, userId, groupId, f.name, setUploadProgress);
        } else if (ext === 'pptx' && zipRef) {
          rawImages = await extractPptxImages(zipRef, userId, groupId, setUploadProgress);
        }

        if (rawImages.length > 0) {
          setUploadProgress(`Uploading ${rawImages.length} images…`);
          await uploadImages(rawImages, userId, groupId, f.name, setUploadProgress);
        }
      }

      // ── Delete existing source with same name ─────────────────────────
      setUploadPhase('saving');
      setUploadProgress('Replacing existing version if any…');
      const { data: existing } = await supabase
        .from('sources').select('source_group_id')
        .eq('user_id', userId).eq('file_name', f.name).eq('part_index', 0)
        .maybeSingle();

      if (existing?.source_group_id) {
        // Delete old images too
        await supabase.from('source_images').delete()
          .eq('user_id', userId).eq('source_group_id', existing.source_group_id);
        await supabase.from('sources').delete()
          .eq('user_id', userId).eq('source_group_id', existing.source_group_id);
      } else {
        await supabase.from('sources').delete()
          .eq('user_id', userId).eq('file_name', f.name);
      }

      // ── Save chunks in batches ────────────────────────────────────────
      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchChunks = chunks.slice(batchIdx * CHUNKS_PER_BATCH, (batchIdx + 1) * CHUNKS_PER_BATCH);
        const percent = Math.round(((batchIdx + 1) / totalBatches) * 100);
        setUploadPercent(percent);
        setUploadProgress(`Saving batch ${batchIdx + 1} of ${totalBatches} (${percent}%)…`);

        const { error: saveErr } = await supabase.from('sources').insert({
          user_id: userId, file_name: f.name,
          total_pages: extracted.totalPages, chunk_count: chunks.length,
          chunks: batchChunks, part_index: batchIdx,
          total_parts: totalBatches, source_group_id: groupId,
        });
        if (saveErr) throw new Error(`Batch ${batchIdx + 1} failed: ${saveErr.message}`);
      }

      setUploadProgress('Done!');
      setUploadPercent(100);
      await loadSources();
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false); setUploadProgress(''); setUploadPercent(0); setUploadPhase('');
    }
  }, [session, loadSources, extractImages]);

  const deleteSource = async (src) => {
    if (!confirm('Remove this source and all its images?')) return;
    setDeleting(src.id);
    if (src.source_group_id) {
      // Delete storage images
      const { data: imgs } = await supabase.from('source_images')
        .select('storage_path').eq('source_group_id', src.source_group_id);
      if (imgs?.length) {
        await supabase.storage.from('source-images').remove(imgs.map(i => i.storage_path));
      }
      await supabase.from('source_images').delete().eq('source_group_id', src.source_group_id);
      await supabase.from('sources').delete().eq('user_id', session.user.id).eq('source_group_id', src.source_group_id);
    } else {
      await supabase.from('sources').delete().eq('user_id', session.user.id).eq('file_name', src.file_name);
    }
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

  const phaseLabel = uploadPhase === 'text' ? '📝 Extracting text' : uploadPhase === 'images' ? '🖼 Extracting images' : uploadPhase === 'saving' ? '💾 Saving to library' : '';

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
              Text + Images · Any size · Stored permanently
            </p>
          </div>

          {/* Image toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px', background: '#141414', border: '1px solid #222', borderRadius: 10 }}>
            <div
              onClick={() => setExtractImages(v => !v)}
              style={{
                width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
                background: extractImages ? '#c9a86c' : '#2a2a2a',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: extractImages ? 18 : 3,
                width: 14, height: 14, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s',
              }} />
            </div>
            <div>
              <p style={{ ...m, fontSize: '0.76rem', color: extractImages ? '#c9a86c' : '#666' }}>
                Extract images from documents
              </p>
              <p style={{ ...m, fontSize: '0.62rem', color: '#444', marginTop: 2 }}>
                {extractImages ? 'Images will be stored and shown in answers · Adds extra upload time' : 'Text only · Faster upload'}
              </p>
            </div>
          </div>

          {/* Upload zone */}
          <div
            className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDrop={e => { e.preventDefault(); setDragOver(false); if (!uploading) processFile(e.dataTransfer.files[0]); }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => !uploading && fileRef.current.click()}
            style={{ opacity: uploading ? 0.85 : 1, cursor: uploading ? 'default' : 'pointer' }}
          >
            <input ref={fileRef} type="file" accept=".pdf,.pptx" style={{ display: 'none' }} onChange={e => processFile(e.target.files[0])} />

            {uploading ? (
              <>
                <div style={{ width: '80%', maxWidth: 300, background: '#1e1e1e', borderRadius: 4, height: 4, margin: '0 auto 16px', overflow: 'hidden' }}>
                  <div style={{ width: `${uploadPercent}%`, height: '100%', background: uploadPhase === 'images' ? '#7eb8c9' : '#c9a86c', borderRadius: 4, transition: 'width 0.3s ease' }} />
                </div>
                {phaseLabel && <p style={{ ...m, fontSize: '0.65rem', color: '#555', marginBottom: 6 }}>{phaseLabel}</p>}
                <p style={{ ...serif, fontSize: '1.1rem', color: '#e2ddd6', marginBottom: 8 }}>Processing…</p>
                <p style={{ ...m, fontSize: '0.7rem', color: '#c9a86c', marginBottom: 4 }}>{uploadProgress}</p>
              </>
            ) : (
              <>
                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📚</div>
                <p style={{ ...serif, fontSize: '1.2rem', color: '#e2ddd6', marginBottom: 8 }}>Add a source</p>
                <p style={{ ...m, fontSize: '0.72rem', color: '#666' }}>
                  Drop here or <strong style={{ color: '#c9a86c' }}>tap to browse</strong>
                </p>
                <p style={{ ...m, fontSize: '0.65rem', color: '#444', marginTop: 8 }}>
                  PDF or PPTX · Any size · {extractImages ? 'Text + Images extracted' : 'Text only'}
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
                <SourceCard key={src.id} src={src} onDelete={deleteSource} deleting={deleting} />
              ))}
            </div>
          )}

          {sources.length > 0 && (
            <div style={{ marginTop: 28, background: '#17150e', border: '1px solid #3a3020', borderRadius: 10, padding: '16px 20px' }}>
              <p style={{ ...m, fontSize: '0.72rem', color: '#c9a86c', marginBottom: 4 }}>✓ Sources ready</p>
              <p style={{ ...m, fontSize: '0.68rem', color: '#666' }}>
                Go to <Link href="/" style={{ color: '#c9a86c', textDecoration: 'none' }}>Dashboard</Link> to select and analyze.
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

// ── Source card with image preview ────────────────────────────────────────────
function SourceCard({ src, onDelete, deleting }) {
  const [images, setImages] = useState([]);
  const [showImages, setShowImages] = useState(false);
  const m = { fontFamily: "'IBM Plex Mono',monospace" };

  useEffect(() => {
    if (!showImages || !src.source_group_id) return;
    supabase.from('source_images')
      .select('public_url, page_number')
      .eq('source_group_id', src.source_group_id)
      .order('page_number', { ascending: true })
      .limit(20)
      .then(({ data }) => setImages(data || []));
  }, [showImages, src.source_group_id]);

  return (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
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
          onClick={() => setShowImages(v => !v)}
          style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, color: '#666', cursor: 'pointer', padding: '5px 10px', ...m, fontSize: '0.65rem' }}
        >
          🖼 {showImages ? 'hide' : 'images'}
        </button>
        <button
          onClick={() => onDelete(src)}
          disabled={deleting === src.id}
          style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, color: '#555', cursor: 'pointer', padding: '6px 12px', ...m, fontSize: '0.68rem' }}
          onMouseOver={e => e.target.style.borderColor = '#d95f5f'}
          onMouseOut={e => e.target.style.borderColor = '#2a2a2a'}
        >
          {deleting === src.id ? '…' : 'Remove'}
        </button>
      </div>

      {showImages && (
        <div style={{ padding: '0 18px 16px', borderTop: '1px solid #1e1e1e', marginTop: 0 }}>
          {images.length === 0 ? (
            <p style={{ ...m, fontSize: '0.68rem', color: '#444', paddingTop: 14 }}>No images stored for this source. Re-upload with "Extract images" enabled.</p>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 14 }}>
              {images.map((img, idx) => (
                <div key={idx} style={{ position: 'relative' }}>
                  <img
                    src={img.public_url}
                    alt={`Page ${img.page_number}`}
                    style={{ height: 80, width: 'auto', borderRadius: 4, border: '1px solid #2a2a2a', objectFit: 'cover', cursor: 'pointer' }}
                    onClick={() => window.open(img.public_url, '_blank')}
                    title={`Page/Slide ${img.page_number}`}
                  />
                  {img.page_number && (
                    <span style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(0,0,0,0.7)', ...m, fontSize: '0.55rem', color: '#aaa', padding: '1px 4px', borderRadius: 3 }}>
                      p{img.page_number}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
