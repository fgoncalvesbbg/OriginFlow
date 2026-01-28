import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../../config/environment.config';

/**
 * Standard Supabase client for authenticated requests
 * Credentials are loaded from environment variables only
 */
export const supabase = createClient(
    APP_CONFIG.supabaseUrl,
    APP_CONFIG.supabaseAnonKey,
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
export const portalClient = createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'sb-portal-auth-token'
  }
});
