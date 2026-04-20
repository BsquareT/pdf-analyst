import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'No source ids provided' });

  // Fetch metadata rows (part_index=0) for selected sources
  const { data: metaRows, error: metaErr } = await supabaseAdmin
    .from('sources')
    .select('id, file_name, source_group_id, total_parts')
    .in('id', ids)
    .eq('user_id', user.id);

  if (metaErr) return res.status(500).json({ error: metaErr.message });
  if (!metaRows?.length) return res.status(404).json({ error: 'No sources found' });

  const allChunks = [];
  const groupIds = [];

  for (const meta of metaRows) {
    let parts;
    if (meta.source_group_id) {
      groupIds.push(meta.source_group_id);
      const { data, error } = await supabaseAdmin
        .from('sources')
        .select('chunks, part_index')
        .eq('source_group_id', meta.source_group_id)
        .eq('user_id', user.id)
        .order('part_index', { ascending: true });
      if (error) throw new Error(error.message);
      parts = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('sources').select('chunks, part_index').eq('id', meta.id);
      if (error) throw new Error(error.message);
      parts = data;
    }

    for (const part of (parts || [])) {
      for (const chunk of (part.chunks || [])) {
        allChunks.push({
          ...chunk,
          source: `[${meta.file_name}] ${chunk.source}`,
          fileName: meta.file_name,
          sourceGroupId: meta.source_group_id,
        });
      }
    }
  }

  // Fetch images for all selected sources (grouped by page number)
  let imagesByPage = {};
  if (groupIds.length > 0) {
    const { data: imgs } = await supabaseAdmin
      .from('source_images')
      .select('public_url, page_number, file_name, source_group_id')
      .in('source_group_id', groupIds)
      .order('page_number', { ascending: true });

    for (const img of (imgs || [])) {
      const key = `${img.source_group_id}_${img.page_number}`;
      if (!imagesByPage[key]) imagesByPage[key] = [];
      imagesByPage[key].push({
        url: img.public_url,
        pageNumber: img.page_number,
        fileName: img.file_name,
        groupId: img.source_group_id,
      });
    }
  }

  res.json({
    chunks: allChunks,
    imagesByPage,
    sourceNames: metaRows.map(m => m.file_name),
    groupIds,
  });
}
