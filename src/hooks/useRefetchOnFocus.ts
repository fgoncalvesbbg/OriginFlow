/**
 * useRefetchOnFocus — re-runs the given callback when the window/tab regains focus, so pages
 * refresh stale data when the user returns to them.
 */
import { useEffect, useRef } from 'react';

/**
 * Calls `refetch` whenever the browser tab becomes visible again.
 * Prevents stale data after the user switches tabs or returns to the app.
 */
export function useRefetchOnFocus(refetch: () => void) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refetchRef.current();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);
}
