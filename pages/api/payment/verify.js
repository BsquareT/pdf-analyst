import crypto from 'crypto';
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;

  // ── 1. Verify signature ───────────────────────────────────────────────
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment signature mismatch. Contact support.' });
  }

  // ── 2. Get current profile ────────────────────────────────────────────
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('*').eq('id', user.id).single();
  if (!profile) return res.status(500).json({ error: 'Profile not found' });

  // ── 3. Update membership based on plan ───────────────────────────────
  let updates = {};
  let expiresAt = null;

  if (plan === 'pack') {
    // Add 20 more questions
    updates = {
      membership_type: 'pack',
      questions_remaining: (profile.questions_remaining || 0) + 20,
    };
  } else if (plan === 'timed') {
    // 8 days unlimited
    expiresAt = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
    updates = {
      membership_type: 'timed',
      membership_expires_at: expiresAt,
    };
  } else if (plan === 'lifetime') {
    updates = { membership_type: 'lifetime' };
  } else {
    return res.status(400).json({ error: 'Unknown plan' });
  }

  await supabaseAdmin.from('profiles').update(updates).eq('id', user.id);

  // ── 4. Record verified payment ────────────────────────────────────────
  await supabaseAdmin.from('payments').update({
    razorpay_payment_id,
    status: 'verified',
  }).eq('razorpay_order_id', razorpay_order_id);

  res.json({
    success: true,
    membershipType: updates.membership_type,
    questionsRemaining: updates.questions_remaining ?? profile.questions_remaining,
    expiresAt,
  });
}
