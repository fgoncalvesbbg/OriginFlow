/**
 * Public, unauthenticated supplier review portal for an Instruction Manual
 * (`/#/review/im/:token`, and `/#/review/:token` when the token resolves to a manual).
 *
 * The first-party replacement for the Markup.io round: instead of marking up a PDF on
 * someone else's site, the supplier reads the ONLINE manual here — the same read-only
 * <IMViewer> the internal Viewer tab and the /share/im/ page render — selects the wording
 * that is wrong, and leaves a note.
 *
 * EVERYTHING THAT IS NOT THE MANUAL LIVES IN THE SHARED SHELL. The name gate, the note rail,
 * the composer, image attachments, replies, submit and the deliberately-vague "invalid or
 * revoked" screen are `src/modules/review-portal/ReviewPortalShell.tsx`, shared with the
 * Design Specs portal so a fix to any of them lands in both. What is left here is the only
 * part that is genuinely IM-specific: the viewer, and the TEXT anchor — a chapter plus the
 * wording the reviewer selected.
 */
import React, { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageSquarePlus } from 'lucide-react';
import { getPublishedManifestUrl } from '../../services';
import { resolvePublishedUrl } from '../../services/im/im-publish.service';
import { IMViewer, type ViewerSource, type ViewerTextSelection } from '../../modules/im-viewer';
import { ReviewPortalShell } from '../../modules/review-portal';
import type { IMTemplateType } from '../../types';
import type { ReviewSession, TextReviewAnchor } from '../../types/review.types';
import { buildReviewAnchor } from './review-anchor';

const IMReviewPortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  // Resolved from the session by `prepare` below, before the shell renders the surface.
  const [source, setSource] = useState<ViewerSource | null>(null);

  /**
   * A manual that was never published has no manifest to read, which is a real state — the
   * token is fine, the document is not there. Reported as an error string so the shell shows
   * it on the same screen as a dead link rather than rendering an empty viewer.
   */
  const prepare = useCallback(async (session: ReviewSession): Promise<string | null> => {
    const manifestUrl = getPublishedManifestUrl(
      session.projectId,
      session.subjectType as IMTemplateType,
    );
    if (!manifestUrl) return 'This manual is unavailable.';
    setSource({ manifestUrl });
    return null;
  }, []);

  return (
    <ReviewPortalShell
      token={token}
      gateTitle="Review this manual"
      loadingLabel="Loading manual…"
      unavailableLabel="This manual is currently unavailable. Please try again later."
      pickHint="Highlight any text in the manual to comment on it."
      prepare={prepare}
      surface={({ composing, startComment }) => (
        <IMSurface
          source={source}
          token={token}
          composing={composing}
          onStartComment={startComment}
        />
      )}
    />
  );
};

interface IMSurfaceProps {
  source: ViewerSource | null;
  token: string | undefined;
  composing: boolean;
  onStartComment: (anchor: TextReviewAnchor) => void;
}

/**
 * The manual, plus the floating "Comment on selection" affordance.
 *
 * The selection lives HERE rather than in the shell because the button is positioned against
 * the selection's own screen rectangle — a fact about a document the shell cannot see. The
 * shell is told only when the reviewer commits to commenting.
 */
const IMSurface: React.FC<IMSurfaceProps> = ({ source, token, composing, onStartComment }) => {
  const [selection, setSelection] = useState<ViewerTextSelection | null>(null);

  const onSelectText = useCallback((sel: ViewerTextSelection | null) => {
    setSelection(sel);
  }, []);

  const commit = () => {
    if (!selection) return;
    const anchor = buildReviewAnchor({
      sectionId: selection.sectionId,
      sectionTitle: selection.sectionTitle,
      sectionText: selection.sectionText,
      quote: selection.text,
    });
    // Null means there was nothing to anchor — a stray click collapsed the selection. Not an
    // error; the reviewer simply selects again.
    if (!anchor) return;
    onStartComment({
      kind: 'text',
      sectionId: anchor.sectionId,
      sectionTitle: anchor.sectionTitle,
      quote: anchor.quote,
      quoteBefore: anchor.quoteBefore,
      quoteAfter: anchor.quoteAfter,
    });
    setSelection(null);
  };

  if (!source) return null;

  return (
    <>
      {/* `im-published` is one of the two buckets closed off from permanent public URLs —
          every fetch the viewer makes is re-signed here, authorized by THIS review token. */}
      <IMViewer
        source={source}
        onSelectText={onSelectText}
        resolveUrl={(url) => resolvePublishedUrl(url, { portalToken: token as string })}
      />

      {/* Floats over the manual next to whatever the reviewer just highlighted. */}
      {selection && !composing && (
        <button
          onClick={commit}
          // Keep the browser from collapsing the selection when this is pressed: without it
          // the mousedown clears the highlight, the button unmounts on the next render, and
          // the click never lands on anything.
          onMouseDown={e => e.preventDefault()}
          style={{ top: Math.max(8, selection.rect.bottom + 8), left: Math.max(8, selection.rect.left) }}
          className="fixed z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium shadow-lg hover:bg-indigo-700 transition-colors"
        >
          <MessageSquarePlus size={13} /> Comment on selection
        </button>
      )}
    </>
  );
};

export default IMReviewPortal;
