/**
 * IM share links — the Instruction Manual's adapter over the shared review module.
 *
 * The implementation moved to `src/services/review/review-share.service.ts` in migration
 * 162, when `im_shares` became `review_shares` so the Design Specs module could run the
 * identical round. This file is what is left that is genuinely IM-specific:
 *
 *   * an IM round is addressed by (projectId, templateType) and has no per-version subject
 *     row, so `subject_id` is always null here — see migration 119 for why the IM has never
 *     used an FK to project_ims;
 *   * the IM's own field names (templateType, manualVersion) are kept on `IMShare` so the
 *     surfaces written before the generalization are untouched;
 *   * the /share/im/ and /review/im/ URLs.
 *
 * Add nothing else here. A rule that should hold for every reviewable document belongs in
 * the shared module, or the two will drift — which is the whole point of 162.
 */

import type { IMTemplateType, IMReviewStage } from '../../types';
import type { ReviewShare, ReviewSubject } from '../../types/review.types';
import {
  getReviewShares, createReviewShare, revokeReviewShare, resolveShareToken, appUrl,
  DEFAULT_SHARE_TTL_MS,
} from '../review/review-share.service';

export type IMShareMode = 'view' | 'review';

/** The subject an IM round belongs to: a manual, identified by project and template type. */
const imSubject = (
  projectId: string,
  templateType: IMTemplateType,
  manualVersion?: number | null,
): ReviewSubject => ({
  type: templateType,
  projectId,
  id: null,
  version: manualVersion ?? null,
});

export interface IMShare {
  id: string;
  token: string;
  projectId: string;
  templateType: IMTemplateType;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** Who revoked the link (audit trail). */
  revokedBy: string | null;
  /** Optional TTL — the public resolver stops honoring the token after this instant. */
  expiresAt: string | null;
  /** Free-text purpose/recipient ("DE distributor") so a list of links is tellable-apart. */
  label: string | null;
  /** When the public token was last successfully resolved. Null = never opened. */
  lastUsedAt: string | null;
  /** How many times the public token has been successfully resolved. */
  useCount: number;
  /**
   * 'view' = read-only shared manual (/#/share/im/:token). 'review' = supplier review portal
   * (/#/review/im/:token), which also collects comments. See db_migrations/130.
   */
  mode: IMShareMode;
  /** Set once a reviewer clicked "Submit review" on a review link. Null on view links. */
  submittedAt: string | null;
  /** Display name the reviewer submitted under (self-declared, unauthenticated). */
  submittedBy: string | null;
  /** project_ims.version when the link was minted — lets a later republish be spotted. */
  manualVersion: number | null;
  /**
   * Which workflow review step this link was sent as — 'draft' (Draft Review) or 'final'
   * (Final Review). Null on view-mode links and on rounds minted before migration 149.
   *
   * Immutable once minted: a link sent as a draft review stays a draft review in the
   * history even after the manual has moved on to its final round.
   */
  reviewStage: IMReviewStage | null;
}

/** Project the shared row onto the IM's own field names. */
const toIMShare = (s: ReviewShare): IMShare => ({
  id: s.id,
  token: s.token,
  projectId: s.projectId,
  templateType: s.subjectType as IMTemplateType,
  createdBy: s.createdBy,
  createdAt: s.createdAt,
  revokedAt: s.revokedAt,
  revokedBy: s.revokedBy,
  expiresAt: s.expiresAt,
  label: s.label,
  lastUsedAt: s.lastUsedAt,
  useCount: s.useCount,
  mode: s.mode as IMShareMode,
  submittedAt: s.submittedAt,
  submittedBy: s.submittedBy,
  manualVersion: s.subjectVersion,
  reviewStage: s.reviewStage as IMReviewStage | null,
});

/** True once the link's TTL has passed (the RPC also enforces this server-side). */
export const isShareExpired = (share: IMShare): boolean =>
  !!share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now();

/**
 * Active (non-revoked) share links for a manual, most recent first.
 *
 * `mode` is an optional filter: omit it to list both kinds (the Viewer tab shows one table),
 * pass one to list just read-only links or just review links.
 */
export const getIMShares = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
  mode?: IMShareMode,
): Promise<IMShare[]> => {
  const shares = await getReviewShares(imSubject(projectId, templateType), mode);
  return shares.map(toIMShare);
};

/**
 * Mint a new public share link for a manual, optionally labeled and with a TTL.
 *
 * `mode: 'review'` makes it a supplier review link instead of a read-only one; pass
 * `manualVersion` (the project_ims.version being sent out) alongside it so a later republish
 * is detectable as "reviewed against v3, now on v4", and `reviewStage` to say WHICH of the
 * workflow's two review steps this is (Draft Review or Final Review) — that is what moves
 * the manual's card into the right board column. Callers pick the default with
 * `nextReviewStageFor`; the send dialog lets the PM override it.
 *
 * `expiresAt` defaults to 30 days from now when the caller OMITS the option entirely. A
 * caller that explicitly passes `expiresAt` — including `null`, meaning "no expiry" (e.g.
 * the Viewer tab's "Never" choice) — is honored exactly as passed. The distinction between
 * an absent key and a present-but-null one is made in the shared module; see
 * DEFAULT_SHARE_TTL_MS there for why a `??` default would be a bug.
 */
export const createIMShare = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
  opts?: {
    label?: string;
    expiresAt?: string | null;
    mode?: IMShareMode;
    manualVersion?: number | null;
    reviewStage?: IMReviewStage | null;
  },
): Promise<IMShare> => {
  const created = await createReviewShare(
    imSubject(projectId, templateType, opts?.manualVersion),
    opts && 'expiresAt' in opts
      ? {
        label: opts.label,
        expiresAt: opts.expiresAt,
        mode: opts.mode,
        reviewStage: opts.reviewStage,
      }
      // Deliberately omits the key rather than passing undefined, so the shared module's
      // `'expiresAt' in opts` test still sees an absent key and applies the 30-day default.
      : { label: opts?.label, mode: opts?.mode, reviewStage: opts?.reviewStage },
  );
  return toIMShare(created);
};

/** Revoke a share link — the public URL stops resolving immediately. Records who revoked. */
export const revokeIMShare = (id: string): Promise<void> => revokeReviewShare(id);

/**
 * Resolve a public token to its (project, template type). Returns null for an unknown,
 * revoked or expired token.
 */
export const resolveIMShareToken = async (
  token: string,
): Promise<{ projectId: string; templateType: IMTemplateType } | null> => {
  const resolved = await resolveShareToken(token);
  if (!resolved) return null;
  return {
    projectId: resolved.projectId,
    templateType: resolved.subjectType as IMTemplateType,
  };
};

/** Build the public, shareable URL for a token (app uses HashRouter). */
export const getIMShareUrl = (token: string): string => appUrl(`/share/im/${token}`);

/**
 * Build the supplier review URL for a token. Separate page from getIMShareUrl because the
 * review portal adds the commenting rail on top of the same read-only viewer; a review token
 * still opens read-only at the /share/im/ URL, which is harmless.
 */
export const getIMReviewUrl = (token: string): string => appUrl(`/review/im/${token}`);

export { DEFAULT_SHARE_TTL_MS };
