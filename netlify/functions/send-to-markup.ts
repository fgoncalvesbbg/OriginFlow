/**
 * send-to-markup — uploads an already-rendered print PDF to Markup.io for a
 * supplier review round and records the returned share link.
 *
 * Why a function: the Markup.io workspace API key is a server-only secret (like
 * PDFSHIFT_API_KEY), and the review state must be written with the service role
 * so the link and the render row stay consistent regardless of the caller's RLS.
 *
 * Flow: authenticate (same Bearer-token check as the print pipeline) → load the
 * im_print_renders row → download the PDF from the im-print bucket → create a
 * markup via POST /api/v2/markups/file (multipart; a NEW markup per review
 * round, so older rounds keep their links and supplier comments) → stamp
 * markup_url/markup_id on the render row and the review_* columns on
 * project_ims. "In Review" is derived client-side from those columns; editing
 * or republishing the manual ends the state without any clearing write here.
 *
 * Server env (do NOT use a VITE_ prefix):
 *   MARKUPIO_API_KEY    — workspace API key (required)
 *   MARKUPIO_FOLDER_ID  — target folder for review uploads (optional)
 * The UI is gated on the public flag VITE_MARKUP_REVIEW_ENABLED ("true"),
 * set alongside the secret — same pattern as VITE_PRINT_EXPORT_ENABLED.
 */

import { createClient } from '@supabase/supabase-js';
import { AuthError, BUCKET, NetlifyEvent, PermanentError, authenticate, json } from './lib/print-render-shared';

const MARKUP_ENDPOINT = 'https://api.markup.io/api/v2/markups/file';
const MARKUP_API_VERSION = '2023-02-22';
/** POST /markups/file rejects files over 100MB; larger needs the S3 flow (not implemented). */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

interface SendToMarkupRequest {
  projectId: string;
  templateType: 'im' | 'warning_leaflet';
  /** im_print_renders.id of the PDF to send. */
  renderId: string;
  /** Display name for the markup in the Markup.io folder. */
  name?: string;
}

const isValidRequest = (b: unknown): b is SendToMarkupRequest => {
  const r = b as Partial<SendToMarkupRequest>;
  return (
    !!r &&
    typeof r.projectId === 'string' &&
    (r.templateType === 'im' || r.templateType === 'warning_leaflet') &&
    typeof r.renderId === 'string' &&
    (r.name === undefined || typeof r.name === 'string')
  );
};

/** Create the markup. Markup.io 4xx (except 408/429) will fail identically on retry → permanent. */
const createMarkup = async (
  pdf: ArrayBuffer,
  filename: string,
  name: string,
  apiKey: string,
  folderId: string | undefined,
): Promise<{ markupId: string; markupUrl: string }> => {
  const params = new URLSearchParams({ name });
  if (folderId) params.set('parentFolderId', folderId);

  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), filename);

  const res = await fetch(`${MARKUP_ENDPOINT}?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Markup-API-Version': MARKUP_API_VERSION },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const message = `Markup.io upload failed (${res.status}): ${detail.slice(0, 300)}`;
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new PermanentError(message);
    }
    throw new Error(message);
  }

  // The API wraps some responses in { data: … } — accept both shapes.
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const markup = ((body?.data ?? body) ?? {}) as { id?: string; markupUrl?: string; url?: string };
  const markupId = markup.id;
  if (!markupId) throw new Error('Markup.io returned no markup id.');
  return { markupId, markupUrl: markup.markupUrl ?? markup.url ?? `https://app.markup.io/markup/${markupId}` };
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.MARKUPIO_API_KEY;
  const folderId = process.env.MARKUPIO_FOLDER_ID || undefined;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!apiKey) return json(500, { error: 'MARKUPIO_API_KEY is not configured on the server.' });
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let req: SendToMarkupRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!isValidRequest(req)) return json(400, { error: 'Invalid request body.' });

  try {
    const requestedBy = await authenticate(supabase, event);

    // The render row is the source of truth for what gets uploaded — never a
    // caller-supplied URL, so the function can only ever publish this app's own PDFs.
    const { data: render, error: renderErr } = await supabase
      .from('im_print_renders')
      .select('id, project_id, template_type, im_version, languages, page_size, storage_path, bytes')
      .eq('id', req.renderId)
      .maybeSingle();
    if (renderErr) throw new Error(`Could not load the render (${renderErr.message}).`);
    if (!render || render.project_id !== req.projectId || render.template_type !== req.templateType) {
      throw new PermanentError('This PDF render does not exist (or belongs to another manual).');
    }
    if ((render.bytes ?? 0) > MAX_UPLOAD_BYTES) {
      throw new PermanentError('This PDF is over Markup.io\'s 100MB upload limit.');
    }

    const { data: file, error: dlErr } = await supabase.storage.from(BUCKET).download(render.storage_path);
    if (dlErr || !file) {
      throw new PermanentError(`The rendered PDF is missing from storage (${render.storage_path}).`);
    }

    const fallbackName = `${req.templateType === 'warning_leaflet' ? 'Warning Leaflet' : 'Instruction Manual'}` +
      `${render.im_version != null ? ` v${render.im_version}` : ''}`;
    const name = (req.name ?? '').trim().slice(0, 200) || fallbackName;
    const filename = render.storage_path.split('/').pop() ?? 'manual.pdf';

    const { markupId, markupUrl } = await createMarkup(await file.arrayBuffer(), filename, name, apiKey, folderId);

    // The markup now exists either way — record it best-effort and surface a warning
    // instead of failing (a failure here must not trigger a client retry that would
    // create a second markup for the same PDF).
    const warnings: string[] = [];
    const { error: rowErr } = await supabase
      .from('im_print_renders')
      .update({ markup_url: markupUrl, markup_id: markupId })
      .eq('id', render.id);
    if (rowErr) warnings.push(`the render history row could not be updated (${rowErr.message})`);

    const reviewRequestedAt = new Date().toISOString();
    const { error: imErr } = await supabase
      .from('project_ims')
      .update({
        review_url: markupUrl,
        review_markup_id: markupId,
        review_requested_at: reviewRequestedAt,
        review_requested_by: requestedBy,
        review_version: render.im_version ?? null,
        updated_at: reviewRequestedAt,
      })
      .eq('project_id', req.projectId)
      .eq('template_type', req.templateType);
    if (imErr) warnings.push(`the manual's review status could not be updated (${imErr.message})`);

    return json(200, {
      markupUrl,
      markupId,
      reviewRequestedAt,
      reviewRequestedBy: requestedBy,
      reviewVersion: render.im_version ?? null,
      ...(warnings.length
        ? { warning: `The PDF is on Markup.io (keep the link), but ${warnings.join('; ')}.` }
        : {}),
    });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    const message = e instanceof Error ? e.message : 'Sending to Markup.io failed.';
    if (e instanceof PermanentError) return json(422, { error: message });
    return json(502, { error: message });
  }
};
