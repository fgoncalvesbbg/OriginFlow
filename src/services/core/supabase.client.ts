/**
 * Supabase client setup. Exports `supabase` (authenticated app client) and `portalClient`
 * (separate client for unauthenticated supplier-portal access). Configured from environment.config.
 */
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
 * Network-level backstop so NO request can hang forever.
 *
 * The idle-tab freeze is caused by requests that never settle: after a tab is
 * backgrounded long enough for the access token to expire, the keep-alive socket
 * is often silently dropped. On return, supabase-js's internal token refresh (and
 * any getSession/read that waits on it) can stay pending indefinitely — the OS
 * never delivers an error for the dead socket. Neither `withTimeout` (only wraps
 * explicit call sites) nor `timeoutLock` (only bounds lock acquisition) covers
 * that internal refresh fetch. Bounding fetch itself does.
 *
 * This is deliberately generous (100s) — LONGER than save-retry's MAX_TIMEOUT_MS
 * (90s) — so it never aborts a legitimately slow large upload; the per-call
 * `withTimeout` bounds (12-90s) always fire first for those. It exists purely to
 * convert an infinite hang into a normal fetch error the app can recover from.
 * The connection-recovery layer (ConnectionContext) surfaces failures to the user
 * much faster (~8s) via its own short-bounded probe.
 */
const GLOBAL_FETCH_TIMEOUT_MS = 100_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const external = init?.signal ?? undefined;
  const onExternalAbort = () => controller.abort((external as AbortSignal).reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input as Request).url);
    console.warn(`[supabase] request aborted by ${GLOBAL_FETCH_TIMEOUT_MS / 1000}s network backstop — likely a dropped connection`, url);
    controller.abort(new DOMException(`Request exceeded ${GLOBAL_FETCH_TIMEOUT_MS}ms network backstop`, 'TimeoutError'));
  }, GLOBAL_FETCH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', onExternalAbort);
  });
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
    },
    global: { fetch: fetchWithTimeout }
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
    },
    global: { fetch: fetchWithTimeout }
  }
);
