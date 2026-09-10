/**
 * Add requirements to a section by POOLING them from the existing library.
 *
 * The inward half of the sharing mechanism. `ApplyRequirementsModal` pushes this category's
 * requirements out to other categories; this pulls other categories' requirements in. Both
 * call `planRequirementSharing`, so link-vs-copy, the "already applies" skips and the
 * FINAL-lock blocks behave identically in both directions rather than being re-implemented
 * with slightly different rules.
 *
 * WHY THIS EXISTS AT ALL: without it the only way to give a category a requirement that
 * already exists elsewhere is to re-type it, which is how a library ends up with "RoHS",
 * "RoHs - Test report of finished Product" and "RoHS Test Report" all meaning one obligation.
 * Every candidate here shows where it comes from, so picking the one that already exists is
 * easier than typing a new one.
 *
 * THE ONE ASYMMETRY WORTH KNOWING, and the dialog says it out loud: a LINK is a single row
 * with a single `section`, so it appears under ITS OWN section heading everywhere. Only a COPY
 * can be filed into the section you clicked. When that matters the preview names the heading
 * each linked requirement will actually appear under.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Copy, FolderInput, Globe, Link2, Loader2, Lock, Search, X,
} from 'lucide-react';
import {
  applyRequirementSharing, planRequirementSharing, summarizeSharingPlan, SHARING_SKIP_LABELS,
  sectionOf,
} from '../../services';
import type { ApplySharingResult, SharingMode } from '../../services';
import { requirementAppliesToCategory, requirementShareCount } from '../../utils';
import type { CategoryL3, ComplianceRequirement } from '../../types';

interface Props {
  /** The whole library — the pool to choose from, and what the planner needs to skip duplicates. */
  requirements: ComplianceRequirement[];
  categories: CategoryL3[];
  /** The category receiving them. */
  targetCategoryId: string;
  targetCategoryName: string;
  /** The section heading the operator clicked "add existing" on. */
  targetSection: string;
  onClose: () => void;
  onAdded: (result: ApplySharingResult) => void;
}

