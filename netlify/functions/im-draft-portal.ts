/**
 * Supplier IM draft intake (Netlify Function) — migration 179.
 *
 * The supplier uploads the draft manual from the portal they already have; that mints a
 * review link for Quality on the shared review layer; Quality marks the PDF up and submits.
 * The project then reads Backlog with a brief, and the writer opens the PDF plus those notes.
 *
 * WHY ONE FUNCTION WITH FIVE ROUTES. `im_draft_requests` and `im_draft_uploads` are
 * RLS-scoped to can_see_project and the `im-drafts` bucket has ZERO storage policies, so
 * neither the supplier nor Quality can reach any of it directly — this function is the only
 * door, and every route needs the same service-role client and the same credential helpers.
 * Same shape as doc-portal.ts, routed by path suffix through netlify.toml.
 *
 *   POST /api/im-draft/requests    supplier credential  open draft slots for their projects
 *   POST /api/im-draft/upload-url  supplier credential  signed PUT at a path WE choose
 *   POST /api/im-draft/commit      supplier credential  validate bytes, record, mint QM link
 *   POST /api/im-draft/queue       QM access code       drafts awaiting review + their tokens
 *   POST /api/im-draft/file        review token | staff | supplier   short-TTL signed GET
 *
 * THE ACCESS CODE IS VERIFIED ONLY HERE, against the pgcrypto hash in im_draft_portal_config
 * — a table with no policy and no grant to anon or authenticated. There is deliberately no
 * RPC that checks it, so PostgREST offers no second door, and the plaintext never exists
 * server-side beyond the comparison below.
 *
 * WHAT THE QM QUEUE DELIBERATELY EXPOSES. Anyone holding the shared code can open any draft
 * AWAITING REVIEW. That is the accepted price of Quality not logging in. It is bounded: the
 * queue never returns the project list, never a project without a pending draft, and never a
 * published manual. Rotating the code in im_draft_portal_config revokes everyone at once.
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

type Supabase = ReturnType<typeof serviceClient>;

const BUCKET = 'im-drafts';
const CONTENT_TYPE = 'application/pdf';

/** Mirrors the bucket's file_size_limit (50MB) in migration 179. */
export const MAX_DRAFT_PDF_BYTES = 52428800;

/** How long a minted download URL lives. Long enough to open, short enough to be useless if copied. */
const SIGNED_URL_TTL_SECONDS = 300;

/** Review links for Quality. 60 days — a draft round is slower than a supplier round. */
const QM_LINK_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/** Access-code attempts allowed per window, keyed per caller IP. */
const CODE_ATTEMPT_LIMIT = 10;
const CODE_ATTEMPT_WINDOW_SECONDS = 900;

/** One message for every reviewer-side refusal, so a probe cannot tell the cases apart. */
const DEAD_LINK = 'This review link is invalid, expired or has been revoked.';

/** Likewise for the supplier portal: wrong token, someone else's project, no such request. */
const NO_PORTAL_ACCESS = 'That draft is not available from your portal.';

/** And for the QM queue, so a wrong code and an empty queue are indistinguishable. */
const BAD_CODE = 'That access code is not valid.';

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/** %PDF- magic. A renamed .docx passes the mime check at the storage layer but not this. */
const isPdf = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50
  && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;

/**
 * Page count straight off the PDF, without pulling in a parser: count the `/Type /Page`
 * objects that are not `/Pages`. Best-effort and informational only — it is shown on a card,
 * never relied on for a decision — so an odd file yielding null is fine.
 */
const countPages = (bytes: Uint8Array): number | null => {
  try {
    const text = Buffer.from(bytes).toString('latin1');
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return matches?.length || null;
  } catch {
    return null;
  }
};

