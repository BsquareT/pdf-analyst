import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { fileName, chunks, totalPages } = req.body;
  if (!fileName || !chunks?.length) return res.status(400).json({ error: 'Missing data' });

  // Check if source with same name already exists for this user — replace it
  await supabaseAdmin
    .from('sources')
    .delete()
    .eq('user_id', user.id)
    .eq('file_name', fileName);

  const { data, error } = await supabaseAdmin.from('sources').insert({
    user_id: user.id,
    file_name: fileName,
    total_pages: totalPages || 0,
    chunk_count: chunks.length,
    chunks: chunks,
  }).select('id, file_name, total_pages, chunk_count, created_at').single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ source: data });
}
