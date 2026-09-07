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

import {
  NetlifyEvent,
  json,
  serviceClient,
  authenticate,
  authorizeProject,
  assertJobId,
  AuthError,
  ForbiddenError,
  ValidationError,
} from './lib/http';
import {
  RenderRequestBase,
  isValidBase,
  loadManuals,
  buildParts,
  renderPartPdf,
  marginFor,
  resolveTypography,
  tempPartPath,
  assertRenderProjectId,
  BUCKET,
  PermanentError,
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
  if (!apiKey) return json(500, { error: 'PDFSHIFT_API_KEY is not configured on the server.' });

  const supabaseUrl = process.env.SUPABASE_URL;
  let supabase: ReturnType<typeof serviceClient>;
  try {
    supabase = serviceClient();
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Server misconfiguration.' });
  }
  if (!supabaseUrl) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
  }

  let req: PartRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!isValidPartRequest(req)) return json(400, { error: 'Invalid request body.' });

  try {
    // Every parameter interpolated into a Storage key is validated before it is used.
    const { value: projectId, isDraft } = assertRenderProjectId(req.projectId);
    assertJobId(req.jobId);

    // AUTHORIZATION, not just authentication — see render-print-prepare.ts's comment.
    if (isDraft) await authenticate(event);
    else await authorizeProject(event, projectId);

    const { manuals } = await loadManuals(supabase, req);
    const { parts } = buildParts(manuals, req);
    if (req.partIndex >= parts.length) {
      return json(400, { error: `partIndex ${req.partIndex} out of range (0..${parts.length - 1}).` });
    }

    const format = req.pageSize.toUpperCase();
    // Margins come from the global print settings (Admin → IM Print), range-checked here.
    const pdfBytes = await renderPartPdf(parts[req.partIndex].html, format, apiKey, marginFor(resolveTypography(req)));

    const path = tempPartPath(projectId, req.templateType, req.jobId, req.partIndex);
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, Buffer.from(pdfBytes), {
      upsert: true,
      contentType: 'application/pdf',
      cacheControl: '0',
    });
    if (upErr) {
      // Log the storage path + driver detail server-side only — never echo it to the caller.
      console.error(`[render-print-part] temp part upload failed (${path}):`, upErr);
      throw new Error('Temp part upload failed.');
    }

    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    if (e instanceof ForbiddenError) return json(403, { error: e.message });
    if (e instanceof ValidationError) return json(400, { error: e.message });
    // Permanent failures (bad HTML, unpublished language) get 422 so the client
    // fails fast instead of retrying a conversion that can never succeed. These
    // messages are hand-crafted to be safe to show — never a raw driver string.
    if (e instanceof PermanentError) return json(422, { error: e.message });
    console.error('[render-print-part] failed:', e);
    return json(502, { error: 'Print part render failed. Please try again or contact support.', code: 'PART_RENDER_FAILED' });
  }
};
