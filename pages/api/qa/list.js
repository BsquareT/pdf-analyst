import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { data: items, error } = await supabaseAdmin
    .from('qa_cache')
    .select('id, question_original, answer, file_name, ask_count, created_at')
    .order('ask_count', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: items || [] });
}
