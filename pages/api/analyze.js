import { supabaseAdmin } from '../../lib/supabase';
import { normalizeQuestion, jaccardSimilarity, SIMILARITY_THRESHOLD } from '../../lib/similarity';

function checkQuota(profile) {
  if (profile.membership_type === 'lifetime') return true;
  if (profile.membership_type === 'timed') {
    return profile.membership_expires_at && new Date(profile.membership_expires_at) > new Date();
  }
  return (profile.questions_remaining || 0) > 0;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── 1. Auth ──────────────────────────────────────────────────────────
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // ── 2. Profile ───────────────────────────────────────────────────────
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles').select('*').eq('id', user.id).single();
  if (profileErr || !profile) return res.status(500).json({ error: 'Profile not found' });
  if (!profile.approved) return res.status(403).json({ error: 'Account not approved' });

  const { chunks, question, structure, fileName } = req.body;
  if (!chunks?.length) return res.status(400).json({ error: 'No content chunks provided' });

  const normalized = normalizeQuestion(question);
  const fileLower = (fileName || 'Unknown').toLowerCase().trim();

  // ── 3. Exact cache match ─────────────────────────────────────────────
  const { data: exact } = await supabaseAdmin
    .from('qa_cache')
    .select('*')
    .eq('question_normalized', normalized)
    .ilike('file_name', fileLower)
    .maybeSingle();

  if (exact) {
    await supabaseAdmin.from('qa_cache').update({ ask_count: exact.ask_count + 1, updated_at: new Date().toISOString() }).eq('id', exact.id);
    return res.json({
      result: exact.answer,
      fromCache: true,
      questionsRemaining: profile.questions_remaining,
      membershipType: profile.membership_type,
    });
  }

  // ── 4. Fuzzy cache match (top 80 by ask_count, same file) ────────────
  const { data: candidates } = await supabaseAdmin
    .from('qa_cache')
    .select('*')
    .ilike('file_name', fileLower)
    .order('ask_count', { ascending: false })
    .limit(80);

  if (candidates?.length) {
    const match = candidates.find(c => jaccardSimilarity(normalized, c.question_normalized) >= SIMILARITY_THRESHOLD);
    if (match) {
      await supabaseAdmin.from('qa_cache').update({ ask_count: match.ask_count + 1, updated_at: new Date().toISOString() }).eq('id', match.id);
      return res.json({
        result: match.answer,
        fromCache: true,
        questionsRemaining: profile.questions_remaining,
        membershipType: profile.membership_type,
      });
    }
  }

  // ── 5. Quota check (only for real Claude calls) ──────────────────────
  if (!checkQuota(profile)) {
    return res.status(402).json({ error: 'quota_exceeded', questionsRemaining: 0, membershipType: profile.membership_type });
  }

  // ── 6. Call Claude ───────────────────────────────────────────────────
  const context = chunks.map((c, i) => `[${c.source || `Section ${i+1}`}]\n${c.text}`).join('\n\n---\n\n');
  const prompt = [
    'You are a precise document analyst. Answer ONLY from the document excerpts provided.',
    '', 'DOCUMENT EXCERPTS:', context, '',
    question?.trim() ? `USER QUESTION: ${question.trim()}` : 'Provide a thorough analysis of the content above.',
    '', 'Respond STRICTLY following this output structure:', '', structure, '',
    'If the excerpts do not contain enough info for a section, write "Not found in the provided excerpts."',
  ].join('\n');

  let result;
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await apiRes.json();
    if (data.error) throw new Error(data.error.message);
    result = data.content?.map(b => b.text || '').join('\n') || '';
  } catch (err) {
    return res.status(500).json({ error: 'Claude API failed: ' + err.message });
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

  // ── 8. Decrement quota (if applicable) ──────────────────────────────
  const isUnlimited = profile.membership_type === 'lifetime' ||
    (profile.membership_type === 'timed' && new Date(profile.membership_expires_at) > new Date());

  let newRemaining = profile.questions_remaining;
  if (!isUnlimited) {
    newRemaining = Math.max(0, profile.questions_remaining - 1);
    await supabaseAdmin.from('profiles').update({ questions_remaining: newRemaining }).eq('id', user.id);
  }

  res.json({
    result,
    fromCache: false,
    questionsRemaining: newRemaining,
    membershipType: profile.membership_type,
  });
}
