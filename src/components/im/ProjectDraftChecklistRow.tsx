/**
 * The supplier's draft manual as a row in the PM's phase checklist (migrations 179–181).
 *
 * WHY THE PM NEEDS THIS AT ALL. The draft is something a supplier owes on a date, exactly
 * like 3D CAD Files or Product Photos. Before this, the only place it appeared was the IM
 * screen — so the person actually chasing the supplier could not see, in the list of things
 * they chase, whether it had arrived. The answer is to put it in that list.
 *
 * IT MIRRORS THE DOCUMENT ROWS AROUND IT rather than inventing a fourth look: the same icon
 * tile, the same title-plus-badge line, the same "Supplier · Due: …" subline with the same
 * overdue colouring and the same "(phase)" marker when the date is inherited. A PM scanning
 * the column should not have to learn a second row format to find out if Quality has it.
 *
 * READ-ONLY. Everything that changes a draft happens elsewhere — the supplier uploads in
 * their portal, Quality marks up in theirs, the writer reads it on the IM screen. This row
 * reports, and links.
 */

import React from 'react';
import { CheckCircle2, Clock, FileText, Loader2 } from 'lucide-react';
import type { ProjectDraftState } from '../../services/im/im-draft.service';

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—';

/**
 * What the badge says. Deliberately the supplier-facing fact ("has it arrived, and has
 * Quality been through it"), not the board's step name — a PM reading a checklist wants the
 * state of THIS deliverable, and `Backlog` would describe the manual instead.
 */
const badgeOf = (state: ProjectDraftState): { label: string; classes: string } => {
  if (state.submitted) return { label: 'REVIEWED', classes: 'bg-emerald-100 text-emerald-700' };
  if (state.latest) return { label: 'WITH QUALITY', classes: 'bg-sky-100 text-sky-700' };
  if (state.cancelledAt) return { label: 'NOT REQUIRED', classes: 'bg-gray-100 text-gray-500' };
  return { label: 'NOT STARTED', classes: 'bg-gray-100 text-gray-600' };
};

interface Props {
  state: ProjectDraftState | null;
  /** Opens the draft PDF with Quality's notes — the IM screen owns that viewer. */
  onOpen?: () => void;
}

export const ProjectDraftChecklistRow: React.FC<Props> = ({ state, onOpen }) => {
  if (!state) {
    return (
      <div className="p-4 text-xs text-gray-400 flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Loading draft manual…
      </div>
    );
  }

  // No request and nothing uploaded means this project is not collecting a draft at all.
  // Showing an empty row for it would be noise in a list of things that are actually owed.
  if (!state.requestId && !state.latest) return null;

  const badge = badgeOf(state);
  const due = state.dueDate;
  const overdue = !!due && new Date(due) < new Date() && !state.latest && !state.cancelledAt;
  const hasFile = !!state.latest;

  return (
    <div className="p-4 hover:bg-light transition-colors group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          <div className={`p-2 rounded-xl ${hasFile ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
            <FileText size={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-primary">
                {state.templateType === 'warning_leaflet' ? 'Draft Warning Leaflet' : 'Draft Instruction Manual'}
              </h4>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.classes}`}>
                {badge.label}
              </span>
              {state.submitted && <CheckCircle2 size={14} className="text-emerald-600" />}
            </div>
            <div className="text-xs text-muted mt-0.5 flex items-center gap-2 flex-wrap">
              <span>Supplier</span>
              {due && (
                <span className={`flex items-center gap-1 ${overdue ? 'text-rose-600 font-semibold' : 'text-amber-600'}`}>
                  Due: {due}
                  {!state.dueDateIsCustom && (
                    <span className="text-[10px] text-gray-400 font-normal">(phase)</span>
                  )}
                </span>
              )}
              {/* The two facts a PM chasing this actually wants. */}
              {hasFile && (
                <span className="text-gray-400">
                  v{state.latest!.version} · {shortDate(state.latest!.uploadedAt)}
                  {state.noteCount > 0 && ` · ${state.noteCount} note${state.noteCount === 1 ? '' : 's'}`}
                </span>
              )}
              {!hasFile && !state.cancelledAt && !state.reachedStep && (
                // Not late, just early — a PM should not chase a supplier for a phase the
                // launch has not entered.
                <span className="text-gray-400">phase not started yet</span>
              )}
              {!hasFile && !state.cancelledAt && state.reachedStep && (
                <span className={overdue ? 'text-rose-600' : 'text-gray-400'}>
                  <Clock size={11} className="inline mr-0.5" />
                  waiting on the supplier
                </span>
              )}
            </div>
          </div>
        </div>

        {hasFile && onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-3 py-1.5 rounded-lg hover:bg-indigo-50"
          >
            Open draft
          </button>
        )}
      </div>
    </div>
  );
};

export default ProjectDraftChecklistRow;
