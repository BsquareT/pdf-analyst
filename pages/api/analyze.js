import { supabaseAdmin } from '../../lib/supabase';
import { normalizeQuestion, jaccardSimilarity, SIMILARITY_THRESHOLD } from '../../lib/similarity';

// ══════════════════════════════════════════════════════════════════
//  AI PROVIDER — set AI_PROVIDER in Vercel env vars:
//  "gemini"  → Gemini 2.5 Flash (free tier, with auto-retry)
//  "haiku"   → Claude Haiku (cheap)
//  "claude"  → Claude Sonnet (best)
// ══════════════════════════════════════════════════════════════════
const PROVIDER = process.env.AI_PROVIDER || 'gemini';

// Gemini model cascade: try each in order if previous is overloaded
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-8b',
  'gemini-2.0-flash-lite',
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGeminiModel(model, prompt, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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

  // Check for overload / quota errors
  if (data.error) {
    const code = data.error.code;
    const msg = data.error.message || '';
    if (code === 429 || code === 503 || msg.includes('high demand') || msg.includes('overloaded') || msg.includes('quota')) {
      throw { retryable: true, message: msg, model };
    }
    throw { retryable: false, message: msg };
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw { retryable: false, message: 'Empty response from Gemini' };
  return text;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  // Try each model with up to 2 retries + exponential backoff
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callGeminiModel(model, prompt, apiKey);
      } catch (err) {
        if (!err.retryable) throw new Error(err.message || 'Gemini API error');
        // Retryable error — wait and try again (or next model)
        const waitMs = Math.pow(2, attempt) * 1500; // 1.5s, 3s, 6s
        console.log(`Gemini ${model} overloaded (attempt ${attempt + 1}), waiting ${waitMs}ms…`);
        if (attempt < 2) {
          await sleep(waitMs);
        }
        // After 3 attempts on this model, fall through to next model
      }
    }
    console.log(`Falling back from ${model} to next model…`);
  }

  throw new Error('All Gemini models are currently overloaded. Please try again in a minute.');
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

// ── QUOTA ─────────────────────────────────────────────────────────────────────
function checkQuota(profile) {
  const today = new Date().toISOString().split('T')[0];
  const type = profile.membership_type;
  const isNewDay = profile.daily_reset_date !== today;
  const dailyUsed = isNewDay ? 0 : (profile.daily_questions_used || 0);
  const dailyLimit = profile.daily_limit || 0;

  if (type === 'lifetime') {
    return { allowed: true, updatesNeeded: isNewDay ? { daily_questions_used: 0, daily_reset_date: today } : null };
  }

  const timedTypes = ['monthly', 'annual', 'promax_monthly', 'promax_annual'];
  if (timedTypes.includes(type)) {
    const expired = !profile.membership_expires_at || new Date(profile.membership_expires_at) < new Date();
    if (expired) return { allowed: false, reason: 'subscription_expired' };
    if (dailyLimit === 0) return { allowed: true, updatesNeeded: isNewDay ? { daily_questions_used: 0, daily_reset_date: today } : null };
    if (dailyUsed >= dailyLimit) return { allowed: false, reason: 'daily_limit_reached', dailyUsed, dailyLimit };
    return { allowed: true, updatesNeeded: { daily_questions_used: dailyUsed + 1, daily_reset_date: today } };
  }

  // Free / pack
  if ((profile.questions_remaining || 0) <= 0) return { allowed: false, reason: 'quota_exceeded' };
  return { allowed: true, updatesNeeded: { questions_remaining: profile.questions_remaining - 1 } };
}

// ── CACHE KEY ─────────────────────────────────────────────────────────────────
function buildCacheKey(normalizedQ, sourceNames) {
  const sortedSources = [...sourceNames].sort().join('|').toLowerCase();
  return `${normalizedQ}__sources__${sortedSources}`;
}

