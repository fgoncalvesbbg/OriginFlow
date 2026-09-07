/**
 * SkipControls — Skip / Skip rest of section / Skip all remaining / Finish.
 *
 * Purely presentational: `PlaceholderIntakeWizard` is the only place that actually writes
 * `pending` status (via `saveWizardAnswer`) — keeping "what does skip actually do" in one
 * place rather than scattered across every control that can trigger it.
 */
import React from 'react';
import { CheckCircle2, ChevronsRight, SkipForward } from 'lucide-react';

interface SkipControlsProps {
  onSkip: () => void;
  onSkipRestOfSection: () => void;
  onSkipAllRemaining: () => void;
  onFinish: () => void;
  /** Always true in Phase 1 — Finish just closes the wizard; skipping every question still
   *  produces a draft (see the wizard plan). Kept as a prop rather than hard-coded so a
   *  later phase can gate it (e.g. mid-upload) without changing this component's contract. */
  canFinish: boolean;
}

const SkipControls: React.FC<SkipControlsProps> = ({
  onSkip, onSkipRestOfSection, onSkipAllRemaining, onFinish, canFinish,
}) => (
  <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 bg-light">
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onSkip}
        className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded hover:bg-white border border-transparent hover:border-gray-200"
      >
        Skip
      </button>
      <button
        type="button"
        onClick={onSkipRestOfSection}
        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded hover:bg-white border border-transparent hover:border-gray-200"
      >
        <SkipForward size={12} /> Skip rest of section
      </button>
      <button
        type="button"
        onClick={onSkipAllRemaining}
        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded hover:bg-white border border-transparent hover:border-gray-200"
      >
        <ChevronsRight size={12} /> Skip all remaining
      </button>
    </div>
    <button
      type="button"
      onClick={onFinish}
      disabled={!canFinish}
      className="flex items-center gap-1.5 bg-indigo-600 text-white text-sm font-bold px-4 py-2 rounded-xl shadow hover:bg-indigo-700 disabled:opacity-50"
    >
      <CheckCircle2 size={15} /> Finish
    </button>
  </div>
);

export default SkipControls;