/** The caller's IP, for rate-limit keying. Netlify sets x-nf-client-connection-ip. */
const callerIp = (event: NetlifyEvent): string =>
  event.headers?.['x-nf-client-connection-ip']
  || (event.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  || 'unknown';

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

interface SupplierCredential {
  projectToken: string | null;
  supplierToken: string | null;
  accessCode: string | null;
}

/**
 * Portal credentials travel in HEADERS, not the query string or body — the house rule from
 * lib/doc-access.ts. A token in a URL lands in browser history, proxy logs and Referer.
 */
const supplierCredential = (event: NetlifyEvent): SupplierCredential => ({
  projectToken: str(event.headers?.['x-portal-token']),
  supplierToken: str(event.headers?.['x-supplier-token']),
  accessCode: str(event.headers?.['x-supplier-code']),
});

const hasSupplierCredential = (c: SupplierCredential): boolean =>
  !!c.projectToken || !!(c.supplierToken && c.accessCode);

/**
 * Which projects a supplier credential speaks for. The service role bypasses RLS, so this
 * comparison IS the authorization — the same two credentials and the same checks as
 * design-spec-file.ts and supplier-file-url.ts.
 *
 * Returns an empty array for anything that does not check out, so every caller fails closed
 * by finding no projects rather than by forgetting an `if`.
 */
const projectsForSupplier = async (
  supabase: Supabase,
  c: SupplierCredential,
): Promise<string[]> => {
  if (c.projectToken) {
    const { data } = await supabase
      .from('projects').select('id').eq('supplier_link_token', c.projectToken);
    return (data ?? []).map(r => (r as { id: string }).id);
  }
  if (c.supplierToken && c.accessCode) {
    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id, portal_token, access_code')
      .eq('portal_token', c.supplierToken)
      .maybeSingle();
    const s = supplier as { id: string; portal_token: string; access_code: string | null } | null;
    if (!s || s.access_code !== c.accessCode) return [];
    const { data } = await supabase.from('projects').select('id').eq('supplier_id', s.id);
    return (data ?? []).map(r => (r as { id: string }).id);
  }
  return [];
};

/**
 * Which project an INTERNAL (staff) caller may act on, for this request body.
 *
 * A re-edit (migration 182) has no supplier, so its requirement PDF is attached by the
 * person writing the manual rather than uploaded through the portal. Rather than a second
 * upload pipeline, the same two routes serve both: only the credential differs.
 *
 * Asking Postgres AS THE CALLER is the authorization, exactly as the /file route's internal
 * branch does — PM-scoped RLS already restricts `projects` to the caller's own (or every
 * project, for an admin), so there is no role check to forget here. Returns the single
 * project the request belongs to, or an empty array, so callers fail closed on the same
 * `projectIds.includes(...)` test the supplier paths use.
 */
const projectsForStaff = async (
  supabase: Supabase,
  event: NetlifyEvent,
  body: { requestId?: unknown },
): Promise<string[]> => {
  let requestId: string;
  try {
    requestId = assertUuid(body.requestId, 'requestId');
  } catch {
    return [];
  }

  const { data } = await supabase
    .from('im_draft_requests').select('project_id').eq('id', requestId).maybeSingle();
  const projectId = (data as { project_id: string } | null)?.project_id ?? null;
  if (!projectId) return [];

  await authenticate(event);
  const { data: proj, error } = await userClient(event)
    .from('projects').select('id').eq('id', projectId).maybeSingle();
  if (error) throw new Error(error.message);
  return proj ? [projectId] : [];
};

/**
 * The QM access code, checked against the pgcrypto hash. Rate-limited per IP BEFORE the
 * comparison, reusing doc_rate_limit_hit from migration 159 (a generic keyed counter despite
 * the name). Returns false for a wrong code, a missing config row and a throttled caller
 * alike — the handler renders all three as BAD_CODE.
 */
const checkQmCode = async (
  supabase: Supabase,
  event: NetlifyEvent,
  code: string | null,
): Promise<boolean> => {
  if (!code) return false;

  const { data: allowed } = await supabase.rpc('doc_rate_limit_hit', {
    p_key: `im-draft-code:${callerIp(event)}`,
    p_limit: CODE_ATTEMPT_LIMIT,
    p_window_s: CODE_ATTEMPT_WINDOW_SECONDS,
  });
  if (allowed === false) return false;

  // crypt() re-hashes the candidate with the stored hash as its salt, so this is a constant
  // -time comparison done in Postgres. The plaintext is never stored and never logged.
  const { data, error } = await supabase.rpc('im_draft_check_code', { p_code: code });
  if (error) {
    console.error('[im-draft-portal] code check failed:', error);
    return false;
  }
  return data === true;
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Open draft slots for the projects this supplier credential speaks for. */
const listRequests = async (supabase: Supabase, projectIds: string[]) => {
  if (projectIds.length === 0) return json(200, { requests: [] });

  const { data, error } = await supabase
    .from('im_draft_requests')
    .select('id, project_id, template_type, step_number, requested_at, due_date, note, projects(name, project_id_code)')
    .in('project_id', projectIds)
    .is('cancelled_at', null)
    .order('requested_at', { ascending: false });

  if (error) {
    console.error('[im-draft-portal] request list failed:', error);
    return json(500, { error: 'Could not load your draft requests.' });
  }

  const ids = (data ?? []).map(r => (r as { id: string }).id);
  const { data: uploads } = ids.length
    ? await supabase
        .from('im_draft_uploads')
        .select('request_id, version, uploaded_at, original_filename')
        .in('request_id', ids)
        .is('withdrawn_at', null)
        .order('version', { ascending: false })
    : { data: [] as unknown[] };

  const latest = new Map<string, { version: number; uploaded_at: string; original_filename: string | null }>();
  for (const u of (uploads ?? []) as Array<{ request_id: string; version: number; uploaded_at: string; original_filename: string | null }>) {
    if (!latest.has(u.request_id)) latest.set(u.request_id, u);
  }

  return json(200, {
    requests: (data ?? []).map(r => {
      const row = r as {
        id: string; project_id: string; template_type: string; step_number: number | null;
        requested_at: string; due_date: string | null; note: string | null;
        projects: { name: string; project_id_code: string | null } | null;
      };
      const last = latest.get(row.id);
      return {
        id: row.id,
        templateType: row.template_type,
        // Which phase the supplier sees this ask in (migration 180).
        stepNumber: row.step_number ?? 2,
        requestedAt: row.requested_at,
        dueDate: row.due_date,
        note: row.note,
        projectName: row.projects?.name ?? null,
        projectCode: row.projects?.project_id_code ?? null,
        latestVersion: last?.version ?? null,
        latestUploadedAt: last?.uploaded_at ?? null,
      };
    }),
  });
};

/**
 * A signed upload URL at a path THIS function chooses. The bytes never pass through here —
 * a 50MB body cannot fit in a Netlify Function, and the browser already holds the file.
 */
const mintUploadUrl = async (
  supabase: Supabase,
  projectIds: string[],
  body: { requestId?: unknown; byteSize?: unknown },
) => {
  let requestId: string;
  try {
    requestId = assertUuid(body.requestId, 'requestId');
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'requestId must be a UUID.' });
  }

  if (typeof body.byteSize === 'number' && body.byteSize > MAX_DRAFT_PDF_BYTES) {
    return json(413, { error: 'That PDF is larger than the 50MB limit.' });
  }

  const { data: request } = await supabase
    .from('im_draft_requests')
    .select('id, project_id, cancelled_at')
    .eq('id', requestId)
    .maybeSingle();

  const r = request as { id: string; project_id: string; cancelled_at: string | null } | null;
  // A request on someone else's project and a request that does not exist read the same.
  if (!r || !projectIds.includes(r.project_id)) return json(403, { error: NO_PORTAL_ACCESS });
  if (r.cancelled_at) {
    return json(409, { error: 'This draft is no longer being collected. Contact your project manager.' });
  }

  // The upload id is chosen here and returned, so /commit addresses a row we already named
  // and a caller cannot direct the bytes anywhere else in the bucket.
  const uploadId = randomUUID();
  const path = `${requestId}/${uploadId}-draft.pdf`;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    console.error('[im-draft-portal] createSignedUploadUrl failed:', error);
    return json(500, { error: 'Could not prepare the upload.' });
  }

  return json(200, { uploadId, path, signedUrl: data.signedUrl, contentType: CONTENT_TYPE });
};

