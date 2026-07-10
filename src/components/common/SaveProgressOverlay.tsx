/**
 * Full-screen blocking overlay shown while a save/publish is in flight.
 *
 * Its job is to stop the user navigating away or clicking anything mid-save — an
 * interrupted save on a slow connection is what wedges the session and loses work.
 * Because every network call in the save path is now time-bounded (see with-timeout.ts),
 * this overlay is guaranteed to clear: the underlying save always resolves or fails within
 * its ceiling, so the caller flips `isOpen` back to false. It intentionally has no dismiss
 * control — the only way out is for the save to finish.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

export interface SaveProgressOverlayProps {
  isOpen: boolean;
  /** Main line, e.g. "Saving your work…". */
  message?: string;
  /** Optional live phase text, e.g. the publish status ("Rendering PDF…"). */
  detail?: string | null;
}

export const SaveProgressOverlay: React.FC<SaveProgressOverlayProps> = ({
  isOpen,
  message = 'Saving your work…',
  detail,
}) => {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200"
      // Swallow every interaction so nothing behind the overlay is clickable mid-save.
      onClick={(e) => e.stopPropagation()}
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 flex flex-col items-center text-center">
        <Loader2 size={32} className="animate-spin text-indigo-600 mb-4" />
        <p className="text-base font-bold text-primary">{message}</p>
        {detail ? <p className="mt-1 text-sm text-gray-600">{detail}</p> : null}
        <p className="mt-4 text-xs text-muted">Please keep this tab open until it finishes.</p>
      </div>
    </div>
  );
};
