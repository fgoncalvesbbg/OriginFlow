/**
 * ConnectionBanner — top-of-screen banner shown when the Supabase connection is
 * degraded. Hidden entirely while online. Driven by ConnectionContext.
 *
 * The user asked to be told when they need to act: on a `lost`/`offline` state we
 * show a Reconnect button (bounded auto-recovery) and a Reload fallback, so a
 * frozen session is always recoverable without guessing.
 */
import React from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { useConnection } from '../../context/ConnectionContext';

export const ConnectionBanner: React.FC = () => {
  const { status, reconnect } = useConnection();

  if (status === 'online') return null;

  const isReconnecting = status === 'reconnecting';
  const isOffline = status === 'offline';

  const message = isOffline
    ? 'You appear to be offline. Check your internet connection.'
    : isReconnecting
      ? 'Reconnecting…'
      : 'Connection to the server was lost. Your data may not load or save until you reconnect.';

  return (
    <div
      className="fixed top-0 inset-x-0 z-[100] bg-amber-500 text-amber-950 shadow-md"
      role="alert"
      aria-live="assertive"
    >
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3 text-sm font-medium">
        {isOffline ? (
          <WifiOff className="w-4 h-4 flex-shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        )}
        <span className="flex-grow">{message}</span>

        {!isOffline && (
          <button
            onClick={() => reconnect()}
            disabled={isReconnecting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950/10 hover:bg-amber-950/20 px-3 py-1 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
            {isReconnecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
        )}

        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-950/10 hover:bg-amber-950/20 px-3 py-1 transition-colors"
        >
          Reload page
        </button>
      </div>
    </div>
  );
};
