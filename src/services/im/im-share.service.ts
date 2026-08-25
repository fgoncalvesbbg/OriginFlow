/**
 * IM share links — public, unguessable-token URLs that render a generated manual in the
 * read-only IMViewer with no login. The manual JSON itself is already anonymously readable
 * by URL (im-published bucket); this service just manages the token -> (project, template
 * type) mapping in `im_shares` (see db_migrations/84_create_im_shares.sql).
 */

import { auth, db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { IMTemplateType } from '../../types';

export type IMShareMode = 'view' | 'review';

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
  /** When the public token was last successfully resolved (viewer opened). Null = never opened. */
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
}

/** True once the link's TTL has passed (the RPC also enforces this server-side). */
export const isShareExpired = (share: IMShare): boolean =>
  !!share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now();

const mapRow = (row: any): IMShare => ({
  id: row.id,
  token: row.token,
  projectId: row.project_id,
  templateType: row.template_type,
  createdBy: row.created_by,
  createdAt: row.created_at,
  revokedAt: row.revoked_at,
  revokedBy: row.revoked_by ?? null,
  expiresAt: row.expires_at ?? null,
  label: row.label ?? null,
  lastUsedAt: row.last_used_at ?? null,
  useCount: row.use_count ?? 0,
  mode: (row.mode ?? 'view') as IMShareMode,
  submittedAt: row.submitted_at ?? null,
  submittedBy: row.submitted_by ?? null,
  manualVersion: row.manual_version ?? null,
});

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
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('im_shares', {
      where: {
        project_id: projectId,
        template_type: templateType,
        revoked_at: { op: 'isNull' },
        mode,
      },
      order: { column: 'created_at', ascending: false },
    }),
    '[getIMShares]',
  );
  return rows.map(mapRow);
};

/**
 * Mint a new public share link for a manual, optionally labeled and with a TTL.
 *
 * `mode: 'review'` makes it a supplier review link instead of a read-only one; pass
 * `manualVersion` (the project_ims.version being sent out) alongside it so a later republish
 * is detectable as "reviewed against v3, now on v4".
 */
export const createIMShare = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
  opts?: { label?: string; expiresAt?: string | null; mode?: IMShareMode; manualVersion?: number | null },
): Promise<IMShare> => {
  const user = await auth.getUser();
  const createdBy = user?.email ?? user?.id ?? null;
  const created = await db.insert<Row>('im_shares', {
    project_id: projectId,
    template_type: templateType,
    created_by: createdBy,
    label: opts?.label?.trim() || null,
    expires_at: opts?.expiresAt ?? null,
    mode: opts?.mode ?? 'view',
    manual_version: opts?.manualVersion ?? null,
  });
  return mapRow(created);
};

/** Revoke a share link — the public URL stops resolving immediately. Records who revoked. */
export const revokeIMShare = async (id: string): Promise<void> => {
  const user = await auth.getUser();
  await db.updateWhere('im_shares', {
    revoked_at: new Date().toISOString(),
    revoked_by: user?.email ?? user?.id ?? null,
  }, { where: { id } });
};

/**
 * Resolve a public token to its (project, template type), via the anon-callable
 * `get_im_share_by_token` routine. Returns null for an unknown or revoked token.
 */
export const resolveIMShareToken = async (
  token: string,
): Promise<{ projectId: string; templateType: IMTemplateType } | null> => {
  if (!isLive) return null;
  let data: Row | Row[] | null;
  try {
    data = await portalDb.rpc<Row | Row[] | null>('get_im_share_by_token', { p_token: token });
  } catch (e) {
    console.error('[resolveIMShareToken] error:', e);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { projectId: row.project_id, templateType: row.template_type as IMTemplateType };
};

/** Build the public, shareable URL for a token (app uses HashRouter). */
export const getIMShareUrl = (token: string): string =>
  `${window.location.origin}${window.location.pathname}#/share/im/${token}`;

/**
 * Build the supplier review URL for a token. Separate page from getIMShareUrl because the
 * review portal adds the commenting rail on top of the same read-only viewer; a review token
 * still opens read-only at the /share/im/ URL, which is harmless.
 */
export const getIMReviewUrl = (token: string): string =>
  `${window.location.origin}${window.location.pathname}#/review/im/${token}`;
