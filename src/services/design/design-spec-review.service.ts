/**
 * Minting and revoking a design spec's review links.
 *
 * The link lifecycle itself — token, label, TTL, revoke, submitted stamp — is the shared
 * review layer's (`src/services/review/`), the same code the Instruction Manual uses. What
 * belongs here is the two things that are specific to a design spec: a round is per VERSION
 * rather than per document, and the reviewer's URL is /review/design-spec/.
 */

import { appUrl, createReviewShare, getReviewShares, revokeReviewShare } from '../review/review-share.service';
import type { ReviewShare } from '../../types/review.types';
import type { DesignSpec, DesignSpecVersion } from '../../types/design-spec.types';
import { designSpecSubject } from './design-spec.service';

/**
 * The reviewer's URL for a token (the app uses HashRouter).
 *
 * A separate route from the IM's on purpose: each portal renders a different document
 * surface, and choosing by URL avoids resolving the token twice — see the comment on the
 * routes in src/app/App.tsx.
 */
export const designSpecReviewUrl = (token: string): string =>
  appUrl(`/review/design-spec/${token}`);

/**
 * Send one version out for review.
 *
 * `label` is what makes several concurrent links tellable apart ("Factory A", "Packaging
 * vendor"), and it is the only way the board can say WHO is still outstanding — a round
 * closes only when every live link has been submitted.
 *
 * The TTL default (30 days) comes from the shared layer: omitting `expiresAt` gets it,
 * passing `null` explicitly means never. Both are honoured exactly as passed.
 */
export const sendDesignSpecForReview = async (
  spec: Pick<DesignSpec, 'projectId'>,
  version: Pick<DesignSpecVersion, 'id' | 'version'>,
  opts?: { label?: string; expiresAt?: string | null },
): Promise<ReviewShare> => createReviewShare(
  designSpecSubject(spec, version),
  opts && 'expiresAt' in opts
    ? { label: opts.label, expiresAt: opts.expiresAt, mode: 'review' }
    // Deliberately omits the key rather than passing undefined, so the shared module's
    // `'expiresAt' in opts` test still applies the 30-day default.
    : { label: opts?.label, mode: 'review' },
);

/** Live links for one version, most recent first. */
export const getDesignSpecReviewLinks = async (
  spec: Pick<DesignSpec, 'projectId'>,
  version: Pick<DesignSpecVersion, 'id' | 'version'>,
): Promise<ReviewShare[]> => getReviewShares(designSpecSubject(spec, version), 'review');

/** Revoke one link. The reviewer's URL — and the PDF behind it — stop resolving at once. */
export const revokeDesignSpecReviewLink = (id: string): Promise<void> => revokeReviewShare(id);
