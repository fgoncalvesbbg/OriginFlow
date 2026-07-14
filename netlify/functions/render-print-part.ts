/**
 * Print-PDF pipeline, step 2/4: PART (Netlify Function).
 *
 * Renders EXACTLY ONE part (cover / one language body / back) via PDFShift and
 * uploads the result to a temp storage path namespaced by the client-generated
 * `jobId`. The client calls this once per part, in parallel, from the browser —
 * so no single invocation ever does more than one PDFShift conversion, which is
 * what keeps large multi-language manuals under Netlify's per-invocation time
 * ceiling (see lib/print-render-shared.ts for the full rationale).
 */

import { createClient } from '@supabase/supabase-js';
import {
  NetlifyEvent,
  RenderRequestBase,
  isValidBase,
  json,
  fetchManifestAndManuals,
  buildParts,
  renderPartPdf,
  marginFor,
  tempPartPath,
  BUCKET,
  AuthError,
} from './lib/print-render-shared';

interface PartRequest extends RenderRequestBase {
  jobId: string;
  partIndex: number;
}

const isValidPartRequest = (b: unknown): b is PartRequest => {
  if (!isValidBase(b)) return false;
  const r = b as PartRequest;
  return typeof r.jobId === 'string' && !!r.jobId && typeof r.partIndex === 'number' && r.partIndex >= 0;
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.PDFSHIFT_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey) return json(500, { error: 'PDFSHIFT_API_KEY is not configured on the server.' });
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let req: PartRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!isValidPartRequest(req)) return json(400, { error: 'Invalid request body.' });

  try {
    const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new AuthError('Authentication required.');
    const { error: authErr } = await supabase.auth.getUser(token);
    if (authErr) throw new AuthError('Invalid or expired session.');

    const { manuals } = await fetchManifestAndManuals(supabaseUrl, req);
    const { parts, compact } = buildParts(manuals, req);
    if (req.partIndex >= parts.length) {
      return json(400, { error: `partIndex ${req.partIndex} out of range (0..${parts.length - 1}).` });
    }

    const format = req.pageSize.toUpperCase();
    const pdfBytes = await renderPartPdf(parts[req.partIndex].html, format, apiKey, marginFor(compact));

    const path = tempPartPath(req.projectId, req.templateType, req.jobId, req.partIndex);
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, Buffer.from(pdfBytes), {
      upsert: true,
      contentType: 'application/pdf',
      cacheControl: '0',
    });
    if (upErr) throw new Error(`Temp part upload failed (${path}): ${upErr.message}`);

    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    const message = e instanceof Error ? e.message : 'Print part render failed.';
    return json(502, { error: message });
  }
};
