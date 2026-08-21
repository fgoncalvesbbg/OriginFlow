/**
 * IMTemplateChecklist — the regulatory checklist as the TEMPLATE AUTHOR's readiness gate
 * (migration 120).
 *
 * The items are the combined checklist of every regulation that applies to the template
 * (see buildTemplateChecklist); ticking one here says "the template covers this". That is a
 * different claim from the per-manual confirmation the publisher makes in the generator's
 * publish dialog (migration 119), and neither is derived from the other — see
 * src/services/regulatory/regulation-checklist.ts for why a tick must not cross that
 * boundary. The publish dialog shows this decision beside its own as context.
 *
 * ADVISORY, NEVER A GATE. Nothing here blocks finalizing a template. A checklist that
 * blocks release only teaches people to tick everything, at which point it records nothing.
 * And it is deliberately NOT disabled for a FINAL template, matching the regulatory check
 * itself: a released template is the one most worth re-reviewing, and a tick records a
 * review rather than changing content.
 *
 * Decisions are written on click — there is no Save button in a review list — and applied
 * optimistically with a rollback if the write fails, because a tick that looks saved and is
 * not would be the one failure worth avoiding in a compliance record.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CheckSquare, Loader2, Scale, Square, X } from 'lucide-react';
import {
  buildTemplateChecklist,
  getTemplateChecklistState,
  getTemplateRegulations,
  setTemplateChecklistItemState,
  summarizeChecklist,
} from '../../services';
import type { ChecklistItem, ChecklistItemState, ChecklistItemStatus, ChecklistSummary } from '../../services';
import type { IMTemplate } from '../../types';
import { IM_TEMPLATE_TYPE_LABELS } from '../../types';
import { useAuth } from '../../context/AuthContext';

export interface TemplateChecklistProgress {
  items: ChecklistItem[];
  state: Record<string, ChecklistItemState>;
  summary: ChecklistSummary;
}

/**
 * Load a template's checklist and how far through it the author is.
 *
 * Exported so a caller that only wants the progress (a toolbar badge) does not have to
 * mount the list. Skips the state read when there are no items to have decided.
 */
export const loadTemplateChecklistProgress = async (
  template: Pick<IMTemplate, 'id' | 'categoryId'>,
): Promise<TemplateChecklistProgress> => {
  const assignments = await getTemplateRegulations(template.id, template.categoryId);
  const items = buildTemplateChecklist(assignments);
  const state = items.length ? await getTemplateChecklistState(template.id) : {};
  return { items, state, summary: summarizeChecklist(items, state) };
};

interface ChecklistProps {
  template: IMTemplate;
  /**
   * Items the caller already built (from assignments it had loaded anyway). Omit and the
   * component loads them itself.
   */
  items?: ChecklistItem[];
  /** Called after the initial load and after every decision, for a parent's badge. */
  onProgress?: (summary: ChecklistSummary) => void;
  /** Show the decisions without allowing changes. */
  readOnly?: boolean;
}

