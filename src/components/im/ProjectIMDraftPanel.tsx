/**
 * The supplier draft and Quality's notes on it, as the technical writer sees them
 * (migration 179). This is the brief — the thing that replaces starting from a blank page.
 *
 * IT IS READ-ONLY, AND THAT IS THE WHOLE POINT. The writer reads the draft and the notes and
 * then authors the manual the normal way; nothing here writes IM content, and nothing here
 * gates anything. A project with no draft, or with one still being marked up, can be started
 * at any time — the panel says so rather than hiding the fact.
 *
 * The pins are shown on the pages rather than only listed, because a note like "this warning
 * is wrong" is meaningless without the paragraph it points at.
 */

import React, { useCallback, useEffect, useState, Suspense } from 'react';
import {
  AlertCircle, CheckCircle2, ClipboardCheck, Clock, FileText, Loader2, Upload, X,
} from 'lucide-react';
import {
  getProjectDraftState, fetchDraftFile, requestSupplierDraft, cancelSupplierDraftRequest,
  uploadReEditAttachment, MAX_DRAFT_PDF_BYTES,
  type ProjectDraftState,
} from '../../services/im/im-draft.service';
import { getReviewComments } from '../../services/review/review-comments.service';
import { MANUAL_STATUS_META, isDraftStep, type ManualStatusMeta } from '../../pages/im/im-manual-status';
import type { IMTemplateType, ProjectKind } from '../../types';
import type { ReviewComment } from '../../types/review.types';

const PdfReviewCanvas = React.lazy(() => import('../../modules/review-portal/PdfReviewCanvas'));

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—';

interface Props {
  projectId: string;
  templateType?: IMTemplateType;
  /** Stamped on the request so the board can say who asked. */
  requestedBy?: string | null;
  /**
   * What the project IS (migration 182). On a re-edit this panel shows the REQUIREMENT —
   * the brief written when the re-edit was raised — in place of the supplier draft, because
   * a re-edit has no supplier to collect one from. Same panel, same PDF viewer, same notes;
   * only the words and the one action differ.
   */
  kind?: ProjectKind;
  /** The re-edit's requirement text, from `projects.reedit_requirement`. */
  requirement?: string | null;
}

