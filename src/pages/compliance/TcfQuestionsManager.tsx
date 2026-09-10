/**
 * The TCF questions library (migration 174) — define the questions that decide which
 * conditional requirements apply.
 *
 * Deliberately its own small screen rather than a section of the Admin attribute editor.
 * These are not product attributes: they are compliance questions, owned by the compliance
 * library, and the last time the two were conflated all 172 attributes were deleted and every
 * conditional requirement silently stopped applying.
 *
 * Every row shows how many requirements depend on it. That count is the difference between an
 * author who knows a re-wording will change three obligations and one who finds out later.
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Edit2, HelpCircle, ListChecks, Loader2, Plus, Trash2, X } from 'lucide-react';
import { deleteComplianceQuestion, saveComplianceQuestion, questionUsageCounts } from '../../services';
import type { ComplianceQuestion, ComplianceRequirement, TcfQuestionDataType } from '../../types';

interface Props {
  questions: ComplianceQuestion[];
  /** The whole library, for the "used by N requirements" count. */
  requirements: ComplianceRequirement[];
  onClose: () => void;
  /** Called after any write, so the caller reloads and every dependent view stays in step. */
  onChanged: () => void | Promise<void>;
}

const DATA_TYPES: { value: TcfQuestionDataType; label: string; hint: string }[] = [
  { value: 'boolean', label: 'Yes / No', hint: 'Does the product transmit radio?' },
  { value: 'enum',    label: 'Choose one', hint: 'Which plug type? — CEE 7/7, BS 1363, …' },
  { value: 'number',  label: 'Number', hint: 'Rated power, in watts' },
  { value: 'text',    label: 'Free text', hint: 'Use sparingly — an exact string match is brittle' },
];

const blank = (): ComplianceQuestion => ({
  id: '',
  label: '',
  helpText: '',
  dataType: 'boolean',
  options: [],
  unit: '',
  group: '',
  sortOrder: 0,
  needsReview: false,
});

