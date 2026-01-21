
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY;

// Export a flag so the UI can show a setup warning if needed
export const isLive = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isLive) {
    console.warn(
        "Supabase credentials missing. Check your environment variables (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or SUPABASE_URL/SUPABASE_ANON_KEY)."
    );
}

/**
 * Standard Supabase client.
 * Credentials are loaded from environment variables only.
 */
export const supabase = createClient(
    SUPABASE_URL ?? '',
    SUPABASE_ANON_KEY ?? ''
);
