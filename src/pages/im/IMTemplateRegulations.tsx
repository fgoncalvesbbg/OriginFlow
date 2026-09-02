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
 * The panel also carries the COMBINED compliance checklist these regulations produce
 * (migrations 119/120): the template author ticks off what the template covers here, while
 * each manual built from the template is confirmed separately at publish time. Both records
 * exist because they are different claims — see regulation-checklist.ts.
 *
 * `TemplateRegulationsPanel` is the body without a modal shell, so the check modal can
 * embed it and let assignments be fixed without leaving the run.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Check, ExternalLink, FileText, Loader2, Lock, Plus, Scale, Trash2, X,
} from 'lucide-react';
import {
  assignRegulationToTemplate,
  buildTemplateChecklist,
  getRegulations,
  getTemplateRegulations,
  unassignRegulationFromTemplate,
  updateTemplateRegulationNotes,
} from '../../services';
import type { IMTemplate, Regulation, TemplateRegulation } from '../../types';
import { IM_TEMPLATE_TYPE_LABELS } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { TemplateComplianceChecklist } from './IMTemplateChecklist';

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
      getTemplateRegulations(template.id, template.categoryId),
      // Superseded regulations stay out of the picker but keep showing where already assigned.
      getRegulations({ status: 'active' }),
    ]);
    setAssignments(assigned);
    setLibrary(regs);
    setLoading(false);
  }, [template.id, template.categoryId]);

  useEffect(() => { load(); }, [load]);

  const assignedIds = useMemo(() => new Set(assignments.map((a) => a.regulationId)), [assignments]);

  /**
   * Regulations that do NOT yet apply, for the "add" picker. There is no longer a
   * "suggested for this category" group: anything marked for this category already
   * applies, so it is never free.
   */
  const options = useMemo(
    () => library.filter((r) => !assignedIds.has(r.id)),
    [library, assignedIds]);

  const derivedCount = assignments.filter((a) => a.source === 'category').length;

  // Deduped across regulations: two regulations stating the same obligation are one item.
  const checklistItems = useMemo(() => buildTemplateChecklist(assignments), [assignments]);

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

      {/* The library is a top-level section since migration 139 — it is shared with the TCF,
          so it no longer lives inside the IM dashboard and needs a way back. */}
      <p className="text-[11px] text-gray-400">
        This assigns regulations from the shared library. Their summaries, versions and IM
        requirements are edited in{' '}
        <Link to="/regulations" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">
          Regulations <ExternalLink size={10} />
        </Link>.
      </p>

      {derivedCount > 0 && (
        <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded p-2">
          {derivedCount} of these appl{derivedCount === 1 ? 'ies' : 'y'} because this category is
          marked on the regulation. Unmark the category in the Regulations library to stop
          {derivedCount === 1 ? ' it' : ' them'} applying here.
        </p>
      )}

      {assignments.length === 0 ? (
        <p className="text-xs text-gray-400 bg-light border border-dashed border-gray-200 rounded-lg p-4 text-center">
          Nothing applies yet. Add the regulations this {IM_TEMPLATE_TYPE_LABELS[template.templateType]}{' '}
          must satisfy below, or mark this category on a regulation in the Regulations library
          and it will apply here automatically.
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
                    {a.source === 'category' && (
                      <span
                        className="ml-1.5 align-middle bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                        title="Applies because this category is marked on the regulation. Unmark it in the Regulations library to stop it applying here."
                      >
                        VIA CATEGORY
                      </span>
                    )}
                    {reg?.title && <p className="text-xs text-gray-600 mt-0.5">{reg.title}</p>}
                  </div>
                  {/* Only an explicit row can be removed here — a category-derived entry has
                      no row, and goes away by unmarking the category on the regulation. */}
                  {a.source === 'explicit' ? (
                    <button
                      onClick={() => run(() => unassignRegulationFromTemplate(a.id))}
                      disabled={busy}
                      title="Unassign from this template"
                      className="p-1 text-gray-300 hover:text-rose-600 disabled:opacity-50 shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : (
                    <span
                      className="p-1 text-gray-200 shrink-0 cursor-help"
                      title="Remove the category from this regulation in the Regulations library to stop it applying here."
                    >
                      <Lock size={13} />
                    </span>
                  )}
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
                      {a.source === 'category' && ' Saving one pins this regulation to this template.'}
                    </p>
                    {noteDraft !== undefined && noteDraft !== (a.notes ?? '') && (
                      <button
                        onClick={() => run(async () => {
                          // A 'category' entry has no row — saving a note materializes the
                          // explicit assignment carrying it (see the service).
                          await updateTemplateRegulationNotes(a.id, noteDraft, {
                            templateId: template.id,
                            regulationId: a.regulationId,
                            actor: user?.email,
                          });
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

      {/* The combined checklist these regulations produce (migrations 119/120), tickable
          HERE as the template author's readiness gate. The per-manual confirmation is a
          separate record made at publish time — see IMTemplateChecklist. */}
      {checklistItems.length > 0 && (
        <TemplateComplianceChecklist
          template={template}
          items={checklistItems}
          readOnly={readOnly}
        />
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
              {options.map((r) => (
                <option key={r.id} value={r.id}>{r.referenceCode} — {r.title}</option>
              ))}
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
          {options.length === 0 && (
            <p className="text-[11px] text-gray-400 mt-1.5">
              Every active regulation in the library already applies to this template.
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