const AddExistingRequirementsModal: React.FC<Props> = ({
  requirements, categories, targetCategoryId, targetCategoryName, targetSection, onClose, onAdded,
}) => {
  const [mode, setMode] = useState<SharingMode>('link');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  /**
   * The pool: everything that does NOT already reach this category.
   *
   * Excluded rather than shown-and-skipped, unlike the outward dialog. There the operator
   * picks CATEGORIES and needs to see which of them already have the requirement; here they
   * are picking from a library of hundreds and a list padded with things already in place
   * would just be harder to search.
   */
  const pool = useMemo(
    () => requirements.filter(r => !requirementAppliesToCategory(r, targetCategoryId)),
    [requirements, targetCategoryId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter(r =>
      [r.title, r.description, r.section, categoryById.get(r.categoryId ?? '')?.name]
        .some(v => (v ?? '').toLowerCase().includes(q)));
  }, [pool, search, categoryById]);

  /** Grouped by where each one comes from, so "the Hoods one" is findable. */
  const groups = useMemo(() => {
    const byOrigin = new Map<string, ComplianceRequirement[]>();
    for (const r of filtered) {
      const key = r.categoryId === null
        ? 'Global Requirements'
        : categoryById.get(r.categoryId)?.name ?? 'Unknown category';
      const bucket = byOrigin.get(key);
      if (bucket) bucket.push(r); else byOrigin.set(key, [r]);
    }
    return [...byOrigin.entries()]
      // Global first — it is the set most likely to hold the requirement somebody wants.
      .sort((a, b) => (a[0] === 'Global Requirements' ? -1 : b[0] === 'Global Requirements' ? 1 : a[0].localeCompare(b[0])));
  }, [filtered, categoryById]);

  const plan = useMemo(
    () => planRequirementSharing({
      requirements,
      categories,
      requirementIds: [...picked],
      targetCategoryIds: [targetCategoryId],
      mode,
      targetSection,
    }),
    [requirements, categories, picked, targetCategoryId, mode, targetSection],
  );
  const summary = useMemo(() => summarizeSharingPlan(plan), [plan]);

  /** Linked requirements whose own section is not the one being added to. */
  const sectionMismatches = useMemo(
    () => plan.links.filter(l => l.landsInSection !== targetSection),
    [plan.links, targetSection],
  );

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    if (plan.isNoop || saving) return;
    setSaving(true);
    setError(null);
    try {
      onAdded(await applyRequirementSharing(plan));
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
            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              <FolderInput size={18} className="text-indigo-600" /> Add existing requirements
            </h3>
            <p className="text-xs text-muted mt-0.5">
              into <strong>{targetSection}</strong> · {targetCategoryName}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full" title="Cancel">
            <X size={18} />
          </button>
        </div>

        {/* Link or copy — the same choice, and the same wording, as the outward dialog. */}
        <div className="px-6 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
          <div className="grid sm:grid-cols-2 gap-3">
            {([
              {
                value: 'link' as const,
                icon: <Link2 size={15} />,
                title: 'Link them',
                blurb: 'Share the existing requirement. Edited once later, it changes here and everywhere else it is used.',
              },
              {
                value: 'copy' as const,
                icon: <Copy size={15} />,
                title: 'Copy them',
                blurb: 'Take an independent duplicate into this category. Free to edit here without affecting the original.',
              },
            ]).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                className={`text-left p-3 rounded-lg border-2 transition-colors ${
                  mode === opt.value ? 'border-indigo-600 bg-indigo-50/60' : 'border-gray-200 hover:border-gray-300 bg-white'
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
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search the library by title, description, section or category…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {pool.length === 0 && (
            <p className="text-center py-10 text-sm text-gray-400">
              Every requirement in the library already applies to this category.
            </p>
          )}

          {pool.length > 0 && filtered.length === 0 && (
            <p className="text-center py-10 text-sm text-gray-400">Nothing matches "{search}".</p>
          )}

          <div className="space-y-3">
            {groups.map(([origin, items]) => (
              <div key={origin} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-light px-3 py-1.5 flex items-center gap-1.5">
                  {origin === 'Global Requirements' && <Globe size={11} className="text-amber-600" />}
                  <span className="text-xs font-bold text-gray-700">{origin}</span>
                  <span className="text-[10px] text-muted">({items.length})</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map(r => {
                    const shares = requirementShareCount(r);
                    const own = sectionOf(r);
                    return (
                      <label key={r.id} className="flex items-start gap-2.5 px-3 py-2 hover:bg-light cursor-pointer">
                        <input
                          type="checkbox"
                          checked={picked.has(r.id)}
                          onChange={() => toggle(r.id)}
                          className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="flex-1 min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium text-primary">{r.title}</span>
                            {r.isMandatory && (
                              <span className="text-[9px] font-bold bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded uppercase">Mandatory</span>
                            )}
                            {shares > 1 && (
                              <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded uppercase">
                                Shared · {shares}
                              </span>
                            )}
                            {own !== targetSection && (
                              <span className="text-[10px] text-muted" title="Its own section">
                                in {own}
                              </span>
                            )}
                          </span>
                          {r.description && (
                            <span className="block text-[11px] text-muted mt-0.5 line-clamp-2">{r.description}</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* What will happen. */}
          {picked.size > 0 && (
            <div className="mt-5 border border-gray-200 rounded-lg p-4 bg-light/60">
              <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">What this will do</p>

              {plan.isNoop ? (
                <p className="text-xs text-muted">Nothing to change — see the notes below.</p>
              ) : (
                <ul className="text-xs text-gray-700 space-y-1">
                  {mode === 'link' && summary.linkedRequirements > 0 && (
                    <li className="flex items-center gap-2">
                      <Link2 size={13} className="text-indigo-600" />
                      Share {summary.linkedRequirements} existing requirement{summary.linkedRequirements !== 1 ? 's' : ''} with {targetCategoryName}
                    </li>
                  )}
                  {mode === 'copy' && summary.copies > 0 && (
                    <li className="flex items-center gap-2">
                      <Copy size={13} className="text-indigo-600" />
                      Create {summary.copies} independent cop{summary.copies !== 1 ? 'ies' : 'y'} in <strong>{targetSection}</strong>
                    </li>
                  )}
                </ul>
              )}

              {/* The link/section asymmetry, named per requirement. */}
              {sectionMismatches.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={13} /> Not all of these will appear under "{targetSection}"
                  </p>
                  <ul className="text-[11px] text-gray-600 space-y-0.5">
                    {sectionMismatches.map(l => (
                      <li key={l.requirementId}>
                        <strong>{l.title}</strong> appears under "{l.landsInSection}" — a shared
                        requirement has one section everywhere. Use <strong>Copy</strong> to file
                        it under "{targetSection}" instead.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.blocks.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-xs font-bold text-rose-700 flex items-center gap-1.5 mb-1">
                    <Lock size={13} /> Blocked by a FINAL lock
                  </p>
                  <ul className="text-[11px] text-gray-600 space-y-0.5">
                    {plan.blocks.map(b => (
                      <li key={`${b.side}-${b.categoryName}`}>
                        <strong>{b.categoryName}</strong> is FINAL —{' '}
                        {b.side === 'target'
                          ? 'it cannot receive requirements'
                          : `${b.titles.length} of these already reach it and cannot be re-shared`}
                        . An administrator must release it first.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.skips.length > 0 && (
                <details className="mt-3 pt-3 border-t border-gray-200">
                  <summary className="text-xs text-muted cursor-pointer hover:text-gray-700">
                    {plan.skips.length} will not be added
                  </summary>
                  <ul className="text-[11px] text-gray-500 space-y-0.5 mt-1.5">
                    {plan.skips.map((s, i) => (
                      <li key={i}>{s.title} — {SHARING_SKIP_LABELS[s.reason]}</li>
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

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-white flex-shrink-0">
          <span className="text-xs text-muted">{picked.size} selected</span>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md font-medium">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={plan.isNoop || saving}
              className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-sm font-medium shadow flex items-center gap-2"
            >
              {saving
                ? <><Loader2 size={14} className="animate-spin" /> Adding…</>
                : mode === 'link'
                  ? <><Link2 size={14} /> Link {summary.linkedRequirements || ''} requirement{summary.linkedRequirements !== 1 ? 's' : ''}</>
                  : <><Copy size={14} /> Copy {summary.copies || ''} requirement{summary.copies !== 1 ? 's' : ''}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddExistingRequirementsModal;
