import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Browser-safe public client
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// Server-only admin client (never use in frontend)
export const supabaseAdmin = createClient(supabaseUrl || '', supabaseServiceKey || '', {
  auth: { autoRefreshToken: false, persistSession: false }
});