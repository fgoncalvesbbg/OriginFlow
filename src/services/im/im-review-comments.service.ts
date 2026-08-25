/**
 * Supplier review comments on the online Instruction Manual — the first-party replacement for
 * the Markup.io round (db_migrations/130 + 131).
 *
 * Two audiences, two access paths, and the split matters:
 *
 *  - The SUPPLIER half is unauthenticated. It goes through `portalDb`, and through RPCs only —
 *    `portalDb` is documented as never being allowed to touch a table directly, and
 *    im_review_comments deliberately has no anon policy. Each RPC re-resolves the bearer token
 *    server-side, so the caller cannot say which manual a comment belongs to.
 *  - The PM half is a normal authenticated read/write under the table's "Auth all" policy.
 */

import { auth, db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { IMTemplateType } from '../../types';

export type IMReviewCommentStatus = 'open' | 'done' | 'wont_fix';

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

const mapCommentRow = (row: any): IMReviewComment => ({
  id: row.id,
  shareId: row.share_id,
  projectId: row.project_id,
  templateType: (row.template_type ?? 'im') as IMTemplateType,
  language: row.language ?? 'en',
  manualVersion: row.manual_version ?? null,
  sectionId: row.section_id,
  sectionTitle: row.section_title ?? null,
  quote: row.quote ?? null,
  quoteBefore: row.quote_before ?? null,
  quoteAfter: row.quote_after ?? null,
  body: row.body,
  authorName: row.author_name,
  status: (row.status ?? 'open') as IMReviewCommentStatus,
  resolvedAt: row.resolved_at ?? null,
  resolvedBy: row.resolved_by ?? null,
  createdAt: row.created_at,
});

// ---------------------------------------------------------------------------
// Supplier side — anonymous, RPC-only, bearer token
// ---------------------------------------------------------------------------

/**
 * Resolve a review token to its manual. Returns null for a token that is unknown, revoked,
 * expired, or a plain 'view' share — the portal shows one "invalid or revoked" screen for all
 * of them on purpose, so a probe can't tell the cases apart.
 *
 * Resolving also stamps last_used_at / use_count server-side, so opening the portal is logged.
 */
export const resolveReviewShare = async (token: string): Promise<IMReviewSession | null> => {
  if (!isLive) return null;
  let data: Row | Row[] | null;
  try {
    data = await portalDb.rpc<Row | Row[] | null>('im_review_resolve', { p_token: token });
  } catch (e) {
    console.error('[resolveReviewShare] error:', e);
    return null;
  }
  const row: any = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    shareId: row.share_id,
    projectId: row.project_id,
    templateType: (row.template_type ?? 'im') as IMTemplateType,
    label: row.label ?? null,
    submittedAt: row.submitted_at ?? null,
    submittedBy: row.submitted_by ?? null,
    manualVersion: row.manual_version ?? null,
    expiresAt: row.expires_at ?? null,
  };
};

/** This link's own notes, oldest first. Never another reviewer's — the RPC scopes by share. */
export const listReviewCommentsByToken = async (token: string): Promise<IMReviewComment[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    portalDb.rpc<Row[]>('im_review_list_comments', { p_token: token }),
    '[listReviewCommentsByToken]',
  );
  return rows.map(mapCommentRow);
};

export interface AddReviewCommentInput {
  sectionId: string;
  sectionTitle?: string | null;
  quote?: string | null;
  quoteBefore?: string | null;
  quoteAfter?: string | null;
  body: string;
  authorName: string;
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
  const row = await portalDb.rpc<Row | Row[]>('im_review_add_comment', {
    p_token: token,
    p_author_name: input.authorName,
    p_body: input.body,
    p_section_id: input.sectionId,
    p_section_title: input.sectionTitle ?? null,
    p_quote: input.quote ?? null,
    p_quote_before: input.quoteBefore ?? null,
    p_quote_after: input.quoteAfter ?? null,
  });
  return mapCommentRow(Array.isArray(row) ? row[0] : row);
};

/** Retract one's own note. False when the PM has already acted on it, or the link is dead. */
export const deleteReviewComment = async (token: string, commentId: string): Promise<boolean> => {
  const ok = await portalDb.rpc<boolean>('im_review_delete_comment', {
    p_token: token,
    p_comment_id: commentId,
  });
  return ok === true;
};

