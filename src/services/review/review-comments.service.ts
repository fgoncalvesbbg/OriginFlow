/**
 * Review notes and replies — one implementation for every reviewable document.
 *
 * Two audiences, two access paths, and the split is the security model:
 *
 *  - The REVIEWER half is unauthenticated. It goes through `portalDb`, and through RPCs
 *    only — `portalDb` is documented as never being allowed to touch a table directly, and
 *    `review_comments` deliberately has no anon policy. Each RPC re-resolves the bearer
 *    token server-side, so the caller cannot say which document a note belongs to, which
 *    version it was written against, or whose share it lands on.
 *  - The INTERNAL half is a normal authenticated read/write under the table's "Scoped all"
 *    policy (`can_see_project(project_id)` — note this is the LIVE policy, not the "Auth
 *    all" that migrations 84/131 describe).
 *
 * Nothing here knows what an IM or a design spec is. The anchor arrives as a
 * `ReviewAnchor` union and is flattened onto the wire only at the RPC boundary.
 */

import { auth, db, portalDb, storage, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type {
  ReviewAnchor, ReviewAttachment, ReviewComment, ReviewCommentStatus, ReviewReply,
  ReviewSession, ReviewSubject, ReviewSubjectType,
} from '../../types/review.types';

/**
 * Public bucket the review images live in (migration 132).
 *
 * Still named for the IM because renaming a Storage bucket moves every object in it, and
 * the objects are referenced by path from live notes. The bucket is shared by both modules;
 * only its name is historical.
 */
const REVIEW_UPLOAD_BUCKET = 'im-review-uploads';

/**
 * Rebuild the anchor union from a row.
 *
 * A page wins over a chapter if a row somehow carries both — the database forbids it
 * (`review_comments_one_anchor`), and preferring one deterministically beats returning a
 * half-populated shape.
 */
export const anchorFromRow = (row: any): ReviewAnchor | null => {
  if (row.page != null) {
    return {
      kind: 'pdf',
      page: Number(row.page),
      x: Number(row.anchor_x),
      y: Number(row.anchor_y),
      w: row.anchor_w != null ? Number(row.anchor_w) : null,
      h: row.anchor_h != null ? Number(row.anchor_h) : null,
    };
  }
  if (row.section_id != null) {
    return {
      kind: 'text',
      sectionId: row.section_id,
      sectionTitle: row.section_title ?? null,
      quote: row.quote ?? null,
      quoteBefore: row.quote_before ?? null,
      quoteAfter: row.quote_after ?? null,
    };
  }
  return null;
};

export const mapCommentRow = (row: any): ReviewComment => ({
  id: row.id,
  shareId: row.share_id,
  projectId: row.project_id,
  subjectType: (row.subject_type ?? 'im') as ReviewSubjectType,
  subjectId: row.subject_id ?? null,
  subjectVersion: row.subject_version ?? null,
  language: row.language ?? 'en',
  anchor: anchorFromRow(row),
  body: row.body,
  authorName: row.author_name,
  // Defaulted rather than trusted: rows written before migration 132 have no column, and a
  // hand-edited value could be any JSON shape.
  attachments: Array.isArray(row.attachments) ? (row.attachments as ReviewAttachment[]) : [],
  status: (row.status ?? 'open') as ReviewCommentStatus,
  checkedSubjectId: row.checked_subject_id ?? null,
  checkedSubjectVersion: row.checked_subject_version ?? null,
  resolvedAt: row.resolved_at ?? null,
  resolvedBy: row.resolved_by ?? null,
  createdAt: row.created_at,
});

export const mapReplyRow = (row: any): ReviewReply => ({
  id: row.id,
  commentId: row.comment_id,
  body: row.body,
  authorName: row.author_name,
  authorUserId: row.author_user_id ?? null,
  createdAt: row.created_at,
});

/** Flatten an anchor onto the RPC's parameter shape. Exactly one half is ever populated. */
const anchorParams = (anchor: ReviewAnchor) => anchor.kind === 'pdf'
  ? {
    p_section_id: null, p_section_title: null,
    p_quote: null, p_quote_before: null, p_quote_after: null,
    p_page: anchor.page,
    p_anchor_x: anchor.x, p_anchor_y: anchor.y,
    p_anchor_w: anchor.w ?? null, p_anchor_h: anchor.h ?? null,
  }
  : {
    p_section_id: anchor.sectionId,
    p_section_title: anchor.sectionTitle ?? null,
    p_quote: anchor.quote ?? null,
    p_quote_before: anchor.quoteBefore ?? null,
    p_quote_after: anchor.quoteAfter ?? null,
    p_page: null, p_anchor_x: null, p_anchor_y: null, p_anchor_w: null, p_anchor_h: null,
  };

// ---------------------------------------------------------------------------
// Reviewer side — anonymous, RPC-only, bearer token
// ---------------------------------------------------------------------------

/**
 * Resolve a review token to its subject. Returns null for a token that is unknown, revoked,
 * expired, or a plain 'view' share — the portal shows ONE "invalid or revoked" screen for
 * all of them on purpose, so a probe cannot tell the cases apart.
 *
 * Resolving also stamps last_used_at / use_count server-side, so opening the portal is
 * logged.
 */
export const resolveReviewSession = async (token: string): Promise<ReviewSession | null> => {
  if (!isLive) return null;
  let data: Row | Row[] | null;
  try {
    data = await portalDb.rpc<Row | Row[] | null>('review_resolve', { p_token: token });
  } catch (e) {
    console.error('[resolveReviewSession] error:', e);
    return null;
  }
  const row: any = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    shareId: row.share_id,
    projectId: row.project_id,
    subjectType: (row.subject_type ?? 'im') as ReviewSubjectType,
    subjectId: row.subject_id ?? null,
    subjectVersion: row.subject_version ?? null,
    label: row.label ?? null,
    submittedAt: row.submitted_at ?? null,
    submittedBy: row.submitted_by ?? null,
    expiresAt: row.expires_at ?? null,
  };
};

