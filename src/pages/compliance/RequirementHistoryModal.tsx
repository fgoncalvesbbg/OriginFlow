/**
 * The TCF requirement history for one category (migration 172).
 *
 * This is the answer to "who changed this, and what did it say before" — the question a
 * compliance officer gets asked months after the change, by someone holding a test report
 * that no longer matches the requirement. So the panel shows the RECORD, not a summary of it:
 * every entry expands to a field-by-field before/after, and a release shows its reason
 * verbatim rather than paraphrased.
 *
 * Read-only by construction. The table has no write grant for any client role, so there is
 * nothing here to edit, delete or tidy — and nothing to explain to the user about why.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, History, Link2, Loader2, X } from 'lucide-react';
import { getRequirementHistory } from '../../services';
import type { CategoryL3, ComplianceRequirementHistoryEntry, Regulation } from '../../types';
import {
  HISTORY_ACTION_META,
  historyDiffRows,
  summarizeHistoryEntry,
} from './requirement-history';

interface Props {
  /** null = the global requirement set. */
  categoryId: string | null;
  categoryName: string;
  /** Used to turn a stored regulation/clause uuid back into its reference code. */
  regulations: Regulation[];
  /**
   * Used to name the categories in a link/unlink diff (migration 173). Without it the most
   * interesting row in the history — "Shared with" gaining eleven Hoods — renders as eleven
   * uuids.
   */
  categories: CategoryL3[];
  onClose: () => void;
}

const fmtWhen = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};

const RequirementHistoryModal: React.FC<Props> = ({ categoryId, categoryName, regulations, categories, onClose }) => {
  const [entries, setEntries] = useState<ComplianceRequirementHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRequirementHistory(categoryId)
      .then(rows => { if (!cancelled) setEntries(rows); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categoryId]);

  // Escape closes it — this is a reference panel somebody opens mid-task and wants out of.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * uuid → name, covering regulations, their clauses and categories. Built once: a category
   * with a long history would otherwise re-scan every regulation's clause list, and every
   * category, for every row it renders.
   */
  const resolveId = useMemo(() => {
    const byId = new Map<string, string>();
    for (const reg of regulations) {
      byId.set(reg.id, reg.referenceCode ?? reg.title ?? reg.id);
      for (const clause of reg.clauses ?? []) {
        byId.set(clause.id, `${reg.referenceCode ?? ''} §${clause.number}`.trim());
      }
    }
    for (const cat of categories) byId.set(cat.id, cat.name);
    return (id: string) => byId.get(id);
  }, [regulations, categories]);

  const toggle = useCallback((id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[88vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-4 flex-shrink-0">
          <div>
            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              <History size={18} className="text-indigo-600" /> Requirement History
            </h3>
            <p className="text-xs text-muted mt-0.5">{categoryName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Loading history…
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className="px-6 py-16 text-center text-sm text-gray-400">
              Nothing recorded yet. Every change from here on — added, edited or removed
              requirements, and every lock and release — appears in this list.
            </div>
          )}

          {!loading && entries.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {entries.map(entry => {
                const meta = HISTORY_ACTION_META[entry.action];
                const rows = historyDiffRows(entry, resolveId);
                const isOpen = expanded.has(entry.id);
                const canExpand = rows.length > 0;
                return (
                  <li key={entry.id} className="px-5 py-3.5 hover:bg-light/60 transition-colors">
                    <div
                      className={`flex items-start gap-3 ${canExpand ? 'cursor-pointer' : ''}`}
                      onClick={() => canExpand && toggle(entry.id)}
                    >
                      <div className="pt-0.5 w-4 flex-shrink-0 text-gray-300">
                        {canExpand && (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${meta.className}`}>
                            {meta.label}
                          </span>
                          <span className="text-sm font-medium text-primary truncate">
                            {summarizeHistoryEntry(entry)}
                          </span>
                          {entry.section && entry.action !== 'lock' && entry.action !== 'release' && (
                            <span className="text-[10px] text-muted bg-light border border-gray-200 px-1.5 py-0.5 rounded">
                              {entry.section}
                            </span>
                          )}
                          {/* This change reached the category through a SHARED requirement
                              owned elsewhere (migration 173). Worth saying: otherwise an
                              entry appears in the history of a category that never edited
                              anything, and reads as a mystery. */}
                          {categoryId !== null && entry.categoryId !== null && entry.categoryId !== categoryId && (
                            <span
                              title="A requirement shared with this category, owned by another one"
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded"
                            >
                              <Link2 size={9} /> shared from {resolveId(entry.categoryId) ?? 'another category'}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted mt-1">
                          {fmtWhen(entry.changedAt)} · {entry.changedBy ?? 'unknown user'}
                          {entry.action === 'update' && entry.changedFields.length > 0 && (
                            <> · {entry.changedFields.length} field{entry.changedFields.length !== 1 ? 's' : ''} changed</>
                          )}
                        </div>

                        {/* A release reason is the whole point of the release record, so it is
                            never behind a disclosure. A lock note is shown the same way when
                            somebody bothered to write one. */}
                        {entry.reason && (
                          <blockquote className={`mt-2 text-xs leading-relaxed border-l-2 pl-3 py-1 ${
                            entry.action === 'release'
                              ? 'border-amber-400 bg-amber-50/60 text-amber-900'
                              : 'border-gray-300 bg-light text-gray-600'
                          }`}>
                            {entry.reason}
                          </blockquote>
                        )}
                      </div>
                    </div>

                    {isOpen && canExpand && (
                      <div className="mt-3 ml-7 border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-light text-[10px] uppercase tracking-wide text-muted">
                            <tr>
                              <th className="text-left font-semibold px-3 py-1.5 w-1/4">Field</th>
                              <th className="text-left font-semibold px-3 py-1.5">Was</th>
                              <th className="text-left font-semibold px-3 py-1.5">Now</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rows.map(r => (
                              <tr key={r.column} className="align-top">
                                <td className="px-3 py-1.5 font-medium text-gray-700">{r.label}</td>
                                <td className="px-3 py-1.5 text-gray-500 break-words">
                                  {entry.action === 'create' ? '—' : r.before}
                                </td>
                                <td className="px-3 py-1.5 text-primary break-words">
                                  {entry.action === 'delete' ? '—' : r.after}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 bg-white flex items-center justify-between flex-shrink-0">
          <p className="text-[11px] text-gray-400">
            Written by the database on every change — it cannot be edited or removed.
          </p>
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-md font-medium">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default RequirementHistoryModal;
