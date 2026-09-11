/**
 * Every review link sent out for one document, and what became of it.
 *
 * WHY THIS IS ONE COMPONENT AND NOT TWO
 * -------------------------------------
 * "What did we send the supplier, and did they open it" gets asked in two places — inside
 * the IM editor, where the PM is working the notes, and on the project page, where someone
 * who is not the PM is asking whether the round is moving. Those were answerable in neither:
 * the editor showed only the notes that had already arrived (so a link nobody had opened
 * looked exactly like a supplier with nothing to say), and the project page showed no links
 * at all. Rendering them from one component is what stops the two growing different
 * vocabularies for the same five states — the same reason the round itself is shared code.
 *
 * The status word comes from `reviewLinkStatusOf`, never from re-reading the columns here;
 * see that module for why revoked/expired outrank submitted.
 *
 * REVOKED LINKS ARE LISTED, dimmed, when the caller passes them. A link that was pulled back
 * is the answer to "why can't the supplier open what you sent me", so hiding it would hide
 * the explanation. Callers that derive round state still ask for live links only.
 *
 * Holds no business rules and does no loading: links arrive ready, and copy/revoke go back
 * out through callbacks.
 */

import React, { useState } from 'react';
import { Copy, Check, ExternalLink, Ban, Loader2, Clock, User as UserIcon } from 'lucide-react';
import { reviewLinkStatusOf, type ReviewLinkStatusRef } from '../../services/review';
import type { ReviewStage } from '../../types/review.types';

/** The bit of a share row this component renders. Structural: IMShare and ReviewShare fit. */
export interface ReviewLinkRef extends ReviewLinkStatusRef {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Version of the document the link was minted against, for "reviewed against v3". */
  version: number | null;
  /** Which review pass, when the document has passes. Null on view links and old rows. */
  stage: ReviewStage | null;
}

const TONE_CLS: Record<string, string> = {
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

interface ReviewLinkListProps {
  links: readonly ReviewLinkRef[];
  /** Public URL for a link. Differs per document type, so the caller builds it. */
  urlOf: (link: ReviewLinkRef) => string;
  /** Human name for a stage, e.g. IM_REVIEW_STAGE_LABELS. Omit to not show stages. */
  stageLabel?: (stage: ReviewStage) => string;
  /** Omit to render read-only — the project page lists links, it does not manage them. */
  onRevoke?: (link: ReviewLinkRef) => void;
  /** Id currently being revoked, so its row can show progress. */
  revokingId?: string | null;
  /** Shown in place of the list when there is nothing to show. */
  emptyLabel?: string;
  /** Tighter rows for the docked editor panel, which is 23rem wide. */
  dense?: boolean;
}

export const ReviewLinkList: React.FC<ReviewLinkListProps> = ({
  links, urlOf, stageLabel, onRevoke, revokingId = null,
  emptyLabel = 'No review links have been sent for this document yet.',
  dense = false,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Two-step revoke: the first click arms the row, the second one does it. A link is the
  // supplier's only way in, so losing it to a stray click is not recoverable — the round
  // has to be re-sent and the reviewer told why.
  const [armedId, setArmedId] = useState<string | null>(null);

  const copy = async (link: ReviewLinkRef) => {
    try {
      await navigator.clipboard.writeText(urlOf(link));
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 2000);
    } catch {
      // Clipboard is blocked in some browsers/contexts. The URL is in the row's title
      // attribute and Open still works, so this is a downgrade, not a failure worth an alert.
    }
  };

  if (links.length === 0) {
    return <p className={`${dense ? 'text-[11px]' : 'text-xs'} text-gray-400`}>{emptyLabel}</p>;
  }

  return (
    <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
      {links.map((link) => {
        const status = reviewLinkStatusOf(link);
        const url = urlOf(link);
        const armed = armedId === link.id;
        const revoking = revokingId === link.id;
        return (
          <li key={link.id} className={`px-2.5 py-2 bg-white ${status.live ? '' : 'opacity-60'}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`${dense ? 'text-[11px]' : 'text-xs'} font-semibold text-gray-700 truncate max-w-full`}>
                    {link.label || 'Unlabelled link'}
                  </span>
                  {stageLabel && link.stage && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                      {stageLabel(link.stage)}
                    </span>
                  )}
                  {link.version != null && (
                    <span className="text-[10px] text-gray-400">v{link.version}</span>
                  )}
                  {/* Status always carries its word, never colour alone. */}
                  <span
                    title={status.hint}
                    className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${TONE_CLS[status.tone]}`}
                  >
                    {status.label}
                  </span>
                </div>

                <div className="text-[11px] text-gray-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    <time dateTime={link.createdAt}>{new Date(link.createdAt).toLocaleDateString()}</time>
                  </span>
                  {link.createdBy && (
                    <span className="flex items-center gap-1 truncate max-w-[12rem]" title={link.createdBy}>
                      <UserIcon size={10} /> {link.createdBy}
                    </span>
                  )}
                  {/* The access log (migration 109) is the only evidence a link was ever
                      delivered — OriginFlow sends no email, so "never opened" is as often a
                      link nobody passed on as a supplier who is ignoring it. */}
                  {link.useCount > 0 && link.lastUsedAt && (
                    <span>opened {link.useCount}× · last {new Date(link.lastUsedAt).toLocaleDateString()}</span>
                  )}
                  {link.submittedAt && (
                    <span className="text-emerald-700">
                      submitted {new Date(link.submittedAt).toLocaleDateString()}
                    </span>
                  )}
                  {link.revokedAt
                    ? <span>revoked {new Date(link.revokedAt).toLocaleDateString()}</span>
                    : link.expiresAt && (
                      <span>
                        {status.key === 'expired' ? 'expired' : 'expires'}{' '}
                        {new Date(link.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void copy(link)}
                  title={url}
                  className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-50"
                  aria-label="Copy this link"
                >
                  {copiedId === link.id ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                </button>
                {/* Opening a dead link only shows the portal's "invalid or revoked" screen,
                    so the action is dropped rather than left to disappoint. */}
                {status.live && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the reviewer's view"
                    className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-50"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
                {onRevoke && status.live && (
                  <button
                    type="button"
                    onClick={() => { if (armed) { setArmedId(null); onRevoke(link); } else setArmedId(link.id); }}
                    onBlur={() => setArmedId((id) => (id === link.id ? null : id))}
                    disabled={revoking}
                    title="Revoke this link — the supplier loses access immediately"
                    className={`flex items-center gap-1 text-[11px] px-1.5 py-1 rounded border transition-colors disabled:opacity-50 ${
                      armed
                        ? 'border-rose-400 bg-rose-600 text-white hover:bg-rose-700'
                        : 'border-transparent text-rose-500 hover:bg-rose-50'
                    }`}
                  >
                    {revoking ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                    {armed && 'Confirm'}
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
