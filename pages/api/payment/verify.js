import crypto from 'crypto';
import { supabaseAdmin } from '../../../lib/supabase';

const PLAN_CONFIG = {
  // One-time pack: adds 20 questions to balance
  pack: {
    type: 'pack',
    questionsToAdd: 20,
    dailyLimit: null,
    durationDays: null,
  },
  // Monthly: 15 questions/day for 30 days
  monthly: {
    type: 'monthly',
    questionsToAdd: 0,
    dailyLimit: 15,
    durationDays: 30,
  },
  // Annual: 30 questions/day for 365 days
  annual: {
    type: 'annual',
    questionsToAdd: 0,
    dailyLimit: 30,
    durationDays: 365,
  },
  // Pro Max Monthly: unlimited for 30 days
  promax_monthly: {
    type: 'promax_monthly',
    questionsToAdd: 0,
    dailyLimit: 0, // 0 = unlimited
    durationDays: 30,
  },
  // Pro Max Annual: unlimited for 365 days
  promax_annual: {
    type: 'promax_annual',
    questionsToAdd: 0,
    dailyLimit: 0, // 0 = unlimited
    durationDays: 365,
  },
  // Legacy lifetime plan (keep for existing users)
  lifetime: {
    type: 'lifetime',
    questionsToAdd: 0,
    dailyLimit: 0,
    durationDays: null,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;

  // ── 1. Verify Razorpay signature ──────────────────────────────────────
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expected !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment signature mismatch. Contact support.' });
  }

  // ── 2. Get config for this plan ───────────────────────────────────────
  const config = PLAN_CONFIG[plan];
  if (!config) return res.status(400).json({ error: 'Unknown plan: ' + plan });

  // ── 3. Get current profile ────────────────────────────────────────────
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('*').eq('id', user.id).single();
  if (!profile) return res.status(500).json({ error: 'Profile not found' });

  // ── 4. Build update object ────────────────────────────────────────────
  const updates = {
    membership_type: config.type,
    daily_limit: config.dailyLimit ?? 0,
    daily_questions_used: 0,
    daily_reset_date: new Date().toISOString().split('T')[0],
  };

  if (config.questionsToAdd > 0) {
    // Pack: add questions to existing balance
    updates.questions_remaining = (profile.questions_remaining || 0) + config.questionsToAdd;
    updates.membership_type = 'pack'; // stays on pack, free questions not affected
  }

  if (config.durationDays) {
    const expires = new Date();
    expires.setDate(expires.getDate() + config.durationDays);
    updates.membership_expires_at = expires.toISOString();
  }

  if (config.type === 'lifetime') {
    updates.membership_expires_at = null;
  }

  await supabaseAdmin.from('profiles').update(updates).eq('id', user.id);

  // ── 5. Record verified payment ────────────────────────────────────────
  await supabaseAdmin.from('payments').update({
    razorpay_payment_id,
    status: 'verified',
  }).eq('razorpay_order_id', razorpay_order_id);

  res.json({
    success: true,
    membershipType: updates.membership_type,
    questionsRemaining: updates.questions_remaining ?? profile.questions_remaining,
    dailyLimit: config.dailyLimit,
    expiresAt: updates.membership_expires_at || null,
  });
}
