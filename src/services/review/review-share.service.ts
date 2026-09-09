/**
 * Review and share links — one implementation for every reviewable document.
 *
 * Manages the token -> subject mapping in `review_shares` (migration 162, which renamed
 * `im_shares` and generalized it away from the Instruction Manual). Callers name a
 * `ReviewSubject`; nothing here knows what an IM or a design spec is.
 *
 * A token grants unauthenticated read access, so the lifecycle here — label, TTL, revoke,
 * last-used stamping — is the containment. The IM adapter is
 * `src/services/im/im-share.service.ts`; the design spec one will sit beside it.
 */

import { auth, db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type {
  ReviewShare, ReviewShareMode, ReviewStage, ReviewSubject, ReviewSubjectType,
} from '../../types/review.types';

/**
 * Default TTL for a link that does not specify one (see `createReviewShare`).
 *
 * "Forever" must be something a caller opts into, never something it gets by omission —
 * an unguessable URL that never expires is the one mistake this default exists to prevent.
 */
export const DEFAULT_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const mapShareRow = (row: any): ReviewShare => ({
  id: row.id,
  token: row.token,
  projectId: row.project_id,
  subjectType: (row.subject_type ?? 'im') as ReviewSubjectType,
  subjectId: row.subject_id ?? null,
  subjectVersion: row.subject_version ?? null,
  createdBy: row.created_by ?? null,
  createdAt: row.created_at,
  revokedAt: row.revoked_at ?? null,
  revokedBy: row.revoked_by ?? null,
  expiresAt: row.expires_at ?? null,
  label: row.label ?? null,
  lastUsedAt: row.last_used_at ?? null,
  useCount: row.use_count ?? 0,
  mode: (row.mode ?? 'view') as ReviewShareMode,
  submittedAt: row.submitted_at ?? null,
  submittedBy: row.submitted_by ?? null,
  reviewStage: (row.review_stage ?? null) as ReviewStage | null,
});

/**
 * Active (non-revoked) links for one subject, most recent first.
 *
 * `mode` is an optional filter: omit it to list both kinds in one table, pass one to list
 * just read-only links or just review links. `subject.id` narrows to a single version's
 * round — omit it and every round on the subject comes back, which is what the IM wants
 * (it has no per-version rounds) and what a design spec's history view wants.
 */
export const getReviewShares = async (
  subject: ReviewSubject,
  mode?: ReviewShareMode,
): Promise<ReviewShare[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('review_shares', {
      where: {
        project_id: subject.projectId,
        subject_type: subject.type,
        ...(subject.id ? { subject_id: subject.id } : {}),
        revoked_at: { op: 'isNull' },
        mode,
      },
      order: { column: 'created_at', ascending: false },
    }),
    '[getReviewShares]',
  );
  return rows.map(mapShareRow);
};

export interface CreateReviewShareOptions {
  label?: string;
  expiresAt?: string | null;
  mode?: ReviewShareMode;
  reviewStage?: ReviewStage | null;
}

/**
 * Mint a link for a subject.
 *
 * `expiresAt` defaults to 30 days when the caller OMITS the option entirely. A caller that
 * passes it explicitly — including `null`, meaning "no expiry" — is honored exactly as
 * passed. `'expiresAt' in opts` is what distinguishes "the key is absent" from "the key is
 * present and null", which `opts?.expiresAt ?? default` cannot: that would silently turn
 * every omitted-expiry caller into a link that never expires.
 */
export const createReviewShare = async (
  subject: ReviewSubject,
  opts?: CreateReviewShareOptions,
): Promise<ReviewShare> => {
  const user = await auth.getUser();
  const expiresAt = opts && 'expiresAt' in opts
    ? opts.expiresAt
    : new Date(Date.now() + DEFAULT_SHARE_TTL_MS).toISOString();

  const created = await db.insert<Row>('review_shares', {
    project_id: subject.projectId,
    subject_type: subject.type,
    subject_id: subject.id ?? null,
    subject_version: subject.version ?? null,
    created_by: user?.email ?? user?.id ?? null,
    label: opts?.label?.trim() || null,
    expires_at: expiresAt,
    mode: opts?.mode ?? 'view',
    // Only a review link has a stage; a view link is not part of a workflow at all.
    review_stage: opts?.mode === 'review' ? (opts?.reviewStage ?? 'draft') : null,
  });
  return mapShareRow(created);
};

/** Revoke a link — the public URL stops resolving immediately. Records who revoked it. */
export const revokeReviewShare = async (id: string): Promise<void> => {
  const user = await auth.getUser();
  await db.updateWhere('review_shares', {
    revoked_at: new Date().toISOString(),
    revoked_by: user?.email ?? user?.id ?? null,
  }, { where: { id } });
};

/**
 * Revoke every live link on a subject, returning how many were revoked.
 *
 * Exists because ending a round is a real operation, not a loop the callers should each
 * write: cancelling a design spec revokes its links, and revoking the last link is what
 * genuinely ends a round for the status derivation.
 */
export const revokeAllReviewShares = async (
  subject: ReviewSubject,
  mode?: ReviewShareMode,
): Promise<number> => {
  const live = await getReviewShares(subject, mode);
  for (const share of live) await revokeReviewShare(share.id);
  return live.length;
};

/**
 * Resolve a public token to its (project, subject type) via the anon-callable
 * `get_im_share_by_token` routine. Returns null for an unknown, revoked or expired token.
 *
 * The routine keeps its original name deliberately: migration 130 records that widening or
 * dropping it — even for an instant — takes the live public share page down mid-deploy, and
 * migration 162 only re-pointed its body. It is the read-only path; a review token resolves
 * through `resolveReviewSession` in review-comments.service.ts instead.
 */
export const resolveShareToken = async (
  token: string,
): Promise<{ projectId: string; subjectType: ReviewSubjectType } | null> => {
  if (!isLive) return null;
  let data: Row | Row[] | null;
  try {
    data = await portalDb.rpc<Row | Row[] | null>('get_im_share_by_token', { p_token: token });
  } catch (e) {
    console.error('[resolveShareToken] error:', e);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    projectId: row.project_id,
    subjectType: (row.template_type ?? 'im') as ReviewSubjectType,
  };
};

/** Build an absolute app URL for a hash route (the app uses HashRouter). */
export const appUrl = (hashPath: string): string =>
  `${window.location.origin}${window.location.pathname}#${hashPath}`;
