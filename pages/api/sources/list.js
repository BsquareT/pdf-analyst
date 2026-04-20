import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  // Fetch ALL rows for this user (we deduplicate manually to handle both
  // old single-row format and new batched format reliably)
  const { data, error } = await supabaseAdmin
    .from('sources')
    .select('id, file_name, total_pages, chunk_count, created_at, source_group_id, part_index, total_parts')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Deduplicate: one entry per file_name, always the part_index=0 row
  // This handles old rows (no part_index) and new batched rows correctly
  const seen = new Set();
  const unique = [];

  for (const row of (data || [])) {
    // Only include the "head" row of each file (part_index 0 or null/undefined)
    const partIdx = row.part_index ?? 0;
    if (partIdx !== 0) continue;

    // Deduplicate by file_name in case of any duplicates
    if (seen.has(row.file_name)) continue;
    seen.add(row.file_name);
    unique.push(row);
  }

  res.json({ sources: unique });
}
