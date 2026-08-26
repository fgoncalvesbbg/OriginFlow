/**
 * Signed upload-URL issuer for supplier review images (Netlify Function).
 *
 * A reviewer on /#/review/im/:token is anonymous and holds nothing but that bearer token.
 * Storage RLS cannot see it — a policy can only tell that the caller is `anon` — so an anon
 * INSERT policy on the bucket would be an open file drop for the whole internet. There isn't
 * one. This endpoint is the authorization instead: it validates the review token with the
 * SERVICE ROLE, then mints a one-shot signed upload URL for a path IT chooses.
 *
 * Two consequences worth keeping:
 *   - The bytes never pass through this function. The browser PUTs straight to Storage, so
 *     there is no 6MB function-body ceiling and no egress through Netlify.
 *   - The path is always `<share_id>/<uuid>.<ext>`. im_review_add_comment (migration 132)
 *     re-checks that prefix, so a caller cannot attach an arbitrary object — or another
 *     reviewer's image — to their own note.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service role, so signing bypasses storage RLS
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
}

interface UploadUrlRequest {
  token: string;
  contentType: string;
}

const BUCKET = 'im-review-uploads';

/** Mirrors the bucket's allowed_mime_types in migration 132 — images only. */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
  }

  let req: UploadUrlRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!req.token || typeof req.token !== 'string') {
    return json(400, { error: 'A review token is required.' });
  }
  const ext = EXT_BY_TYPE[req.contentType];
  if (!ext) {
    return json(400, { error: 'Only JPEG, PNG and WebP images can be attached.' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Service role bypasses RLS, so the token check is enforced here in TypeScript — the same
  // filters im_review_resolve applies. Deliberately NOT via that RPC: resolving bumps
  // use_count, which means "the portal was opened", and attaching an image is not that.
  const { data: share, error } = await supabase
    .from('im_shares')
    .select('id, revoked_at, expires_at, mode')
    .eq('token', req.token)
    .eq('mode', 'review')
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    console.error('[review-upload-url] share lookup failed:', error);
    return json(500, { error: 'Could not prepare the upload.' });
  }
  // One message for unknown / revoked / expired / wrong-mode, matching the portal, so a probe
  // cannot tell the cases apart.
  const expired = share?.expires_at != null && new Date(share.expires_at as string) <= new Date();
  if (!share || expired) {
    return json(403, { error: 'This review link is invalid, expired or has been revoked.' });
  }

  const path = `${share.id}/${randomUUID()}.${ext}`;
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (signErr || !signed?.signedUrl) {
    console.error('[review-upload-url] createSignedUploadUrl failed:', signErr);
    return json(500, { error: 'Could not prepare the upload.' });
  }

  return json(200, { path, signedUrl: signed.signedUrl, token: signed.token });
};
