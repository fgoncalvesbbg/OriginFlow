/**
 * PipelineStepper — a row of steps with a state each, used twice in the generator header.
 *
 * The generator answers two different questions with the same widget, and keeping them
 * visually identical is deliberate — they are both "where does this stand":
 *
 *   Readiness   Content → Translation → Published. What has to be true before a manual can
 *               go anywhere. These are checks, not places: a manual does not "rest" in
 *               Translation.
 *   Workflow    In Progress → In Review (draft) → Rework → In Review (final) → Final. The
 *               steps the All Manuals board is built from, in the same words, so the two
 *               screens cannot disagree about the same manual.
 *
 * Purely presentational: the host derives every state and supplies the click-through
 * actions. `caption` names which of the two rows this is, so neither has to be guessed
 * from its contents.
 */

import React from 'react';
import { Check, Circle, AlertCircle, ChevronRight, CircleDashed, MinusCircle, Dot } from 'lucide-react';

export type PipelineStepState = 'done' | 'todo' | 'warn' | 'optional' | 'skipped' | 'current';

export interface PipelineStep {
  key: string;
  label: string;
  state: PipelineStepState;
  /** Small status fragment shown under the label ("3 open items", "v5"). */
  detail?: string;
  /** Makes the step a button that jumps to its action. */
  onClick?: () => void;
  /** Tooltip. */
  title?: string;
}

const STATE_STYLE: Record<PipelineStepState, { icon: React.ReactNode; text: string; detail: string; chip?: string }> = {
  done: { icon: <Check size={13} className="text-emerald-600" />, text: 'text-gray-700', detail: 'text-emerald-600' },
  warn: { icon: <AlertCircle size={13} className="text-amber-500" />, text: 'text-gray-700', detail: 'text-amber-600' },
  todo: { icon: <Circle size={13} className="text-gray-300" />, text: 'text-gray-500', detail: 'text-gray-400' },
  optional: { icon: <CircleDashed size={13} className="text-gray-300" />, text: 'text-gray-400', detail: 'text-gray-400' },
  skipped: { icon: <MinusCircle size={13} className="text-gray-300" />, text: 'text-gray-400', detail: 'text-gray-400' },
  // The step the manual is AT right now. Filled, darker, and on its own tinted chip — on a
  // row of seven near-identical labels, "which one am I" has to be answerable at a glance
  // and not by reading each one.
  current: {
    icon: <Dot size={16} className="text-indigo-600" />,
    text: 'text-indigo-800',
    detail: 'text-indigo-600',
    chip: 'bg-indigo-50 border border-indigo-200 rounded-lg',
  },
};

export const PipelineStepper: React.FC<{ steps: PipelineStep[]; caption?: string }> = ({ steps, caption }) => (
  <div className="flex items-center gap-1 flex-wrap rounded-xl border border-gray-200 bg-white px-3 py-1.5 mb-2 shadow-sm">
    {caption && (
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mr-1.5 shrink-0">{caption}</span>
    )}
    {steps.map((step, i) => {
      const s = STATE_STYLE[step.state];
      const body = (
        <span className="flex items-center gap-1.5">
          {s.icon}
          <span className={`text-xs font-semibold ${s.text}`}>{step.label}</span>
          {step.detail && <span className={`text-[10px] ${s.detail}`}>{step.detail}</span>}
        </span>
      );
      return (
        <React.Fragment key={step.key}>
          {i > 0 && <ChevronRight size={12} className="text-gray-200 shrink-0" />}
          {step.onClick ? (
            <button
              onClick={step.onClick}
              title={step.title}
              aria-current={step.state === 'current' ? 'step' : undefined}
              className={`px-1.5 py-1 rounded-lg hover:bg-gray-50 transition-colors ${s.chip ?? ''}`}
            >{body}</button>
          ) : (
            <span
              title={step.title}
              aria-current={step.state === 'current' ? 'step' : undefined}
              className={`px-1.5 py-1 ${s.chip ?? ''}`}
            >{body}</span>
          )}
        </React.Fragment>
      );
    })}
  </div>
);

export default PipelineStepper;