/**
 * Record an upload that has landed, and open Quality's review round for it.
 *
 * The bytes are READ BACK and validated before anything is recorded: size, `%PDF-` magic,
 * and that the object sits under the prefix we minted. A file that fails is DELETED and
 * refused, so a rejected upload cannot linger in the bucket — the doc-registry.ts rule.
 */
const commitUpload = async (
  supabase: Supabase,
  projectIds: string[],
  body: { requestId?: unknown; uploadId?: unknown; uploadedByName?: unknown; originalFilename?: unknown },
  /**
   * `false` for an internal attachment (a re-edit's requirement, migration 182): it is
   * recorded with `source: 'internal'` and opens NO quality review round. A re-edit has no
   * supplier draft to check — the requirement is the brief itself, written by the person who
   * raised the re-edit — so a QM round would be a queue entry nobody is waiting on.
   */
  isSupplier = true,
) => {
  let requestId: string;
  let uploadId: string;
  try {
    requestId = assertUuid(body.requestId, 'requestId');
    uploadId = assertUuid(body.uploadId, 'uploadId');
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'Invalid identifiers.' });
  }

  const { data: request } = await supabase
    .from('im_draft_requests')
    .select('id, project_id, template_type, cancelled_at')
    .eq('id', requestId)
    .maybeSingle();

  const r = request as {
    id: string; project_id: string; template_type: string; cancelled_at: string | null;
  } | null;
  if (!r || !projectIds.includes(r.project_id)) return json(403, { error: NO_PORTAL_ACCESS });
  if (r.cancelled_at) {
    return json(409, { error: 'This draft is no longer being collected. Contact your project manager.' });
  }

  const path = `${requestId}/${uploadId}-draft.pdf`;

  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(path);
  if (dlErr || !blob) {
    return json(400, { error: 'That upload did not arrive. Please try again.' });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const reject = async (message: string, status = 400) => {
    await supabase.storage.from(BUCKET).remove([path]);
    return json(status, { error: message });
  };

  if (bytes.byteLength === 0) return reject('That file is empty.');
  if (bytes.byteLength > MAX_DRAFT_PDF_BYTES) {
    return reject('That PDF is larger than the 50MB limit.', 413);
  }
  if (!isPdf(bytes)) return reject('That file is not a PDF.');

  /**
   * WHO UPLOADED IT IS DERIVED, NOT TYPED. Uploading a draft is the same gesture as
   * uploading any other project document, and no other upload in the portal asks who you
   * are — a name box on this one alone is friction the supplier has no reason to expect.
   *
   * The credential already identifies the company, so the server reads the supplier's name
   * off the project. That is also more trustworthy than a free-text field: nobody can type
   * someone else's company into it. `uploadedByName` is still accepted for the internal and
   * quality-uploaded paths (im_draft_uploads.source), where there is no supplier to derive.
   */
  const { data: projectRow } = await supabase
    .from('projects')
    .select('suppliers(name)')
    .eq('id', r.project_id)
    .maybeSingle();

  const supplierName =
    (projectRow as { suppliers?: { name?: string } | null } | null)?.suppliers?.name ?? null;
  const uploadedByName =
    (str(body.uploadedByName) ?? '').trim().slice(0, 120) || supplierName || 'Supplier';

  const { data: inserted, error: insErr } = await supabase
    .from('im_draft_uploads')
    .insert({
      id: uploadId,
      request_id: requestId,
      source: isSupplier ? 'supplier' : 'internal',
      storage_path: path,
      original_filename: (str(body.originalFilename) ?? '').slice(0, 260) || null,
      page_count: countPages(bytes),
      byte_size: bytes.byteLength,
      uploaded_by_name: uploadedByName,
    })
    .select('id, version')
    .single();

  if (insErr || !inserted) {
    console.error('[im-draft-portal] upload insert failed:', insErr);
    return reject('Could not record that upload.', 500);
  }

  const version = (inserted as { version: number }).version;

  // An internal attachment is done here: recorded, readable from the manual's draft panel,
  // and in no queue.
  if (!isSupplier) return json(200, { uploadId, version, reviewToken: null });

  // Quality's round, on the shared review layer. subject_id is the upload, so a token is
  // bound to exactly one PDF and /file can prove it (see the token branch below).
  const { data: share, error: shareErr } = await supabase
    .from('review_shares')
    .insert({
      project_id: r.project_id,
      subject_type: 'im_draft',
      subject_id: uploadId,
      subject_version: version,
      mode: 'review',
      label: `Quality review — draft v${version}`,
      created_by: uploadedByName,
      expires_at: new Date(Date.now() + QM_LINK_TTL_MS).toISOString(),
    })
    .select('token')
    .single();

  if (shareErr || !share) {
    console.error('[im-draft-portal] review share insert failed:', shareErr);
    // The upload is recorded and valid; only the link failed. Say so rather than deleting
    // the supplier's work — the link can be re-minted internally.
    return json(500, {
      error: 'The draft was uploaded but the quality review link could not be created. Your project manager can open it manually.',
    });
  }

  return json(200, { uploadId, version, reviewToken: (share as { token: string }).token });
};

