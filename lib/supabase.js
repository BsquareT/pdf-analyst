import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase env vars:', {
    url: supabaseUrl ? 'found' : 'MISSING',
    anonKey: supabaseAnonKey ? 'found' : 'MISSING',
  });
}

// Browser-safe public client
export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-key-replace-me'
);

// Server-only admin client (never use in frontend)
export const supabaseAdmin = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseServiceKey ?? 'placeholder-service-key',
  { auth: { autoRefreshToken: false, persistSession: false } }
);
