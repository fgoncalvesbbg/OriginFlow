/**
 * "Apply these requirements to other categories" — the link-or-copy dialog (migration 173).
 *
 * The motivating case is a family: every Hood needs the same LVD report, the same EMC report,
 * the same exploded view. So the category picker is grouped by "L1 › L2" with a whole-group
 * toggle, because the operator's actual thought is "all Hoods", not "these eleven leaves" —
 * making them tick eleven boxes is making them do the grouping the tree already did.
 *
 * WHY THE PLAN IS SHOWN BEFORE ANYTHING IS WRITTEN. One click here fans out across a dozen
 * categories and there is no undo. `planRequirementSharing` decides every item up front and
 * this dialog renders that decision — what will be linked, what will be copied, what is
 * already there, and what a FINAL lock refuses — so the confirmation is a real one. Nothing
 * is re-derived at write time; the service applies exactly the plan on screen.
 *
 * LINK vs COPY is the one genuine choice, and the copy explains the consequence rather than
 * the mechanism: link keeps them the same forever, copy lets them drift.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Link2, Loader2, Lock, X,
} from 'lucide-react';
import {
  applyRequirementSharing, planRequirementSharing, summarizeSharingPlan, SHARING_SKIP_LABELS,
} from '../../services';
import type { ApplySharingResult, SharingMode } from '../../services';
import type { CategoryL3, ComplianceRequirement } from '../../types';
import { groupByL1L2 } from '../../utils/category-tree.utils';

interface Props {
  /** The requirements to fan out — one row, or a whole category's own set. */
  requirementIds: string[];
  /** The full library. The planner needs all of it to know what a target already has. */
  requirements: ComplianceRequirement[];
  categories: CategoryL3[];
  /** The category the operator is fanning OUT from, excluded from the picker. */
  sourceCategoryId: string;
  /** Heading context, e.g. a requirement title or "12 requirements". */
  subjectLabel: string;
  onClose: () => void;
  onApplied: (result: ApplySharingResult) => void;
}

