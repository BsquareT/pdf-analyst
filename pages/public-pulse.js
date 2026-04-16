import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';

export default function PublicPulse() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    fetch('/api/qa/list')
      .then(r => r.json())
      .then(d => { setItems(d.items || []); setLoading(false); });
  }, []);

  const filtered = items.filter(item =>
    !search.trim() ||
    item.question_original.toLowerCase().includes(search.toLowerCase()) ||
    item.file_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Head><title>Public Pulse — PDF Analyst</title></Head>
      <div style={{ minHeight:'100vh', background:'#0c0c0c' }}>
        {/* Top bar */}
        <div style={{ background:'#111', borderBottom:'1px solid #1e1e1e', padding:'16px 24px 16px 72px', display:'flex', alignItems:'center', gap:16 }}>
          <Link href="/" style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.68rem', color:'#555', textDecoration:'none', letterSpacing:'0.06em' }}>
            ← Dashboard
          </Link>
          <span style={{ color:'#2a2a2a' }}>|</span>
          <span style={{ fontFamily:"'Playfair Display',serif", fontSize:'1.1rem', color:'#e2ddd6' }}>
            ◎ Public <em style={{ color:'#c9a86c' }}>Pulse</em>
          </span>
        </div>

        <div style={{ maxWidth:860, margin:'0 auto', padding:'40px 20px 80px 72px' }}>
          {/* Header */}
          <div style={{ marginBottom:32 }}>
            <h1 style={{ fontFamily:"'Playfair Display',serif", fontWeight:400, fontSize:'1.8rem', color:'#e2ddd6', marginBottom:8 }}>
              Questions &amp; Answers
            </h1>
            <p style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.7rem', color:'#555' }}>
              A shared knowledge base built from {items.length} unique questions. Great for quick revision.
            </p>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search questions or document names…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width:'100%', background:'#141414', border:'1px solid #222', borderRadius:10,
              color:'#d4cec6', fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.78rem',
              padding:'14px 18px', outline:'none', marginBottom:24, boxSizing:'border-box',
            }}
          />

          {loading && (
            <div style={{ textAlign:'center', padding:60 }}>
              <div style={{ width:28, height:28, border:'2px solid #2a2a2a', borderTopColor:'#c9a86c', borderRadius:'50%', margin:'0 auto', animation:'spin 0.7s linear infinite' }} />
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div style={{ textAlign:'center', padding:60 }}>
              <p style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.75rem', color:'#444' }}>
                {search ? 'No results for that search.' : 'No questions yet. Be the first!'}
              </p>
            </div>
          )}

          {/* Q&A cards */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {filtered.map(item => (
              <div
                key={item.id}
                style={{
                  background:'#141414', border:'1px solid #222', borderRadius:12,
                  overflow:'hidden', transition:'border-color 0.15s',
                }}
              >
                {/* Question header */}
                <div
                  style={{ padding:'18px 20px', cursor:'pointer', display:'flex', alignItems:'flex-start', gap:14 }}
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                >
                  <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.7rem', color:'#c9a86c', flexShrink:0, marginTop:2 }}>Q</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontFamily:"'IBM Plex Sans',sans-serif", fontSize:'0.88rem', color:'#e2ddd6', lineHeight:1.5, marginBottom:6 }}>
                      {item.question_original}
                    </p>
                    <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                      {item.file_name && item.file_name !== 'Unknown' && (
                        <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.62rem', color:'#555', background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:4, padding:'2px 8px' }}>
                          📄 {item.file_name}
                        </span>
                      )}
                      <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.62rem', color:'#555' }}>
                        Asked {item.ask_count}× · {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <span style={{ color:'#555', fontSize:'0.8rem', flexShrink:0 }}>{expanded === item.id ? '▲' : '▼'}</span>
                </div>

                {/* Answer */}
                {expanded === item.id && (
                  <div style={{ borderTop:'1px solid #1e1e1e', padding:'18px 20px', background:'#111' }}>
                    <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                      <span style={{ fontFamily:"'IBM Plex Mono',monospace", fontSize:'0.7rem', color:'#6bcf7f', flexShrink:0, marginTop:2 }}>A</span>
                      <div style={{ flex:1 }}>
                        {item.answer.split('\n').map((line, i) => {
                          if (line.startsWith('## ')) return <p key={i} style={{ fontFamily:"'Playfair Display',serif", fontWeight:400, fontSize:'1rem', color:'#c9a86c', margin:'14px 0 6px' }}>{line.slice(3)}</p>;
                          if (line.startsWith('- ') || line.startsWith('* ')) return <p key={i} style={{ fontFamily:"'IBM Plex Sans',sans-serif", fontSize:'0.82rem', color:'#a09a92', lineHeight:1.7, paddingLeft:12 }}>· {line.slice(2)}</p>;
                          if (line.trim()) return <p key={i} style={{ fontFamily:"'IBM Plex Sans',sans-serif", fontSize:'0.82rem', color:'#a09a92', lineHeight:1.7, marginBottom:6 }}>{line}</p>;
                          return null;
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
