/**
 * The shared supplier-review module: links, notes, replies and triage for ANY reviewable
 * document (migration 162).
 *
 * Import from here when building a new reviewable subject. The Instruction Manual reaches
 * this same code through the thin adapters in `src/services/im/`, which keep the IM's own
 * vocabulary (templateType, manualVersion) for surfaces written before the generalization.
 *
 * NOT re-exported from `src/services/index.ts` on purpose: several names here
 * (`addReviewComment`, `listReviewCommentsByToken`, `getReviewComments`, `submitReview`)
 * are also exported from the IM adapters with IM-shaped types, and one flat barrel cannot
 * carry both. A new module imports `from '../../services/review'` directly.
 */

export {
  DEFAULT_SHARE_TTL_MS,
  mapShareRow,
  getReviewShares,
  createReviewShare,
  revokeReviewShare,
  revokeAllReviewShares,
  resolveShareToken,
  appUrl,
} from './review-share.service';
export type { CreateReviewShareOptions } from './review-share.service';

export {
  anchorFromRow,
  mapCommentRow,
  mapReplyRow,
  resolveReviewSession,
  listReviewCommentsByToken,
  listReviewRepliesByToken,
  addReviewComment,
  deleteReviewComment,
  addReviewReplyByToken,
  submitReview,
  reviewImageUrl,
  uploadReviewImage,
  getReviewComments,
  getReviewReplies,
  addReviewReply,
  setReviewCommentStatus,
  reviewRoundKey,
  getReviewRounds,
} from './review-comments.service';
export type { AddReviewCommentInput, ReviewRoundSummary } from './review-comments.service';
