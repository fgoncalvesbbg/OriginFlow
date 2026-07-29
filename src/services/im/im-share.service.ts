/**
 * IM share links — public, unguessable-token URLs that render a generated manual in the
 * read-only IMViewer with no login. The manual JSON itself is already anonymously readable
 * by URL (im-published bucket); this service just manages the token -> (project, template
 * type) mapping in `im_shares` (see db_migrations/84_create_im_shares.sql).
 */

import { auth, db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { IMTemplateType } from '../../types';

export interface IMShare {
  id: string;
  token: string;
  projectId: string;
  templateType: IMTemplateType;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
}

const mapRow = (row: any): IMShare => ({
  id: row.id,
  token: row.token,
  projectId: row.project_id,
  templateType: row.template_type,
  createdBy: row.created_by,
  createdAt: row.created_at,
  revokedAt: row.revoked_at,
});

/** Active (non-revoked) share links for a manual, most recent first. */
export const getIMShares = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<IMShare[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('im_shares', {
      where: {
        project_id: projectId,
        template_type: templateType,
        revoked_at: { op: 'isNull' },
      },
      order: { column: 'created_at', ascending: false },
    }),
    '[getIMShares]',
  );
  return rows.map(mapRow);
};

/** Mint a new public share link for a manual. */
export const createIMShare = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<IMShare> => {
  const user = await auth.getUser();
  const createdBy = user?.email ?? user?.id ?? null;
  const created = await db.insert<Row>('im_shares', {
    project_id: projectId,
    template_type: templateType,
    created_by: createdBy,
  });
  return mapRow(created);
};

/** Revoke a share link — the public URL stops resolving immediately. */
export const revokeIMShare = async (id: string): Promise<void> => {
  await db.updateWhere('im_shares', { revoked_at: new Date().toISOString() }, { where: { id } });
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