/** Drafts awaiting Quality's review, with the token that opens each. */
const qmQueue = async (supabase: Supabase) => {
  const { data, error } = await supabase
    .from('review_shares')
    .select('token, subject_id, subject_version, created_at, expires_at, project_id, projects(name, project_id_code)')
    .eq('subject_type', 'im_draft')
    .eq('mode', 'review')
    .is('submitted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[im-draft-portal] queue failed:', error);
    return json(500, { error: 'Could not load the draft queue.' });
  }

  const uploadIds = (data ?? [])
    .map(r => (r as { subject_id: string | null }).subject_id)
    .filter((v): v is string => !!v);

  const { data: uploads } = uploadIds.length
    ? await supabase
        .from('im_draft_uploads')
        .select('id, page_count, uploaded_at, uploaded_by_name, original_filename, withdrawn_at')
        .in('id', uploadIds)
    : { data: [] as unknown[] };

  const byId = new Map(
    ((uploads ?? []) as Array<{ id: string; withdrawn_at: string | null }>).map(u => [u.id, u]),
  );

  return json(200, {
    drafts: (data ?? [])
      .map(r => {
        const row = r as {
          token: string; subject_id: string | null; subject_version: number | null;
          created_at: string; expires_at: string | null;
          projects: { name: string; project_id_code: string | null } | null;
        };
        const upload = row.subject_id ? byId.get(row.subject_id) as {
          page_count: number | null; uploaded_at: string; uploaded_by_name: string;
          original_filename: string | null; withdrawn_at: string | null;
        } | undefined : undefined;
        // A withdrawn upload keeps its share row but must not be offered for review.
        if (!upload || upload.withdrawn_at) return null;
        // Expiry is filtered here rather than in the query: the alternative is
        // .or(`expires_at.is.null,expires_at.gt.${now}`), which interpolates a value into a
        // PostgREST filter STRING. Nothing here is attacker-controlled today, but building
        // filter strings by concatenation is the habit that eventually bites.
        if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
        return {
          token: row.token,
          version: row.subject_version,
          projectName: row.projects?.name ?? null,
          projectCode: row.projects?.project_id_code ?? null,
          pageCount: upload.page_count,
          uploadedAt: upload.uploaded_at,
          uploadedBy: upload.uploaded_by_name,
          filename: upload.original_filename,
        };
      })
      .filter(Boolean),
  });
};

