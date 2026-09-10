/**
 * Signed READ URLs for design spec PDFs (Netlify Function).
 *
 * WHY THIS EXISTS AT ALL. The `design-specs` bucket is private and carries no storage
 * policies (migration 163), so nothing reaches a PDF without the service role. That is
 * deliberate, and the reason is revocation: a public bucket's URL keeps working forever once
 * it has been seen, so a revoked review link would still serve the draft to whoever had
 * copied the object URL. Here, access is re-derived on every request from a credential that
 * can be taken away.
 *
 * THREE CALLERS, THREE CREDENTIALS, AND A DIFFERENT FILE FOR EACH:
 *
 *   (a) REVIEWER — `token` in the body: a live `review_shares` row for this spec version.
 *       Served the STAMPED copy (`INITIAL RELEASE v.02 · FOR REVIEW ONLY`, or
 *       `INTERNAL REVIEW v.01 · NOT FOR DISTRIBUTION`). Never the original, so a factory
 *       cannot tool up from an unmarked spec that leaked out of a review.
 *   (b) INTERNAL — a bearer session: authorized against the spec's project the same way
 *       every other function does it, by asking Postgres as the caller. Served the original.
 *   (c) SUPPLIER PORTAL — `projectToken`, or `supplierToken` + `accessCode`: the same two
 *       credentials supplier-file-url.ts accepts, validated the same way. Served the
 *       ISSUED FINAL ONLY, and only for the spec of a project that credential speaks for.
 *
 * WHY (c) CANNOT REACH AN UNISSUED VERSION. A portal credential is a long-lived URL sitting
 * in a supplier's inbox — it does not expire with a round and nobody revokes it when one
 * closes. An unreleased version is exactly the thing every other path here goes out of its
 * way to serve only in stamped form and only to the recipient of a live round; letting the
 * standing portal link reach one would quietly undo that. `final_version_id` is the test,
 * not `stage`: it is the spec's own record of what was ISSUED, so a Final Release uploaded
 * but not yet issued is refused too.
 *
 * A reviewer's token is checked against the version they are asking for, not just for
 * existence: without that, any live review token in the system would unlock any other
 * spec's PDF.
 *
 * The TTL is deliberately short. A URL copied out of a network log should be dead before it
 * can be pasted anywhere useful; the browser only needs it long enough to start the transfer.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   — the bucket is unreachable without it
 */

import {
  NetlifyEvent, json, serviceClient, userClient, authenticate,
  AuthError, ConfigError, ForbiddenError, ValidationError, assertUuid,
} from './lib/http';

const BUCKET = 'design-specs';

/** Five minutes. Long enough to open a 50MB PDF on a bad connection, short enough to rot. */
export const SIGNED_URL_TTL_SECONDS = 300;

interface FileRequest {
  /** design_spec_versions.id — which version's PDF is wanted. */
  versionId?: unknown;
  /** REVIEWER path: a review_shares.token. Omitted on the internal path. */
  token?: unknown;
  /** PORTAL path: projects.supplier_link_token. */
  projectToken?: unknown;
  /** PORTAL path: suppliers.portal_token + suppliers.access_code, which travel together. */
  supplierToken?: unknown;
  accessCode?: unknown;
}

/** Read a body field as a non-empty string, or null. */
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/** One message for every reviewer-side refusal, so a probe cannot tell the cases apart. */
const DEAD_LINK = 'This review link is invalid, expired or has been revoked.';

/**
 * Likewise for the portal: a wrong token, a spec on someone else's project and a spec that
 * has not been issued all read the same, so the endpoint cannot be used to discover which of
 * those is true.
 */
