/**
 * ConnectionBanner — passive top-of-screen notice shown only when the browser
 * reports it is offline. It NEVER navigates or reloads on its own; the only
 * page-level action (Reload) is an explicit button the user chooses to click.
 * When the device comes back online the banner disappears automatically.
 */
import React from 'react';
import { WifiOff } from 'lucide-react';
import { useConnection } from '../../context/ConnectionContext';

export const ConnectionBanner: React.FC = () => {
  const { status } = useConnection();

  if (status === 'online') return null;

  return (
    <div
      className="fixed top-0 inset-x-0 z-[100] bg-amber-500 text-amber-950 shadow-md"
      role="status"
      aria-live="polite"
    >
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-3 text-sm font-medium">
        <WifiOff className="w-4 h-4 flex-shrink-0" />
        <span className="flex-grow">
          You appear to be offline. Changes may not save until your connection returns.
        </span>
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
