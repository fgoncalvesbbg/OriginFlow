/**
 * PipelineStepper — the manual's lifecycle at a glance, in the generator header.
 *
 * Content → Translation → Publish → Review (optional) → Final → Print, each step
 * derived from data the page already holds. For one person running the whole IM
 * process, opening a manual should instantly answer "where was I here, and what
 * do I do next" — that is this component's whole job. Purely presentational:
 * the host derives the states and supplies the click-through actions.
 */

import React from 'react';
import { Check, Circle, AlertCircle, ChevronRight, CircleDashed, MinusCircle } from 'lucide-react';

export type PipelineStepState = 'done' | 'todo' | 'warn' | 'optional' | 'skipped';

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

const STATE_STYLE: Record<PipelineStepState, { icon: React.ReactNode; text: string; detail: string }> = {
  done: { icon: <Check size={13} className="text-emerald-600" />, text: 'text-gray-700', detail: 'text-emerald-600' },
  warn: { icon: <AlertCircle size={13} className="text-amber-500" />, text: 'text-gray-700', detail: 'text-amber-600' },
  todo: { icon: <Circle size={13} className="text-gray-300" />, text: 'text-gray-500', detail: 'text-gray-400' },
  optional: { icon: <CircleDashed size={13} className="text-gray-300" />, text: 'text-gray-400', detail: 'text-gray-400' },
  skipped: { icon: <MinusCircle size={13} className="text-gray-300" />, text: 'text-gray-400', detail: 'text-gray-400' },
};

export const PipelineStepper: React.FC<{ steps: PipelineStep[] }> = ({ steps }) => (
  <div className="flex items-center gap-1 flex-wrap rounded-xl border border-gray-200 bg-white px-3 py-1.5 mb-3 shadow-sm">
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
              className="px-1.5 py-1 rounded-lg hover:bg-gray-50 transition-colors"
            >{body}</button>
          ) : (
            <span title={step.title} className="px-1.5 py-1">{body}</span>
          )}
        </React.Fragment>
      );
    })}
  </div>
);

export default PipelineStepper;
