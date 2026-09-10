/**
 * Which categories a global requirement does NOT apply to (migration 176).
 *
 * The per-category flow — "not applicable here", from inside a category — is how an exclusion
 * normally gets made, in the moment somebody notices. This is the other view of the same
 * data: every exception to one requirement, in one list, which is what you need to answer
 * "where is RoHS not being asked for?" without opening 135 categories.
 *
 * Grouped by "L1 › L2" with a whole-group toggle, because exclusions come in families for the
 * same reason requirements do — if one cast-iron category has no electronics, its siblings
 * very likely do not either.
 *
 * A FINAL category cannot be added to or removed from the list, so it is shown locked rather
 * than hidden: an operator wondering why a category is missing from an exception list deserves
 * the reason on screen.
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Loader2, Lock, X } from 'lucide-react';
import { setRequirementExclusions } from '../../services';
import type { CategoryL3, ComplianceRequirement } from '../../types';
import { groupByL1L2 } from '../../utils/category-tree.utils';

interface Props {
  requirement: ComplianceRequirement;
  categories: CategoryL3[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

const RequirementExclusionsModal: React.FC<Props> = ({
  requirement, categories, onClose, onSaved,
}) => {
  const initial = useMemo(
    () => new Set(requirement.excludedCategoryIds ?? []),
    [requirement.excludedCategoryIds],
  );
  const [excluded, setExcluded] = useState<Set<string>>(initial);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectable = useMemo(() => categories.filter(c => c.active !== false), [categories]);
  const groups = useMemo(() => groupByL1L2(selectable), [selectable]);

  /**
   * A FINAL category's set is frozen, so its exclusion state cannot change either way. Its
   * CURRENT state stays in whatever list it is in — the checkbox is disabled, not cleared.
   */
  const lockedIds = useMemo(
    () => new Set(selectable.filter(c => c.isFinalized).map(c => c.id)),
    [selectable],
  );

  const dirty = useMemo(() => {
    if (excluded.size !== initial.size) return true;
    for (const id of excluded) if (!initial.has(id)) return true;
    return false;
  }, [excluded, initial]);

  /** Changes the database will refuse — surfaced before the operator clicks Save. */
  const blockedChanges = useMemo(
    () => selectable.filter(c =>
      lockedIds.has(c.id) && excluded.has(c.id) !== initial.has(c.id)),
    [selectable, lockedIds, excluded, initial],
  );

  const toggle = (id: string) => {
    if (lockedIds.has(id)) return;
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroup = (ids: string[]) => {
    const usable = ids.filter(id => !lockedIds.has(id));
    if (usable.length === 0) return;
    setExcluded(prev => {
      const next = new Set(prev);
      const allOn = usable.every(id => next.has(id));
      for (const id of usable) { if (allOn) next.delete(id); else next.add(id); }
      return next;
    });
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setRequirementExclusions(requirement.id, [...excluded]);
      await onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'The change was refused.');
    } finally {
      setSaving(false);
    }
  };

  const appliesTo = selectable.length - excluded.size;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[75] p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-4 flex-shrink-0">
          <div>
            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              <Ban size={18} className="text-rose-600" /> Not applicable in…
            </h3>
            <p className="text-xs text-muted mt-0.5">{requirement.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full" title="Cancel">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pt-4 flex-shrink-0">
          <p className="text-[11px] text-gray-600 bg-light border border-gray-200 rounded-md px-3 py-2 leading-relaxed">
            Tick a category to stop asking for this requirement there. Use it for a fact about
            the <strong>category</strong> — "these products have no electronics". If it depends
            on the individual product, gate the requirement on a TCF question instead so the
            request wizard asks per product.
          </p>
          <p className="text-xs text-muted mt-2">
            Currently applies to <strong className="text-primary">{appliesTo}</strong> of{' '}
            {selectable.length} categories.
          </p>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          <div className="space-y-2">
            {groups.map(group => {
              const ids = group.categories.map(c => c.id);
              const onCount = ids.filter(id => excluded.has(id)).length;
              const isCollapsed = collapsed.has(group.key);
              return (
                <div key={group.key} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-light px-3 py-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCollapsed(prev => {
                        const next = new Set(prev);
                        if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                        return next;
                      })}
                      className="text-gray-400 hover:text-gray-700"
                    >
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <span className="text-xs font-bold text-gray-700 flex-1">{group.label}</span>
                    <span className="text-[10px] text-muted">{onCount}/{ids.length} excluded</span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(ids)}
                      className="text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded"
                    >
                      {onCount === ids.length ? 'Clear group' : 'Exclude all'}
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div className="divide-y divide-slate-100">
                      {group.categories.map(cat => {
                        const isLocked = lockedIds.has(cat.id);
                        return (
                          <label
                            key={cat.id}
                            className={`flex items-center gap-2.5 px-3 py-1.5 text-sm ${
                              isLocked ? 'opacity-60 cursor-not-allowed' : 'hover:bg-light cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={excluded.has(cat.id)}
                              disabled={isLocked}
                              onChange={() => toggle(cat.id)}
                              className="rounded border-gray-300 text-rose-600 focus:ring-rose-500 disabled:opacity-50"
                            />
                            <span className={`flex-1 ${excluded.has(cat.id) ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                              {cat.name}
                            </span>
                            {isLocked && (
                              <span
                                title="Marked FINAL — its requirement set is frozen, so this cannot change"
                                className="inline-flex items-center gap-1 text-[10px] font-bold bg-gray-900 text-white px-1.5 py-0.5 rounded"
                              >
                                <Lock size={9} /> FINAL
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {blockedChanges.length > 0 && (
            <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg p-3 flex gap-2">
              <AlertTriangle size={15} className="text-rose-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-rose-900 leading-relaxed">
                {blockedChanges.map(c => c.name).join(', ')}{' '}
                {blockedChanges.length === 1 ? 'is' : 'are'} marked FINAL, so the change there
                will be refused. Release the category first.
              </p>
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5 leading-relaxed mt-4">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-white flex-shrink-0">
          <span className="text-xs text-muted">
            {excluded.size} exclusion{excluded.size !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md font-medium">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-sm font-medium shadow flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? 'Saving…' : 'Save exclusions'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RequirementExclusionsModal;
