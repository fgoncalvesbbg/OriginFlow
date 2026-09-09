/**
 * What you get instead of a file when the export would be wrong.
 *
 * *A partial file handed over with a list of warnings is one somebody imports anyway, landing
 * half the work and silently dropping the rest.* So there is no "export anyway" button here.
 * The list below is the deliverable: every problem, the SKU and attribute it is about, and what
 * to do about it.
 *
 * Phase 8 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import React from 'react';
import {
  BLOCKER_TITLES,
  groupBlockers,
  type ExportBlocker,
} from './attribute-grid/export-validation.utils';
import { Button } from '../common/Button';
import { X, ShieldAlert, Download } from 'lucide-react';

interface Props {
  blockers: readonly ExportBlocker[];
  /** How many SKUs the export would have covered, for context on the scale of the refusal. */
  skuCount: number;
  /** Copy the list out, so it can be pasted into a ticket or a message to whoever fixes it. */
  onCopy: () => void;
  onClose: () => void;
}

const ExportBlockedDialog: React.FC<Props> = ({ blockers, skuCount, onCopy, onClose }) => {
  const groups = groupBlockers(blockers);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="animate-scaleIn relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div className="flex items-start gap-2">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-red-600" />
            <div>
              <h2 className="text-sm font-semibold text-primary">
                No file was produced — {blockers.length} problem
                {blockers.length === 1 ? '' : 's'} would make it wrong
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                The export covers {skuCount} SKU{skuCount === 1 ? '' : 's'}, and it is
                all-or-nothing on purpose: a partial file plus a warning list is a file somebody
                imports anyway.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {groups.map(group => (
            <section key={group.kind}>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
                {BLOCKER_TITLES[group.kind]}
                <span className="ml-1 font-normal normal-case text-gray-400">
                  {group.blockers.length}
                </span>
              </h3>
              <ul className="space-y-1.5">
                {group.blockers.map((b, i) => (
                  <li
                    key={`${group.kind}-${i}`}
                    className="rounded border border-gray-200 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {b.skuNumber && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
                          {b.skuNumber}
                        </span>
                      )}
                      {b.attributeName && (
                        <span className="font-medium text-gray-800">{b.attributeName}</span>
                      )}
                    </div>
                    <p className="mt-1 text-gray-700">{b.detail}</p>
                    {/* Every refusal carries its remedy. A blocker that does not say what to do
                        is just an obstacle. */}
                    <p className="mt-0.5 text-gray-500">{b.remedy}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-200 px-5 py-3">
          <Button variant="secondary" onClick={onCopy} leftIcon={<Download size={14} />}>
            Copy this list
          </Button>
          <span className="text-[11px] text-gray-400">
            Fix these and export again — there is deliberately no override.
          </span>
        </div>
      </div>
    </div>
  );
};

export default ExportBlockedDialog;
