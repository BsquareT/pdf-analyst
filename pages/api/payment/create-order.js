import { supabaseAdmin } from '../../../lib/supabase';

const PLAN_AMOUNTS = { pack: 20000, timed: 50000, lifetime: 80000 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { plan } = req.body;
  const amount = PLAN_AMOUNTS[plan];
  if (!amount) return res.status(400).json({ error: 'Invalid plan' });

  // Create Razorpay order via REST API
  const credentials = Buffer.from(`${process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
    body: JSON.stringify({ amount, currency: 'INR', receipt: `order_${user.id.slice(0,8)}_${Date.now()}` }),
  });

  const order = await rzpRes.json();
  if (order.error) return res.status(500).json({ error: order.error.description });

  // Record pending payment
  await supabaseAdmin.from('payments').insert({
    user_id: user.id,
    razorpay_order_id: order.id,
    plan,
    amount_paise: amount,
    status: 'pending',
  });

  res.json(order);
}
