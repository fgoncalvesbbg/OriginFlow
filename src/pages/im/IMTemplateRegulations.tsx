/**
 * IMTemplateRegulations — assign library regulations to ONE IM template.
 *
 * Assignment is per template (a category + `im` / `warning_leaflet`), not per category:
 * a category's manual and its warning leaflet carry different obligations, and the
 * leaflet is exactly the document a "must appear in the printed matter accompanying the
 * appliance" clause lands on.
 *
 * Each assignment can carry a SCOPE NOTE. That note is interpolated into the regulatory
 * check's system prompt, so it genuinely narrows what the model reports — it is not a
 * comment field. The UI says so, because a note nobody knows is functional gets left blank.
 *
 * `TemplateRegulationsPanel` is the body without a modal shell, so the check modal can
 * embed it and let assignments be fixed without leaving the run.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, FileText, Loader2, Plus, Scale, Trash2, X,
} from 'lucide-react';
import {
  assignRegulationToTemplate,
  getRegulations,
  getTemplateRegulations,
  unassignRegulationFromTemplate,
  updateTemplateRegulationNotes,
} from '../../services';
import type { IMTemplate, Regulation, TemplateRegulation } from '../../types';
import { IM_TEMPLATE_TYPE_LABELS } from '../../types';
import { useAuth } from '../../context/AuthContext';

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} kB`;

interface PanelProps {
  template: IMTemplate;
  /** Called after any assignment change, so a parent can refresh its counts. */
  onChanged?: () => void;
  /** Hide the "add" row — used when the panel is read-only context inside another flow. */
  readOnly?: boolean;
}

