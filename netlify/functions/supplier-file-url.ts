/**
 * Supplier document signed-URL issuer (Netlify Function).
 *
 * `documents` is private already; `im-print` is about to be flipped from public to private
 * too (see im-file-url.ts's header for the staff/portal-share side of that same migration).
 * External suppliers (anon, no Supabase session) cannot read storage objects directly, so
 * this endpoint issues a short-lived signed URL ONLY after validating the caller's portal
 * credentials:
 *   - a project portal token (projects.supplier_link_token), OR
 *   - a supplier portal token + access code (suppliers.portal_token + access_code).
 * In both cases the requested document must belong to that supplier/project.
 *
 * TWO buckets, one document row. `project_documents.file_url` is written from two different
 * places with two different bucket shapes: ordinary uploads land in `documents`
 * (project-document.service.ts's uploadFile), but the Printed IM / Warning Leaflet PDFs a PM
 * shares with a supplier are pointed at an `im-print` render's permanent `.url`
 * (ProjectDetail.tsx's handleShareWithSupplier → setSupplierPdfDocument — that `.url` is kept
 * around deliberately, see im-print-export.service.ts's PrintRender comment, precisely so a
 * consumer like this one can still resolve it). `toStorageRef` below reads the BUCKET back out
 * of the stored URL itself rather than assuming `documents`, so both shapes resolve correctly.
 *
 * `im-print` gets one extra check `documents` doesn't need: every object in that bucket lives
 * at `<projectId>/<templateType>/<file>` (render-print-merge.ts), and the path's leading
 * segment is verified to equal the document's OWN `project_id` before signing. The document
 * row is already proven to belong to the token's project by the lookups below, so in the
 * ordinary case this is redundant — but it is a cheap, load-bearing backstop against a
 * mis-pointed `file_url` (bad data, a copy-paste bug, anything) silently handing out a signed
 * URL to a DIFFERENT project's PDF than the one this token is scoped to. A token for project A
 * must never sign project B's file, full stop, independent of whether the `project_documents`
 * row's own bookkeeping is trustworthy.
 *
 * `is_visible_to_supplier` is enforced HERE, not just in the SPA. The portal page
 * (SupplierPortal.tsx) only ever LISTS documents where that flag is true, but until now this
 * endpoint would sign anything belonging to the project regardless — so a supplier holding a
 * valid project/supplier token could mint a signed URL for an internal-only document simply by
 * knowing (or guessing) its id. This function is the actual authorization boundary; the SPA's
 * client-side filter is a UI convenience, not a security control, and must not be the only
 * place this is checked.
 *
 * PMs (authenticated) do NOT use this endpoint — they create signed URLs directly
 * with their session via the authenticated storage policy.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service role, so signing bypasses storage RLS
 */

import { NetlifyEvent, json, serviceClient } from './lib/http';

interface UrlRequest {
  docId: string;
  projectToken?: string;
  supplierToken?: string;
  accessCode?: string;
}

/** The only two buckets a `project_documents.file_url` may point into. Anything else is refused. */
const ALLOWED_BUCKETS = new Set(['documents', 'im-print']);

/** Per-bucket signed-TTL: `documents` is typically a small upload; `im-print` can be a
 *  multi-hundred-page merged PDF downloaded over a slow supplier connection, so it gets the
 *  same longer window `im-file-url.ts` grants staff/portal downloads of the same bucket. */
const TTL_SECONDS: Record<string, number> = {
  documents: 120,
  'im-print': 900,
};

interface StorageRef {
  bucket: string;
  path: string;
}

/**
 * Derive {bucket, path} from a stored `file_url`. Handles both the Supabase Storage
 * public/signed URL shape (`.../storage/v1/object/(public|sign)/<bucket>/<path>`) and a bare
 * in-bucket path with no host (the pre-signed-URL legacy shape, always `documents`).
 *
 * Refuses: any bucket outside `ALLOWED_BUCKETS`, an absolute URL that doesn't match the known
 * Supabase Storage shape (no guessing), and any path containing `..` or starting with `/`.
 */
