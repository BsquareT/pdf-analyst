import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'No source ids provided' });

  const { data, error } = await supabaseAdmin
    .from('sources')
    .select('id, file_name, chunks')
    .in('id', ids)
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ error: error.message });

  // Merge all chunks from all selected sources, tagging each with file name
  const merged = (data || []).flatMap(source =>
    (source.chunks || []).map(chunk => ({
      ...chunk,
      source: `[${source.file_name}] ${chunk.source}`,
    }))
  );

  res.json({ chunks: merged });
}