/** This link's own notes, oldest first. Never another reviewer's — the RPC scopes by share. */
export const listReviewCommentsByToken = async (token: string): Promise<ReviewComment[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    portalDb.rpc<Row[]>('review_list_comments', { p_token: token }),
    '[listReviewCommentsByToken]',
  );
  return rows.map(mapCommentRow);
};

/**
 * What this reviewer said in EARLIER rounds of their own chain of links (migration 169).
 *
 * Separate from `listReviewCommentsByToken` on purpose, and not a widening of it: these notes
 * are anchored to a version that is not the one on screen, and the portal must render them
 * read-only rather than mixed into the live rail where Delete and Reply sit. Empty for a
 * first round, and empty for every link minted before rounds were chained.
 */
export const listPriorReviewCommentsByToken = async (token: string): Promise<ReviewComment[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    portalDb.rpc<Row[]>('review_list_prior_comments', { p_token: token }),
    '[listPriorReviewCommentsByToken]',
  );
  return rows.map(mapCommentRow);
};

/** Replies on this link's own notes, so the reviewer sees the team's answers on return. */
export const listReviewRepliesByToken = async (token: string): Promise<ReviewReply[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    portalDb.rpc<Row[]>('review_list_replies', { p_token: token }),
    '[listReviewRepliesByToken]',
  );
  return rows.map(mapReplyRow);
};

export interface AddReviewCommentInput {
  anchor: ReviewAnchor;
  body: string;
  authorName: string;
  /** Already uploaded (see `uploadReviewImage`) — this only records the paths on the note. */
  attachments?: ReviewAttachment[];
}

/**
 * Leave a note.
 *
 * The RPC derives share/project/subject/version from the token itself and enforces the
 * length, anchor-shape and per-link volume rules, so its errors are written FOR the reviewer
 * ("too long", "link revoked"). Surface the message rather than a generic failure.
 */
export const addReviewComment = async (
  token: string,
  input: AddReviewCommentInput,
): Promise<ReviewComment> => {
  const row = await portalDb.rpc<Row | Row[]>('review_add_comment', {
    p_token: token,
    p_author_name: input.authorName,
    p_body: input.body,
    ...anchorParams(input.anchor),
    p_attachments: input.attachments ?? [],
  });
  return mapCommentRow(Array.isArray(row) ? row[0] : row);
};

/** Retract one's own note. False when the team has already acted on it, or the link is dead. */
export const deleteReviewComment = async (token: string, commentId: string): Promise<boolean> => {
  const ok = await portalDb.rpc<boolean>('review_delete_comment', {
    p_token: token,
    p_comment_id: commentId,
  });
  return ok === true;
};

/** Reply into a thread from the reviewer's side. Scoped to notes on their own share. */
export const addReviewReplyByToken = async (
  token: string,
  commentId: string,
  body: string,
  authorName: string,
): Promise<ReviewReply> => {
  const row = await portalDb.rpc<Row | Row[]>('review_add_reply', {
    p_token: token,
    p_comment_id: commentId,
    p_body: body,
    p_author_name: authorName,
  });
  return mapReplyRow(Array.isArray(row) ? row[0] : row);
};

