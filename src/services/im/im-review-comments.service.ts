/**
 * IM supplier review notes — the Instruction Manual's adapter over the shared review module.
 *
 * The implementation moved to `src/services/review/review-comments.service.ts` in migration
 * 162, when `im_review_comments` became `review_comments` so the Design Specs module could
 * run the identical round. What is IM-specific and stays here:
 *
 *   * the flat `IMReviewComment` shape, whose anchor fields (sectionId, quote, …) sit at the
 *     top level because every IM surface was written against them before the anchor became
 *     a union. The shared module hands back `anchor: {kind:'text'|'pdf', …}`; this file
 *     flattens the text case for those callers;
 *   * (projectId, templateType) addressing, with no per-version subject row;
 *   * the IM's field names — templateType, manualVersion.
 *
 * Everything else — the RPC containment, the attachment upload, triage, the round summary —
 * is shared. Add new rules there, not here.
 */

import type { IMTemplateType } from '../../types';
import type {
  ReviewAttachment, ReviewComment, ReviewCommentStatus, ReviewSession, ReviewSubject,
} from '../../types/review.types';
import {
  resolveReviewSession,
  listReviewCommentsByToken as listSharedCommentsByToken,
  addReviewComment as addSharedComment,
  getReviewComments as getSharedComments,
  getReviewRounds,
  reviewRoundKey,
  deleteReviewComment, submitReview, reviewImageUrl, uploadReviewImage,
  setReviewCommentStatus,
} from '../review/review-comments.service';

export type { ReviewAttachment };
export type { ReviewRoundSummary } from '../review/review-comments.service';
export { deleteReviewComment, submitReview, reviewImageUrl, uploadReviewImage };
export { setReviewCommentStatus };

export type IMReviewCommentStatus = ReviewCommentStatus;

/** The subject an IM round belongs to. See the note in im-share.service.ts. */
const imSubject = (projectId: string, templateType: IMTemplateType): ReviewSubject => ({
  type: templateType,
  projectId,
  id: null,
});

export interface IMReviewComment {
  id: string;
  shareId: string;
  projectId: string;
  templateType: IMTemplateType;
  language: string;
  /** project_ims.version this note was written against — flags notes made before a republish. */
  manualVersion: number | null;
  /** im_sections.id, or a project-only 'proj-…' chapter id. */
  sectionId: string;
  /** Chapter title as it read when the note was made; survives a later rename or deletion. */
  sectionTitle: string | null;
  /** The exact wording the reviewer selected, whitespace-normalized. */
  quote: string | null;
  quoteBefore: string | null;
  quoteAfter: string | null;
  body: string;
  authorName: string;
  /** Images the reviewer attached, in the im-review-uploads bucket. */
  attachments: ReviewAttachment[];
  status: IMReviewCommentStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

/** What a valid review token resolves to. */
export interface IMReviewSession {
  shareId: string;
  projectId: string;
  templateType: IMTemplateType;
  /** The link's free-text purpose/recipient, shown to the reviewer so they know it's theirs. */
  label: string | null;
  /** Set once the reviewer has clicked "Submit review". */
  submittedAt: string | null;
  submittedBy: string | null;
  manualVersion: number | null;
  expiresAt: string | null;
}

/**
 * Flatten the shared note onto the IM's shape.
 *
 * A PDF-anchored note cannot appear on an IM round, so the non-text case falls back to an
 * empty chapter id rather than throwing: an unexpected row should render as an unanchored
 * note in the panel, not take the panel down.
 */
const toIMComment = (c: ReviewComment): IMReviewComment => {
  const text = c.anchor?.kind === 'text' ? c.anchor : null;
  return {
    id: c.id,
    shareId: c.shareId,
    projectId: c.projectId,
    templateType: c.subjectType as IMTemplateType,
    language: c.language,
    manualVersion: c.subjectVersion,
    sectionId: text?.sectionId ?? '',
    sectionTitle: text?.sectionTitle ?? null,
    quote: text?.quote ?? null,
    quoteBefore: text?.quoteBefore ?? null,
    quoteAfter: text?.quoteAfter ?? null,
    body: c.body,
    authorName: c.authorName,
    attachments: c.attachments,
    status: c.status,
    resolvedAt: c.resolvedAt,
    resolvedBy: c.resolvedBy,
    createdAt: c.createdAt,
  };
};

// ---------------------------------------------------------------------------
// Supplier side — anonymous, RPC-only, bearer token
// ---------------------------------------------------------------------------

/**
 * Resolve a review token to its manual. Returns null for a token that is unknown, revoked,
 * expired, or a plain 'view' share — the portal shows one "invalid or revoked" screen for all
 * of them on purpose, so a probe can't tell the cases apart.
 */
export const resolveReviewShare = async (token: string): Promise<IMReviewSession | null> => {
  const s: ReviewSession | null = await resolveReviewSession(token);
  if (!s) return null;
  return {
    shareId: s.shareId,
    projectId: s.projectId,
    templateType: s.subjectType as IMTemplateType,
    label: s.label,
    submittedAt: s.submittedAt,
    submittedBy: s.submittedBy,
    manualVersion: s.subjectVersion,
    expiresAt: s.expiresAt,
  };
};

/** This link's own notes, oldest first. Never another reviewer's — the RPC scopes by share. */
export const listReviewCommentsByToken = async (token: string): Promise<IMReviewComment[]> => {
  const rows = await listSharedCommentsByToken(token);
  return rows.map(toIMComment);
};

export interface AddReviewCommentInput {
  sectionId: string;
  sectionTitle?: string | null;
  quote?: string | null;
  quoteBefore?: string | null;
  quoteAfter?: string | null;
  body: string;
  authorName: string;
  /** Already uploaded (see uploadReviewImage) — this only records the paths on the note. */
  attachments?: ReviewAttachment[];
}

/**
 * Leave a note. The RPC derives share/project/template/version from the token itself and
 * enforces the length and per-link volume caps, so its errors are user-facing: surface the
 * message rather than a generic failure.
 */
export const addReviewComment = async (
  token: string,
  input: AddReviewCommentInput,
): Promise<IMReviewComment> => {
  const created = await addSharedComment(token, {
    anchor: {
      kind: 'text',
      sectionId: input.sectionId,
      sectionTitle: input.sectionTitle ?? null,
      quote: input.quote ?? null,
      quoteBefore: input.quoteBefore ?? null,
      quoteAfter: input.quoteAfter ?? null,
    },
    body: input.body,
    authorName: input.authorName,
    attachments: input.attachments,
  });
  return toIMComment(created);
};

// ---------------------------------------------------------------------------
// PM side — authenticated, direct table access under the "Scoped all" policy
// ---------------------------------------------------------------------------

/** Every reviewer's notes on a manual, oldest first. */
export const getReviewComments = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<IMReviewComment[]> => {
  const rows = await getSharedComments(imSubject(projectId, templateType));
  return rows.map(toIMComment);
};

/**
 * Review round per manual, across ALL projects — the dashboard's supplier-feedback signal.
 *
 * Keyed `${projectId}::${templateType}`, matching stalenessKey so the dashboard can reuse
 * it. Restricted to the two IM template types so a design spec round can never land in the
 * IM dashboard's map.
 */
export const getReviewRoundsByManual = () => getReviewRounds(['im', 'warning_leaflet']);

export { reviewRoundKey };