const TcfQuestionsManager: React.FC<Props> = ({ questions, requirements, onClose, onChanged }) => {
  const [editing, setEditing] = useState<ComplianceQuestion | null>(null);
  const [optionsText, setOptionsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ComplianceQuestion | null>(null);

  const usage = useMemo(() => questionUsageCounts(requirements), [requirements]);

  const openEditor = (q: ComplianceQuestion | null) => {
    const next = q ? { ...q } : blank();
    setEditing(next);
    setOptionsText(next.options.join('\n'));
    setError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || saving) return;
    if (!editing.label.trim()) { setError('Give the question some words.'); return; }
    setSaving(true);
    setError(null);
    try {
      await saveComplianceQuestion({
        ...editing,
        id: editing.id || crypto.randomUUID(),
        options: optionsText.split('\n').map(o => o.trim()).filter(Boolean),
      });
      await onChanged();
      setEditing(null);
    } catch (err: any) {
      setError(err?.message ?? 'Could not save the question.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (q: ComplianceQuestion) => {
    setConfirmDelete(null);
    try {
      await deleteComplianceQuestion(q.id);
      await onChanged();
    } catch (err: any) {
      setError(err?.message ?? 'Could not delete the question.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[75] p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-4 flex-shrink-0">
          <div>
            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              <ListChecks size={18} className="text-indigo-600" /> TCF Questions
            </h3>
            <p className="text-xs text-muted mt-0.5">
              What the request wizard asks to decide which conditional requirements apply.
              Shared by every category.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {error && !editing && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5 mb-3">{error}</p>
          )}

          {/* ── The editor ─────────────────────────────────────────────────── */}
          {editing && (
            <form onSubmit={save} className="border-2 border-indigo-200 bg-indigo-50/40 rounded-xl p-4 mb-5 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  The question, as you would ask it <span className="text-rose-600">*</span>
                </label>
                <input
                  autoFocus
                  value={editing.label}
                  onChange={e => setEditing({ ...editing, label: e.target.value })}
                  placeholder="Does the product transmit or receive radio?"
                  className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Guidance (optional)</label>
                <input
                  value={editing.helpText ?? ''}
                  onChange={e => setEditing({ ...editing, helpText: e.target.value })}
                  placeholder="Wi-Fi, Bluetooth, RF remotes and NFC all count."
                  className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Answer type</label>
                <div className="grid grid-cols-2 gap-2">
                  {DATA_TYPES.map(dt => (
                    <button
                      key={dt.value}
                      type="button"
                      onClick={() => setEditing({ ...editing, dataType: dt.value })}
                      className={`text-left px-3 py-2 rounded-lg border-2 transition-colors ${
                        editing.dataType === dt.value
                          ? 'border-indigo-600 bg-white'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <span className="block text-xs font-bold text-gray-800">{dt.label}</span>
                      <span className="block text-[10px] text-muted mt-0.5">{dt.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {editing.dataType === 'enum' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Options, one per line</label>
                  <textarea
                    rows={4}
                    value={optionsText}
                    onChange={e => setOptionsText(e.target.value)}
                    placeholder={'CEE 7/7\nBS 1363\nNo plug (hard-wired)'}
                    className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-y font-mono"
                  />
                </div>
              )}

              {editing.dataType === 'number' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Unit (optional)</label>
                  <input
                    value={editing.unit ?? ''}
                    onChange={e => setEditing({ ...editing, unit: e.target.value })}
                    placeholder="W"
                    className="w-32 border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Group (optional)</label>
                  <input
                    value={editing.group ?? ''}
                    onChange={e => setEditing({ ...editing, group: e.target.value })}
                    placeholder="Electrical"
                    className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Order</label>
                  <input
                    type="number"
                    value={editing.sortOrder}
                    onChange={e => setEditing({ ...editing, sortOrder: Number(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-md p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {editing.needsReview && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 leading-relaxed">
                  This question was rescued from a broken condition and has never been
                  reviewed. Saving it counts as the review and clears the flag — so make sure
                  the wording above is what should actually be asked.
                </p>
              )}

              {error && (
                <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5">{error}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-md font-medium">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !editing.label.trim()}
                  className="px-4 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 rounded-md text-sm font-medium shadow flex items-center gap-1.5"
                >
                  {saving && <Loader2 size={13} className="animate-spin" />}
                  {editing.id ? 'Save question' : 'Add question'}
                </button>
              </div>
            </form>
          )}

          {!editing && (
            <button
              type="button"
              onClick={() => openEditor(null)}
              className="mb-4 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow"
            >
              <Plus size={15} /> New question
            </button>
          )}

          {/* ── The list ───────────────────────────────────────────────────── */}
          {questions.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">
              No questions yet. Add one, then gate a requirement on it from the requirement editor.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 border border-gray-200 rounded-lg overflow-hidden">
              {questions.map(q => {
                const used = usage[q.id] ?? 0;
                return (
                  <li key={q.id} className="px-4 py-3 hover:bg-light/60 group">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-primary">{q.label}</span>
                          <span className="text-[10px] font-bold text-gray-500 bg-light border border-gray-200 px-1.5 py-0.5 rounded uppercase">
                            {DATA_TYPES.find(d => d.value === q.dataType)?.label ?? q.dataType}
                          </span>
                          {q.group && (
                            <span className="text-[10px] text-muted">{q.group}</span>
                          )}
                          {q.needsReview && (
                            <span
                              title="Rescued from a broken condition — nobody has confirmed what it should ask"
                              className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded uppercase"
                            >
                              <AlertTriangle size={9} /> Needs review
                            </span>
                          )}
                        </div>
                        {q.helpText && (
                          <p className="text-[11px] text-muted mt-1 flex gap-1.5">
                            <HelpCircle size={11} className="flex-shrink-0 mt-0.5" /> {q.helpText}
                          </p>
                        )}
                        <p className="text-[11px] text-muted mt-1">
                          {used === 0
                            ? 'Not used by any requirement yet'
                            : `Decides ${used} requirement${used !== 1 ? 's' : ''}`}
                          {q.dataType === 'enum' && q.options.length > 0 && ` · ${q.options.join(', ')}`}
                          {q.dataType === 'number' && q.unit && ` · in ${q.unit}`}
                        </p>
                      </div>

                      <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditor(q)}
                          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full"
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(q)}
                          className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {confirmDelete?.id === q.id && (
                      <div className="mt-2 bg-rose-50 border border-rose-200 rounded-md p-3">
                        <p className="text-xs text-rose-900 leading-relaxed">
                          {used > 0 ? (
                            <>
                              <strong>{used} requirement{used !== 1 ? 's' : ''}</strong> gate on
                              this question. Deleting it does not break them — a requirement
                              whose question is gone is <strong>included in every request and
                              flagged</strong>, never silently dropped — but they will be
                              over-asked until you re-point them.
                            </>
                          ) : (
                            <>Delete this question? Nothing depends on it.</>
                          )}
                        </p>
                        <div className="flex justify-end gap-2 mt-2">
                          <button onClick={() => setConfirmDelete(null)} className="px-3 py-1 text-xs text-gray-600 hover:bg-white rounded font-medium">
                            Keep it
                          </button>
                          <button onClick={() => remove(q)} className="px-3 py-1 text-xs bg-rose-600 text-white hover:bg-rose-700 rounded font-medium">
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 bg-white flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-md font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default TcfQuestionsManager;
