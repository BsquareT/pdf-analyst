import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// This will print "Found" or "Missing" in your browser console
console.log("Supabase URL:", url ? "Found" : "Missing");
console.log("Supabase Key:", key ? "Found" : "Missing");

export const supabase = createClient(url || '', key || '');