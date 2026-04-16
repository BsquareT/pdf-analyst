import { createClient } from '@supabase/supabase-js';

// 1. Check if variables exist (Helper for debugging)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

// 2. Browser-safe public client
// This is used for logging in and basic data fetching
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 3. Server-only admin client
// This is used for "God Mode" tasks. 
// Note: This will only work on the SERVER side (API routes or Server Components)
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey,
  { 
    auth: { 
      autoRefreshToken: false, 
      persistSession: false 
    } 
  }
);