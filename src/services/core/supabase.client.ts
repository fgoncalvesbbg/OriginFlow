import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG, isLive } from '../../config/environment.config';

const FALLBACK_SUPABASE_URL = 'http://localhost:54321';
const FALLBACK_SUPABASE_ANON_KEY = 'public-anon-key';

/**
 * Standard Supabase client for authenticated requests
 * Credentials are loaded from environment variables only
 */
export const supabase = createClient(
  isLive ? APP_CONFIG.supabaseUrl : FALLBACK_SUPABASE_URL,
  isLive ? APP_CONFIG.supabaseAnonKey : FALLBACK_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'sb-auth-token'
    }
  }
);

/**
 * Portal client for non-authenticated public routes (suppliers, external users)
 * Uses separate session storage to avoid conflicts with authenticated session
 */
export const portalClient = createClient(
  isLive ? APP_CONFIG.supabaseUrl : FALLBACK_SUPABASE_URL,
  isLive ? APP_CONFIG.supabaseAnonKey : FALLBACK_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'sb-portal-auth-token'
    }
  }
);
