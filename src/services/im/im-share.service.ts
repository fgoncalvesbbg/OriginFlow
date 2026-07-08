/**
 * IM share links — public, unguessable-token URLs that render a generated manual in the
 * read-only IMViewer with no login. The manual JSON itself is already anonymously readable
 * by URL (im-published bucket); this service just manages the token -> (project, template
 * type) mapping in `im_shares` (see db_migrations/84_create_im_shares.sql).
 */

import { supabase, portalClient } from '../core/supabase.client';
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
  const { data, error } = await supabase
    .from('im_shares')
    .select('*')
    .eq('project_id', projectId)
    .eq('template_type', templateType)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[getIMShares] error:', error);
    return [];
  }
  return (data || []).map(mapRow);
};

/** Mint a new public share link for a manual. */
export const createIMShare = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<IMShare> => {
  const { data: userData } = await supabase.auth.getUser();
  const createdBy = userData?.user?.email ?? userData?.user?.id ?? null;
  const { data, error } = await supabase
    .from('im_shares')
    .insert({ project_id: projectId, template_type: templateType, created_by: createdBy })
    .select()
    .single();
  if (error) throw new Error(`Failed to create share link: ${error.message}`);
  return mapRow(data);
};

/** Revoke a share link — the public URL stops resolving immediately. */
export const revokeIMShare = async (id: string): Promise<void> => {
  const { error } = await supabase
    .from('im_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Failed to revoke share link: ${error.message}`);
};

/**
 * Resolve a public token to its (project, template type), via the anon-callable
 * `get_im_share_by_token` RPC. Returns null for an unknown or revoked token.
 */
export const resolveIMShareToken = async (
  token: string,
): Promise<{ projectId: string; templateType: IMTemplateType } | null> => {
  if (!isLive) return null;
  const { data, error } = await portalClient.rpc('get_im_share_by_token', { p_token: token });
  if (error) {
    console.error('[resolveIMShareToken] error:', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { projectId: row.project_id, templateType: row.template_type as IMTemplateType };
};

/** Build the public, shareable URL for a token (app uses HashRouter). */
export const getIMShareUrl = (token: string): string =>
  `${window.location.origin}${window.location.pathname}#/share/im/${token}`;
