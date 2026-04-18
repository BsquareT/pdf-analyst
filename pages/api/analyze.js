import { supabaseAdmin } from '../../lib/supabase';
import { normalizeQuestion, jaccardSimilarity, SIMILARITY_THRESHOLD } from '../../lib/similarity';

// ══════════════════════════════════════════════════════════════════
//  AI PROVIDER — set AI_PROVIDER in Vercel env vars:
//  "gemini"  → Gemini Flash (FREE: 1500 req/day)
//  "haiku"   → Claude Haiku (cheap, ~₹0.08/question)
//  "claude"  → Claude Sonnet (best quality, higher cost)
// ══════════════════════════════════════════════════════════════════
const PROVIDER = process.env.AI_PROVIDER || 'gemini';

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
      }),
    }
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callClaude(prompt, model = 'claude-sonnet-4-6') {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.map(b => b.text || '').join('\n') || '';
}

async function callAI(prompt) {
  if (PROVIDER === 'gemini') return callGemini(prompt);
  if (PROVIDER === 'haiku') return callClaude(prompt, 'claude-haiku-4-5-20251001');
  return callClaude(prompt, 'claude-sonnet-4-6');
}

// ── QUOTA CHECKER ──────────────────────────────────────────────────────────
// Returns { allowed, reason, updatesNeeded }
function checkQuota(profile) {
  const today = new Date().toISOString().split('T')[0];
  const type = profile.membership_type;

  // Reset daily counter if it's a new day
  const isNewDay = profile.daily_reset_date !== today;
  const dailyUsed = isNewDay ? 0 : (profile.daily_questions_used || 0);
  const dailyLimit = profile.daily_limit || 0;

  // Lifetime — always allowed
  if (type === 'lifetime') {
    return { allowed: true, isNewDay, dailyUsed, updatesNeeded: isNewDay ? { daily_questions_used: 0, daily_reset_date: today } : null };
  }

  // Timed subscriptions — check expiry first
  const timedTypes = ['monthly', 'annual', 'promax_monthly', 'promax_annual'];
  if (timedTypes.includes(type)) {
    const expired = !profile.membership_expires_at || new Date(profile.membership_expires_at) < new Date();
    if (expired) {
      return { allowed: false, reason: 'subscription_expired', dailyUsed, dailyLimit };
    }

    // Unlimited plans (promax)
    if (dailyLimit === 0) {
      return {
        allowed: true, isNewDay, dailyUsed,
        updatesNeeded: isNewDay ? { daily_questions_used: 0, daily_reset_date: today } : null,
      };
    }

    // Daily limited plans (monthly = 15/day, annual = 30/day)
    if (dailyUsed >= dailyLimit) {
      return { allowed: false, reason: 'daily_limit_reached', dailyUsed, dailyLimit };
    }

    return {
      allowed: true, isNewDay, dailyUsed, dailyLimit,
      updatesNeeded: {
        daily_questions_used: dailyUsed + 1,
        daily_reset_date: today,
      },
    };
  }

  // Free / pack — uses questions_remaining pool
  if ((profile.questions_remaining || 0) <= 0) {
    return { allowed: false, reason: 'quota_exceeded' };
  }

  return {
    allowed: true,
    updatesNeeded: {
      questions_remaining: profile.questions_remaining - 1,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── 1. Auth ──────────────────────────────────────────────────────────
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // ── 2. Profile ───────────────────────────────────────────────────────
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('*').eq('id', user.id).single();
  if (!profile) return res.status(500).json({ error: 'Profile not found' });
  if (!profile.approved) return res.status(403).json({ error: 'Account not approved' });

  const { chunks, question, structure, fileName } = req.body;
  if (!chunks?.length) return res.status(400).json({ error: 'No content chunks provided' });

  const normalized = normalizeQuestion(question);
  const fileLower = (fileName || 'Unknown').toLowerCase().trim();

  // ── 3. Exact cache match (FREE — no quota used) ──────────────────────
  const { data: exact } = await supabaseAdmin
    .from('qa_cache').select('*')
    .eq('question_normalized', normalized).ilike('file_name', fileLower)
    .maybeSingle();

  if (exact) {
    await supabaseAdmin.from('qa_cache')
      .update({ ask_count: exact.ask_count + 1, updated_at: new Date().toISOString() })
      .eq('id', exact.id);
    return res.json({
      result: exact.answer, fromCache: true,
      questionsRemaining: profile.questions_remaining,
      membershipType: profile.membership_type,
      dailyUsed: profile.daily_questions_used || 0,
      dailyLimit: profile.daily_limit || 0,
    });
  }

  // ── 4. Fuzzy cache match (FREE — no quota used) ──────────────────────
  const { data: candidates } = await supabaseAdmin
    .from('qa_cache').select('*').ilike('file_name', fileLower)
    .order('ask_count', { ascending: false }).limit(80);

  if (candidates?.length) {
    const match = candidates.find(c =>
      jaccardSimilarity(normalized, c.question_normalized) >= SIMILARITY_THRESHOLD
    );
    if (match) {
      await supabaseAdmin.from('qa_cache')
        .update({ ask_count: match.ask_count + 1, updated_at: new Date().toISOString() })
        .eq('id', match.id);
      return res.json({
        result: match.answer, fromCache: true,
        questionsRemaining: profile.questions_remaining,
        membershipType: profile.membership_type,
        dailyUsed: profile.daily_questions_used || 0,
        dailyLimit: profile.daily_limit || 0,
      });
    }
  }

  // ── 5. Quota check ───────────────────────────────────────────────────
  const quota = checkQuota(profile);

  if (!quota.allowed) {
    return res.status(402).json({
      error: quota.reason || 'quota_exceeded',
      questionsRemaining: profile.questions_remaining,
      membershipType: profile.membership_type,
      dailyUsed: quota.dailyUsed,
      dailyLimit: quota.dailyLimit,
    });
  }

  // ── 6. Call AI ───────────────────────────────────────────────────────
  const context = chunks.map((c, i) => `[${c.source || `Section ${i + 1}`}]\n${c.text}`).join('\n\n---\n\n');
  const prompt = [
    'You are a precise document analyst. Answer ONLY from the document excerpts provided.',
    '', 'DOCUMENT EXCERPTS:', context, '',
    question?.trim() ? `USER QUESTION: ${question.trim()}` : 'Provide a thorough analysis of the content above.',
    '', 'Respond STRICTLY following this output structure:', '', structure, '',
    'If the excerpts do not contain enough info for a section, write "Not found in the provided excerpts."',
  ].join('\n');

  let result;
  try {
    result = await callAI(prompt);
  } catch (err) {
    return res.status(500).json({ error: `AI API failed: ${err.message}` });
  }

  // ── 7. Store in cache ────────────────────────────────────────────────
  await supabaseAdmin.from('qa_cache').upsert({
    question_normalized: normalized,
    question_original: question?.trim() || 'General analysis',
    answer: result,
    structure,
    file_name: fileName || 'Unknown',
    ask_count: 1,
  }, { onConflict: 'question_normalized,file_name' });

  // ── 8. Update quota ───────────────────────────────────────────────────
  if (quota.updatesNeeded) {
    await supabaseAdmin.from('profiles').update(quota.updatesNeeded).eq('id', user.id);
  }

  // Build response quota info
  const newProfile = { ...profile, ...quota.updatesNeeded };

  res.json({
    result, fromCache: false,
    questionsRemaining: newProfile.questions_remaining ?? profile.questions_remaining,
    membershipType: profile.membership_type,
    dailyUsed: newProfile.daily_questions_used ?? 0,
    dailyLimit: profile.daily_limit ?? 0,
    expiresAt: profile.membership_expires_at,
  });
}
