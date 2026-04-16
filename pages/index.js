import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import Layout from '../components/Layout';
import PaymentModal from '../components/PaymentModal';

const DEFAULT_STRUCTURE = `## Summary
A clear 3-5 sentence overview of the relevant content.

## Key Concepts
- The main theories, ideas, or topics covered

## Important Details
- Specific facts, figures, formulas, examples, or dates worth noting

## What I Should Understand
- 3-5 key takeaways a student should be able to explain after reading this`;

const STOP = new Set(['the','is','at','which','on','a','an','and','or','but','in','of','to','for','with','by','from','as','are','was','were','been','be','have','has','had','do','does','did','will','would','could','should','may','might','this','that','these','those','it','its','what','when','where','how','why','who','about','than','into','me','my','you','your','we','our','they','their','i','am','not','can','if']);

function findRelevantChunks(chunks, query, topN = 12) {
  if (!query.trim()) {
    if (chunks.length <= topN) return chunks;
    const step = Math.max(1, Math.floor(chunks.length / topN));
    return Array.from({ length: topN }, (_, i) => chunks[Math.min(i * step, chunks.length - 1)]);
  }
  const terms = query.toLowerCase().split(/\W+/).filter(t => t.length > 2 && !STOP.has(t));
  if (!terms.length) return chunks.slice(0, topN);
  const scored = chunks.map((c, idx) => {
    const lower = c.text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lower.includes(t)) score += 2;
      score += (lower.match(new RegExp(t, 'g')) || []).length;
    }
    return { ...c, score, idx };
  });
  const top = scored.filter(c => c.score > 0).sort((a,b) => b.score-a.score).slice(0, topN);
  if (top.length < 3) top.push(...chunks.slice(0,3).filter(c => !top.find(t => t.idx===c.idx)));
  return top.sort((a,b) => a.idx - b.idx);
}

