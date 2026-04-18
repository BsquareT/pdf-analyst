import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'No source ids provided' });

  // Fetch the metadata rows (part_index=0) to get source_group_ids and file names
  const { data: metaRows, error: metaErr } = await supabaseAdmin
    .from('sources')
    .select('id, file_name, source_group_id, total_parts')
    .in('id', ids)
    .eq('user_id', user.id);

  if (metaErr) return res.status(500).json({ error: metaErr.message });
  if (!metaRows?.length) return res.status(404).json({ error: 'No sources found' });

  // For each selected source, fetch ALL its parts using source_group_id
  const allChunks = [];

  for (const meta of metaRows) {
    let parts;

    if (meta.source_group_id) {
      // New batched format — fetch all parts by group id
      const { data, error } = await supabaseAdmin
        .from('sources')
        .select('chunks, part_index')
        .eq('source_group_id', meta.source_group_id)
        .eq('user_id', user.id)
        .order('part_index', { ascending: true });

      if (error) throw new Error(error.message);
      parts = data;
    } else {
      // Old single-row format — just use the one row
      const { data, error } = await supabaseAdmin
        .from('sources')
        .select('chunks, part_index')
        .eq('id', meta.id);

      if (error) throw new Error(error.message);
      parts = data;
    }

    // Merge all parts' chunks and tag with source file name
    for (const part of (parts || [])) {
      for (const chunk of (part.chunks || [])) {
        allChunks.push({
          ...chunk,
          source: `[${meta.file_name}] ${chunk.source}`,
          fileName: meta.file_name,
        });
      }
    }
  }

  res.json({ chunks: allChunks, sourceNames: metaRows.map(m => m.file_name) });
}
