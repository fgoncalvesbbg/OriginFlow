/**
 * Signed UPLOAD URLs for a design spec version (Netlify Function).
 *
 * The `design-specs` bucket is private with no storage policies (migration 163), so even an
 * authenticated designer cannot write to it directly — "no policy" means deny, for everyone
 * but the service role. This endpoint is the authorization: it checks the caller may edit
 * design specs and that they can reach the spec's project, then mints one-shot signed upload
 * URLs for paths IT chooses.
 *
 * WHY THE BYTES DO NOT PASS THROUGH HERE. A design spec can be 50MB; a Netlify Function
 * body cannot. The browser PUTs straight to Storage with the signed URL, so there is no
 * size ceiling and no egress through Netlify. The same reason the review stamp is applied in
 * the browser (`src/services/design/design-spec-stamp.ts`) rather than server-side: the
 * designer's browser already has the bytes.
 *
 * TWO PATHS PER VERSION, and both are minted here so a caller cannot choose where the bytes
 * land:
 *   <specId>/<uuid>-original.pdf   the design team's file, never mutated, internal-only
 *   <specId>/<uuid>-review.pdf     the stamped copy served to reviewers
 *
 * A Final Release asks for the original slot only — it is served exactly as uploaded. The
 * other two stages (Internal Review, Initial Release) are stamped, so they get both.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { randomUUID } from 'crypto';
import {
  NetlifyEvent, json, serviceClient, userClient, authenticate,
  AuthError, ConfigError, ForbiddenError, ValidationError, assertUuid,
} from './lib/http';

const BUCKET = 'design-specs';

/** Mirrors the bucket's allowed_mime_types in migration 163. */
const CONTENT_TYPE = 'application/pdf';

/** Mirrors the bucket's file_size_limit (50MB), so an oversize file fails before uploading. */
export const MAX_PDF_BYTES = 52428800;

/** Mirrors design_spec_versions.stage (migration 171). */
const STAGES = ['internal', 'initial', 'final'] as const;
type Stage = typeof STAGES[number];

interface UploadRequest {
  specId?: unknown;
  stage?: unknown;
  /** Declared size, so an oversize file is refused before the bytes move. */
  byteSize?: unknown;
}

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let supabase: ReturnType<typeof serviceClient>;
  try {
    supabase = serviceClient();
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }

  let req: UploadRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  let specId: string;
  try {
    specId = assertUuid(req.specId, 'specId');
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'specId must be a UUID.' });
  }

  const stage = STAGES.includes(req.stage as Stage) ? req.stage as Stage : null;
  if (!stage) {
    return json(400, { error: 'stage must be "internal", "initial" or "final".' });
  }

  if (typeof req.byteSize === 'number' && req.byteSize > MAX_PDF_BYTES) {
    return json(413, { error: 'That PDF is larger than the 50MB limit.' });
  }

  const { data: spec, error: specErr } = await supabase
    .from('design_specs')
    .select('id, project_id, state, final_version_id, spec_code')
    .eq('id', specId)
    .maybeSingle();

  if (specErr) {
    console.error('[design-spec-upload-url] spec lookup failed:', specErr);
    return json(500, { error: 'Could not load that design spec.' });
  }
  if (!spec) return json(404, { error: 'No such design spec.' });

  // Authorize: a session, the right to edit design specs, and reach to this project.
  //
  // is_design_editor() is asked AS THE CALLER, so the answer comes from user_roles via the
  // same SECURITY DEFINER function the table policies use — this cannot drift from them.
  try {
    await authenticate(event);
    const asCaller = userClient(event);

    const { data: isEditor, error: roleErr } = await asCaller.rpc('is_design_editor');
    if (roleErr) throw new Error(roleErr.message);
    if (isEditor !== true) {
      throw new ForbiddenError('Only the design team can upload a design spec.');
    }

    const { data: project, error: projErr } = await asCaller
      .from('projects')
      .select('id')
      .eq('id', spec.project_id)
      .maybeSingle();
    if (projErr) throw new Error(projErr.message);
    if (!project) throw new ForbiddenError('You do not have access to this design spec.');
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    if (e instanceof ForbiddenError) return json(403, { error: e.message });
    if (e instanceof ConfigError) return json(500, { error: e.message });
    if (e instanceof ValidationError) return json(400, { error: e.message });
    console.error('[design-spec-upload-url] authorization failed:', e);
    return json(500, { error: 'Could not verify your access.' });
  }

  // The lock, checked here as well as by the trigger. The trigger is the real guarantee —
  // it fires whatever path the insert takes — but refusing before 50MB moves over the wire
  // is the difference between a clear message and a long upload that fails at the end.
  if (spec.final_version_id) {
    return json(409, {
      error: `${spec.spec_code} is issued as final. Unlock it before uploading another version.`,
    });
  }
  if (spec.state === 'cancelled') {
    return json(409, { error: `${spec.spec_code} is cancelled.` });
  }

  const stem = `${specId}/${randomUUID()}`;
  const originalPath = `${stem}-original.pdf`;
  // Everything but a Final Release is served to reviewers stamped, so it needs the second
  // slot. Deciding here rather than trusting the client means a caller cannot ask for an
  // unstamped slot and then upload an Initial Release into it.
  const stampedPath = stage === 'final' ? null : `${stem}-review.pdf`;

  const sign = async (path: string) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) throw error ?? new Error('No signed URL returned.');
    return data.signedUrl;
  };

  try {
    const originalUrl = await sign(originalPath);
    const stampedUrl = stampedPath ? await sign(stampedPath) : null;
    return json(200, {
      contentType: CONTENT_TYPE,
      original: { path: originalPath, signedUrl: originalUrl },
      stamped: stampedPath ? { path: stampedPath, signedUrl: stampedUrl } : null,
    });
  } catch (e) {
    console.error('[design-spec-upload-url] createSignedUploadUrl failed:', e);
    return json(500, { error: 'Could not prepare the upload.' });
  }
};
