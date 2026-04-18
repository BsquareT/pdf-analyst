import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).end();

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing source id' });

  const { error } = await supabaseAdmin
    .from('sources')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id); // ensure user owns it

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
}