const ApplyRequirementsModal: React.FC<Props> = ({
  requirementIds, requirements, categories, sourceCategoryId, subjectLabel, onClose, onApplied,
}) => {
  const [mode, setMode] = useState<SharingMode>('link');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The source is not a target of itself; inactive leaves are not offered at all, since
  // putting requirements on a retired category is never the intent.
  const selectable = useMemo(
    () => categories.filter(c => c.id !== sourceCategoryId && c.active !== false),
    [categories, sourceCategoryId],
  );
  const groups = useMemo(() => groupByL1L2(selectable), [selectable]);

  const plan = useMemo(
    () => planRequirementSharing({
      requirements,
      categories,
      requirementIds,
      targetCategoryIds: [...selected],
      mode,
    }),
    [requirements, categories, requirementIds, selected, mode],
  );
  const summary = useMemo(() => summarizeSharingPlan(plan), [plan]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /** Whole-group toggle: "all Hoods" in one click, which is the reason this dialog exists. */
  const toggleGroup = (ids: string[]) => setSelected(prev => {
    const next = new Set(prev);
    const allOn = ids.every(id => next.has(id));
    for (const id of ids) { if (allOn) next.delete(id); else next.add(id); }
    return next;
  });

  const toggleCollapse = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const submit = async () => {
    if (plan.isNoop || saving) return;
    setSaving(true);
    setError(null);
    try {
      onApplied(await applyRequirementSharing(plan));
    } catch (err: any) {
      setError(err?.message ?? 'The change was refused.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-4 flex-shrink-0">
          <div>
            <h3 className="font-bold text-lg text-gray-800">Apply to other categories</h3>
            <p className="text-xs text-muted mt-0.5">{subjectLabel}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full" title="Cancel">
            <X size={18} />
          </button>
        </div>

        {/* The choice, explained by its consequence rather than its mechanism. */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div className="grid sm:grid-cols-2 gap-3">
            {([
              {
                value: 'link' as const,
                icon: <Link2 size={15} />,
                title: 'Link them',
                blurb: 'One requirement, shared. Edit it once later and every category changes together — this is what keeps a family identical.',
              },
              {
                value: 'copy' as const,
                icon: <Copy size={15} />,
                title: 'Copy them',
                blurb: 'A separate requirement per category, starting identical. Each can be edited on its own afterwards and they will drift apart.',
              },
            ]).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={`text-left p-3 rounded-lg border-2 transition-colors ${
                  mode === opt.value
                    ? 'border-indigo-600 bg-indigo-50/60'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <span className={`flex items-center gap-2 font-bold text-sm ${mode === opt.value ? 'text-indigo-700' : 'text-gray-700'}`}>
                  {opt.icon} {opt.title}
                  {mode === opt.value && <Check size={14} className="ml-auto" />}
                </span>
                <span className="block text-[11px] text-muted mt-1 leading-relaxed">{opt.blurb}</span>
              </button>
            ))}
          </div>

          {mode === 'link' && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-3 leading-relaxed flex gap-2">
              <Lock size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                A linked requirement is frozen if <strong>any</strong> category it reaches is
                marked FINAL — not only its own. Locking one Hood would freeze the shared
                requirements for all of them until an administrator releases it. Choose
                <strong> Copy</strong> if the categories should be able to move independently.
              </span>
            </p>
          )}
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Target categories</span>
            <span className="text-xs text-muted">{selected.size} selected</span>
          </div>

          <div className="space-y-2">
            {groups.map(group => {
              const ids = group.categories.map(c => c.id);
              const onCount = ids.filter(id => selected.has(id)).length;
              const isCollapsed = collapsed.has(group.key);
              return (
                <div key={group.key} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-light px-3 py-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(group.key)}
                      className="text-gray-400 hover:text-gray-700"
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <span className="text-xs font-bold text-gray-700 flex-1">{group.label}</span>
                    <span className="text-[10px] text-muted">{onCount}/{ids.length}</span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(ids)}
                      className="text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded"
                    >
                      {onCount === ids.length ? 'Clear group' : 'Select all'}
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div className="divide-y divide-slate-100">
                      {group.categories.map(cat => (
                        <label
                          key={cat.id}
                          className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-light cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(cat.id)}
                            onChange={() => toggle(cat.id)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="flex-1 text-gray-700">{cat.name}</span>
                          {/* A FINAL target is offered but will be reported as blocked — hiding
                              it would leave the operator wondering where the category went. */}
                          {cat.isFinalized && (
                            <span
                              title="Marked FINAL — its requirements cannot change until an administrator releases it"
                              className="inline-flex items-center gap-1 text-[10px] font-bold bg-gray-900 text-white px-1.5 py-0.5 rounded"
                            >
                              <Lock size={9} /> FINAL
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* What will actually happen. */}
          {selected.size > 0 && (
            <div className="mt-5 border border-gray-200 rounded-lg p-4 bg-light/60">
              <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">What this will do</p>

              {plan.isNoop ? (
                <p className="text-xs text-muted">
                  Nothing to change — every selected category already has these requirements, or
                  is blocked below.
                </p>
              ) : (
                <ul className="text-xs text-gray-700 space-y-1">
                  {mode === 'link' && summary.linkedRequirements > 0 && (
                    <li className="flex items-center gap-2">
                      <Link2 size={13} className="text-indigo-600" />
                      Share {summary.linkedRequirements} requirement{summary.linkedRequirements !== 1 ? 's' : ''} with{' '}
                      {summary.linkedCategories} more categor{summary.linkedCategories !== 1 ? 'ies' : 'y'}
                    </li>
                  )}
                  {mode === 'copy' && summary.copies > 0 && (
                    <li className="flex items-center gap-2">
                      <Copy size={13} className="text-indigo-600" />
                      Create {summary.copies} new independent requirement{summary.copies !== 1 ? 's' : ''}
                    </li>
                  )}
                </ul>
              )}

              {plan.blocks.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-xs font-bold text-rose-700 flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={13} /> Blocked by a FINAL lock
                  </p>
                  <ul className="text-[11px] text-gray-600 space-y-0.5">
                    {plan.blocks.map(b => (
                      <li key={`${b.side}-${b.categoryName}`}>
                        <strong>{b.categoryName}</strong> is FINAL —{' '}
                        {b.side === 'target'
                          ? `cannot receive ${b.titles.length} requirement${b.titles.length !== 1 ? 's' : ''}`
                          : `${b.titles.length} requirement${b.titles.length !== 1 ? 's' : ''} already reach${b.titles.length === 1 ? 'es' : ''} it and cannot be re-shared`}
                        . An administrator must release it first.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.skips.length > 0 && (
                <details className="mt-3 pt-3 border-t border-gray-200">
                  <summary className="text-xs text-muted cursor-pointer hover:text-gray-700">
                    {plan.skips.length} already in place — no change
                  </summary>
                  <ul className="text-[11px] text-gray-500 space-y-0.5 mt-1.5">
                    {plan.skips.map((s, i) => (
                      <li key={i}>
                        <strong>{s.targetCategoryName}</strong> · {s.title} — {SHARING_SKIP_LABELS[s.reason]}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5 leading-relaxed mt-4">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-white flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md font-medium">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={plan.isNoop || saving}
            className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-sm font-medium shadow flex items-center gap-2"
          >
            {saving
              ? <><Loader2 size={14} className="animate-spin" /> Applying…</>
              : mode === 'link'
                ? <><Link2 size={14} /> Link to {summary.linkedCategories || selected.size} categor{(summary.linkedCategories || selected.size) !== 1 ? 'ies' : 'y'}</>
                : <><Copy size={14} /> Create {summary.copies} cop{summary.copies !== 1 ? 'ies' : 'y'}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ApplyRequirementsModal;
