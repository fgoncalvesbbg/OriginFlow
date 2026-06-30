/**
 * Supplier document signed-URL issuer (Netlify Function).
 *
 * The `documents` bucket is private. External suppliers (anon, no Supabase
 * session) cannot read storage objects directly, so this endpoint issues a
 * short-lived signed URL ONLY after validating the caller's portal credentials:
 *   - a project portal token (projects.supplier_link_token), OR
 *   - a supplier portal token + access code (suppliers.portal_token + access_code).
 * In both cases the requested document must belong to that supplier/project.
 *
 * PMs (authenticated) do NOT use this endpoint — they create signed URLs directly
 * with their session via the authenticated storage policy.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service role, so signing bypasses storage RLS
 */

import { createClient } from '@supabase/supabase-js';

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
}

interface UrlRequest {
  docId: string;
  projectToken?: string;
  supplierToken?: string;
  accessCode?: string;
}

const BUCKET = 'documents';
const SIGNED_TTL_SECONDS = 120;

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/** Extract the in-bucket object path from a stored URL or a raw path. */
const toStoragePath = (fileUrl: string): string | null => {
  if (!fileUrl) return null;
  const m = fileUrl.match(/\/documents\/(.+)$/);
  if (m) return decodeURIComponent(m[1]);
  // Already a bare path (no host) — accept as-is.
  return fileUrl.startsWith('http') ? null : fileUrl.replace(/^\/+/, '');
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
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

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Load the document and its project, then authorize via explicit lookups
  // (service role bypasses RLS; we enforce the token/code check ourselves here).
  const { data: doc, error: docErr } = await supabase
    .from('project_documents')
    .select('id, file_url, project_id')
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

  const path = toStoragePath((doc as any).file_url || '');
  if (!path) return json(404, { error: 'No file is attached to this document.' });

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_TTL_SECONDS);

  if (signErr || !signed?.signedUrl) {
    return json(500, { error: 'Could not create a download link.' });
  }
  return json(200, { url: signed.signedUrl });
};
