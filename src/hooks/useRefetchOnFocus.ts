/**
 * useRefetchOnFocus — re-runs the given callback when the tab regains focus (or the
 * connection is recovered), so pages refresh stale data when the user returns.
 */
import { useEffect, useRef } from 'react';
import { RECONNECTED_EVENT } from '../context/ConnectionContext';

/**
 * Calls `refetch` whenever the browser tab becomes visible again or the app
 * recovers from a lost connection.
 *
 * Guards against overlapping runs: without this, returning to a tab fired a fresh
 * `loadData` on every page at once, and if one stalled it could pile up. The
 * in-flight ref drops re-entrant triggers, and errors are caught + logged so a
 * failed refetch is traceable rather than silent.
 */
export function useRefetchOnFocus(refetch: () => void | Promise<void>) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const inFlight = useRef(false);

  useEffect(() => {
    const run = async (trigger: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await refetchRef.current();
      } catch (e) {
        console.warn(`[refetch-on-focus] refetch (${trigger}) failed`, e);
      } finally {
        inFlight.current = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') run('visibility');
    };
    const onReconnected = () => run('reconnect');

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener(RECONNECTED_EVENT, onReconnected);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener(RECONNECTED_EVENT, onReconnected);
    };
  }, []);
}