export const ProjectIMDraftPanel: React.FC<Props> = ({
  projectId, templateType = 'im', requestedBy = null, kind = 'launch', requirement = null,
}) => {
  const isReEdit = kind === 'reedit';
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ProjectDraftState | null>(null);
  const [notes, setNotes] = useState<ReviewComment[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await getProjectDraftState(projectId, templateType);
      setState(s);
      if (s.latest) {
        setNotes(await getReviewComments({
          type: 'im_draft', projectId, id: s.latest.id,
        }));
      } else {
        setNotes([]);
      }
    } catch (e: any) {
      console.error('[ProjectIMDraftPanel] load failed:', e);
      setError(e?.message ?? 'Could not load the draft.');
    }
  }, [projectId, templateType]);

  useEffect(() => { void load(); }, [load]);

  /** Signed URLs live five minutes, so one is minted per open rather than prefetched. */
  const openDraft = async () => {
    if (!state?.latest) return;
    setBusy(true);
    setError('');
    try {
      const file = await fetchDraftFile(state.latest.id);
      setFileUrl(file.url);
      setOpen(true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not open that draft.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-400 inline-flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Loading quality draft…
      </div>
    );
  }

  /**
   * The badge describes THE DRAFT, not the project's step.
   *
   * For the two intake steps the two coincide, so it reads from the one vocabulary like
   * every other surface. A checked draft does not: its project is in Backlog (or already
   * In Progress, since this panel lives on the manual), and stamping "Backlog" on the
   * writer's brief would describe the wrong document. That case gets its own words.
   */
  const meta: ManualStatusMeta = isReEdit
    ? {
        label: 'Requirement',
        classes: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        hint: 'Why this re-edit was raised. It was written when the re-edit was created and is the brief for the manual.',
      }
    : state.submitted
    ? {
        label: 'Draft reviewed',
        classes: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        hint: 'Quality has been through the supplier draft and submitted their notes. This is the brief — read it, then write the manual.',
      }
    : isDraftStep(state.step)
      ? MANUAL_STATUS_META[state.step]
      : {
          label: 'No draft',
          classes: 'bg-gray-100 text-gray-600 border-gray-200',
          hint: 'No supplier draft has come in for this project. Nothing is waiting on it — write the manual the normal way.',
        };
  const hasDraft = !!state.latest;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <ClipboardCheck size={15} className="text-gray-400" />
        <h3 className="text-sm font-bold text-gray-900">
          {isReEdit ? 'Re-edit requirement' : 'Quality draft'}
        </h3>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.classes}`}>
          {meta.label}
        </span>
        {meta.waiting && (
          <span className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold">waiting</span>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">
          {/* Said plainly, because the step name alone could read as a gate. */}
          {isReEdit
            ? 'The brief for this re-edit.'
            : 'Never blocks — you can start the manual at any time.'}
        </span>
      </div>

      <div className="px-4 py-3">
        <p className="text-[11px] text-gray-600 mb-2">{meta.hint}</p>

        {error && (
          <p className="text-[11px] text-rose-700 inline-flex items-start gap-1 mb-2">
            <AlertCircle size={11} className="shrink-0 mt-0.5" /> {error}
          </p>
        )}

        {/*
          A re-edit has no supplier to ask and nothing to cancel, so the whole request/cancel
          row is replaced by the requirement itself plus the one action that does apply:
          attaching the markup, complaint or test report that prompted it.
        */}
        {isReEdit ? (
          <div className="space-y-2">
            {requirement && (
              <p className="text-[12px] text-gray-800 whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                {requirement}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  if (file.size > MAX_DRAFT_PDF_BYTES) {
                    setError('That PDF is larger than the 50MB limit.');
                    return;
                  }
                  if (!state.requestId) {
                    setError('This re-edit has no requirement slot to attach to.');
                    return;
                  }
                  act(async () => { await uploadReEditAttachment(state.requestId!, file); });
                }}
              />
              <button
                type="button"
                disabled={busy || !state.requestId}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 disabled:opacity-60"
                title="Attach the markup, complaint or test report behind this re-edit (PDF)"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {hasDraft ? 'Replace attachment' : 'Attach a PDF'}
              </button>
              <span className="text-[11px] text-gray-400">Optional · PDF up to 50MB</span>
            </div>
          </div>
        ) : !state.requestId || state.cancelledAt ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-gray-500">
              {state.cancelledAt
                ? `Draft collection was stopped on ${shortDate(state.cancelledAt)}.`
                : 'This project has no draft request — unusual, since every launch gets one.'}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => requestSupplierDraft(projectId, templateType, { requestedBy }))}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 disabled:opacity-60"
            >
              <Upload size={12} /> {state.cancelledAt ? 'Ask the supplier again' : 'Request draft from supplier'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
              <Clock size={11} /> Asked for in step {state.stepNumber}
              {state.dueDate ? ` · due ${shortDate(state.dueDate)}` : ''}
            </span>
            {/* Not late, just early — worth saying, because an empty draft slot on a project
                still in step 1 is not something anyone needs to chase. */}
            {!state.reachedStep && !hasDraft && (
              <span className="text-[11px] text-gray-500">
                The project has not reached that step yet, so the supplier is not overdue.
              </span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => cancelSupplierDraftRequest(projectId, templateType))}
              className="text-[11px] text-gray-500 hover:text-rose-700 underline disabled:opacity-60"
              title="Stop collecting a draft for this project. Notes already made are kept."
            >
              Not needed for this project
            </button>
          </div>
        )}

        {hasDraft && (
          <div className="border border-gray-200 rounded-lg px-3 py-2 flex flex-wrap items-center gap-2">
            <FileText size={14} className="text-gray-400" />
            <span className="text-xs font-semibold text-gray-800">
              v{state.latest!.version}
              {state.latest!.originalFilename ? ` · ${state.latest!.originalFilename}` : ''}
            </span>
            <span className="text-[11px] text-gray-500">
              {state.latest!.pageCount ? `${state.latest!.pageCount} pages · ` : ''}
              from {state.latest!.uploadedByName} on {shortDate(state.latest!.uploadedAt)}
            </span>
            {state.submitted ? (
              <span className="text-[11px] text-emerald-700 inline-flex items-center gap-1">
                <CheckCircle2 size={11} /> quality check done
                {state.noteCount > 0 && ` · ${state.noteCount} note${state.noteCount === 1 ? '' : 's'}`}
              </span>
            ) : (
              <span className="text-[11px] text-sky-700">with quality now</span>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={openDraft}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-60"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
              Open draft{state.noteCount > 0 ? ` + ${state.noteCount} note${state.noteCount === 1 ? '' : 's'}` : ''}
            </button>
          </div>
        )}

        {/* Earlier versions, so "what did we send before" has an answer. */}
        {state.uploads.length > 1 && (
          <p className="text-[10px] text-gray-400 mt-2">
            {state.uploads.length} versions uploaded — notes stay pinned to the version they
            were written against.
          </p>
        )}
      </div>

      {open && fileUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch" role="dialog" aria-modal="true">
          <div className="bg-white m-auto w-[min(1200px,95vw)] h-[92vh] rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
              <FileText size={14} className="text-gray-400" />
              <span className="text-sm font-bold text-gray-900">
                Quality draft v{state.latest?.version} — read only
              </span>
              <span className="text-[11px] text-gray-500">
                {notes.length} note{notes.length === 1 ? '' : 's'} from quality
              </span>
              <button
                onClick={() => { setOpen(false); setFileUrl(null); }}
                className="ml-auto text-gray-400 hover:text-gray-700"
                aria-label="Close"
              ><X size={18} /></button>
            </div>
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 min-w-0">
                <Suspense fallback={
                  <div className="h-full flex items-center justify-center bg-gray-100 text-gray-400 gap-2">
                    <Loader2 size={16} className="animate-spin" /> Loading viewer…
                  </div>
                }>
                  <PdfReviewCanvas
                    fileUrl={fileUrl}
                    comments={notes}
                    composing={false}
                    draftAnchor={null}
                    // Read-only: the writer reads Quality's notes, they do not add to them.
                    // A reply belongs in the manual, not on the supplier's draft.
                    readOnly
                    onDropPin={() => {}}
                    focusedCommentId={focused}
                    onFocusComment={setFocused}
                  />
                </Suspense>
              </div>
              <aside className="w-80 shrink-0 border-l border-gray-200 overflow-y-auto bg-light/40">
                {notes.length === 0 && (
                  <p className="p-4 text-xs text-gray-400 italic">
                    Quality left no notes on this draft.
                  </p>
                )}
                <ul className="divide-y divide-gray-100">
                  {notes.map((n, i) => (
                    <li
                      key={n.id}
                      onClick={() => setFocused(n.id)}
                      className={`px-3 py-2 cursor-pointer ${focused === n.id ? 'bg-indigo-50' : 'hover:bg-white'}`}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[10px] font-bold text-indigo-600">{i + 1}</span>
                        <span className="text-[11px] font-semibold text-gray-700">{n.authorName}</span>
                        <span className="text-[10px] text-gray-400 ml-auto">{shortDate(n.createdAt)}</span>
                      </div>
                      <p className="text-xs text-gray-800 mt-0.5 whitespace-pre-wrap">{n.body}</p>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectIMDraftPanel;