export const TemplateComplianceChecklist: React.FC<ChecklistProps> = ({
  template, items: providedItems, onProgress, readOnly,
}) => {
  const { user } = useAuth();
  const [items, setItems] = useState<ChecklistItem[]>(providedItems ?? []);
  const [state, setState] = useState<Record<string, ChecklistItemState>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      if (providedItems) {
        setItems(providedItems);
        const next = providedItems.length ? await getTemplateChecklistState(template.id) : {};
        setState(next);
        onProgress?.(summarizeChecklist(providedItems, next));
      } else {
        const progress = await loadTemplateChecklistProgress(template);
        setItems(progress.items);
        setState(progress.state);
        onProgress?.(progress.summary);
      }
    } catch (e) {
      setError(`Could not load the checklist: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
    // `onProgress` is intentionally not a dependency — a parent that re-creates the
    // callback each render would otherwise reload the checklist on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, template.categoryId, providedItems]);

  useEffect(() => { load(); }, [load]);

  const decide = async (key: string, status: ChecklistItemStatus | null) => {
    if (readOnly) return;
    const previous = state;
    const optimistic = { ...state };
    if (!status) delete optimistic[key];
    else optimistic[key] = { status, updatedBy: user?.email, updatedAt: new Date().toISOString() };

    setBusyKey(key);
    setError('');
    setState(optimistic);
    onProgress?.(summarizeChecklist(items, optimistic));
    try {
      await setTemplateChecklistItemState(template.id, key, status, { actor: user?.email });
    } catch (e) {
      setState(previous);
      onProgress?.(summarizeChecklist(items, previous));
      setError(`Could not save that: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <p className="text-xs text-gray-400 flex items-center gap-1.5 py-3">
        <Loader2 size={12} className="animate-spin" /> Loading the checklist…
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="text-xs text-gray-400 bg-light border border-dashed border-gray-200 rounded-lg p-4 text-center">
        None of the regulations that apply to this{' '}
        {IM_TEMPLATE_TYPE_LABELS[template.templateType].toLowerCase()} defines checklist items
        yet. Add them to a regulation in the Regulations library and they will appear here.
      </p>
    );
  }

  const summary = summarizeChecklist(items, state);

  return (
    <div className="border border-emerald-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-emerald-50 border-b border-emerald-200">
        <span className="text-xs font-bold uppercase tracking-wide text-emerald-800 flex items-center gap-1.5">
          <CheckSquare size={13} /> Compliance checklist
        </span>
        <span className="text-[10px] font-semibold text-emerald-700">
          {summary.done} of {summary.total} confirmed
          {summary.na > 0 && <> · {summary.na} n/a</>}
          {summary.open > 0 && <> · {summary.open} to review</>}
        </span>
      </div>

      <p className="text-[11px] text-gray-500 px-3 pt-2">
        Every obligation the regulations on this template ask a person to verify. Confirm what
        the template covers before releasing it — optional, and nothing here blocks
        finalizing. Each manual built from this template is confirmed separately at publish
        time.
      </p>

      <ul className="divide-y divide-gray-100 mt-1">
        {items.map((item) => {
          const decided = state[item.key];
          const done = decided?.status === 'done';
          const na = decided?.status === 'na';
          const busy = busyKey === item.key;
          return (
            <li key={item.key} className="flex items-start gap-2 px-3 py-2">
              <button
                onClick={() => decide(item.key, done ? null : 'done')}
                disabled={busy || readOnly}
                title={done ? 'Clear this confirmation' : 'The template covers this'}
                className="shrink-0 mt-0.5 disabled:opacity-40"
              >
                {busy
                  ? <Loader2 size={15} className="animate-spin text-gray-400" />
                  : done
                    ? <CheckSquare size={15} className="text-emerald-600" />
                    : <Square size={15} className={na ? 'text-gray-300' : 'text-gray-400'} />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${na ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {item.text}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  <span className="font-mono">{item.regulationReferences.join(' · ')}</span>
                  {decided && (
                    <>
                      {' — '}
                      {done ? 'confirmed' : 'not applicable'}
                      {decided.updatedBy ? ` by ${decided.updatedBy}` : ''}
                      {decided.updatedAt
                        ? ` on ${new Date(decided.updatedAt).toLocaleDateString()}`
                        : ''}
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={() => decide(item.key, na ? null : 'na')}
                disabled={busy || readOnly}
                title={na ? 'This item applies after all' : 'Does not apply to this template'}
                className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border disabled:opacity-40 ${
                  na
                    ? 'bg-gray-100 text-gray-600 border-gray-300'
                    : 'text-gray-400 border-gray-200 hover:text-gray-600 hover:border-gray-300'
                }`}
              >
                N/A
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="text-[11px] text-rose-700 bg-rose-50 border-t border-rose-200 px-3 py-1.5">
          {error}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Modal wrapper — launched from the template editor's toolbar
// ---------------------------------------------------------------------------

interface ModalProps {
  template: IMTemplate;
  categoryName?: string;
  items?: ChecklistItem[];
  onProgress?: (summary: ChecklistSummary) => void;
  onClose: () => void;
}

export const TemplateChecklistModal: React.FC<ModalProps> = ({
  template, categoryName, items, onProgress, onClose,
}) => (
  <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b">
        <div>
          <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Scale size={16} /> Compliance checklist
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {categoryName ? `${categoryName} · ` : ''}{IM_TEMPLATE_TYPE_LABELS[template.templateType]}
          </p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
      </div>
      <div className="px-5 py-4 overflow-y-auto">
        <TemplateComplianceChecklist template={template} items={items} onProgress={onProgress} />
      </div>
      <div className="flex justify-end px-5 py-3 border-t">
        <button onClick={onClose} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50">Done</button>
      </div>
    </div>
  </div>
);

export default TemplateChecklistModal;
