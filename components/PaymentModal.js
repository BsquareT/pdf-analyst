import { useState } from 'react';

const PLANS = [
  {
    id: 'pack',
    label: '20 More Questions',
    price: '₹200',
    paise: 20000,
    description: 'Top up 20 questions. Repeatable anytime.',
    icon: '◈',
  },
  {
    id: 'timed',
    label: '8-Day Unlimited',
    price: '₹500',
    paise: 50000,
    description: 'Unlimited questions for 8 days.',
    icon: '◉',
    highlight: true,
  },
  {
    id: 'lifetime',
    label: 'Lifetime Unlimited',
    price: '₹800',
    paise: 80000,
    description: 'One-time payment. Ask forever.',
    icon: '★',
  },
];

export default function PaymentModal({ token, userEmail, userName, onSuccess, onClose }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);

  const pay = async (plan) => {
    setLoading(plan.id);
    setError(null);

    try {
      // Create Razorpay order on server
      const res = await fetch('/api/payment/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ plan: plan.id, amount: plan.paise }),
      });

      const order = await res.json();
      if (order.error) throw new Error(order.error);

      // Open Razorpay checkout
      const rzp = new window.Razorpay({
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: plan.paise,
        currency: 'INR',
        name: 'PDF Analyst',
        description: plan.label,
        order_id: order.id,
        prefill: { email: userEmail, name: userName },
        theme: { color: '#c9a86c' },
        handler: async (response) => {
          try {
            const verifyRes = await fetch('/api/payment/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ ...response, plan: plan.id }),
            });

            const result = await verifyRes.json();
            if (result.error) throw new Error(result.error);
            onSuccess(result);
          } catch (err) {
            setError('Payment verification failed: ' + err.message);
          } finally {
            setLoading(null);
          }
        },
        modal: {
          ondismiss: () => setLoading(null),
        },
      });
      rzp.open();
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
      setLoading(null);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        background: '#111', border: '1px solid #222',
        borderRadius: 16, padding: '36px 28px',
        width: '100%', maxWidth: 560,
        animation: 'fadeUp 0.3s ease',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <p style={{ fontSize: '1.8rem', marginBottom: 8 }}>⚡</p>
          <h2 style={{
            fontFamily: "'Playfair Display',serif", fontWeight: 400,
            fontSize: '1.4rem', color: '#e2ddd6', marginBottom: 8,
          }}>
            You've used your <em style={{ color: '#c9a86c' }}>20 free questions</em>
          </h2>
          <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#666' }}>
            Choose a plan to continue. All prices in INR.
          </p>
        </div>

        {/* Plans */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {PLANS.map(plan => (
            <div
              key={plan.id}
              style={{
                background: plan.highlight ? '#17150e' : '#161616',
                border: `1px solid ${plan.highlight ? '#3a3020' : '#242424'}`,
                borderRadius: 10, padding: '18px 20px',
                display: 'flex', alignItems: 'center', gap: 16,
              }}
            >
              <span style={{ fontSize: '1.5rem', color: '#c9a86c', flexShrink: 0 }}>{plan.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontFamily: "'IBM Plex Sans',sans-serif", fontSize: '0.88rem',
                  color: '#e2ddd6', fontWeight: 500, marginBottom: 2,
                }}>
                  {plan.label}
                  {plan.highlight && (
                    <span style={{
                      marginLeft: 8, fontSize: '0.6rem', fontFamily: "'IBM Plex Mono',monospace",
                      color: '#c9a86c', border: '1px solid #3a3020', borderRadius: 4,
                      padding: '1px 6px', letterSpacing: '0.06em',
                    }}>POPULAR</span>
                  )}
                </p>
                <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.68rem', color: '#666' }}>
                  {plan.description}
                </p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{
                  fontFamily: "'Playfair Display',serif", fontSize: '1.2rem',
                  color: '#c9a86c', marginBottom: 4,
                }}>
                  {plan.price}
                </p>
                <button
                  onClick={() => pay(plan)}
                  disabled={!!loading}
                  style={{
                    padding: '7px 18px',
                    background: loading === plan.id ? '#1e1a14' : '#c9a86c',
                    color: loading === plan.id ? '#c9a86c' : '#0c0c0c',
                    border: 'none', borderRadius: 6,
                    fontFamily: "'IBM Plex Mono',monospace",
                    fontSize: '0.7rem', letterSpacing: '0.04em',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading && loading !== plan.id ? 0.4 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {loading === plan.id ? '...' : 'Pay →'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div style={{
            background: '#140d0d', border: '1px solid #3a1515',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#d95f5f',
          }}>
            ⚠ {error}
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '10px',
            background: 'transparent', border: '1px solid #242424',
            borderRadius: 8, cursor: 'pointer',
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: '0.7rem', color: '#444', letterSpacing: '0.04em',
          }}
        >
          Maybe later
        </button>
      </div>

      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}
