import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Pending() {
  const router = useRouter();

  const check = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }
    const { data: profile } = await supabase
      .from('profiles').select('approved').eq('id', session.user.id).single();
    if (profile?.approved) { router.push('/'); return; }
    alert('Still waiting for approval. Please check back later.');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0c0c0c',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 420, textAlign: 'center',
        background: '#111', border: '1px solid #1e1e1e',
        borderRadius: 16, padding: '48px 32px',
      }}>
        <p style={{ fontSize: '2.5rem', marginBottom: 20 }}>⏳</p>
        <h1 style={{
          fontFamily: "'Playfair Display',serif", fontWeight: 400,
          fontSize: '1.5rem', color: '#e2ddd6', marginBottom: 12,
        }}>
          Awaiting <em style={{ color: '#c9a86c' }}>Approval</em>
        </h1>
        <p style={{
          fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.75rem',
          color: '#666', lineHeight: 1.7, marginBottom: 32,
        }}>
          Your account has been created and is waiting for the admin to approve it. This is usually done within 24 hours.
        </p>
        <button
          onClick={check}
          style={{
            width: '100%', padding: '13px', background: '#c9a86c', border: 'none',
            borderRadius: 8, cursor: 'pointer', fontFamily: "'IBM Plex Mono',monospace",
            fontSize: '0.78rem', fontWeight: 500, letterSpacing: '0.05em',
            color: '#0c0c0c', marginBottom: 10,
          }}
        >
          Check Again →
        </button>
        <button
          onClick={signOut}
          style={{
            width: '100%', padding: '13px', background: 'transparent',
            border: '1px solid #242424', borderRadius: 8, cursor: 'pointer',
            fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#555',
          }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
