/**
 * Editing a regulation's clauses and obligations (migration 141).
 *
 * Kept OUT of the regulation editor modal, which is already a long form. This one opens from
 * the detail page against a saved regulation, and every change is written immediately — there
 * is no draft, because a list of thirty obligations with a Save button at the bottom is a list
 * people lose work in.
 *
 * WHAT THE CLAUSE FIELD ON AN OBLIGATION DOES. It is a free-text citation, not a picker: an
 * operator reading a standard types "7.12.5" as they go, and stopping to create a clause row
 * first is friction that produces unclassified obligations instead. Typing a number that does
 * not exist yet CREATES the clause. That makes the clause list a consequence of the
 * obligations, which is the right way round — a clause with nothing under it is not useful.
 */

import React, { useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';

import {
  CARRIERS,
  createClause,
  createObligation,
  deleteObligation,
  updateObligation,
  updateClause,
} from '../../services';
import type {
  ObligationCarrier,
  Regulation,
  RegulationClause,
  RegulationObligation,
} from '../../types';

const LABEL = 'text-[10px] font-semibold text-gray-400 uppercase tracking-wide';

interface Props {
  regulation: Regulation;
  /** Re-read the regulation after any write. */
  onChanged: () => Promise<void> | void;
  onClose: () => void;
  actor?: string;
}

/** The editable shape of one obligation row, with its clause as text. */
interface Draft {
  id?: string;
  clauseNumber: string;
  text: string;
  verbatim: string;
  carriers: ObligationCarrier[];
  optionalCarriers: ObligationCarrier[];
}

const toDraft = (o: RegulationObligation, clauses: RegulationClause[]): Draft => {
  const clause = clauses.find(c => c.id === o.clauseId);
  return {
    id: o.id,
    clauseNumber: clause ? [clause.number, clause.qualifier].filter(Boolean).join(' ') : '',
    text: o.text,
    verbatim: o.verbatim ?? '',
    carriers: o.carriers,
    optionalCarriers: o.optionalCarriers,
  };
};

const ObligationsEditor: React.FC<Props> = ({ regulation, onChanged, onClose, actor }) => {
  const clauses = useMemo(() => regulation.clauses ?? [], [regulation.clauses]);
  const obligations = useMemo(() => regulation.obligations ?? [], [regulation.obligations]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /**
   * Resolve a typed citation to a clause id, creating the clause when it is new. Matching is
   * case- and whitespace-insensitive, mirroring the unique index, so "7.12" and " 7.12 " never
   * produce two rows.
   */
  const resolveClause = async (citation: string): Promise<string | null> => {
    const wanted = citation.trim();
    if (!wanted) return null;
    const existing = clauses.find(c =>
      [c.number, c.qualifier].filter(Boolean).join(' ').trim().toLowerCase() === wanted.toLowerCase()
      || c.number.trim().toLowerCase() === wanted.toLowerCase());
    if (existing) return existing.id;
    // A citation may carry a qualifier ("7.12 Addition"); split on the first space after the
    // number so the clause row stores them separately, as the parser does.
    const m = wanted.match(/^(\S+)\s+(.+)$/);
    const created = await createClause(
      regulation.id,
      m && /^[\d.]+$/.test(m[1]) ? { number: m[1], qualifier: m[2] } : { number: wanted },
      actor,
    );
    return created.id;
  };

  const handleSave = async () => {
    if (!draft || !draft.text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const clauseId = await resolveClause(draft.clauseNumber);
      const payload = {
        clauseId,
        text: draft.text.trim(),
        verbatim: draft.verbatim.trim() || null,
        carriers: draft.carriers,
        optionalCarriers: draft.optionalCarriers,
      };
      if (draft.id) await updateObligation(draft.id, payload);
      else await createObligation(regulation.id, { ...payload, sortOrder: obligations.length }, actor);
      await onChanged();
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (o: RegulationObligation) => {
    if (!window.confirm(`Delete this obligation?\n\n"${o.text.slice(0, 120)}"`)) return;
    setDeletingId(o.id);
    setError('');
    try {
      await deleteObligation(o.id);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  };

  /** Record when a clause last changed — the reason clauses are rows at all. */
  const handleClauseChange = async (clause: RegulationClause, amendedIn: string, on: string) => {
    setBusy(true);
    setError('');
    try {
      await updateClause(clause.id, { amendedIn: amendedIn || null, lastChangedAt: on || null });
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleCarrier = (list: 'carriers' | 'optionalCarriers', c: ObligationCarrier) => {
    if (!draft) return;
    const current = draft[list];
    const next = current.includes(c) ? current.filter(x => x !== c) : [...current, c];
    // A carrier is never both required and optional; setting one clears the other.
    const other = list === 'carriers' ? 'optionalCarriers' : 'carriers';
    setDraft({ ...draft, [list]: next, [other]: draft[other].filter(x => x !== c) } as Draft);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-800">Chapters &amp; obligations</h3>
            <p className="text-[11px] text-gray-400 font-mono truncate">{regulation.referenceCode}</p>
          </div>
          <button onClick={() => !busy && onClose()} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</div>
          )}

          {/* Clause change tracking — the point of the clause level. */}
          {clauses.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-light text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                When each chapter last changed
              </div>
              <div className="divide-y divide-gray-100">
                {clauses.map(c => (
                  <div key={c.id} className="px-3 py-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-primary w-28 shrink-0">
                      {[c.number, c.qualifier].filter(Boolean).join(' ')}
                    </span>
                    <input
                      defaultValue={c.amendedIn ?? ''}
                      onBlur={e => e.target.value !== (c.amendedIn ?? '')
                        && handleClauseChange(c, e.target.value, c.lastChangedAt ?? '')}
                      placeholder="A11:2020"
                      className="text-xs border rounded px-2 py-1 w-32"
                      title="The amendment that last changed this clause"
                    />
                    <input
                      type="date"
                      defaultValue={c.lastChangedAt ?? ''}
                      onBlur={e => e.target.value !== (c.lastChangedAt ?? '')
                        && handleClauseChange(c, c.amendedIn ?? '', e.target.value)}
                      className="text-xs border rounded px-2 py-1"
                    />
                    <span className="text-[10px] text-gray-400 ml-auto">
                      {obligations.filter(o => o.clauseId === c.id).length} obligation(s)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The obligations themselves. */}
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-light flex items-center justify-between">
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                {obligations.length} obligation{obligations.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={() => setDraft({
                  clauseNumber: '', text: '', verbatim: '', carriers: ['IM'], optionalCarriers: [],
                })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                <Plus size={13} /> Add
              </button>
            </div>
            <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
              {obligations.map(o => {
                const clause = clauses.find(c => c.id === o.clauseId);
                return (
                  <li key={o.id} className="px-3 py-2 flex items-start gap-2 hover:bg-light/60">
                    <span className="font-mono text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1 py-px shrink-0 mt-0.5 w-20 text-center">
                      {clause ? clause.number : '—'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-800">{o.text}</p>
                      {o.verbatim && (
                        <p className="text-[10px] text-indigo-900 italic mt-0.5 line-clamp-2">{o.verbatim}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-1">
                        {o.carriers.map(c => (
                          <span key={c} className="text-[9px] font-bold px-1 py-px rounded bg-gray-100 text-gray-600">{c}</span>
                        ))}
                        {o.optionalCarriers.map(c => (
                          <span key={c} className="text-[9px] px-1 py-px rounded bg-gray-50 text-gray-400 border border-dashed border-gray-300">{c}?</span>
                        ))}
                        {o.carriers.length === 0 && (
                          <span className="text-[9px] font-bold px-1 py-px rounded bg-amber-50 text-amber-700 border border-amber-200">
                            unclassified
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setDraft(toDraft(o, clauses))}
                      className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 shrink-0"
                    >Edit</button>
                    <button
                      onClick={() => handleDelete(o)}
                      disabled={deletingId === o.id}
                      className="text-gray-300 hover:text-rose-600 shrink-0 disabled:opacity-40"
                    >
                      {deletingId === o.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </li>
                );
              })}
              {obligations.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-gray-400">
                  No obligations yet.
                </li>
              )}
            </ul>
          </div>

          {/* The row editor. */}
          {draft && (
            <div className="border border-indigo-200 bg-indigo-50/40 rounded-lg p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className={LABEL}>Clause</label>
                  <input
                    value={draft.clauseNumber}
                    onChange={e => setDraft({ ...draft, clauseNumber: e.target.value })}
                    placeholder="7.12.5"
                    list="clause-suggestions"
                    className="w-full text-sm border rounded px-2 py-1.5 mt-1 font-mono"
                  />
                  <datalist id="clause-suggestions">
                    {clauses.map(c => (
                      <option key={c.id} value={[c.number, c.qualifier].filter(Boolean).join(' ')} />
                    ))}
                  </datalist>
                  <p className="text-[10px] text-gray-400 mt-1">
                    A number that does not exist yet is created.
                  </p>
                </div>
                <div className="sm:col-span-3">
                  <label className={LABEL}>Obligation *</label>
                  <textarea
                    value={draft.text}
                    onChange={e => setDraft({ ...draft, text: e.target.value })}
                    rows={2}
                    placeholder="The instructions shall state that…"
                    className="w-full text-sm border rounded px-2 py-1.5 mt-1"
                  />
                </div>
              </div>

              <div>
                <label className={LABEL}>Mandated wording (optional)</label>
                <textarea
                  value={draft.verbatim}
                  onChange={e => setDraft({ ...draft, verbatim: e.target.value })}
                  rows={2}
                  placeholder={'"If the supply cord is damaged, it must be replaced by…"'}
                  className="w-full text-sm border rounded px-2 py-1.5 mt-1"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Only text that must appear word-for-word. Leave empty when the standard
                  states a duty rather than a sentence — this is the text a translation must
                  never alter.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Must appear on</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {CARRIERS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleCarrier('carriers', c)}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${
                          draft.carriers.includes(c)
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-gray-500 border-gray-300 hover:border-indigo-300'
                        }`}
                      >{c}</button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    Leave all unticked if you do not know — an unclassified obligation is shown
                    on every checklist rather than hidden from all of them.
                  </p>
                </div>
                <div>
                  <label className={LABEL}>May also appear on</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {CARRIERS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleCarrier('optionalCarriers', c)}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-full border border-dashed ${
                          draft.optionalCarriers.includes(c)
                            ? 'bg-gray-200 text-gray-700 border-gray-400'
                            : 'bg-white text-gray-400 border-gray-300 hover:border-gray-400'
                        }`}
                      >{c}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDraft(null)}
                  disabled={busy}
                  className="text-xs px-3 py-1.5 border rounded-lg hover:bg-white disabled:opacity-50"
                >Cancel</button>
                <button
                  onClick={handleSave}
                  disabled={busy || !draft.text.trim()}
                  className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  {busy ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : <><Save size={13} /> Save</>}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end px-5 py-3 border-t">
          <button onClick={onClose} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50">Done</button>
        </div>
      </div>
    </div>
  );
};

export default ObligationsEditor;