// ── ENRICH CACHED ANSWER WITH NEW SOURCES ─────────────────────────────────────
async function buildEnrichedAnswer(existingAnswer, newChunks, question, structure, cachedSourceNames, currentSourceNames) {
  const newSources = currentSourceNames.filter(n => !cachedSourceNames.includes(n));
  if (!newSources.length) return null;

  const newContext = newChunks
    .filter(c => newSources.some(s => c.source?.includes(s)))
    .slice(0, 8)
    .map((c, idx) => `[${c.source || `Section ${idx + 1}`}]\n${c.text}`)
    .join('\n\n---\n\n');

  if (!newContext.trim()) return null;

  const enrichPrompt = [
    'You are updating an existing medical analysis with additional source material.',
    '',
    'EXISTING ANSWER (from previous sources):',
    existingAnswer,
    '',
    'NEW SOURCE EXCERPTS:',
    newContext,
    '',
    `ORIGINAL QUESTION: ${question || 'General analysis'}`,
    '',
    'Produce an updated comprehensive answer that:',
    '1. Keeps all correct information from the existing answer',
    '2. Adds any NEW information from the new excerpts',
    '3. Resolves conflicts by mentioning both perspectives',
    '4. Follows this exact structure:',
    '',
    structure,
  ].join('\n');

  return callAI(enrichPrompt);
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', user.id).single();
  if (!profile) return res.status(500).json({ error: 'Profile not found' });
  if (!profile.approved) return res.status(403).json({ error: 'Account not approved' });

  const { chunks, question, structure, fileName, sourceNames = [] } = req.body;
  if (!chunks?.length) return res.status(400).json({ error: 'No content chunks provided' });

  const normalized = normalizeQuestion(question);
  const cacheKey = buildCacheKey(normalized, sourceNames);

  // ── 3. Exact cache match ─────────────────────────────────────────────
  const { data: exact } = await supabaseAdmin
    .from('qa_cache').select('*')
    .eq('question_normalized', cacheKey)
    .maybeSingle();

  if (exact) {
    const cachedSources = exact.source_names || [];
    const newSources = sourceNames.filter(s => !cachedSources.includes(s));

    if (newSources.length > 0) {
      try {
        const enriched = await buildEnrichedAnswer(exact.answer, chunks, question, structure, cachedSources, sourceNames);
        if (enriched) {
          await supabaseAdmin.from('qa_cache').update({
            answer: enriched, source_names: sourceNames,
            ask_count: exact.ask_count + 1, updated_at: new Date().toISOString(),
          }).eq('id', exact.id);
          return res.json({ result: enriched, fromCache: false, enriched: true, questionsRemaining: profile.questions_remaining, membershipType: profile.membership_type });
        }
      } catch (e) {
        console.error('Enrichment failed:', e.message);
      }
    }

    await supabaseAdmin.from('qa_cache')
      .update({ ask_count: exact.ask_count + 1, updated_at: new Date().toISOString() })
      .eq('id', exact.id);
    return res.json({ result: exact.answer, fromCache: true, questionsRemaining: profile.questions_remaining, membershipType: profile.membership_type });
  }

  // ── 4. Fuzzy cache match ─────────────────────────────────────────────
  const { data: candidates } = await supabaseAdmin
    .from('qa_cache').select('*').order('ask_count', { ascending: false }).limit(100);

  if (candidates?.length) {
    const match = candidates.find(c => {
      const cNorm = c.question_normalized?.split('__sources__')[0] || c.question_normalized;
      return jaccardSimilarity(normalized, cNorm) >= SIMILARITY_THRESHOLD;
    });
    if (match) {
      const cachedSources = match.source_names || [];
      const newSources = sourceNames.filter(s => !cachedSources.includes(s));
      if (newSources.length === 0) {
        await supabaseAdmin.from('qa_cache')
          .update({ ask_count: match.ask_count + 1, updated_at: new Date().toISOString() })
          .eq('id', match.id);
        return res.json({ result: match.answer, fromCache: true, questionsRemaining: profile.questions_remaining, membershipType: profile.membership_type });
      }
    }
  }

  // ── 5. Quota check ───────────────────────────────────────────────────
  const quota = checkQuota(profile);
  if (!quota.allowed) {
    return res.status(402).json({ error: quota.reason || 'quota_exceeded', questionsRemaining: profile.questions_remaining, membershipType: profile.membership_type });
  }

  // ── 6. Build multi-source prompt ──────────────────────────────────────
  const chunksBySource = {};
  for (const chunk of chunks) {
    const src = chunk.fileName || (chunk.source ? chunk.source.split(']')[0].replace('[', '') : 'Unknown');
    if (!chunksBySource[src]) chunksBySource[src] = [];
    chunksBySource[src].push(chunk);
  }

  const context = Object.entries(chunksBySource)
    .map(([srcName, srcChunks]) => {
      const excerpts = srcChunks.map((c, idx) => `  [${c.source || `Section ${idx + 1}`}]: ${c.text}`).join('\n');
      return `=== SOURCE: ${srcName} ===\n${excerpts}`;
    }).join('\n\n');

  const sourceList = sourceNames.length > 1 ? `\nSources: ${sourceNames.join(', ')}` : '';

  const prompt = [
    'You are a precise medical document analyst. Answer ONLY from the document excerpts provided.',
    'When multiple sources are provided, synthesize information from ALL of them into one comprehensive answer.',
    'If sources agree, state confidently. If they add to each other, combine the information.',
    sourceList, '',
    'DOCUMENT EXCERPTS:', context, '',
    question?.trim() ? `QUESTION: ${question.trim()}` : 'Provide a thorough analysis of the content above.',
    '', 'Respond STRICTLY following this output structure:', '', structure, '',
    'If the excerpts do not contain enough info for a section, write "Not found in the provided excerpts."',
  ].join('\n');

  let result;
  try {
    result = await callAI(prompt);
  } catch (err) {
    return res.status(500).json({ error: `AI API failed: ${err.message}` });
  }

  // ── 7. Cache the result ───────────────────────────────────────────────
  await supabaseAdmin.from('qa_cache').upsert({
    question_normalized: cacheKey,
    question_original: question?.trim() || 'General analysis',
    answer: result, structure,
    file_name: sourceNames.join(', ') || fileName || 'Unknown',
    source_names: sourceNames,
    ask_count: 1,
  }, { onConflict: 'question_normalized' });

  // ── 8. Update quota ───────────────────────────────────────────────────
  if (quota.updatesNeeded) {
    await supabaseAdmin.from('profiles').update(quota.updatesNeeded).eq('id', user.id);
  }
  const newProfile = { ...profile, ...quota.updatesNeeded };

  res.json({
    result, fromCache: false,
    questionsRemaining: newProfile.questions_remaining ?? profile.questions_remaining,
    membershipType: profile.membership_type,
    dailyUsed: newProfile.daily_questions_used ?? 0,
    dailyLimit: profile.daily_limit ?? 0,
  });
}