const toStorageRef = (fileUrl: string): StorageRef | null => {
  if (!fileUrl) return null;

  let bucket: string;
  let rawPath: string;

  const m = fileUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
  if (m) {
    bucket = decodeURIComponent(m[1]);
    rawPath = decodeURIComponent(m[2]);
  } else if (fileUrl.startsWith('http')) {
    // Some other absolute URL shape — refuse rather than guess at a bucket/path split.
    return null;
  } else {
    // Bare path (no host): the pre-signed-URL shape, always the `documents` bucket.
    bucket = 'documents';
    rawPath = fileUrl.replace(/^\/+/, '');
  }

  if (!ALLOWED_BUCKETS.has(bucket)) return null;
  if (!rawPath || rawPath.startsWith('/') || rawPath.includes('..')) return null;
  return { bucket, path: rawPath };
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let supabase: ReturnType<typeof serviceClient>;
  try {
    supabase = serviceClient();
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }

  let req: UrlRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!req.docId || typeof req.docId !== 'string') {
    return json(400, { error: 'docId is required.' });
  }
  const hasProject = typeof req.projectToken === 'string' && req.projectToken.length > 0;
  const hasSupplier =
    typeof req.supplierToken === 'string' && req.supplierToken.length > 0 &&
    typeof req.accessCode === 'string' && req.accessCode.length > 0;
  if (!hasProject && !hasSupplier) {
    return json(400, { error: 'A project token or supplier token + access code is required.' });
  }

  // Load the document and its project, then authorize via explicit lookups
  // (service role bypasses RLS; we enforce the token/code check ourselves here).
  const { data: doc, error: docErr } = await supabase
    .from('project_documents')
    .select('id, file_url, project_id, is_visible_to_supplier')
    .eq('id', req.docId)
    .maybeSingle();
  if (docErr || !doc) return json(404, { error: 'Document not found.' });

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('supplier_link_token, supplier_id')
    .eq('id', (doc as any).project_id)
    .maybeSingle();
  if (projErr || !project) return json(404, { error: 'Project not found.' });

  let authorized = false;
  if (hasProject) {
    authorized = (project as any).supplier_link_token === req.projectToken;
  } else if (hasSupplier && (project as any).supplier_id) {
    const { data: supplier } = await supabase
      .from('suppliers')
      .select('portal_token, access_code')
      .eq('id', (project as any).supplier_id)
      .maybeSingle();
    authorized = !!supplier &&
      (supplier as any).portal_token === req.supplierToken &&
      (supplier as any).access_code === req.accessCode;
  }
  if (!authorized) return json(403, { error: 'Not authorized for this document.' });

  // The document belonging to the token's project is not enough on its own — it must also be
  // flagged shared. The SPA's own listing already filters on this client-side; that filter is
  // cosmetic, not a security boundary, so it is re-checked here regardless of how the caller
  // learned this docId.
  if (!(doc as any).is_visible_to_supplier) {
    return json(403, { error: 'This document is not shared with the supplier.' });
  }

  const ref = toStorageRef((doc as any).file_url || '');
  if (!ref) return json(404, { error: 'No file is attached to this document.' });

  // Extra backstop for im-print specifically: confirm the object's own path sits under THIS
  // document's project, not just that the document row claims to. See file header.
  if (ref.bucket === 'im-print') {
    const projectId = (doc as any).project_id as string;
    const firstSegment = ref.path.split('/')[0];
    if (firstSegment !== projectId) {
      return json(403, { error: 'Not authorized for this document.' });
    }
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(ref.bucket)
    .createSignedUrl(ref.path, TTL_SECONDS[ref.bucket] ?? 120);

  if (signErr || !signed?.signedUrl) {
    return json(500, { error: 'Could not create a download link.' });
  }
  return json(200, { url: signed.signedUrl });
};
