/**
 * Environment configuration and feature flags
 */

// Supabase connection status
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isLive = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const APP_CONFIG = {
  isProduction: import.meta.env.MODE === 'production',
  isLive,
  apiTimeout: 30000,
  pollingInterval: 30000,
  supabaseUrl: SUPABASE_URL || '',
  supabaseAnonKey: SUPABASE_ANON_KEY || '',
};

if (!isLive) {
    console.warn(
        "Supabase credentials missing. Check your environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)."
    );
}
