import { useState } from 'react';

const PLANS = [
  {
    id: 'monthly',
    label: 'Monthly',
    price: '₹200',
    paise: 20000,
    period: '/month',
    description: '15 questions per day · Resets daily',
    icon: '◈',
    badge: null,
  },
  {
    id: 'annual',
    label: 'Annual',
    price: '₹1,200',
    paise: 120000,
    period: '/year',
    description: '30 questions per day · Resets daily · Save ₹1,200 vs monthly',
    icon: '◉',
    badge: 'BEST VALUE',
  },
  {
    id: 'promax_monthly',
    label: 'Pro Max',
    price: '₹1,000',
    paise: 100000,
    period: '/month',
    description: 'Unlimited questions per day · No restrictions',
    icon: '⬡',
    badge: null,
  },
  {
    id: 'promax_annual',
    label: 'Pro Max Annual',
    price: '₹7,500',
    paise: 750000,
    period: '/year',
    description: 'Unlimited questions per day · Save ₹4,500 vs monthly',
    icon: '★',
    badge: 'POPULAR',
  },
  {
    id: 'pack',
    label: 'Question Pack',
    price: '₹200',
    paise: 20000,
    period: 'one-time',
    description: '20 more questions added to your balance',
    icon: '▸',
    badge: null,
  },
];

export default function PaymentModal({ token, userEmail, userName, onSuccess, onClose }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('subscription'); // 'subscription' | 'pack'

  const pay = async (plan) => {
    setLoading(plan.id);
    setError(null);
    try {
      const res = await fetch('/api/payment/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: plan.id, amount: plan.paise }),
      });
      const order = await res.json();
      if (order.error) throw new Error(order.error);

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
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
        modal: { ondismiss: () => setLoading(null) },
      });
      rzp.open();
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
      setLoading(null);
    }
  };

  const subscriptionPlans = PLANS.filter(p => p.id !== 'pack');
  const packPlan = PLANS.find(p => p.id === 'pack');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      overflowY: 'auto',
    }}>
      <div style={{
        background: '#111', border: '1px solid #222', borderRadius: 16,
        padding: '36px 28px', width: '100%', maxWidth: 580,
        animation: 'fadeUp 0.3s ease', margin: 'auto',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <p style={{ fontSize: '1.8rem', marginBottom: 8 }}>⚡</p>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontWeight: 400, fontSize: '1.4rem', color: '#e2ddd6', marginBottom: 8 }}>
            You've used your free questions
          </h2>
          <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.7rem', color: '#555' }}>
            Choose a plan to continue · All prices in INR
          </p>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {[
            { id: 'subscription', label: 'Subscriptions' },
            { id: 'pack', label: 'Question Pack' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: '9px', borderRadius: 7, cursor: 'pointer',
                fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem',
                letterSpacing: '0.04em',
                background: tab === t.id ? '#17150e' : 'transparent',
                border: `1px solid ${tab === t.id ? '#3a3020' : '#2a2a2a'}`,
                color: tab === t.id ? '#c9a86c' : '#555',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Plans */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {(tab === 'subscription' ? subscriptionPlans : [packPlan]).map(plan => (
            <div
              key={plan.id}
              style={{
                background: plan.badge ? '#17150e' : '#161616',
                border: `1px solid ${plan.badge ? '#3a3020' : '#242424'}`,
                borderRadius: 10, padding: '16px 18px',
                display: 'flex', alignItems: 'center', gap: 14,
              }}
            >
              <span style={{ fontSize: '1.4rem', color: '#c9a86c', flexShrink: 0 }}>{plan.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <p style={{ fontFamily: "'IBM Plex Sans',sans-serif", fontSize: '0.88rem', color: '#e2ddd6', fontWeight: 500 }}>
                    {plan.label}
                  </p>
                  {plan.badge && (
                    <span style={{
                      fontSize: '0.58rem', fontFamily: "'IBM Plex Mono',monospace",
                      color: '#c9a86c', border: '1px solid #3a3020',
                      borderRadius: 4, padding: '1px 6px', letterSpacing: '0.06em',
                    }}>
                      {plan.badge}
                    </span>
                  )}
                </div>
                <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.66rem', color: '#666', lineHeight: 1.5 }}>
                  {plan.description}
                </p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontFamily: "'Playfair Display',serif", fontSize: '1.15rem', color: '#c9a86c' }}>
                  {plan.price}
                </p>
                <p style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.58rem', color: '#555', marginBottom: 8 }}>
                  {plan.period}
                </p>
                <button
                  onClick={() => pay(plan)}
                  disabled={!!loading}
                  style={{
                    padding: '7px 16px',
                    background: loading === plan.id ? '#1e1a14' : '#c9a86c',
                    color: loading === plan.id ? '#c9a86c' : '#0c0c0c',
                    border: 'none', borderRadius: 6,
                    fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.7rem',
                    letterSpacing: '0.04em', cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading && loading !== plan.id ? 0.4 : 1,
                    transition: 'all 0.15s',
                  }}
                >
                  {loading === plan.id ? '…' : 'Subscribe →'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div style={{
            background: '#140d0d', border: '1px solid #3a1515', borderRadius: 8,
            padding: '10px 14px', marginBottom: 14,
            fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.72rem', color: '#d95f5f',
          }}>
            ⚠ {error}
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '10px', background: 'transparent',
            border: '1px solid #242424', borderRadius: 8, cursor: 'pointer',
            fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.7rem', color: '#444',
            letterSpacing: '0.04em',
          }}
        >
          Maybe later
        </button>
      </div>

      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}
