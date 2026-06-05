import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG, isLive } from '../../config/environment.config';

const FALLBACK_SUPABASE_URL = 'http://localhost:54321';
const FALLBACK_SUPABASE_ANON_KEY = 'public-anon-key';

/**
 * Time-bounded replacement for supabase-js's default navigator.locks-based auth
 * lock. The default acquires the Web Lock with no timeout, so a lock held by
 * another tab — or left stale by a dev-server (HMR) reload mid token-refresh —
 * blocks every subsequent token-bearing request indefinitely. That manifests as
 * reads/writes hanging until our 12s withTimeout fires (e.g. saveIMBlock).
 *
 * Here we still take the lock for normal cross-tab refresh coordination, but if
 * it can't be acquired within ACQUIRE_TIMEOUT_MS we proceed WITHOUT it rather
 * than hang. Worst case under a genuinely stuck lock is a rare double refresh —
 * strictly better than a frozen request.
 */
const ACQUIRE_TIMEOUT_MS = 5000;

const timeoutLock = async <R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> => {
  if (typeof navigator === 'undefined' || !navigator.locks) return fn();
  try {
    return await navigator.locks.request(
      name,
      { mode: 'exclusive', signal: AbortSignal.timeout(ACQUIRE_TIMEOUT_MS) },
      async () => fn(),
    );
  } catch (e) {
    console.warn(`[supabase] auth lock "${name}" not acquired in ${ACQUIRE_TIMEOUT_MS}ms — proceeding without it`, e);
    return fn();
  }
};

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
      storageKey: 'sb-auth-token',
      lock: timeoutLock
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
