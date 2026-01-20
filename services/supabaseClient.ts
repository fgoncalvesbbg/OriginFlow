
import { createClient } from '@supabase/supabase-js';

// Environment variables provided via build tool (Vite)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export const isLive = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isLive) {
    console.warn("Supabase credentials missing. Local mock data or limited functionality may be active.");
}

// Standard Supabase client initialization. 
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