export const TemplateRegulationsPanel: React.FC<PanelProps> = ({ template, onChanged, readOnly }) => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<TemplateRegulation[]>([]);
  const [library, setLibrary] = useState<Regulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [pickId, setPickId] = useState('');
  const [pickNotes, setPickNotes] = useState('');
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [assigned, regs] = await Promise.all([
      getTemplateRegulations(template.id),
      // Superseded regulations stay out of the picker but keep showing where already assigned.
      getRegulations({ status: 'active' }),
    ]);
    setAssignments(assigned);
    setLibrary(regs);
    setLoading(false);
  }, [template.id]);

  useEffect(() => { load(); }, [load]);

  const assignedIds = useMemo(() => new Set(assignments.map((a) => a.regulationId)), [assignments]);

  /** Regulations suggested for this template's category float to the top of the picker. */
  const options = useMemo(() => {
    const free = library.filter((r) => !assignedIds.has(r.id));
    const suggested = free.filter((r) => r.applicableCategories.includes(template.categoryId));
    const rest = free.filter((r) => !r.applicableCategories.includes(template.categoryId));
    return { suggested, rest };
  }, [library, assignedIds, template.categoryId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAssign = () => {
    if (!pickId) return;
    const notes = pickNotes;
    run(async () => {
      await assignRegulationToTemplate(template.id, pickId, notes, user?.email);
      setPickId('');
      setPickNotes('');
    });
  };

  if (loading) return <div className="text-center py-8 text-sm text-gray-400">Loading regulations…</div>;

  const missingSummary = assignments.filter((a) => (a.regulation?.summaryBytes ?? 0) === 0);

  return (
    <div className="space-y-3 text-sm">
      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">{error}</div>
      )}

      {assignments.length === 0 ? (
        <p className="text-xs text-gray-400 bg-light border border-dashed border-gray-200 rounded-lg p-4 text-center">
          No regulations assigned yet. Add the ones this {IM_TEMPLATE_TYPE_LABELS[template.templateType]} must satisfy.
        </p>
      ) : (
        <div className="space-y-2">
          {assignments.map((a) => {
            const reg = a.regulation;
            const noSummary = (reg?.summaryBytes ?? 0) === 0;
            const noteDraft = editingNotes[a.id];
            return (
              <div key={a.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-bold text-primary break-all">
                      {reg?.referenceCode ?? '(regulation removed)'}
                    </span>
                    {reg?.title && <p className="text-xs text-gray-600 mt-0.5">{reg.title}</p>}
                  </div>
                  <button
                    onClick={() => run(() => unassignRegulationFromTemplate(a.id))}
                    disabled={busy}
                    title="Unassign from this template"
                    className="p-1 text-gray-300 hover:text-rose-600 disabled:opacity-50 shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {reg && (
                  noSummary ? (
                    <p className="text-[11px] text-amber-600 mt-1.5 flex items-start gap-1.5">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      No Markdown summary uploaded — a check cannot run against this regulation.
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1.5">
                      <FileText size={11} /> {kb(reg.summaryBytes)} summary
                    </p>
                  )
                )}

                <div className="mt-2">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">
                    Scope note for this template
                  </label>
                  <textarea
                    value={noteDraft ?? a.notes ?? ''}
                    onChange={(e) => setEditingNotes((m) => ({ ...m, [a.id]: e.target.value }))}
                    rows={2}
                    placeholder="e.g. only Annex IV applies — this family is not free-standing"
                    className="w-full text-xs border rounded px-2 py-1.5 mt-1"
                  />
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p className="text-[10px] text-gray-400">
                      Sent to the model as the scope for this template — it narrows what gets reported.
                    </p>
                    {noteDraft !== undefined && noteDraft !== (a.notes ?? '') && (
                      <button
                        onClick={() => run(async () => {
                          await updateTemplateRegulationNotes(a.id, noteDraft);
                          setEditingNotes((m) => { const next = { ...m }; delete next[a.id]; return next; });
                        })}
                        disabled={busy}
                        className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
                      >
                        <Check size={11} /> Save note
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {missingSummary.length > 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          {missingSummary.length} assigned regulation{missingSummary.length === 1 ? '' : 's'} ha
          {missingSummary.length === 1 ? 's' : 've'} no summary. Upload one in the Regulations
          library, or the check will refuse to run.
        </p>
      )}

      {!readOnly && (
        <div className="border-t pt-3">
          <label className="text-xs font-semibold text-gray-500 uppercase">Add a regulation</label>
          <div className="flex flex-col sm:flex-row gap-2 mt-1">
            <select
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
              className="flex-1 text-sm border rounded px-2 py-1.5 bg-white"
            >
              <option value="">Choose from the library…</option>
              {options.suggested.length > 0 && (
                <optgroup label="Suggested for this category">
                  {options.suggested.map((r) => (
                    <option key={r.id} value={r.id}>{r.referenceCode} — {r.title}</option>
                  ))}
                </optgroup>
              )}
              {options.rest.length > 0 && (
                <optgroup label="All other regulations">
                  {options.rest.map((r) => (
                    <option key={r.id} value={r.id}>{r.referenceCode} — {r.title}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <button
              onClick={handleAssign}
              disabled={!pickId || busy}
              className="text-sm px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Assign
            </button>
          </div>
          {pickId && (
            <textarea
              value={pickNotes}
              onChange={(e) => setPickNotes(e.target.value)}
              rows={2}
              placeholder="Optional scope note for this template"
              className="w-full text-xs border rounded px-2 py-1.5 mt-2"
            />
          )}
          {options.suggested.length === 0 && options.rest.length === 0 && (
            <p className="text-[11px] text-gray-400 mt-1.5">
              Every active regulation in the library is already assigned to this template.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Modal wrapper — launched from the TemplateRow on IMDashboard
// ---------------------------------------------------------------------------

interface ModalProps {
  template: IMTemplate;
  categoryName?: string;
  onClose: () => void;
  onChanged?: () => void;
}

export const TemplateRegulationsModal: React.FC<ModalProps> = ({
  template, categoryName, onClose, onChanged,
}) => (
  <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b">
        <div>
          <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Scale size={16} /> Regulations
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {categoryName ? `${categoryName} · ` : ''}{IM_TEMPLATE_TYPE_LABELS[template.templateType]}
          </p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
      </div>
      <div className="px-5 py-4 overflow-y-auto">
        <TemplateRegulationsPanel template={template} onChanged={onChanged} />
      </div>
      <div className="flex justify-end px-5 py-3 border-t">
        <button onClick={onClose} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50">Done</button>
      </div>
    </div>
  </div>
);

export default TemplateRegulationsModal;
