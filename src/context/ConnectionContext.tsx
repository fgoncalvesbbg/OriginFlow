/**
 * Connection health / recovery layer.
 *
 * Root problem this addresses: after a tab has been idle in the background, the
 * Supabase keep-alive socket is often dropped and the access token expires. When
 * the user returns, data requests (and the internal token refresh) can fail or
 * stall. Previously nothing detected this — pages just sat on a spinner.
 *
 * This provider watches `visibilitychange`, `online`, and `offline`. Whenever the
 * tab regains focus or the browser reports it is back online, it runs a short
 * BOUNDED connectivity probe. If the probe succeeds it stays silent (and, if we
 * had previously lost the connection, fires `originflow:reconnected` so pages
 * re-fetch). If the probe fails it flips to a `lost` state, which renders the
 * ConnectionBanner telling the user to reconnect or reload. A manual `reconnect()`
 * forces a token refresh + re-probe.
 */
import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { supabase } from '../services/core/supabase.client';
import { withTimeout } from '../services/core/with-timeout';
import { isLive } from '../config/environment.config';
import { isPortalRoute } from '../config/routes.config';

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting' | 'lost';

interface ConnectionContextType {
  status: ConnectionStatus;
  /** Manually re-establish the connection (forces a token refresh + re-probe). */
  reconnect: () => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

/** Event pages can listen to (via useRefetchOnFocus) to reload after recovery. */
export const RECONNECTED_EVENT = 'originflow:reconnected';

const PROBE_SESSION_TIMEOUT_MS = 6000;
const PROBE_QUERY_TIMEOUT_MS = 8000;
const REFRESH_TIMEOUT_MS = 8000;

export const ConnectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<ConnectionStatus>(
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
  );
  // Prevents overlapping probes (focus + online can fire together).
  const probing = useRef(false);

  /**
   * Bounded connectivity probe against the real data path. Returns true if the
   * connection is healthy (or there is no session to check — e.g. login page).
   */
  const probe = useCallback(async (): Promise<boolean> => {
    try {
      const { data: { session } } = await withTimeout(supabase.auth.getSession(), PROBE_SESSION_TIMEOUT_MS);
      // No session → unauthenticated view; nothing to verify, treat as fine.
      if (!session) return true;
      const { error } = await withTimeout(
        supabase.from('profiles').select('id').limit(1),
        PROBE_QUERY_TIMEOUT_MS,
      );
      if (error) {
        console.warn('[conn] connectivity probe returned an error', error);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[conn] connectivity probe failed (timeout or network)', e);
      return false;
    }
  }, []);

  const markOnline = useCallback((wasDegraded: boolean) => {
    setStatus('online');
    if (wasDegraded) {
      console.info('[conn] connection restored — refreshing data');
      window.dispatchEvent(new Event(RECONNECTED_EVENT));
    }
  }, []);

  /** Silent auto-check used on focus/online — never shows the "reconnecting" state. */
  const silentCheck = useCallback(async () => {
    if (!isLive || isPortalRoute()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('offline');
      return;
    }
    if (probing.current) return;
    probing.current = true;
    try {
      const ok = await probe();
      setStatus(prev => {
        if (ok) {
          if (prev !== 'online') {
            console.info('[conn] connection restored — refreshing data');
            window.dispatchEvent(new Event(RECONNECTED_EVENT));
          }
          return 'online';
        }
        if (prev !== 'lost') {
          console.error('[conn] connection lost — data requests are failing. Showing reconnect banner.');
        }
        return 'lost';
      });
    } finally {
      probing.current = false;
    }
  }, [probe]);

  /** Manual reconnect from the banner: force a token refresh, then re-probe. */
  const reconnect = useCallback(async () => {
    if (probing.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('offline');
      return;
    }
    probing.current = true;
    setStatus('reconnecting');
    console.info('[conn] manual reconnect requested');
    try {
      await withTimeout(supabase.auth.refreshSession(), REFRESH_TIMEOUT_MS).catch(() => {});
      const ok = await probe();
      if (ok) {
        markOnline(true);
        console.info('[conn] reconnect succeeded');
      } else {
        setStatus('lost');
        console.error('[conn] reconnect failed — the user should reload the page.');
      }
    } finally {
      probing.current = false;
    }
  }, [probe, markOnline]);

  useEffect(() => {
    if (!isLive) return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') silentCheck();
    };
    const onOnline = () => {
      console.info('[conn] browser reports online — verifying connection');
      silentCheck();
    };
    const onOffline = () => {
      console.warn('[conn] browser reports offline');
      setStatus('offline');
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [silentCheck]);

  return (
    <ConnectionContext.Provider value={{ status, reconnect }}>
      {children}
    </ConnectionContext.Provider>
  );
};

export const useConnection = (): ConnectionContextType => {
  const context = useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
};
