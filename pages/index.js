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
List 3-5 similar conditions and 1-2 points on how to distinguish them.
(Self-Study Note: This demonstrates clinical reasoning, showing you aren't just memorizing one disease in a vacuum.)

##5. Management (Medical & Surgical)
General/Conservative: Rest, diet, hydration.
Pharmacotherapy: Specific drugs, dosages (if relevant), and duration.
Surgical/Interventional: Indications and names of specific procedures.
(Self-Study Note: Remember the "ABC" or "Emergency Stabilization" protocols if the condition is acute, like MI or Intestinal Obstruction.)

##6. Complications & Prognosis
What happens if left untreated? (Acute vs. Chronic complications).
(Self-Study Note: Think anatomically-how the disease spreads to nearby organs-to logically deduce complications.)`;

const STOP = new Set(['the','is','at','which','on','a','an','and','or','but','in','of','to','for','with','by','from','as','are','was','were','been','be','have','has','had','do','does','did','will','would','could','should','may','might','this','that','these','those','it','its','what','when','where','how','why','who','about','than','into','me','my','you','your','we','our','they','their','i','am','not','can','if']);

function findRelevantChunks(chunks, query, topN = 16) {
  if (!query.trim()) {
    if (chunks.length <= topN) return chunks;
    const step = Math.max(1, Math.floor(chunks.length / topN));
    return Array.from({ length: topN }, (_, idx) => chunks[Math.min(idx * step, chunks.length - 1)]);
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
  return text.split('\n').map((line, idx) => {
    if (line.startsWith('##')) return <div key={idx} className="md-h2">{line.replace(/^#+\s*/, '')}</div>;
    if (line.startsWith('- ') || line.startsWith('* ')) return <div key={idx} className="md-li">. {line.slice(2)}</div>;
    if (line.trim()) return <div key={idx} className="md-p">{line}</div>;
    return <div key={idx} style={{ height: 8 }} />;
  });
}

function LoadingOverlay({ question }) {
  const [dot, setDot] = useState(0);
  const [tip, setTip] = useState(0);
  const tips = ['Searching relevant pages...','Reading your sources...','Cross-referencing content...','Structuring the answer...','Almost there...'];
  useEffect(() => {
    const d = setInterval(() => setDot(n => (n + 1) % 4), 400);
    const t = setInterval(() => setTip(n => (n + 1) % tips.length), 2500);
    return () => { clearInterval(d); clearInterval(t); };
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(12,12,12,0.92)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: 20 }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', border: '3px solid #1e1e1e', borderTopColor: '#c9a86c', animation: 'spin 0.8s linear infinite', marginBottom: 28 }} />
      <p style={{ fontFamily: "'Playfair Display',serif", fontWeight: 400, fontSize: '1.3rem', color: '#e2ddd6', marginBottom: 8, textAlign: 'center' }}>
        Analysing{'.'.repeat(dot + 1)}
      </p>
      {question && question.trim() && (
        <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#666', marginBottom: 20, textAlign: 'center', maxWidth: 400 }}>
          "{question.length > 60 ? question.slice(0, 60) + '...' : question}"
        </p>
      )}
      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.68rem', color: '#c9a86c', background: '#17150e', border: '1px solid #3a3020', borderRadius: 8, padding: '10px 20px', textAlign: 'center' }}>
        {tips[tip]}
      </div>
      <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.62rem', color: '#333', marginTop: 24, textAlign: 'center' }}>
        This may take 15-30 seconds for large documents
      </p>
      <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}

const CAT_KEY = 'pdf_analyst_categories';
function loadCategories() {
  try { return JSON.parse(localStorage.getItem(CAT_KEY) || '{}'); } catch { return {}; }
}
function saveCategoriesToStorage(cats) {
  localStorage.setItem(CAT_KEY, JSON.stringify(cats));
}

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [savedSources, setSavedSources] = useState([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [categories, setCategories] = useState({});
  const [editingCatFor, setEditingCatFor] = useState(null);
  const [catInput, setCatInput] = useState('');
  const [structure, setStructure] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('pdf_analyst_structure') || DEFAULT_STRUCTURE;
    return DEFAULT_STRUCTURE;
  });
  const [structureOpen, setStructureOpen] = useState(false);
  const [structureSaved, setStructureSaved] = useState(false);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('rendered');
  const [copied, setCopied] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const resultRef = useRef();

  useEffect(() => {
    setCategories(loadCategories());
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setSession(session);
      const { data: p } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (!p || !p.approved) { await supabase.auth.signOut(); router.replace('/pending'); return; }
      setProfile(p);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/login');
    });
    return () => subscription.unsubscribe();
  }, []);

  const token = session ? session.access_token : null;

  useEffect(() => {
    if (!token) return;
    setLoadingSources(true);
    fetch('/api/sources/list', { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.json())
      .then(d => { setSavedSources(d.sources || []); setLoadingSources(false); });
  }, [token]);

  const groupedSources = () => {
    const groups = {};
    for (const src of savedSources) {
      const cat = categories[src.id] || 'Uncategorised';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(src);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Uncategorised') return 1;
      if (b === 'Uncategorised') return -1;
      return a.localeCompare(b);
    });
  };

  const allIds = savedSources.map(s => s.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedSourceIds.includes(id));

  const toggleSource = (id) => {
    setSelectedSourceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    setSelectedSourceIds(allSelected ? [] : allIds);
  };

  const toggleGroupSelect = (groupSources) => {
    const groupIds = groupSources.map(s => s.id);
    const allGroupSelected = groupIds.every(id => selectedSourceIds.includes(id));
    if (allGroupSelected) {
      setSelectedSourceIds(prev => prev.filter(id => !groupIds.includes(id)));
    } else {
      setSelectedSourceIds(prev => [...new Set([...prev, ...groupIds])]);
    }
  };

  const setCategory = (sourceId, catName) => {
    const updated = { ...categories, [sourceId]: catName.trim() || 'Uncategorised' };
    setCategories(updated);
    saveCategoriesToStorage(updated);
    setEditingCatFor(null);
    setCatInput('');
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
      const sourceNames = savedSources
        .filter(s => selectedSourceIds.includes(s.id))
        .map(s => s.file_name);

      const chunksRes = await fetch('/api/sources/get-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ ids: selectedSourceIds }),
      });
      const chunksData = await chunksRes.json();
      if (chunksData.error) throw new Error(chunksData.error);

      const relevant = findRelevantChunks(chunksData.chunks, question);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          chunks: relevant,
          question,
          structure,
          fileName: sourceNames.join(', '),
          sourceNames,
        }),
      });
      const data = await res.json();
      if (data.error === 'quota_exceeded' || data.error === 'daily_limit_reached' || data.error === 'subscription_expired') {
        setShowPayment(true); setStatus('idle'); return;
      }
      if (data.error) throw new Error(data.error);
      setResult(data.result);
      setFromCache(!!data.fromCache);
      setProfile(p => ({ ...p, questions_remaining: data.questionsRemaining, membership_type: data.membershipType }));
      setStatus('done');
      if (data.questionsRemaining === 0 && data.membershipType === 'free') setShowPayment(true);
      setTimeout(() => resultRef.current && resultRef.current.scrollIntoView({ behavior: 'smooth' }), 100);
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
      <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: '#555' }}>Loading...</p>
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

  const groups = groupedSources();

  return (
    <>
      <Head><title>PDF Analyst</title></Head>
      {isAnalyzing && <LoadingOverlay question={question} />}
      <Layout user={session ? session.user : null} profile={profile}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '40px 20px 80px 72px' }}>
          <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: '1px solid #1e1e1e' }}>
            <h1 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 400, fontSize: '2rem', color: '#e2ddd6', letterSpacing: '-0.02em' }}>
              PDF <em style={{ color: '#c9a86c', fontStyle: 'italic' }}>Analyst</em>
            </h1>
            <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem', color: '#555', marginTop: 6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Textbooks · Presentations · Smart Caching
            </p>
          </div>

          <div style={{ marginBottom: 18 }}>
            <button onClick={() => setStructureOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: structureOpen ? '#17150e' : '#141414', border: '1px solid ' + (structureOpen ? '#3a3020' : '#222'), borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: structureOpen ? '#c9a86c' : '#666', letterSpacing: '0.06em', width: '100%', textAlign: 'left', transition: 'all 0.15s' }}>
              <span>gear</span><span>Output Structure</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.65rem' }}>{structureOpen ? 'hide' : 'edit'}</span>
            </button>
            {structureOpen && (
              <div style={{ ...s.card, marginTop: 8, marginBottom: 0 }}>
                <p style={s.hint}>Saved to your browser - set it once and it persists.</p>
                <textarea style={{ ...s.textarea, minHeight: 260 }} value={structure} onChange={e => setStructure(e.target.value)} rows={12} />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={saveStructure} style={{ flex: 1, padding: '10px', background: '#c9a86c', color: '#0c0c0c', border: 'none', borderRadius: 7, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', fontWeight: 500 }}>
                    {structureSaved ? 'Saved!' : 'Save Structure'}
                  </button>
                  <button onClick={resetStructure} style={{ padding: '10px 16px', background: 'transparent', border: '1px solid #333', borderRadius: 7, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#555' }}>
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={s.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={s.label}>Select Sources</div>
              {savedSources.length > 0 && (
                <button onClick={toggleSelectAll} style={{ background: allSelected ? '#17150e' : 'transparent', border: '1px solid ' + (allSelected ? '#3a3020' : '#333'), borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem', color: allSelected ? '#c9a86c' : '#555', letterSpacing: '0.04em', transition: 'all 0.15s' }}>
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            {loadingSources ? (
              <p style={{ ...s.hint, marginBottom: 0 }}>Loading your library...</p>
            ) : savedSources.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: '#444', marginBottom: 12 }}>No sources yet. Upload your PDFs first.</p>
                <Link href="/sources" style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#c9a86c', textDecoration: 'none', border: '1px solid #3a3020', borderRadius: 6, padding: '8px 16px', background: '#17150e' }}>Go to Sources</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {groups.map(([groupName, groupSources]) => {
                  const groupIds = groupSources.map(s => s.id);
                  const allGroupSelected = groupIds.every(id => selectedSourceIds.includes(id));
                  const someGroupSelected = groupIds.some(id => selectedSourceIds.includes(id));
                  return (
                    <div key={groupName}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <div style={{ height: 1, flex: 1, background: '#1e1e1e' }} />
                        <button onClick={() => toggleGroupSelect(groupSources)} style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.62rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: allGroupSelected ? '#c9a86c' : someGroupSelected ? '#8a7a5a' : '#444', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 8px' }}>
                          {groupName} ({groupSources.length}){allGroupSelected ? ' ✓' : someGroupSelected ? ' -' : ''}
                        </button>
                        <div style={{ height: 1, flex: 1, background: '#1e1e1e' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {groupSources.map(src => {
                          const selected = selectedSourceIds.includes(src.id);
                          const isEditingCat = editingCatFor === src.id;
                          return (
                            <div key={src.id}>
                              <div onClick={() => toggleSource(src.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 8, cursor: 'pointer', background: selected ? '#17150e' : '#0f0f0f', border: '1px solid ' + (selected ? '#3a3020' : '#2a2a2a'), transition: 'all 0.15s' }}>
                                <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: '2px solid ' + (selected ? '#c9a86c' : '#444'), background: selected ? '#c9a86c' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {selected && <span style={{ color: '#0c0c0c', fontSize: '0.65rem', fontWeight: 700 }}>v</span>}
                                </div>
                                <span style={{ fontSize: '0.95rem', flexShrink: 0 }}>{src.file_name.endsWith('.pptx') ? 'P' : 'D'}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.76rem', color: selected ? '#c9a86c' : '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.file_name}</p>
                                  <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.58rem', color: '#444' }}>{src.total_pages} pages · {src.chunk_count} chunks</p>
                                </div>
                                <button onClick={e => { e.stopPropagation(); setEditingCatFor(isEditingCat ? null : src.id); setCatInput(categories[src.id] || ''); }} style={{ flexShrink: 0, background: 'none', border: '1px solid #2a2a2a', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.6rem', color: '#555', whiteSpace: 'nowrap' }}>
                                  tag: {categories[src.id] ? categories[src.id].slice(0, 12) : 'none'}
                                </button>
                              </div>
                              {isEditingCat && (
                                <div style={{ display: 'flex', gap: 6, padding: '8px 14px', background: '#0a0a0a', borderRadius: '0 0 8px 8px', border: '1px solid #2a2a2a', borderTop: 'none' }} onClick={e => e.stopPropagation()}>
                                  <input autoFocus value={catInput} onChange={e => setCatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') setCategory(src.id, catInput); if (e.key === 'Escape') setEditingCatFor(null); }} placeholder="e.g. Surgery, Medicine, Anatomy..." style={{ flex: 1, background: '#111', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', color: '#d4cec6', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', outline: 'none' }} />
                                  <button onClick={() => setCategory(src.id, catInput)} style={{ padding: '6px 12px', background: '#c9a86c', color: '#0c0c0c', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.68rem' }}>Save</button>
                                  <button onClick={() => setEditingCatFor(null)} style={{ padding: '6px 10px', background: 'transparent', border: '1px solid #333', borderRadius: 6, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.68rem', color: '#555' }}>X</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {selectedSourceIds.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#17150e', border: '1px solid #3a3020', borderRadius: 8 }}>
                    <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.68rem', color: '#c9a86c' }}>
                      {selectedSourceIds.length} source{selectedSourceIds.length > 1 ? 's' : ''} selected
                    </p>
                    <button onClick={() => setSelectedSourceIds([])} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem' }}>Clear</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedSourceIds.length > 0 && (
            <div style={s.card}>
              <div style={s.label}>Your Question <span style={{ color: '#444', fontWeight: 400 }}>(optional)</span></div>
              <p style={s.hint}>Ask something specific or leave blank for a full analysis.</p>
              <input style={s.input} type="text" value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && !isAnalyzing && analyze()} placeholder="e.g.  Explain the management of acute appendicitis" />
            </div>
          )}

          {selectedSourceIds.length > 0 && (
            <button style={{ ...s.btn, opacity: isAnalyzing ? 0.5 : 1, cursor: isAnalyzing ? 'not-allowed' : 'pointer' }} onClick={analyze} disabled={isAnalyzing}>
              Analyze
            </button>
          )}

          {error && (
            <div style={{ background: '#140d0d', border: '1px solid #3a1515', borderRadius: 8, padding: '12px 16px', marginTop: 14, fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: '#d95f5f' }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ marginTop: 28 }} ref={resultRef}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <span style={s.label}>Result</span>
                  {fromCache && <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.6rem', color: '#6bcf7f', marginLeft: 10, border: '1px solid #1a3a1a', borderRadius: 4, padding: '2px 7px' }}>from cache</span>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['rendered', 'raw'].map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', background: tab === t ? '#17150e' : 'transparent', border: '1px solid ' + (tab === t ? '#3a3020' : '#222'), borderRadius: 6, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.66rem', color: tab === t ? '#c9a86c' : '#555' }}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                  <button onClick={() => { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ padding: '6px 14px', background: 'transparent', border: '1px solid #222', borderRadius: 6, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.66rem', color: '#555' }}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '24px' }}>
                {tab === 'rendered' ? renderMd(result) : (
                  <pre style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#777', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{result}</pre>
                )}
              </div>
            </div>
          )}
        </div>

        {showPayment && (
          <PaymentModal token={token} userEmail={session ? session.user.email : ''} userName={profile ? profile.name : ''} onSuccess={onPaymentSuccess} onClose={() => setShowPayment(false)} />
        )}
      </Layout>

      <style>{'@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } } .md-h2 { font-family: Playfair Display,serif; font-weight:600; font-size:1.05rem; color:#c9a86c; margin:22px 0 8px; padding-bottom:6px; border-bottom:1px solid #1e1e1e; } .md-h3 { font-family: Playfair Display,serif; font-style:italic; font-size:0.95rem; color:#e2ddd6; margin:14px 0 6px; } .md-p { font-family: IBM Plex Sans,sans-serif; font-size:0.84rem; line-height:1.8; color:#a09a92; margin-bottom:8px; } .md-li { font-family: IBM Plex Sans,sans-serif; font-size:0.84rem; line-height:1.8; color:#a09a92; padding-left:14px; margin-bottom:2px; }'}</style>
    </>
  );
}