/**
 * Mark the round finished. Idempotent server-side — the first submission's timestamp stands,
 * so a reviewer who keeps commenting afterwards does not restart the round.
 */
export const submitReview = async (token: string, authorName: string): Promise<string> =>
  portalDb.rpc<string>('review_submit', { p_token: token, p_author_name: authorName });

/**
 * Public URL of an attached review image. Synchronous string-building against a public
 * bucket, so it costs nothing and works for the anonymous reviewer and the team alike.
 */
export const reviewImageUrl = (path: string): string =>
  storage.publicUrl(REVIEW_UPLOAD_BUCKET, path);

/**
 * Upload one already-downscaled image for a review note.
 *
 * Two steps, and the split is the security model: a Netlify function validates the review
 * token with the service role and mints a one-shot signed upload URL for a path IT chooses
 * (`<share_id>/<uuid>.<ext>`), then the browser PUTs the bytes straight to Storage. The
 * bucket has no anon INSERT policy — the signed URL is the only way in.
 *
 * Errors carry the server's message: they are written for the reviewer ("too large", "link
 * revoked"), and a generic failure would hide which rule was hit.
 */
export const uploadReviewImage = async (
  token: string,
  blob: Blob,
  contentType: string,
  size: { width: number; height: number },
): Promise<ReviewAttachment> => {
  const res = await fetch('/.netlify/functions/review-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, contentType }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'Could not prepare the image upload.');
  }
  const { path, signedUrl } = (await res.json()) as { path: string; signedUrl: string };

  // Straight to Storage with the signed URL. Deliberately NOT through the storage port:
  // that port authenticates as the current session, and there isn't one here — the signed
  // URL is the whole authorization.
  const put = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: blob,
    signal: AbortSignal.timeout(120_000),
  });
  if (!put.ok) {
    // 413 is the bucket's own file_size_limit rejecting it — worth saying plainly, because
    // the fix (a smaller image) is the reviewer's to make.
    throw new Error(put.status === 413
      ? 'That image is too large to attach.'
      : 'Uploading the image failed. Please try again.');
  }

  return { path, width: size.width, height: size.height };
};

// ---------------------------------------------------------------------------
// Internal side — authenticated, direct table access under "Scoped all"
// ---------------------------------------------------------------------------

/** Every reviewer's notes on a subject, oldest first. */
export const getReviewComments = async (subject: ReviewSubject): Promise<ReviewComment[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('review_comments', {
      where: {
        project_id: subject.projectId,
        subject_type: subject.type,
        ...(subject.id ? { subject_id: subject.id } : {}),
      },
      order: { column: 'created_at', ascending: true },
    }),
    '[getReviewComments]',
  );
  return rows.map(mapCommentRow);
};

/** Replies on a set of notes, oldest first. Empty ids short-circuit to no query. */
export const getReviewReplies = async (commentIds: readonly string[]): Promise<ReviewReply[]> => {
  if (!isLive || commentIds.length === 0) return [];
  const rows = await orEmpty(
    db.select<Row>('review_replies', {
      where: { comment_id: { op: 'in', value: [...commentIds] } },
      order: { column: 'created_at', ascending: true },
    }),
    '[getReviewReplies]',
  );
  return rows.map(mapReplyRow);
};

/** Answer a note as an internal user. The reviewer sees it on their next visit. */
export const addReviewReply = async (commentId: string, body: string): Promise<ReviewReply> => {
  const user = await auth.getUser();
  const created = await db.insert<Row>('review_replies', {
    comment_id: commentId,
    body: body.trim(),
    author_name: user?.email ?? user?.id ?? 'Internal',
    author_user_id: user?.id ?? null,
  });
  return mapReplyRow(created);
};

/**
 * Triage one note. Moving it off 'open' stamps who closed it and when; moving it back to
 * 'open' clears both, so the audit trail never claims a still-open note was resolved.
 *
 * `checkedAgainst` records WHICH version the person was looking at when they decided
 * (migration 169). Pass it whenever a version is on screen; omit it where there is no such
 * context, and the stamp is left exactly as it was rather than being cleared — a triage
 * action taken from a plain list must not erase the knowledge that someone checked this
 * note against v3 last week.
 */
