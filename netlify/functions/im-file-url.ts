/**
 * Signed-URL issuer for the two Instruction-Manual storage buckets (Netlify Function).
 *
 * `im-published` (published manual JSON/manifests) and `im-print` (rendered print PDFs) are
 * PUBLIC Supabase Storage buckets today. Client code used to build a PERMANENT public URL for
 * either one via the synchronous `storage.publicUrl(bucket, path)` port — a URL that never
 * expires and is never re-checked against project access, so revoking a `review_shares` token did
 * nothing for anyone who had already opened DevTools: they kept a permanent link to unreleased
 * product data, including every future republish. This endpoint is the fix: every read of
 * either bucket now goes through a short-TTL signed URL minted HERE, after re-validating the
 * caller's right to the project — never the vendor's storage ACL alone.
 *
 * Works identically whether the bucket is still public or has been flipped private:
 * `createSignedUrl` is a plain Storage API call, independent of the bucket's public/private
 * flag (see storage.adapter.ts for the client-side half of that same note). That is what lets
 * this ship BEFORE the coordinator flips the buckets private and keep working, unchanged,
 * the moment they are.
 *
 * AUTH MATRIX — exactly one of:
 *
 *   (a) STAFF — `Authorization: Bearer <supabase session>` + `projectId` in the body.
 *       Re-validated via `authorizeProject`: PM-scoped RLS on `projects` decides whether this
 *       session may see this project, exactly as every other authorized function in this repo.
 *
 *   (b) PORTAL — `token` in the body: a live `review_shares` row (a "view" OR "review" link — both
 *       read the same published manual, they only differ in whether commenting is allowed).
 *       Looked up DIRECTLY against `review_shares` with the service role — see the note below for
 *       why this is not the `get_im_share_by_token` / `im_review_resolve` RPCs — and the
 *       PROJECT ID COMES FROM THAT ROW, never from the request: a token minted for project A
 *       can never mint a URL under project B's prefix, no matter what the caller sends.
 *
 * Why a direct table query instead of the public resolver RPCs: both `get_im_share_by_token`
 * (migration 109) and `im_review_resolve` (migration 130) stamp `last_used_at`/`use_count` —
 * "the portal was opened" — which is the right signal once per page view, not once per signed
 * URL. A single open of a manual with a dozen languages mints a dozen signed URLs (manifest +
 * one per language switch), plus one more every time a page left open outlives the TTL —
 * calling either RPC here would wildly inflate "opened N× · last …" for something that isn't a
 * new open. `review-upload-url.ts` already established this exact precedent (see its own
 * comment) for the same reason. The WHERE clause below mirrors those RPCs' filters exactly
 * (`revoked_at IS NULL`, `expires_at` check), so the ADMISSION DECISION is identical either
 * way — only the access-log side effect is skipped.
 *
 * PATH VALIDATION. Every object in both buckets lives at
 * `<projectId>/<templateType>/<file>` (im-publish.service.ts / render-print-merge.ts). A
 * request is rejected unless the path: has no leading `/`, contains no `..` segment, starts
 * with a real UUID, has `im` or `warning_leaflet` as its second segment, and every remaining
 * segment is a bare filename (letters/digits/`._-` only — no further `/`, so a segment can
 * never itself smuggle a traversal). The project id embedded in that path is what gets
 * authorized above — never a caller-supplied id used only for the auth check and then ignored.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) — for the staff path's `userClient()`
 */

import {
  NetlifyEvent,
  json,
  serviceClient,
  authorizeProject,
  AuthError,
  ForbiddenError,
  ValidationError,
} from './lib/http';

interface FileUrlRequest {
  bucket?: string;
  path?: string;
  /** STAFF path only. */
  projectId?: string;
  /** PORTAL path only — a `review_shares.token` (view or review link). */
  token?: string;
}

const ALLOWED_BUCKETS = new Set(['im-published', 'im-print']);

/**
 * TTL per bucket, decided server-side only — the request body carries no TTL field, so a
 * caller cannot ask for a longer-lived link than the server is willing to hand out.
 *   - im-published: small JSON, fetched repeatedly (the manifest, then one file per language
 *     switch). 5 minutes is ample per fetch and short enough that a leaked URL is worthless
 *     quickly.
 *   - im-print: a multi-hundred-page merged PDF, sometimes downloaded over a slow supplier
 *     connection. 15 minutes gives a large file room to finish without handing out a
 *     needlessly long-lived link.
 */
