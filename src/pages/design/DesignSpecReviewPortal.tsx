/**
 * Public, unauthenticated supplier review portal for a Design Spec
 * (`/#/review/design-spec/:token`, and `/#/review/:token` when the token resolves to a spec).
 *
 * Same round as the Instruction Manual's, on the same shared shell — the name gate, the note
 * rail, attachments, replies and submit are all
 * `src/modules/review-portal/ReviewPortalShell.tsx`. What differs, and the only thing that
 * could not be shared, is the document and the anchor: a supplier reads a PDF here and marks
 * a place on a page, because a PDF has no chapters and no text this app controls.
 *
 * THE FILE ITSELF IS NEVER PUBLIC. `design-specs` is a private bucket with no storage
 * policies, so the page asks `design-spec-file` for a five-minute signed URL, presenting the
 * review token. That function checks the token is live AND is for this exact version, and
 * serves the DRAFT-STAMPED copy — never the design team's original. Revoking the link
 * therefore genuinely revokes the PDF, which a public bucket could not do.
 */
import React, { useCallback, useState, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ReviewPortalShell } from '../../modules/review-portal';
import { fetchDesignSpecFileByToken } from '../../services/design/design-spec-file.service';
import type { PdfReviewAnchor, ReviewSession } from '../../types/review.types';

/**
 * The canvas is code-split, and this is the only lazily-loaded component in the app.
 *
 * `PdfReviewCanvas` imports pdf.js at module scope, which puts ~350KB of it in whatever
 * chunk reaches it. Imported eagerly that is the MAIN chunk — downloaded by every user on
 * every page, including suppliers who only ever open a portal route, for a viewer almost
 * nobody opens. Splitting it here costs one Suspense boundary and keeps pdf.js out of the
 * critical path.
 */
const PdfReviewCanvas = React.lazy(() => import('../../modules/review-portal/PdfReviewCanvas'));

const DesignSpecReviewPortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  /**
   * Trade the review token for a signed URL before the surface renders.
   *
   * Done here rather than inside the canvas so a missing or unstamped file shows the shell's
   * one "unavailable" screen instead of a broken viewer — and so the canvas stays a pure
   * renderer that takes a URL.
   */
  const prepare = useCallback(async (session: ReviewSession): Promise<string | null> => {
    if (!token) return 'Invalid link.';
    if (!session.subjectId) {
      // A design_spec share always carries the version it is for — the database enforces it
      // (review_shares_subject_id_required). A round without one is a broken link, not an
      // empty document.
      return 'This review link is not attached to a document.';
    }
    try {
      const file = await fetchDesignSpecFileByToken(token, session.subjectId);
      setFileUrl(file.url);
      return null;
    } catch (e: any) {
      // The function's messages are written for this screen — a dead link, or a draft whose
      // stamped copy is still being prepared.
      console.error('[DesignSpecReviewPortal] could not get the file:', e);
      return e?.message ?? 'This design spec is currently unavailable.';
    }
  }, [token]);

  return (
    <ReviewPortalShell
      token={token}
      gateTitle="Review this design spec"
      loadingLabel="Loading design spec…"
      unavailableLabel="This design spec is currently unavailable. Please try again later."
      pickHint="Click anywhere on a page to leave a note there."
      bodyPlaceholder="What needs to change here?"
      prepare={prepare}
      surface={({ comments, composing, draftAnchor, startComment, focusedCommentId, focusComment }) => (
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
            />
          </Suspense>
        ) : null
      )}
    />
  );
};

export default DesignSpecReviewPortal;
