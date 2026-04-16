import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/');
    });
  }, []);

  const submit = async () => {
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { name } },
        });
        if (error) throw error;
        setMessage('Account created! Please wait for admin approval before you can log in.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        // Check approval
        const { data: profile } = await supabase
          .from('profiles')
          .select('approved')
          .eq('id', data.user.id)
          .single();

        if (!profile?.approved) {
          await supabase.auth.signOut();
          router.replace('/pending');
          return;
        }
        router.replace('/');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const inp = {
    width: '100%', padding: '13px 16px',
    background: '#0f0f0f', border: '1px solid #242424',
    borderRadius: 8, color: '#e2ddd6',
    fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.82rem',
    outline: 'none', marginBottom: 12,
    boxSizing: 'border-box',
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0c0c0c',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }}>
      <div style={{
        width: '100%', maxWidth: 400,
        background: '#111', border: '1px solid #1e1e1e',
        borderRadius: 16, padding: '40px 32px',
      }}>
        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <h1 style={{
            fontFamily: "'Playfair Display',serif", fontWeight: 400,
            fontSize: '1.8rem', color: '#e2ddd6', marginBottom: 6,
          }}>
            PDF <em style={{ color: '#c9a86c' }}>Analyst</em>
          </h1>
          <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.65rem', color: '#555', letterSpacing: '0.1em' }}>
            {mode === 'signin' ? 'SIGN IN TO CONTINUE' : 'CREATE YOUR ACCOUNT'}
          </p>
        </div>

        {/* Form */}
        {mode === 'signup' && (
          <input
            style={inp} type="text" placeholder="Full name"
            value={name} onChange={e => setName(e.target.value)}
          />
        )}
        <input
          style={inp} type="email" placeholder="Email address"
          value={email} onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <input
          style={inp} type="password" placeholder="Password"
          value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />

        {error && (
          <div style={{
            background: '#140d0d', border: '1px solid #3a1515', borderRadius: 8,
            padding: '10px 14px', marginBottom: 12,
            fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#d95f5f',
          }}>
            {error}
          </div>
        )}

        {message && (
          <div style={{
            background: '#0d1a0d', border: '1px solid #1a3a1a', borderRadius: 8,
            padding: '10px 14px', marginBottom: 12,
            fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#6bcf7f',
          }}>
            {message}
          </div>
        )}

        <button
          onClick={submit}
          disabled={loading || !email || !password || (mode === 'signup' && !name)}
          style={{
            width: '100%', padding: '14px',
            background: loading ? '#17150e' : '#c9a86c',
            color: loading ? '#c9a86c' : '#0c0c0c',
            border: loading ? '1px solid #3a3020' : 'none',
            borderRadius: 9, cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.05em',
            marginBottom: 20, transition: 'all 0.2s',
          }}
        >
          {loading ? '...' : mode === 'signin' ? 'Sign In →' : 'Create Account →'}
        </button>

        <p style={{
          textAlign: 'center', fontFamily: "'IBM Plex Mono',monospace",
          fontSize: '0.72rem', color: '#555',
        }}>
          {mode === 'signin' ? "Don't have an account? " : "Already have an account? "}
          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); setMessage(''); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#c9a86c', fontFamily: "'IBM Plex Mono',monospace",
              fontSize: '0.72rem', textDecoration: 'underline',
            }}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
