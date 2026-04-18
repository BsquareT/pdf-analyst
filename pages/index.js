import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { supabase } from '../lib/supabase';
import Layout from '../components/Layout';
import PaymentModal from '../components/PaymentModal';

const DEFAULT_STRUCTURE = `##1. Definition & Etiopathogenesis
Definition: A precise, standard textbook definition (e.g., Harrison's or Bailey & Love).
Etiology: Risk factors, causative agents, or genetic predispositions.
Pathophysiology: A brief flow-chart style explanation of how the disease progresses.
Classification or types or grading if present
(Self-Study Note: This is where you connect the basic sciences—Pathology and Physiology—to the clinical presentation. Understanding the "why" makes the symptoms "obvious" rather than something to memorize.)

##2. Clinical Features
Symptoms: Chief complaints (what the patient feels).
Signs: Physical examination findings (e.g., specific murmurs, palpation findings, or classic triads).
(Self-Study Note: Look for "Pathognomonic" signs—signs so specific they essentially name the disease. Mentioning these in exams shows high-level competence.)

##3. Investigations (The Diagnostic Workup)
Gold Standard: The single best test for diagnosis.
Bedside/Routine: CBC, Urine, etc.
Imaging/Special Tests: X-rays, CT/MRI, Biopsy, or Serology.
(Self-Study Note: In the Indian context, always think in terms of "Step-wise approach": non-invasive first, then invasive.)

##4. Differential Diagnosis (D/D)
List 3–5 similar conditions and 1–2 points on how to distinguish them.
(Self-Study Note: This demonstrates clinical reasoning, showing you aren't just memorizing one disease in a vacuum.)

##5. Management (Medical & Surgical)
General/Conservative: Rest, diet, hydration.
Pharmacotherapy: Specific drugs, dosages (if relevant), and duration.
Surgical/Interventional: Indications and names of specific procedures.
(Self-Study Note: Remember the "ABC" or "Emergency Stabilization" protocols if the condition is acute, like MI or Intestinal Obstruction.)

##6. Complications & Prognosis
What happens if left untreated? (Acute vs. Chronic complications).
(Self-Study Note: Think anatomically—how the disease spreads to nearby organs—to logically deduce complications.)`;

const STOP = new Set(['the','is','at','which','on','a','an','and','or','but','in','of','to','for','with','by','from','as','are','was','were','been','be','have','has','had','do','does','did','will','would','could','should','may','might','this','that','these','those','it','its','what','when','where','how','why','who','about','than','into','me','my','you','your','we','our','they','their','i','am','not','can','if']);

function findRelevantChunks(chunks, query, topN = 16) {
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
  const top = scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, topN);
  if (top.length < 3) top.push(...chunks.slice(0, 3).filter(c => !top.find(t => t.idx === c.idx)));
  return top.sort((a, b) => a.idx - b.idx);
}

