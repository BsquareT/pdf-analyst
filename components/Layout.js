import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { supabase } from '../lib/supabase';

const NAV = [
  { href: '/',        label: 'Dashboard',    icon: '▦' },
  { href: '/sources', label: 'Sources',      icon: '📚' },
  { href: '/public-pulse', label: 'Public Pulse', icon: '◎' },
];

export default function Layout({ children, user, profile }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => { setOpen(false); }, [router.pathname]);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const initials = (profile?.name || profile?.email || '?')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const membershipLabel = () => {
    if (!profile) return '';
    if (profile.membership_type === 'lifetime') return '★ Lifetime member';
    if (profile.membership_type === 'timed') {
      const exp = new Date(profile.membership_expires_at);
      return exp > new Date() ? `Unlimited · expires ${exp.toLocaleDateString()}` : 'Plan expired';
    }
    return `${profile.questions_remaining ?? 0} questions left`;
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0c' }}>
      {/* Hamburger */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', top: 20, left: 20, zIndex: 200,
          background: open ? '#1a1a1a' : '#141414',
          border: '1px solid #2a2a2a', borderRadius: 8,
          width: 42, height: 42, cursor: 'pointer',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 5,
        }}
        aria-label="Menu"
      >
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            display: 'block', width: 18, height: 1.5,
            background: open ? '#c9a86c' : '#666',
            transition: 'all 0.2s',
            transform: open
              ? i === 0 ? 'rotate(45deg) translate(5px, 5px)'
              : i === 2 ? 'rotate(-45deg) translate(5px, -5px)'
              : 'scaleX(0)'
              : 'none',
          }} />
        ))}
      </button>

      {/* Overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
        />
      )}

      {/* Sidebar */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 160,
        width: 260, background: '#111', borderRight: '1px solid #1e1e1e',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
        padding: '72px 0 0',
      }}>
        <div style={{ padding: '0 22px 24px', borderBottom: '1px solid #1e1e1e' }}>
          <p style={{ fontFamily: "'Playfair Display',serif", fontSize: '1.2rem', color: '#e2ddd6' }}>
            PDF <em style={{ color: '#c9a86c' }}>Analyst</em>
          </p>
        </div>

        <div style={{ padding: '18px 12px', flex: 1 }}>
          {NAV.map(({ href, label, icon }) => {
            const active = router.pathname === href;
            return (
              <Link key={href} href={href} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 12px', borderRadius: 8, marginBottom: 4,
                textDecoration: 'none',
                background: active ? '#1a1a1a' : 'transparent',
                border: active ? '1px solid #2a2a2a' : '1px solid transparent',
                color: active ? '#c9a86c' : '#888',
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: '0.8rem', letterSpacing: '0.04em',
                transition: 'all 0.15s',
              }}>
                <span style={{ fontSize: '1rem', width: 20, textAlign: 'center' }}>{icon}</span>
                {label}
              </Link>
            );
          })}
        </div>

        {user && profile && (
          <div style={{ padding: '18px 20px', borderTop: '1px solid #1e1e1e' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%',
                background: '#1e1a14', border: '1px solid #3a3020',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem', color: '#c9a86c', flexShrink: 0,
              }}>
                {initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontFamily: "'IBM Plex Sans',sans-serif", fontSize: '0.82rem', color: '#e2ddd6', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profile.name || 'User'}
                </p>
                <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profile.email}
                </p>
              </div>
            </div>

            <div style={{ background: '#17150e', border: '1px solid #2e2a1e', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
              <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem', color: '#c9a86c' }}>
                {membershipLabel()}
              </p>
            </div>

            <button
              onClick={signOut}
              style={{
                width: '100%', padding: '9px', background: 'transparent',
                border: '1px solid #2a2a2a', borderRadius: 7, cursor: 'pointer',
                fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#666',
                transition: 'all 0.15s', letterSpacing: '0.04em',
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#d95f5f'; e.currentTarget.style.color = '#d95f5f'; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#666'; }}
            >
              Sign out
            </button>
          </div>
        )}
      </nav>

      <main>{children}</main>
    </div>
  );
}
