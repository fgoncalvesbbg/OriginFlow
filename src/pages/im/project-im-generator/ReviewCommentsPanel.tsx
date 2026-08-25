/**
 * ReviewCommentsPanel — supplier review notes, docked beside the IM editor.
 *
 * WHY A PANEL AND NOT A DIALOG
 * ----------------------------
 * Same reasoning as PublishReviewPanel, and for the same reason: every row here is a pointer
 * INTO the editor. A modal would make the PM close the list to act on it and reopen it to find
 * their place. Docked, clicking a row selects that chapter, scrolls the preview to it and
 * highlights the exact wording the supplier quoted — and the row stays put, so the PM can work
 * down the list. Collapsing folds it to a rail that keeps the outstanding count on screen.
 *
 * WHAT A ROW IS
 * -------------
 * One supplier note: who wrote it, the wording they selected, what they said about it, and a
 * Done / Not changing decision. Notes are grouped by chapter in the manual's reading order, so
 * the PM works through the document rather than through a chronological feed.
 *
 * Two things the panel deliberately does NOT hide:
 *  - ORPHANED groups, whose chapter is no longer in the manual. Feedback the PM can't navigate
 *    to still has to be read, so it lands in a trailing group with the jump disabled rather
 *    than being dropped.
 *  - RESOLVED notes. They stay listed, dimmed, because "we already decided that" is the answer
 *    to half the follow-up questions a review generates.
 *
 * The panel holds no business rules: groups arrive grouped (review-comments.utils.ts) and every
 * write goes back out through a callback.
 */

import React from 'react';
import {
  ChevronsRight, ChevronRight, CheckCircle, MessageSquare, X, Undo2, Ban, Check, AlertTriangle,
} from 'lucide-react';
import type { IMReviewComment, IMReviewCommentStatus } from '../../../services';
import type { ReviewCommentGroup, ReviewCommentCounts } from './review-comments.utils';

interface ReviewCommentsPanelProps {
  groups: ReviewCommentGroup[];
  counts: ReviewCommentCounts;
  /** Names on the outstanding review links, for the header line. */
  reviewers: string[];
  /** True once every outstanding reviewer has pressed "Submit review". */
  submitted: boolean;
  /** True when the manual has been republished since the notes were written. */
  stale: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  /** Put the editor on the chapter this note is about and highlight its quote. */
  onJump: (comment: IMReviewComment) => void;
  onSetStatus: (id: string, status: IMReviewCommentStatus) => void;
  /** The note last jumped to, kept marked so the PM can see where they were. */
  activeCommentId: string | null;
  /** The note currently being written, if any. */
  busyCommentId: string | null;
}

const relativeDay = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
};