const TTL_SECONDS: Record<string, number> = {
  'im-published': 300,
  'im-print': 900,
};

const TEMPLATE_TYPES = new Set(['im', 'warning_leaflet']);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** One path segment after `<projectId>/<templateType>/` — a bare filename, never another `/`. */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Parses (and validates) `<projectId>/<templateType>/<file...>` — the one layout every object
 * in either bucket is stored under. Returns null for anything that doesn't match exactly,
 * including a leading slash, a `..` segment, or an unknown template type.
 */
const parseObjectPath = (path: unknown): { projectId: string; templateType: string } | null => {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('..')) return null;
  const parts = path.split('/');
  if (parts.length < 3) return null;
  const [projectId, templateType, ...rest] = parts;
  if (!UUID_RE.test(projectId)) return null;
  if (!TEMPLATE_TYPES.has(templateType)) return null;
  if (!rest.length || !rest.every((seg) => SEGMENT_RE.test(seg))) return null;
  return { projectId, templateType };
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let req: FileUrlRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  if (typeof req.bucket !== 'string' || !ALLOWED_BUCKETS.has(req.bucket)) {
    return json(400, { error: 'bucket must be "im-published" or "im-print".' });
  }
  const bucket = req.bucket;

  const parsed = parseObjectPath(req.path);
  if (!parsed) {
    return json(400, { error: 'path is invalid.' });
  }
  const path = req.path as string;

  let supabase: ReturnType<typeof serviceClient>;
  try {
    supabase = serviceClient();
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }

  try {
    const hasToken = typeof req.token === 'string' && req.token.length > 0;
    if (hasToken) {
      // PORTAL PATH. See the file header for why this is a direct table query rather than
      // get_im_share_by_token / im_review_resolve. Any mode ('view' or 'review') may read —
      // both open the same published manual; only commenting is mode-gated, and that's not
      // this endpoint's concern.
      const { data: share, error } = await supabase
        .from('review_shares')
        .select('project_id, template_type, revoked_at, expires_at')
        .eq('token', req.token as string)
        .is('revoked_at', null)
        .maybeSingle();
      if (error) {
        console.error('[im-file-url] share lookup failed:', error);
        return json(500, { error: 'Could not validate the link.' });
      }
      const expired = !!share?.expires_at && new Date(share.expires_at as string) <= new Date();
      // One message for unknown / revoked / expired, matching the portal pages, so a probe
      // cannot tell the cases apart.
      if (!share || expired) {
        return json(403, { error: 'This link is invalid, expired or has been revoked.' });
      }
      // THE PROJECT COMES FROM THIS ROW. A token minted for a different project/template
      // than the one embedded in the requested path is refused outright.
      if (share.project_id !== parsed.projectId || share.template_type !== parsed.templateType) {
        return json(403, { error: 'This link does not grant access to that file.' });
      }
    } else {
      // STAFF PATH. The caller names the project it is asserting access to; it must agree
      // with the project embedded in the path (a mismatch is just a malformed request, not
      // an authorization question), and authorizeProject then re-derives "can this SESSION
      // actually see it" from PM-scoped RLS — independent of anything the caller typed.
      if (typeof req.projectId !== 'string' || req.projectId !== parsed.projectId) {
        return json(400, { error: 'projectId must match the requested path.' });
      }
      await authorizeProject(event, req.projectId);
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, TTL_SECONDS[bucket]);
    if (signErr || !signed?.signedUrl) {
      console.error('[im-file-url] createSignedUrl failed:', signErr);
      return json(500, { error: 'Could not create a download link.' });
    }
    return json(200, { url: signed.signedUrl, expiresIn: TTL_SECONDS[bucket] });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    if (e instanceof ForbiddenError) return json(403, { error: e.message });
    if (e instanceof ValidationError) return json(400, { error: e.message });
    console.error('[im-file-url] failed:', e);
    return json(500, { error: 'Could not create a download link.' });
  }
};
