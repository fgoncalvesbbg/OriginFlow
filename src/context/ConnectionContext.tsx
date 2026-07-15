/**
 * Connection status layer — passive and non-disruptive by design.
 *
 * IMPORTANT: this must NEVER navigate, reload, refresh the session, or sign the
 * user out on its own. Earlier versions actively probed on every tab-refocus and
 * could flip to a "lost" state (and trigger auth churn) while a long operation —
 * e.g. an AI translation — was in flight, breaking it. All of that is removed.
 *
 * What remains: it reflects the browser's own `online`/`offline` signal so we can
 * show a passive banner when the device is genuinely offline. Recovery from a
 * stale/slow connection is handled invisibly by bounded requests (with-timeout)
 * and the auth watchdog — pages fail fast and surface their own error/retry UI
 * rather than hanging. The user is only ever asked to act via explicit buttons.
 */
import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { isLive } from '../config/environment.config';

export type ConnectionStatus = 'online' | 'offline';

interface ConnectionContextType {
  status: ConnectionStatus;
  /** Re-check connectivity and, if back online, ask pages to refresh their data. */
  reconnect: () => void;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

/** Event pages can listen to (via useRefetchOnFocus) to reload after coming back online. */
export const RECONNECTED_EVENT = 'originflow:reconnected';

export const ConnectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<ConnectionStatus>(
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
  );

  const reconnect = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus('offline');
      return;
    }
    setStatus('online');
    console.info('[conn] connectivity confirmed — refreshing data');
    window.dispatchEvent(new Event(RECONNECTED_EVENT));
  }, []);

  useEffect(() => {
    if (!isLive) return;

    const onOnline = () => {
      console.info('[conn] browser reports online');
      setStatus('online');
      // Let pages that opted into useRefetchOnFocus reload any data that went
      // stale while offline. This does not navigate — it only re-fetches.
      window.dispatchEvent(new Event(RECONNECTED_EVENT));
    };
    const onOffline = () => {
      console.warn('[conn] browser reports offline');
      setStatus('offline');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

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