export const ReviewCommentsPanel: React.FC<ReviewCommentsPanelProps> = ({
  groups, counts, reviewers, submitted, stale, collapsed, onToggleCollapsed, onClose,
  onJump, onSetStatus, activeCommentId, busyCommentId,
}) => {
  // Collapsed rail: the open count has to stay readable, or collapsing would hide the very
  // thing the panel exists to report.
  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        title={`Expand supplier review (${counts.open} open note${counts.open === 1 ? '' : 's'})`}
        className="w-10 shrink-0 bg-white border border-gray-200 rounded-xl shadow flex flex-col items-center gap-3 py-3 hover:bg-light transition-colors"
      >
        <ChevronsRight size={14} className="rotate-180 text-gray-400" />
        {counts.open > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
            {counts.open}
          </span>
        )}
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 [writing-mode:vertical-rl]">
          Supplier review
        </span>
      </button>
    );
  }

  return (
    <div className="w-[23rem] shrink-0 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 bg-light border-b border-gray-200 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
            <MessageSquare size={14} className={counts.open > 0 ? 'text-amber-500' : 'text-gray-400'} />
            Supplier review
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            {counts.total === 0
              ? 'No notes yet. Reviewers see the online manual and comment on the wording.'
              : counts.open > 0
                ? `${counts.open} open note${counts.open === 1 ? '' : 's'} of ${counts.total}. Click any note to jump to it.`
                : `All ${counts.total} note${counts.total === 1 ? '' : 's'} handled.`}
          </p>
        </div>
        <button onClick={onToggleCollapsed} title="Collapse to the side" className="shrink-0 p-1 text-gray-400 hover:text-gray-700">
          <ChevronsRight size={15} />
        </button>
        <button onClick={onClose} title="Close the review panel" className="shrink-0 p-1 text-gray-400 hover:text-gray-700">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {reviewers.length > 0 && (
          <p className="text-[11px] text-muted">
            Sent to {reviewers.join(', ')}.{' '}
            {submitted ? 'Review submitted.' : 'Still open — more notes may arrive.'}
          </p>
        )}

        {/* Republished since the notes went out: the quoted wording may no longer exist. */}
        {stale && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              This manual has been republished since it was sent for review. Some notes may point
              at wording that has already changed.
            </span>
          </div>
        )}

        {counts.total > 0 && counts.open === 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <CheckCircle size={14} className="mt-0.5 shrink-0 text-emerald-600" />
            <span>Every note has been handled. Republish so the reviewer sees the changes.</span>
          </div>
        )}

        {counts.total === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">
            Send a review link from the Review step to collect supplier feedback here.
          </p>
        )}

        {groups.map(group => (
          <div key={group.sectionId}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-1 text-gray-500">
              <span className="min-w-0 truncate">{group.title}</span>
              <span className="text-gray-400">({group.comments.length})</span>
            </div>
            {group.orphaned && (
              <p className="text-[11px] text-amber-700 mb-1.5 leading-relaxed">
                This chapter is no longer in the manual — these notes can still be read, but not
                jumped to.
              </p>
            )}
            <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {group.comments.map(comment => {
                const active = comment.id === activeCommentId;
                const resolved = comment.status !== 'open';
                const busy = comment.id === busyCommentId;
                return (
                  <li key={comment.id} className={`${active ? 'bg-slate-100' : 'bg-white'} ${resolved ? 'opacity-60' : ''}`}>
                    <button
                      type="button"
                      onClick={() => !group.orphaned && onJump(comment)}
                      disabled={group.orphaned}
                      title={group.orphaned
                        ? 'The chapter this note points at is no longer in the manual'
                        : 'Open this chapter and highlight the quoted wording'}
                      className="group w-full text-left px-2.5 pt-2 pb-1.5 flex items-start gap-2 transition-colors hover:bg-light disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-1">
                          <span className="font-medium text-gray-600 truncate">{comment.authorName}</span>
                          <span>·</span>
                          <span>{relativeDay(comment.createdAt)}</span>
                        </div>
                        {comment.quote && (
                          <blockquote className="text-[11px] text-gray-500 italic border-l-2 border-gray-200 pl-2 mb-1">
                            {comment.quote}
                          </blockquote>
                        )}
                        <div className="text-xs text-gray-700 leading-snug whitespace-pre-wrap">{comment.body}</div>
                      </div>
                      {!group.orphaned && (
                        <ChevronRight size={13} className="mt-0.5 shrink-0 text-gray-300 group-hover:text-gray-600" />
                      )}
                    </button>

                    {/* Decision row. Status always carries a text label, never colour alone. */}
                    <div className="px-2.5 pb-2 flex items-center gap-1.5">
                      {comment.status === 'open' ? (
                        <>
                          <button
                            onClick={() => onSetStatus(comment.id, 'done')}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-emerald-700 border border-emerald-200 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                          ><Check size={11} /> Done</button>
                          <button
                            onClick={() => onSetStatus(comment.id, 'wont_fix')}
                            disabled={busy}
                            title="Acknowledge the note without changing the manual"
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-gray-500 border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
                          ><Ban size={11} /> Not changing</button>
                        </>
                      ) : (
                        <>
                          <span className={`flex items-center gap-1 text-[11px] font-medium ${
                            comment.status === 'done' ? 'text-emerald-700' : 'text-gray-500'
                          }`}>
                            {comment.status === 'done' ? <Check size={11} /> : <Ban size={11} />}
                            {comment.status === 'done' ? 'Done' : 'Not changing'}
                            {comment.resolvedBy && <span className="text-gray-400">· {comment.resolvedBy}</span>}
                          </span>
                          <button
                            onClick={() => onSetStatus(comment.id, 'open')}
                            disabled={busy}
                            title="Reopen this note"
                            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50"
                          ><Undo2 size={11} /> Reopen</button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};
