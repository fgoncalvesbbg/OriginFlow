/**
 * The Draft Review step, as one dialog — the only thing a project in that step offers.
 *
 * WHY IT IS THIS SMALL. A project sitting in Draft Review is waiting on exactly one decision:
 * has Quality been through the supplier's PDF or not. So the card opens this and nothing
 * else — the markup link to open it, and the tick that says it is done. Anything more (start
 * the IM, request another draft, cancel the ask) belongs to the project, not to the one
 * question this step asks, and the project page still has all of it.
 *
 * MARKING IT REVIEWED MOVES THE CARD TO BACKLOG. It does that by closing the review round —
 * the same `review_submit` Quality's portal calls when they press Submit — so the step
 * follows from the round rather than from a second, independent "reviewed" flag that could
 * disagree with it. See `markDraftReviewed` and `draftStepOf`.
 *
 * The draft does not disappear with the step: it stays on the project and the writer reads
 * it from the generator (`ProjectIMDraftPanel`) whenever they start.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ClipboardCheck, Copy, ExternalLink, FileText, Loader2, X,
} from 'lucide-react';
import {
  ensureDraftMarkupLink, getProjectDraftState, markDraftReviewed, type ProjectDraftState,
} from '../../services/im/im-draft.service';
import { useAuth } from '../../context/AuthContext';
import type { IMTemplateType } from '../../types';

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—';

interface Props {
  projectId: string;
  projectName: string;
  templateType?: IMTemplateType;
  onClose: () => void;
  /** Called after the round is closed, so the board can re-derive the project's step. */
  onReviewed?: () => void;
}

export const DraftQualityCheckDialog: React.FC<Props> = ({
  projectId, projectName, templateType = 'im', onClose, onReviewed,
}) => {
  const { user } = useAuth();
  const [state, setState] = useState<ProjectDraftState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await getProjectDraftState(projectId, templateType));
    } catch (e: any) {
      console.error('[DraftQualityCheckDialog] load failed:', e);
      setError(e?.message ?? 'Could not load this draft.');
    }
  }, [projectId, templateType]);

  useEffect(() => { void load(); }, [load]);

  /** Esc closes, like every other modal in the app. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * The round's link, minted if the upload's own link has expired or been revoked. A dead
   * link is the normal reason someone is looking at this dialog rather than the portal.
   */
  const withLink = async (use: (url: string) => void | Promise<void>) => {
    if (!state?.latest) return;
    setBusy(true);
    setError('');
    try {
      await use(state.markupUrl ?? await ensureDraftMarkupLink(projectId, state.latest.id));
    } catch (e: any) {
      setError(e?.message ?? 'Could not open the markup link.');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = () => withLink(async url => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });

  const markReviewed = async () => {
    if (!state?.latest) return;
    setBusy(true);
    setError('');
    try {
      await markDraftReviewed(projectId, state.latest.id, user?.name || user?.email || 'Quality');
      onReviewed?.();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Could not mark this draft reviewed.');
      setBusy(false);
    }
  };

  const latest = state?.latest ?? null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <ClipboardCheck size={15} className="text-sky-600" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-gray-900 truncate">Supplier draft review</h3>
            <p className="text-[11px] text-gray-500 truncate">{projectName}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-700"
            aria-label="Close"
          ><X size={18} /></button>
        </div>

        <div className="px-4 py-4">
          {!state ? (
            <p className="text-xs text-gray-400 inline-flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Loading the draft…
            </p>
          ) : !latest ? (
            // Only reachable if the upload was withdrawn between the board loading and this
            // opening — say what happened rather than showing two dead buttons.
            <p className="text-xs text-gray-500">
              There is no draft on this project any more — it may have been withdrawn. Reload
              the board.
            </p>
          ) : (
            <>
              <div className="border border-gray-200 rounded-lg px-3 py-2 mb-3">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-gray-400 shrink-0" />
                  <span className="text-xs font-semibold text-gray-800 truncate">
                    v{latest.version}
                    {latest.originalFilename ? ` · ${latest.originalFilename}` : ''}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {latest.pageCount ? `${latest.pageCount} pages · ` : ''}
                  from {latest.uploadedByName} on {shortDate(latest.uploadedAt)}
                  {state.noteCount > 0 && ` · ${state.noteCount} note${state.noteCount === 1 ? '' : 's'} so far`}
                </p>
              </div>

              {state.submitted ? (
                <p className="text-[11px] text-emerald-700 inline-flex items-center gap-1 mb-3">
                  <CheckCircle2 size={12} /> Already reviewed on {shortDate(state.submittedAt)} —
                  this project is in Backlog, ready to be written.
                </p>
              ) : (
                <p className="text-[11px] text-gray-600 mb-3">
                  Open the markup to read the draft and pin notes on it. Mark it reviewed when
                  Quality is done — the project then moves to Backlog and the writer starts the
                  manual with this draft and its notes as the brief.
                </p>
              )}

              {error && (
                <p className="text-[11px] text-rose-700 inline-flex items-start gap-1 mb-2">
                  <AlertCircle size={11} className="shrink-0 mt-0.5" /> {error}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {/* A plain anchor when the link is already live, so the click opens the tab
                    itself — an await between the click and window.open is what popup
                    blockers stop. The minting path is the button beside it. */}
                {state.markupUrl ? (
                  <a
                    href={state.markupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg"
                  >
                    <ExternalLink size={12} /> Open review markup
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => withLink(url => { window.open(url, '_blank', 'noopener'); })}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg disabled:opacity-60"
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                    Open review markup
                  </button>
                )}

                {/* Quality works outside OriginFlow and the app sends no email, so the link
                    has to be handed over by whoever is on this screen. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-lg disabled:opacity-60"
                >
                  <Copy size={12} /> {copied ? 'Copied' : 'Copy link'}
                </button>

                {!state.submitted && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={markReviewed}
                    className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg disabled:opacity-60"
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    Mark as reviewed
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DraftQualityCheckDialog;