export const setReviewCommentStatus = async (
  id: string,
  status: ReviewCommentStatus,
  checkedAgainst?: { subjectId: string | null; version: number | null },
): Promise<void> => {
  const user = await auth.getUser();
  const closing = status !== 'open';
  await db.updateWhere('review_comments', {
    status,
    resolved_at: closing ? new Date().toISOString() : null,
    resolved_by: closing ? (user?.email ?? user?.id ?? null) : null,
    ...(checkedAgainst
      ? {
        checked_subject_id: checkedAgainst.subjectId,
        checked_subject_version: checkedAgainst.version,
      }
      : {}),
  }, { where: { id } });
};

/**
 * Record that a note was re-checked against a version and is STILL an issue.
 *
 * The third verdict of a carried-forward round, and the only one that changes nothing about
 * the note itself: it stays open, because it is still open. What changes is that the team
 * now knows someone looked — which is exactly what an open note cannot otherwise tell you.
 */
export const markReviewCommentChecked = async (
  id: string,
  checkedAgainst: { subjectId: string | null; version: number | null },
): Promise<void> => {
  await db.updateWhere('review_comments', {
    checked_subject_id: checkedAgainst.subjectId,
    checked_subject_version: checkedAgainst.version,
  }, { where: { id } });
};

/** Per-subject round state, for a dashboard's status column. */
export interface ReviewRoundSummary {
  /** Notes still to be handled. */
  openCount: number;
  /** True once EVERY outstanding link on the subject has been submitted. */
  submitted: boolean;
  /**
   * How many live (minted, unrevoked) review links the subject has.
   *
   * Needed because a subject appears in this map for EITHER reason — it has a live link, or
   * it has open notes — and `submitted` cannot tell those apart: it starts true and is only
   * falsified by an outstanding link, so a subject whose last link was revoked while notes
   * were still open reads as `submitted: true`. Without this counter that is
   * indistinguishable from "every reviewer came back", which is the difference between a
   * round that is over and one that is closed and waiting on triage.
   *
   * Zero means the round is genuinely over: revoking the last link ends a round.
   */
  liveLinks: number;
}

/**
 * Round state per subject, across ALL projects — a board's supplier-feedback signal.
 *
 * Two lean queries for a whole board. The Markup.io polling this replaced made one network
 * call PER document in review, capped at twelve rows and still slow; reading our own tables
 * makes the cap unnecessary.
 *
 * Keyed `${projectId}::${subjectType}` (matching the IM's stalenessKey) when the subject has
 * no per-version rounds, and `${projectId}::${subjectType}::${subjectId}` when it does — a
 * design spec runs a separate round per version, so collapsing them onto one key would
 * report the previous version's closed round as this version's.
 */
export const reviewRoundKey = (
  projectId: string,
  subjectType: string,
  subjectId?: string | null,
): string => subjectId
  ? `${projectId}::${subjectType ?? 'im'}::${subjectId}`
  : `${projectId}::${subjectType ?? 'im'}`;

export const getReviewRounds = async (
  subjectTypes?: readonly ReviewSubjectType[],
): Promise<Map<string, ReviewRoundSummary>> => {
  const out = new Map<string, ReviewRoundSummary>();
  if (!isLive) return out;

  const typeFilter = subjectTypes && subjectTypes.length > 0
    ? { subject_type: { op: 'in' as const, value: [...subjectTypes] } }
    : {};

  const [shareRows, commentRows] = await Promise.all([
    orEmpty(
      db.select<Row>('review_shares', {
        columns: 'project_id, subject_type, subject_id, submitted_at',
        where: { mode: 'review', revoked_at: { op: 'isNull' }, ...typeFilter },
      }),
      '[getReviewRounds] shares',
    ),
    orEmpty(
      db.select<Row>('review_comments', {
        columns: 'project_id, subject_type, subject_id',
        where: { status: 'open', ...typeFilter },
      }),
      '[getReviewRounds] comments',
    ),
  ]);

  const entry = (projectId: string, subjectType: string, subjectId: string | null) => {
    const key = reviewRoundKey(projectId, subjectType, subjectId);
    let e = out.get(key);
    if (!e) { e = { openCount: 0, submitted: true, liveLinks: 0 }; out.set(key, e); }
    return e;
  };

  // `submitted` starts true and is falsified by any outstanding link: one reviewer finishing
  // does not mean the feedback is all in.
  for (const r of shareRows as any[]) {
    const e = entry(r.project_id, r.subject_type, r.subject_id ?? null);
    e.liveLinks += 1;
    if (!r.submitted_at) e.submitted = false;
  }
  for (const r of commentRows as any[]) {
    entry(r.project_id, r.subject_type, r.subject_id ?? null).openCount += 1;
  }
  return out;
};