const NO_PORTAL_ACCESS = 'This design spec is not available from your portal.';

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let supabase: ReturnType<typeof serviceClient>;
  try {
    supabase = serviceClient();
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }

  let req: FileRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  let versionId: string;
  try {
    versionId = assertUuid(req.versionId, 'versionId');
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'versionId must be a UUID.' });
  }

  // The version, and the spec it belongs to. Read with the service role because the reviewer
  // path has no session for RLS to key off; the entitlement check is the code below.
  //
  // The embed names its FK explicitly: migration 163 also put a composite FK the other way
  // (design_specs.final_version_id -> design_spec_versions), so PostgREST sees two
  // relationships between these tables and refuses to guess which one `design_specs(...)`
  // means. Left unqualified, every request here 500s with "more than one relationship was
  // found" — the in-memory test fake doesn't catch this because it ignores the select string.
  const { data: version, error: vErr } = await supabase
    .from('design_spec_versions')
    .select('id, spec_id, version, stage, revision, storage_path, stamped_path, design_specs!design_spec_versions_spec_id_fkey(project_id, spec_code, final_version_id)')
    .eq('id', versionId)
    .maybeSingle();

  if (vErr) {
    console.error('[design-spec-file] version lookup failed:', vErr);
    return json(500, { error: 'Could not load that design spec.' });
  }
  if (!version) return json(404, { error: 'No such design spec version.' });

  // supabase-js types an embedded relation as an array even when the foreign key makes it
  // to-one, and which shape actually arrives has changed between client versions. Accepting
  // both is cheaper than pinning a cast that a dependency bump can quietly invalidate.
  const relation = version.design_specs as unknown;
  const spec = (Array.isArray(relation) ? relation[0] : relation) as
    { project_id: string; spec_code: string; final_version_id: string | null } | null | undefined;

  if (!spec) {
    console.error('[design-spec-file] version has no spec:', versionId);
    return json(500, { error: 'Could not load that design spec.' });
  }

  const reviewToken = str(req.token);
  const projectToken = str(req.projectToken);
  const supplierToken = str(req.supplierToken);
  const accessCode = str(req.accessCode);
  const hasPortal = projectToken !== null || (supplierToken !== null && accessCode !== null);
  let objectPath: string;

  if (reviewToken) {
    // ---- (a) REVIEWER ----
    // The same filters review_resolve applies, enforced here in TypeScript because the
    // service role bypasses RLS. Deliberately NOT via that RPC: resolving bumps use_count,
    // which means "the portal was opened", and fetching the file again is not that.
    const { data: share, error: sErr } = await supabase
      .from('review_shares')
      .select('id, subject_id, subject_type, revoked_at, expires_at')
      .eq('token', reviewToken)
      .eq('mode', 'review')
      .is('revoked_at', null)
      .maybeSingle();

    if (sErr) {
      console.error('[design-spec-file] share lookup failed:', sErr);
      return json(500, { error: 'Could not verify that review link.' });
    }

    const expired = share?.expires_at != null
      && new Date(share.expires_at as string) <= new Date();

    // The token must be FOR THIS VERSION. Without this equality any live review token in the
    // system — including one for a different project's spec — would unlock this PDF.
    const wrongSubject = share?.subject_type !== 'design_spec'
      || share?.subject_id !== versionId;

    if (!share || expired || wrongSubject) return json(403, { error: DEAD_LINK });

    // A reviewer gets the stamped copy. Falling back to the original would silently hand out
    // an unmarked spec the moment stamping had failed, so this refuses instead — except for
    // a Final Release, which is served as the design team made it, by decision.
    if (version.stage === 'final') {
      objectPath = version.storage_path as string;
    } else if (version.stamped_path) {
      objectPath = version.stamped_path as string;
    } else {
      console.error('[design-spec-file] version has no stamped copy:', versionId);
      return json(409, {
        error: 'This version is still being prepared for review. Please try again shortly.',
      });
    }
  } else if (hasPortal) {
    // ---- (c) SUPPLIER PORTAL ----
    // The issued final and nothing else. Tested against the SPEC's final_version_id rather
    // than the version's own `stage`, because a Final Release that has been uploaded but not
    // yet issued is not something the supplier has been told to build to — see the header.
    if (!spec.final_version_id || spec.final_version_id !== versionId) {
      return json(403, { error: NO_PORTAL_ACCESS });
    }

    // Same two credentials, same checks, as supplier-file-url.ts. The service role bypasses
    // RLS, so this comparison IS the authorization.
    const { data: project, error: pErr } = await supabase
      .from('projects')
      .select('supplier_link_token, supplier_id')
      .eq('id', spec.project_id)
      .maybeSingle();

    if (pErr) {
      console.error('[design-spec-file] project lookup failed:', pErr);
      return json(500, { error: 'Could not verify your access.' });
    }
    if (!project) return json(403, { error: NO_PORTAL_ACCESS });

    let authorized = false;
    if (projectToken) {
      authorized = (project as { supplier_link_token: string | null }).supplier_link_token
        === projectToken;
    } else if (supplierToken && accessCode && (project as { supplier_id: string | null }).supplier_id) {
      const { data: supplier } = await supabase
        .from('suppliers')
        .select('portal_token, access_code')
        .eq('id', (project as { supplier_id: string }).supplier_id)
        .maybeSingle();
      const s = supplier as { portal_token: string | null; access_code: string | null } | null;
      authorized = !!s && s.portal_token === supplierToken && s.access_code === accessCode;
    }
    if (!authorized) return json(403, { error: NO_PORTAL_ACCESS });

    // The original, exactly as the design team issued it. A final carries no stamp by
    // decision (see the reviewer branch above), so there is no other copy to serve.
    objectPath = version.storage_path as string;
  } else {
    // ---- (b) INTERNAL ----
    // Asking Postgres as the caller IS the authorization: a designer reaches the project
    // through `design_editors_read_projects`, an admin and the owning PM through their own
    // policies (migrations 81/163). No role check is reimplemented here.
    try {
      await authenticate(event);
      const { data, error } = await userClient(event)
        .from('projects')
        .select('id')
        .eq('id', spec.project_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new ForbiddenError('You do not have access to this design spec.');
    } catch (e) {
      if (e instanceof AuthError) return json(401, { error: e.message });
      if (e instanceof ForbiddenError) return json(403, { error: e.message });
      if (e instanceof ConfigError) return json(500, { error: e.message });
      if (e instanceof ValidationError) return json(400, { error: e.message });
      console.error('[design-spec-file] internal authorization failed:', e);
      return json(500, { error: 'Could not verify your access.' });
    }
    objectPath = version.storage_path as string;
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  if (signErr || !signed?.signedUrl) {
    console.error('[design-spec-file] createSignedUrl failed:', signErr);
    return json(500, { error: 'Could not prepare that download.' });
  }

  return json(200, {
    url: signed.signedUrl,
    expiresIn: SIGNED_URL_TTL_SECONDS,
    version: version.version,
    stage: version.stage,
    revision: version.revision,
    specCode: spec.spec_code,
    // Says which object was served, so a reviewer's client can never be confused about
    // whether it is looking at a stamped review copy or an original.
    stamped: reviewToken !== null && version.stage !== 'final',
  });
};