function renderMd(text) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('## ')) return <div key={i} className="md-h2">{line.slice(3)}</div>;
    if (line.startsWith('### ')) return <div key={i} className="md-h3">{line.slice(4)}</div>;
    if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} className="md-li">· {line.slice(2)}</div>;
    if (line.trim()) return <div key={i} className="md-p">{line}</div>;
    return <div key={i} style={{height:8}} />;
  });
}

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [file, setFile] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [structure, setStructure] = useState(DEFAULT_STRUCTURE);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [tab, setTab] = useState('rendered');
  const [copied, setCopied] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

  const fileRef = useRef();
  const resultRef = useRef();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setSession(session);
      const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (!p?.approved) { await supabase.auth.signOut(); router.replace('/pending'); return; }
      setProfile(p);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') router.replace('/login');
    });
    return () => subscription.unsubscribe();
  }, []);

  const token = session?.access_token;

  const processFile = useCallback(async (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['pdf','pptx'].includes(ext)) { setError('Only PDF and PPTX files are supported.'); return; }
    setFile(f); setChunks([]); setResult(null); setError(null);
    setStatus('extracting'); setStatusMsg('Uploading…');
    const formData = new FormData();
    formData.append('file', f);
    try {
      setStatusMsg('Extracting text…');
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setChunks(data.chunks);
      setTotalPages(data.totalPages);
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Failed to process file.');
      setStatus('idle'); setFile(null);
    }
  }, [token]);

  const analyze = async () => {
    if (!chunks.length) return;
    setStatus('analyzing'); setError(null); setResult(null); setFromCache(false);
    const relevant = findRelevantChunks(chunks, question);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chunks: relevant, question, structure, fileName: file?.name }),
      });
      const data = await res.json();
      if (data.error === 'quota_exceeded') {
        setShowPayment(true);
        setStatus('ready');
        return;
      }
      if (data.error) throw new Error(data.error);
      setResult(data.result);
      setFromCache(!!data.fromCache);
      setProfile(p => ({ ...p, questions_remaining: data.questionsRemaining, membership_type: data.membershipType }));
      setStatus('done');
      if (data.questionsRemaining === 0 && data.membershipType === 'free') setShowPayment(true);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) {
      setError(err.message || 'Analysis failed.');
      setStatus('ready');
    }
  };

  const onPaymentSuccess = (data) => {
    setShowPayment(false);
    setProfile(p => ({
      ...p,
      membership_type: data.membershipType,
      questions_remaining: data.questionsRemaining,
      membership_expires_at: data.expiresAt,
    }));
  };

  const reset = () => { setFile(null); setChunks([]); setResult(null); setError(null); setStatus('idle'); setQuestion(''); };

  if (authLoading) return (
    <div style={{ minHeight:'100vh', background:'#0c0c0c', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <p style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.75rem', color:'#555' }}>Loading…</p>
    </div>
  );

  const isReady = status === 'ready' || status === 'done';
  const isAnalyzing = status === 'analyzing';
  const isExtracting = status === 'extracting';

  const s = {
    label: { fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.62rem', letterSpacing:'0.14em', textTransform:'uppercase', color:'#c9a86c', marginBottom:10 },
    card: { background:'#141414', border:'1px solid #222', borderRadius:12, padding:'20px', marginBottom:18 },
    hint: { fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.68rem', color:'#555', marginBottom:10, lineHeight:1.5 },
    textarea: { width:'100%', background:'#0f0f0f', border:'1px solid #222', borderRadius:8, color:'#d4cec6', fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.76rem', lineHeight:1.7, padding:'14px 16px', resize:'vertical', minHeight:180, outline:'none', boxSizing:'border-box' },
    input: { width:'100%', background:'#0f0f0f', border:'1px solid #222', borderRadius:8, color:'#d4cec6', fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.8rem', padding:'12px 16px', outline:'none', boxSizing:'border-box' },
    btn: { width:'100%', padding:'15px', background:'#c9a86c', color:'#0c0c0c', border:'none', borderRadius:9, fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.8rem', fontWeight:500, letterSpacing:'0.05em', cursor:'pointer', marginTop:6 },
  };

  return (
    <>
      <Head><title>PDF Analyst</title></Head>
      <Layout user={session?.user} profile={profile}>
        <div style={{ maxWidth:880, margin:'0 auto', padding:'40px 20px 80px 72px' }}>
          {/* Header */}
          <div style={{ marginBottom:40, paddingBottom:24, borderBottom:'1px solid #1e1e1e' }}>
            <h1 style={{ fontFamily:"'Playfair Display',serif", fontWeight:400, fontSize:'2rem', color:'#e2ddd6', letterSpacing:'-0.02em' }}>
              PDF <em style={{ color:'#c9a86c', fontStyle:'italic' }}>Analyst</em>
            </h1>
            <p style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.65rem', color:'#555', marginTop:6, letterSpacing:'0.08em', textTransform:'uppercase' }}>
              Textbooks · Presentations · Smart Caching
            </p>
          </div>

          {/* IDLE: Upload */}
          {status === 'idle' && (
            <>
              <div style={s.label}>01 — Upload Document</div>
              <div
                className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
                onDrop={e => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]); }}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileRef.current.click()}
              >
                <input ref={fileRef} type="file" accept=".pdf,.pptx" style={{display:'none'}} onChange={e => processFile(e.target.files[0])} />
                <div style={{ fontSize:'2.5rem', marginBottom:12 }}>📚</div>
                <p style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.2rem', color:'#e2ddd6', marginBottom:8 }}>Drop your file here</p>
                <p style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.72rem', color:'#666' }}>
                  or <strong style={{ color:'#c9a86c' }}>tap to browse</strong> — PDF or PPTX, any size
                </p>
              </div>
            </>
          )}

          {/* EXTRACTING */}
          {isExtracting && (
            <div style={{ ...s.card, textAlign:'center', padding:'36px 24px' }}>
              <div style={{ width:36, height:36, border:'2px solid #2a2a2a', borderTopColor:'#c9a86c', borderRadius:'50%', margin:'0 auto 16px', animation:'spin 0.7s linear infinite' }} />
              <p style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.1rem', color:'#e2ddd6', marginBottom:8 }}>Processing your document…</p>
              <p style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.7rem', color:'#666' }}>{statusMsg} Large files may take 30–60s.</p>
            </div>
          )}

          {/* READY / DONE */}
          {isReady && (
            <>
              {/* File pill */}
              <div style={{ display:'flex', alignItems:'center', gap:10, background:'#17150e', border:'1px solid #3a3020', borderRadius:8, padding:'10px 16px', marginBottom:18 }}>
                <span>📄</span>
                <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.78rem', color:'#c9a86c', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{file?.name}</span>
                <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.65rem', color:'#555', whiteSpace:'nowrap' }}>{totalPages} pages · {chunks.length} chunks</span>
                <button onClick={reset} style={{ background:'none', border:'none', cursor:'pointer', color:'#555', fontSize:'1rem' }}>✕</button>
              </div>

              {/* Stats */}
              <div style={{ display:'flex', gap:10, marginBottom:18, flexWrap:'wrap' }}>
                {[
                  { n: totalPages.toLocaleString(), l: 'Pages / Slides' },
                  { n: chunks.length.toLocaleString(), l: 'Text Chunks' },
                  { n: findRelevantChunks(chunks, question).length, l: 'Chunks to Analyze' },
                ].map(({ n, l }) => (
                  <div key={l} style={{ background:'#141414', border:'1px solid #222', borderRadius:8, padding:'12px 16px', flex:1, minWidth:100 }}>
                    <span style={{ display:'block', fontFamily:"'Playfair Display',serif", fontSize:'1.4rem', color:'#c9a86c' }}>{n}</span>
                    <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.6rem', color:'#555', textTransform:'uppercase', letterSpacing:'0.08em' }}>{l}</span>
                  </div>
                ))}
              </div>

              {/* Structure */}
              <div style={s.card}>
                <div style={s.label}>02 — Output Structure</div>
                <p style={s.hint}>Define exactly how you want Claude to respond. Use ## headings, bullet points, or plain instructions.</p>
                <textarea style={s.textarea} value={structure} onChange={e => setStructure(e.target.value)} rows={10} />
              </div>

              {/* Question */}
              <div style={s.card}>
                <div style={s.label}>03 — Question <span style={{ color:'#444', fontWeight:400 }}>(optional)</span></div>
                <p style={s.hint}>Ask something specific to focus on relevant pages, or leave blank for a full analysis.</p>
                <input style={s.input} type="text" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key==='Enter' && !isAnalyzing && analyze()} placeholder="e.g.  What is Newton's third law?" />
                <p style={{ ...s.hint, marginTop:8, marginBottom:0 }}>
                  → {question.trim() ? `Keyword search will select the most relevant chunks` : `Sampling chunks evenly across the document`}
                </p>
              </div>

              <button
                style={{ ...s.btn, background: isAnalyzing ? '#17150e' : '#c9a86c', color: isAnalyzing ? '#c9a86c' : '#0c0c0c', border: isAnalyzing ? '1px solid #3a3020' : 'none', cursor: isAnalyzing ? 'not-allowed' : 'pointer' }}
                onClick={analyze} disabled={isAnalyzing}
              >
                {isAnalyzing ? '⏳ Analyzing…' : 'Analyze →'}
              </button>
            </>
          )}

          {error && (
            <div style={{ background:'#140d0d', border:'1px solid #3a1515', borderRadius:8, padding:'12px 16px', marginTop:14, fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.75rem', color:'#d95f5f' }}>⚠ {error}</div>
          )}

          {/* Results */}
          {result && (
            <div style={{ marginTop:28 }} ref={resultRef}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div>
                  <span style={s.label}>Result</span>
                  {fromCache && <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.6rem', color:'#6bcf7f', marginLeft:10, border:'1px solid #1a3a1a', borderRadius:4, padding:'2px 7px' }}>⚡ from cache</span>}
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  {['rendered','raw'].map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{ padding:'6px 14px', background: tab===t ? '#17150e' : 'transparent', border:`1px solid ${tab===t ? '#3a3020' : '#222'}`, borderRadius:6, cursor:'pointer', fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.66rem', letterSpacing:'0.06em', color: tab===t ? '#c9a86c' : '#555' }}>
                      {t.charAt(0).toUpperCase()+t.slice(1)}
                    </button>
                  ))}
                  <button onClick={() => { navigator.clipboard.writeText(result); setCopied(true); setTimeout(()=>setCopied(false),2000); }} style={{ padding:'6px 14px', background:'transparent', border:'1px solid #222', borderRadius:6, cursor:'pointer', fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.66rem', color:'#555' }}>
                    {copied ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>

              <div style={{ background:'#141414', border:'1px solid #222', borderRadius:12, padding:'24px', animation:'fadeUp 0.3s ease' }}>
                {tab === 'rendered' ? renderMd(result) : (
                  <pre style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.72rem', color:'#777', whiteSpace:'pre-wrap', lineHeight:1.7 }}>{result}</pre>
                )}
              </div>
            </div>
          )}
        </div>

        {showPayment && (
          <PaymentModal
            token={token}
            userEmail={session?.user?.email}
            userName={profile?.name}
            onSuccess={onPaymentSuccess}
            onClose={() => setShowPayment(false)}
          />
        )}
      </Layout>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .drop-zone { border: 1.5px dashed #2a2a2a; border-radius:12px; background:#141414; padding:48px 20px; text-align:center; cursor:pointer; transition:all 0.2s; margin-bottom:18px; }
        .drop-zone:hover, .drop-zone.drag-over { border-color:#c9a86c; background:#17150e; }
        .md-h2 { font-family:'Playfair Display',serif; font-weight:400; font-size:1.1rem; color:#c9a86c; margin:20px 0 8px; padding-bottom:6px; border-bottom:1px solid #1e1e1e; }
        .md-h3 { font-family:'Playfair Display',serif; font-style:italic; font-size:0.95rem; color:#e2ddd6; margin:14px 0 6px; }
        .md-p { font-family:'IBM Plex Sans',sans-serif; font-size:0.84rem; line-height:1.8; color:#a09a92; margin-bottom:8px; }
        .md-li { font-family:'IBM Plex Sans',sans-serif; font-size:0.84rem; line-height:1.8; color:#a09a92; padding-left:14px; }
      `}</style>
    </>
  );
}
