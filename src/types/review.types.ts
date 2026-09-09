/**
 * Supplier review round — the vocabulary shared by every reviewable document.
 *
 * This started life as the Instruction Manual's replacement for Markup.io (migrations
 * 130/131/132) and was IM-shaped throughout: `im_shares`, `template_type`,
 * `manual_version`. Migration 162 renamed that layer to `review_shares` / `review_comments`
 * because the Design Specs module needs the identical round — a labelled, expiring,
 * revocable link; anonymous notes written through token-resolving RPCs; image attachments;
 * a submit that closes the round; and PM-side triage — and the requirement is that both run
 * on ONE implementation so a fix lands in both.
 *
 * THE ONE THING THAT COULD NOT BE SHARED IS THE ANCHOR. An IM note points at a chapter plus
 * the wording the reviewer selected, because the reviewer is reading HTML this app rendered
 * and can select it. A Design Spec is a PDF: there are no chapters and no text we control,
 * so a note points at a page and a position on it. Hence `ReviewAnchor` is a discriminated
 * union rather than a widened record — a note has one anchor or the other, never a mixture
 * of half-null fields, and `review_comments_one_anchor` enforces the same thing in the
 * database.
 */

/**
 * What is under review. 'im' and 'warning_leaflet' are the two IM template types (they are
 * published separately and reviewed separately); 'design_spec' is a PDF.
 *
 * Not a CHECK constraint in the database — house style there is TEXT with a constraint only
 * where a wrong value would corrupt meaning, and this column is written by this file alone.
 */
export type ReviewSubjectType = 'im' | 'warning_leaflet' | 'design_spec';

/**
 * 'view' = a read-only share link. 'review' = the portal that also collects notes.
 * Every RPC in the review layer filters on `mode = 'review'`, so a view token can never
 * write a note even though both kinds live in one table.
 */
export type ReviewShareMode = 'view' | 'review';

/** Which review pass a round is. Immutable once the link is minted. */
export type ReviewStage = 'draft' | 'final';

export type ReviewCommentStatus = 'open' | 'done' | 'wont_fix';

/**
 * Which document a round belongs to.
 *
 * `id` is the reviewed row for subjects that have one — a `design_spec_versions.id`. It is
 * null for an IM, which this module has always addressed by (projectId, type) and not by an
 * FK to `project_ims` (migration 119 records why). `version` is what makes "reviewed against
 * v2, now on v3" detectable after a republish or a re-upload.
 */
export interface ReviewSubject {
  type: ReviewSubjectType;
  projectId: string;
  id?: string | null;
  version?: number | null;
}

/** One image attached to a note, as stored in `review_comments.attachments`. */
export interface ReviewAttachment {
  /** Object path in the review-uploads bucket: `<share_id>/<uuid>.<ext>`. */
  path: string;
  width: number;
  height: number;
}

/** A note on rendered text: the chapter it sits in, plus the exact wording selected. */
export interface TextReviewAnchor {
  kind: 'text';
  /** `im_sections.id`, or a project-only 'proj-…' chapter id. */
  sectionId: string;
  /** Chapter title as it read when the note was made; survives a later rename. */
  sectionTitle: string | null;
  /** The reviewer's selection, whitespace-normalized. Null for a chapter-level note. */
  quote: string | null;
  quoteBefore: string | null;
  quoteAfter: string | null;
}

/**
 * A note on a PDF page.
 *
 * Coordinates are FRACTIONS of the page (0..1), not points. A normalised pin lands in the
 * same place whatever zoom the reviewer used, whatever scale the page was rendered at, and
 * whatever size the page is — an absolute offset would drift on all three. `w`/`h` are set
 * only when the reviewer dragged a region instead of dropping a point.
 */
export interface PdfReviewAnchor {
  kind: 'pdf';
  /** 1-based page number. */
  page: number;
  x: number;
  y: number;
  w: number | null;
  h: number | null;
}

export type ReviewAnchor = TextReviewAnchor | PdfReviewAnchor;

/** True when this anchor points at a PDF page rather than at rendered text. */
export const isPdfAnchor = (a: ReviewAnchor): a is PdfReviewAnchor => a.kind === 'pdf';

/** A share or review link. */
export interface ReviewShare {
  id: string;
  token: string;
  projectId: string;
  subjectType: ReviewSubjectType;
  subjectId: string | null;
  /** Version the link was minted against, so a later republish/re-upload is detectable. */
  subjectVersion: number | null;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  /** TTL. The resolver stops honoring the token after this instant, server-side. */
  expiresAt: string | null;
  /** Free-text purpose/recipient ("Factory A") so a list of links is tellable-apart. */
  label: string | null;
  lastUsedAt: string | null;
  useCount: number;
  mode: ReviewShareMode;
  /**
   * The link this one is the next round of — same recipient, later version (migration 169).
   *
   * Null for a first round. It is what lets a returning reviewer be shown their OWN earlier
   * notes and nobody else's: access follows the chain of links a recipient was given, never
   * "every note on this document", which would hand Factory A everything Factory B wrote.
   */
  supersedesId: string | null;
  /** Set once a reviewer pressed "Submit review". Null on view links. */
  submittedAt: string | null;
  /** Display name the reviewer submitted under — self-declared, NOT authentication. */
  submittedBy: string | null;
  reviewStage: ReviewStage | null;
}

/** One note. */
export interface ReviewComment {
  id: string;
  shareId: string;
  projectId: string;
  subjectType: ReviewSubjectType;
  subjectId: string | null;
  subjectVersion: number | null;
  language: string;
  /**
   * Null only for a row that satisfies neither anchor shape, which the database forbids —
   * kept nullable so a future anchor kind cannot crash an old client.
   */
  anchor: ReviewAnchor | null;
  body: string;
  authorName: string;
  attachments: ReviewAttachment[];
  status: ReviewCommentStatus;
  /**
   * The version this note was last TRIAGED against (migration 169) — for a design spec, a
   * `design_spec_versions.id`. Null means nobody has looked at it again since it was written.
   *
   * This is the difference `status` alone cannot express. An open note that nobody has
   * re-checked and an open note confirmed still wrong on the newest version look identical
   * without it, and the whole point of carrying a round forward is telling those apart.
   */
  checkedSubjectId: string | null;
  checkedSubjectVersion: number | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

/** An in-thread answer to a note. */
export interface ReviewReply {
  id: string;
  commentId: string;
  body: string;
  authorName: string;
  /** Set for an internal reply; null when written by an unauthenticated reviewer. */
  authorUserId: string | null;
  createdAt: string;
}

/** What a valid review token resolves to. */
export interface ReviewSession {
  shareId: string;
  projectId: string;
  subjectType: ReviewSubjectType;
  subjectId: string | null;
  subjectVersion: number | null;
  label: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  expiresAt: string | null;
}

/** True once the link's TTL has passed. The RPCs enforce this server-side as well. */
export const isReviewShareExpired = (share: ReviewShare): boolean =>
  !!share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now();
