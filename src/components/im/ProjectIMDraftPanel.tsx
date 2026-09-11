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
  type ProjectDraftState,
} from '../../services/im/im-draft.service';
import { getReviewComments } from '../../services/review/review-comments.service';
import { MANUAL_STATUS_META } from '../../pages/im/im-manual-status';
import type { IMTemplateType } from '../../types';
import type { ReviewComment } from '../../types/review.types';

const PdfReviewCanvas = React.lazy(() => import('../../modules/review-portal/PdfReviewCanvas'));

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—';

interface Props {
  projectId: string;
  templateType?: IMTemplateType;
  /** Stamped on the request so the board can say who asked. */
  requestedBy?: string | null;
}

export const ProjectIMDraftPanel: React.FC<Props> = ({
  projectId, templateType = 'im', requestedBy = null,
}) => {
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

  const meta = MANUAL_STATUS_META[state.step];
  const hasDraft = !!state.latest;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <ClipboardCheck size={15} className="text-gray-400" />
        <h3 className="text-sm font-bold text-gray-900">Quality draft</h3>
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.classes}`}>
          {meta.label}
        </span>
        {meta.waiting && (
          <span className="text-[9px] uppercase tracking-wide text-gray-400 font-semibold">waiting</span>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">
          {/* Said plainly, because the step name alone could read as a gate. */}
          Never blocks — you can start the manual at any time.
        </span>
      </div>

      <div className="px-4 py-3">
        <p className="text-[11px] text-gray-600 mb-2">{meta.hint}</p>

        {error && (
          <p className="text-[11px] text-rose-700 inline-flex items-start gap-1 mb-2">
            <AlertCircle size={11} className="shrink-0 mt-0.5" /> {error}
          </p>
        )}

        {/* No slot open and nothing uploaded — offer to ask the supplier. */}
        {!state.requestId || state.cancelledAt ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-gray-500">
              {state.cancelledAt
                ? `Draft collection was stopped on ${shortDate(state.cancelledAt)}.`
                : 'No draft has been requested from the supplier.'}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => requestSupplierDraft(projectId, templateType, { requestedBy }))}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 disabled:opacity-60"
            >
              <Upload size={12} /> Request draft from supplier
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
              <Clock size={11} /> Requested {shortDate(state.requestedAt)}
              {state.dueDate ? ` · due ${shortDate(state.dueDate)}` : ''}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => cancelSupplierDraftRequest(projectId, templateType))}
              className="text-[11px] text-gray-500 hover:text-rose-700 underline disabled:opacity-60"
              title="Stop collecting a draft. Notes already made are kept."
            >
              Stop collecting
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
