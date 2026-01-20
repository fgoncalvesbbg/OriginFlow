
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// Export a flag so the UI can show a setup warning if needed
export const isLive = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isLive) {
    console.warn("Supabase credentials missing. Check your environment variables (SUPABASE_URL and SUPABASE_ANON_KEY).");
}

/**
 * Standard Supabase client. 
 * If credentials are missing, we provide dummy values for the constructor to prevent 
 * the 'supabaseUrl is required' error from crashing the entire app on load.
 */
export const supabase = createClient(
    SUPABASE_URL || 'https://placeholder.supabase.co', 
    SUPABASE_ANON_KEY || 'placeholder'
);