function renderMd(text) {
  return text.split('\n').map((line, i) => {
    if (line.startsWith('##')) return <div key={i} className="md-h2">{line.replace(/^#+\s*/, '')}</div>;
    if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} className="md-li">· {line.slice(2)}</div>;
    if (line.trim()) return <div key={i} className="md-p">{line}</div>;
    return <div key={i} style={{ height: 8 }} />;
  });
}

// Loading screen overlay
function LoadingOverlay({ question }) {
  const [dot, setDot] = useState(0);
  const [tip, setTip] = useState(0);
  const tips = [
    'Searching relevant pages…',
    'Reading your sources…',
    'Cross-referencing content…',
    'Structuring the answer…',
    'Almost there…',
  ];

  useEffect(() => {
    const d = setInterval(() => setDot(n => (n + 1) % 4), 400);
    const t = setInterval(() => setTip(n => (n + 1) % tips.length), 2500);
    return () => { clearInterval(d); clearInterval(t); };
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(12,12,12,0.92)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      padding: 20,
    }}>
      {/* Spinner */}
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        border: '3px solid #1e1e1e', borderTopColor: '#c9a86c',
        animation: 'spin 0.8s linear infinite', marginBottom: 28,
      }} />

      <p style={{ fontFamily: "'Playfair Display',serif", fontWeight: 400, fontSize: '1.3rem', color: '#e2ddd6', marginBottom: 8, textAlign: 'center' }}>
        Analysing{'.'.repeat(dot + 1)}
      </p>

      {question?.trim() && (
        <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#666', marginBottom: 20, textAlign: 'center', maxWidth: 400 }}>
          "{question.length > 60 ? question.slice(0, 60) + '…' : question}"
        </p>
      )}

      <div style={{
        fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.68rem', color: '#c9a86c',
        background: '#17150e', border: '1px solid #3a3020', borderRadius: 8,
        padding: '10px 20px', animation: 'fadeIn 0.4s ease',
        textAlign: 'center',
      }}>
        {tips[tip]}
      </div>

      <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.62rem', color: '#333', marginTop: 24, textAlign: 'center' }}>
        This may take 15–30 seconds for large documents
      </p>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
      `}</style>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Sources
  const [savedSources, setSavedSources] = useState([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState([]);
  const [loadingSources, setLoadingSources] = useState(false);

  const [structure, setStructure] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('pdf_analyst_structure') || DEFAULT_STRUCTURE;
    }
    return DEFAULT_STRUCTURE;
  });
  const [structureOpen, setStructureOpen] = useState(false);
  const [structureSaved, setStructureSaved] = useState(false);

  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | analyzing | done
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('rendered');
  const [copied, setCopied] = useState(false);
  const [showPayment, setShowPayment] = useState(false);

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/login');
    });
    return () => subscription.unsubscribe();
  }, []);

  const token = session?.access_token;

  // Load saved sources
  useEffect(() => {
    if (!token) return;
    setLoadingSources(true);
    fetch('/api/sources/list', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setSavedSources(d.sources || []); setLoadingSources(false); });
  }, [token]);

  const toggleSource = (id) => {
    setSelectedSourceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const saveStructure = () => {
    localStorage.setItem('pdf_analyst_structure', structure);
    setStructureSaved(true);
    setTimeout(() => setStructureSaved(false), 2000);
  };

  const resetStructure = () => {
    setStructure(DEFAULT_STRUCTURE);
    localStorage.setItem('pdf_analyst_structure', DEFAULT_STRUCTURE);
  };

  const analyze = async () => {
    if (!selectedSourceIds.length) return;
    setStatus('analyzing'); setError(null); setResult(null); setFromCache(false);

    try {
      // Fetch chunks for selected sources
      const sourceNames = savedSources.filter(s => selectedSourceIds.includes(s.id)).map(s => s.file_name);
      const chunksRes = await fetch('/api/sources/get-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chunks: relevant, question, structure, fileName: sourceNames.join(', '), sourceNames }),
      });
      const chunksData = await chunksRes.json();
      if (chunksData.error) throw new Error(chunksData.error);

      const relevant = findRelevantChunks(chunksData.chunks, question);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          chunks: relevant,
          question,
          structure,
          fileName: selectedSourceIds.length === 1
            ? savedSources.find(s => s.id === selectedSourceIds[0])?.file_name
            : `${selectedSourceIds.length} sources`,
        }),
      });
      const data = await res.json();
      if (data.error === 'quota_exceeded') { setShowPayment(true); setStatus('idle'); return; }
      if (data.error) throw new Error(data.error);

      setResult(data.result);
      setFromCache(!!data.fromCache);
      setProfile(p => ({ ...p, questions_remaining: data.questionsRemaining, membership_type: data.membershipType }));
      setStatus('done');
      if (data.questionsRemaining === 0 && data.membershipType === 'free') setShowPayment(true);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) {
      setError(err.message || 'Analysis failed.');
      setStatus('idle');
    }
  };

  const onPaymentSuccess = (data) => {
    setShowPayment(false);
    setProfile(p => ({ ...p, membership_type: data.membershipType, questions_remaining: data.questionsRemaining, membership_expires_at: data.expiresAt }));
  };

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: '#0c0c0c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: '#555' }}>Loading…</p>
    </div>
  );

  const isAnalyzing = status === 'analyzing';

  const s = {
    label: { fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#c9a86c', marginBottom: 10 },
    card: { background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '20px', marginBottom: 18 },
    hint: { fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.68rem', color: '#555', marginBottom: 10, lineHeight: 1.5 },
    textarea: { width: '100%', background: '#0f0f0f', border: '1px solid #222', borderRadius: 8, color: '#d4cec6', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.76rem', lineHeight: 1.7, padding: '14px 16px', resize: 'vertical', minHeight: 180, outline: 'none', boxSizing: 'border-box' },
    input: { width: '100%', background: '#0f0f0f', border: '1px solid #222', borderRadius: 8, color: '#d4cec6', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.8rem', padding: '12px 16px', outline: 'none', boxSizing: 'border-box' },
    btn: { width: '100%', padding: '15px', background: '#c9a86c', color: '#0c0c0c', border: 'none', borderRadius: 9, fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.05em', cursor: 'pointer', marginTop: 6 },
  };

  return (
    <>
      <Head><title>PDF Analyst</title></Head>
      {isAnalyzing && <LoadingOverlay question={question} />}
      <Layout user={session?.user} profile={profile}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '40px 20px 80px 72px' }}>

          {/* Header */}
          <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid #1e1e1e' }}>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 400, fontSize: '2rem', color: '#e2ddd6', letterSpacing: '-0.02em' }}>
              PDF <em style={{ color: '#c9a86c', fontStyle: 'italic' }}>Analyst</em>
            </h1>
            <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem', color: '#555', marginTop: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Textbooks · Presentations · Smart Caching
            </p>
          </div>

          {/* Output Structure - always visible, collapsible */}
          <div style={{ marginBottom: 18 }}>
            <button
              onClick={() => setStructureOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: structureOpen ? '#17150e' : '#141414',
                border: `1px solid ${structureOpen ? '#3a3020' : '#222'}`,
                borderRadius: 8, padding: '10px 16px', cursor: 'pointer',
                fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem',
                color: structureOpen ? '#c9a86c' : '#666',
                letterSpacing: '0.06em', width: '100%', textAlign: 'left', transition: 'all 0.15s',
              }}
            >
              <span>⚙</span>
              <span>Output Structure</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.65rem' }}>{structureOpen ? '▲ hide' : '▼ edit'}</span>
            </button>

            {structureOpen && (
              <div style={{ ...s.card, marginTop: 8, marginBottom: 0 }}>
                <p style={s.hint}>Saved to your browser — set it once and it persists. Use ## headings, bullets, or plain instructions.</p>
                <textarea style={{ ...s.textarea, minHeight: 260 }} value={structure} onChange={e => setStructure(e.target.value)} rows={12} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={saveStructure} style={{ flex: 1, padding: '10px', background: '#c9a86c', color: '#0c0c0c', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', fontWeight: 500, letterSpacing: '0.05em' }}>
                    {structureSaved ? '✓ Saved!' : 'Save Structure'}
                  </button>
                  <button onClick={resetStructure} style={{ padding: '10px 16px', background: 'transparent', border: '1px solid #333', borderRadius: 7, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#555' }}>
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Source Selection */}
          <div style={s.card}>
            <div style={s.label}>Select Sources to Analyze</div>

            {loadingSources ? (
              <p style={{ ...s.hint, marginBottom: 0 }}>Loading your library…</p>
            ) : savedSources.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: '#444', marginBottom: 12 }}>
                  No sources yet. Upload your PDFs first.
                </p>
                <Link href="/sources" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#c9a86c', textDecoration: 'none', border: '1px solid #3a3020', borderRadius: 6, padding: '8px 16px', background: '#17150e' }}>
                  → Go to Sources
                </Link>
              </div>
            ) : (
              <>
                <p style={s.hint}>Select one or more sources. Claude will search across all of them.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {savedSources.map(src => {
                    const selected = selectedSourceIds.includes(src.id);
                    return (
                      <div
                        key={src.id}
                        onClick={() => toggleSource(src.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                          background: selected ? '#17150e' : '#0f0f0f',
                          border: `1px solid ${selected ? '#3a3020' : '#2a2a2a'}`,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          border: `2px solid ${selected ? '#c9a86c' : '#444'}`,
                          background: selected ? '#c9a86c' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {selected && <span style={{ color: '#0c0c0c', fontSize: '0.7rem', fontWeight: 700 }}>✓</span>}
                        </div>
                        <span style={{ fontSize: '1rem' }}>{src.file_name.endsWith('.pptx') ? '📊' : '📄'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.78rem', color: selected ? '#c9a86c' : '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {src.file_name}
                          </p>
                          <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.6rem', color: '#444' }}>
                            {src.total_pages} pages · {src.chunk_count} chunks
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {selectedSourceIds.length > 0 && (
                  <p style={{ ...s.hint, marginTop: 10, marginBottom: 0, color: '#c9a86c' }}>
                    ✓ {selectedSourceIds.length} source{selectedSourceIds.length > 1 ? 's' : ''} selected
                  </p>
                )}
              </>
            )}
          </div>

          {/* Question */}
          {selectedSourceIds.length > 0 && (
            <div style={s.card}>
              <div style={s.label}>Your Question <span style={{ color: '#444', fontWeight: 400 }}>(optional)</span></div>
              <p style={s.hint}>Ask something specific or leave blank for a full analysis.</p>
              <input
                style={s.input}
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !isAnalyzing && analyze()}
                placeholder="e.g.  Explain the management of acute appendicitis"
              />
            </div>
          )}

          {selectedSourceIds.length > 0 && (
            <button
              style={{ ...s.btn, opacity: isAnalyzing ? 0.5 : 1, cursor: isAnalyzing ? 'not-allowed' : 'pointer' }}
              onClick={analyze}
              disabled={isAnalyzing}
            >
              Analyze →
            </button>
          )}

          {error && (
            <div style={{ background: '#140d0d', border: '1px solid #3a1515', borderRadius: 8, padding: '12px 16px', marginTop: 14, fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: '#d95f5f' }}>
              ⚠ {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div style={{ marginTop: 28 }} ref={resultRef}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <span style={s.label}>Result</span>
                  {fromCache && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.6rem', color: '#6bcf7f', marginLeft: 10, border: '1px solid #1a3a1a', borderRadius: 4, padding: '2px 7px' }}>⚡ from cache</span>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['rendered', 'raw'].map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', background: tab === t ? '#17150e' : 'transparent', border: `1px solid ${tab === t ? '#3a3020' : '#222'}`, borderRadius: 6, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.66rem', letterSpacing: '0.06em', color: tab === t ? '#c9a86c' : '#555' }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                  <button onClick={() => { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ padding: '6px 14px', background: 'transparent', border: '1px solid #222', borderRadius: 6, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.66rem', color: '#555' }}>
                    {copied ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>
              <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '24px', animation: 'fadeUp 0.3s ease' }}>
                {tab === 'rendered' ? renderMd(result) : (
                  <pre style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#777', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{result}</pre>
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
        .md-h2 { font-family:'Playfair Display',serif; font-weight:600; font-size:1.05rem; color:#c9a86c; margin:22px 0 8px; padding-bottom:6px; border-bottom:1px solid #1e1e1e; }
        .md-h3 { font-family:'Playfair Display',serif; font-style:italic; font-size:0.95rem; color:#e2ddd6; margin:14px 0 6px; }
        .md-p { font-family:'IBM Plex Sans',sans-serif; font-size:0.84rem; line-height:1.8; color:#a09a92; margin-bottom:8px; }
        .md-li { font-family:'IBM Plex Sans',sans-serif; font-size:0.84rem; line-height:1.8; color:#a09a92; padding-left:14px; margin-bottom:2px; }
      `}</style>
    </>
  );
}