/**
 * Mark the review round finished. Idempotent server-side — the first submission's timestamp
 * stands, so a reviewer who keeps commenting afterwards doesn't restart the round.
 */
export const submitReview = async (token: string, authorName: string): Promise<string> =>
  portalDb.rpc<string>('im_review_submit', { p_token: token, p_author_name: authorName });

// ---------------------------------------------------------------------------
// PM side — authenticated, direct table access under the "Auth all" policy
// ---------------------------------------------------------------------------

/** Every reviewer's notes on a manual, oldest first. */
export const getReviewComments = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<IMReviewComment[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('im_review_comments', {
      where: { project_id: projectId, template_type: templateType },
      order: { column: 'created_at', ascending: true },
    }),
    '[getReviewComments]',
  );
  return rows.map(mapCommentRow);
};

/**
 * Triage one note. Moving it off 'open' stamps who closed it and when; moving it back to
 * 'open' clears both, so the audit trail never claims a still-open note was resolved.
 */
export const setReviewCommentStatus = async (
  id: string,
  status: IMReviewCommentStatus,
): Promise<void> => {
  const user = await auth.getUser();
  const closing = status !== 'open';
  await db.updateWhere('im_review_comments', {
    status,
    resolved_at: closing ? new Date().toISOString() : null,
    resolved_by: closing ? (user?.email ?? user?.id ?? null) : null,
  }, { where: { id } });
};

/** Per-manual review round state, for the IM Dashboard's status column. */
export interface ReviewRoundSummary {
  /** Notes still to be handled. */
  openCount: number;
  /** True once every outstanding review link on the manual has been submitted. */
  submitted: boolean;
}

/**
 * Review round per manual, across ALL projects — the dashboard's supplier-feedback signal.
 *
 * Two lean queries for the whole board, mirroring getLatestRendersByManual. The Markup.io
 * polling this replaces made one network call PER manual in review, capped at twelve rows and
 * still slow; reading our own tables makes the cap unnecessary.
 *
 * Keyed `${projectId}::${templateType}`, matching stalenessKey so the dashboard can reuse it.
 */
export const getReviewRoundsByManual = async (): Promise<Map<string, ReviewRoundSummary>> => {
  const out = new Map<string, ReviewRoundSummary>();
  if (!isLive) return out;

  const [shareRows, commentRows] = await Promise.all([
    orEmpty(
      db.select<Row>('im_shares', {
        columns: 'project_id, template_type, submitted_at',
        where: { mode: 'review', revoked_at: { op: 'isNull' } },
      }),
      '[getReviewRoundsByManual] shares',
    ),
    orEmpty(
      db.select<Row>('im_review_comments', {
        columns: 'project_id, template_type',
        where: { status: 'open' },
      }),
      '[getReviewRoundsByManual] comments',
    ),
  ]);

  const entry = (projectId: string, templateType: string) => {
    const key = `${projectId}::${templateType ?? 'im'}`;
    let e = out.get(key);
    if (!e) { e = { openCount: 0, submitted: true }; out.set(key, e); }
    return e;
  };

  // `submitted` starts true and is falsified by any outstanding link: one supplier finishing
  // doesn't mean the feedback is all in.
  for (const r of shareRows as any[]) {
    const e = entry(r.project_id, r.template_type);
    if (!r.submitted_at) e.submitted = false;
  }
  for (const r of commentRows as any[]) {
    entry(r.project_id, r.template_type).openCount += 1;
  }
  return out;
};

/**
 * Open-note counts per manual, for the IM Dashboard's status column.
 *
 * One query for the whole board rather than one per manual: the dashboard renders dozens of
 * rows, and the Markup.io polling this replaces was a per-manual network call each.
 */
export const getOpenReviewCommentCounts = async (
  projectIds: string[],
  templateType: IMTemplateType = 'im',
): Promise<Record<string, number>> => {
  if (!isLive || projectIds.length === 0) return {};
  const rows = await orEmpty(
    db.select<Row>('im_review_comments', {
      columns: 'project_id',
      where: { project_id: projectIds, template_type: templateType, status: 'open' },
    }),
    '[getOpenReviewCommentCounts]',
  );
  const counts: Record<string, number> = {};
  for (const row of rows as any[]) {
    counts[row.project_id] = (counts[row.project_id] ?? 0) + 1;
  }
  return counts;
};
