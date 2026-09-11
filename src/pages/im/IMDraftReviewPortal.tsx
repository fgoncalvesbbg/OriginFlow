/**
 * Public, unauthenticated markup portal for a supplier's draft manual
 * (`/#/review/im-draft/:token`) — migration 179.
 *
 * WHO IS ON THE OTHER SIDE, AND WHY IT RUNS BACKWARDS. Every other round on this shell sends
 * OUR document out for someone else to read. This one is the opposite: the supplier wrote
 * the document and Quality is marking it up, before a technical writer has started anything.
 * The mechanics are identical — which is the point of the shared review layer — but the
 * roles are swapped, so the wording here talks about "this draft" rather than "your review".
 *
 * The surface is the same PDF canvas the design-spec round uses, because a supplier's draft
 * is a PDF with no chapters and no text this app controls. A note is a pin on a page.
 *
 * THE FILE ITSELF IS NEVER PUBLIC. `im-drafts` is a private bucket with no storage policies,
 * so the page asks `/api/im-draft/file` for a five-minute signed URL, presenting the review
 * token. That function checks the token is live AND that it is for this exact upload —
 * without that equality any live review token in the system, including a design spec's,
 * would unlock this PDF. Revoking the link therefore genuinely revokes the file, which a
 * public bucket could not do.
 *
 * NOTHING HERE BLOCKS A WRITER. Submitting ends the intake and puts the project in Backlog
 * with this draft and these notes attached as the brief — a better starting point, not a
 * gate. The writer could always have started without it.
 */
import React, { useCallback, useState, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ReviewPortalShell } from '../../modules/review-portal';
import { fetchDraftFileByToken } from '../../services/im/im-draft.service';
import type { PdfReviewAnchor, ReviewSession } from '../../types/review.types';

/**
 * The canvas is code-split — see the note in DesignSpecReviewPortal. `PdfReviewCanvas`
 * imports pdf.js at module scope, and eagerly importing it would put ~350KB of it in the
 * main chunk for every user of the app, including suppliers who only ever open a portal.
 */
const PdfReviewCanvas = React.lazy(() => import('../../modules/review-portal/PdfReviewCanvas'));

const IMDraftReviewPortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  /**
   * Trade the review token for a signed URL before the surface renders, so a dead link shows
   * the shell's one "unavailable" screen rather than a broken viewer — and so the canvas
   * stays a pure renderer that takes a URL.
   */
  const prepare = useCallback(async (session: ReviewSession): Promise<string | null> => {
    if (!token) return 'Invalid link.';
    if (!session.subjectId) {
      // An im_draft share always carries the upload it is for — the commit endpoint sets it
      // in the same insert. A round without one is a broken link, not an empty document.
      return 'This link is not attached to a draft.';
    }
    try {
      const file = await fetchDraftFileByToken(token, session.subjectId);
      setFileUrl(file.url);
      return null;
    } catch (e: any) {
      console.error('[IMDraftReviewPortal] could not get the file:', e);
      return e?.message ?? 'This draft is currently unavailable.';
    }
  }, [token]);

  return (
    <ReviewPortalShell
      token={token}
      gateTitle="Review this draft manual"
      loadingLabel="Loading draft…"
      unavailableLabel="This draft is currently unavailable. Please try again later."
      pickHint="Click anywhere on a page to leave a note there."
      bodyPlaceholder="What needs to change before we write the manual?"
      prepare={prepare}
      surface={({ comments, priorComments, composing, draftAnchor, startComment, focusedCommentId, focusComment }) => (
        fileUrl ? (
          <Suspense fallback={
            <div className="h-full flex items-center justify-center bg-gray-100 text-gray-400 gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading viewer…
            </div>
          }>
            <PdfReviewCanvas
              fileUrl={fileUrl}
              comments={comments}
              composing={composing}
              // The shell's anchor is the union; only a pin can reach this surface.
              draftAnchor={draftAnchor?.kind === 'pdf' ? draftAnchor : null}
              onDropPin={(anchor: PdfReviewAnchor) => startComment(anchor)}
              focusedCommentId={focusedCommentId}
              onFocusComment={focusComment}
              // Notes from the round on the PREVIOUS version of this draft, when the supplier
              // has re-uploaded and the link was chained. Hollow rings, on the pages they
              // were made against.
              ghostComments={priorComments}
            />
          </Suspense>
        ) : null
      )}
    />
  );
};

export default IMDraftReviewPortal;