/**
 * A short-TTL signed URL for one draft PDF. Three credential branches, deliberately
 * disjoint, checked in the order a caller presents them.
 */
const fileUrl = async (
  supabase: Supabase,
  event: NetlifyEvent,
  body: { uploadId?: unknown; token?: unknown },
) => {
  let uploadId: string;
  try {
    uploadId = assertUuid(body.uploadId, 'uploadId');
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'uploadId must be a UUID.' });
  }

  const token = str(body.token);

  const { data: upload, error: upErr } = await supabase
    .from('im_draft_uploads')
    .select('id, storage_path, withdrawn_at, im_draft_requests(project_id)')
    .eq('id', uploadId)
    .maybeSingle();

  if (upErr) {
    console.error('[im-draft-portal] upload lookup failed:', upErr);
    return json(500, { error: 'Could not load that draft.' });
  }
  const u = upload as {
    id: string; storage_path: string; withdrawn_at: string | null;
    im_draft_requests: { project_id: string } | null;
  } | null;
  if (!u) return json(token ? 403 : 404, token ? { error: DEAD_LINK } : { error: 'No such draft.' });

  const projectId = u.im_draft_requests?.project_id ?? null;

  if (token) {
    // ---- (a) QUALITY'S REVIEW TOKEN ----
    const { data: shareRow } = await supabase
      .from('review_shares')
      .select('subject_type, subject_id, mode, revoked_at, expires_at')
      .eq('token', token)
      .maybeSingle();

    const share = shareRow as {
      subject_type: string; subject_id: string | null; mode: string;
      revoked_at: string | null; expires_at: string | null;
    } | null;

    const expired = !!share?.expires_at && new Date(share.expires_at).getTime() <= Date.now();

    // THE CHECK THAT MATTERS. Without this equality any live review token in the system —
    // including one for a design spec, or for another project's draft — would unlock this
    // PDF. Every failure below returns the same string so a probe cannot tell them apart.
    const wrongSubject = share?.subject_type !== 'im_draft' || share?.subject_id !== uploadId;

    if (!share || share.mode !== 'review' || share.revoked_at || expired || wrongSubject
        || u.withdrawn_at) {
      return json(403, { error: DEAD_LINK });
    }
  } else if (hasSupplierCredential(supplierCredential(event))) {
    // ---- (c) THE SUPPLIER, re-reading what they uploaded ----
    const projectIds = await projectsForSupplier(supabase, supplierCredential(event));
    if (!projectId || !projectIds.includes(projectId)) {
      return json(403, { error: NO_PORTAL_ACCESS });
    }
  } else {
    // ---- (b) INTERNAL ----
    // Asking Postgres as the caller IS the authorization: PM-scoped RLS already restricts
    // projects to the caller's own (or every project, for an admin). No role check here.
    try {
      await authenticate(event);
      if (!projectId) throw new ForbiddenError('You do not have access to this draft.');
      const { data, error } = await userClient(event)
        .from('projects').select('id').eq('id', projectId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new ForbiddenError('You do not have access to this draft.');
    } catch (e) {
      if (e instanceof AuthError) return json(401, { error: e.message });
      if (e instanceof ForbiddenError) return json(403, { error: e.message });
      if (e instanceof ConfigError) return json(500, { error: e.message });
      console.error('[im-draft-portal] internal authorization failed:', e);
      return json(500, { error: 'Could not verify your access.' });
    }
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(u.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error('[im-draft-portal] createSignedUrl failed:', error);
    return json(500, { error: 'Could not open that draft.' });
  }

  return json(200, { url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
};

// ---------------------------------------------------------------------------

const routeOf = (path: string): string | null => {
  const m = /\/(requests|upload-url|commit|queue|file)\/?$/.exec(path);
  return m ? m[1] : null;
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const route = routeOf(event.path ?? '');
  if (!route) return json(404, { error: 'No such endpoint.' });

  let supabase: Supabase;
  try {
    supabase = serviceClient();
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  try {
    // /file owns its own three-way credential check; the QM queue owns the access code.
    if (route === 'file') return await fileUrl(supabase, event, body);

    if (route === 'queue') {
      const ok = await checkQmCode(supabase, event, str(body.code));
      if (!ok) return json(403, { error: BAD_CODE });
      return await qmQueue(supabase);
    }

    // `requests` lists a supplier's open slots and is supplier-only; `upload-url` and
    // `commit` also serve staff attaching a re-edit's requirement. Whichever credential is
    // presented, both end up at the SAME `projectIds.includes(...)` test inside the route,
    // so neither path can skip authorization.
    const credential = supplierCredential(event);
    const isSupplier = hasSupplierCredential(credential);

    if (route === 'requests') {
      if (!isSupplier) return json(401, { error: 'Portal credentials are required.' });
      return await listRequests(supabase, await projectsForSupplier(supabase, credential));
    }

    const projectIds = isSupplier
      ? await projectsForSupplier(supabase, credential)
      : await projectsForStaff(supabase, event, body);

    if (projectIds.length === 0) return json(403, { error: NO_PORTAL_ACCESS });
    if (route === 'upload-url') return await mintUploadUrl(supabase, projectIds, body);
    return await commitUpload(supabase, projectIds, body, isSupplier);
  } catch (e) {
    if (e instanceof ValidationError) return json(400, { error: e.message });
    if (e instanceof AuthError) return json(401, { error: e.message });
    if (e instanceof ForbiddenError) return json(403, { error: e.message });
    if (e instanceof ConfigError) return json(500, { error: e.message });
    console.error(`[im-draft-portal] ${route} failed:`, e);
    return json(500, { error: 'Something went wrong.' });
  }
};
