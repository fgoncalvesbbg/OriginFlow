/**
 * Print-PDF render (Netlify Function).
 *
 * Turns a PUBLISHED Information Manual into a combined PDF (A4/A5, vector/selectable text, clickable
 * TOC, page numbers) and uploads it to the public `im-print` Storage bucket.
 *
 * Pipeline (all server-side):
 *   1. fetch the published manifest + each requested language's ResolvedManual JSON (im-published);
 *   2. build the booklet as SEPARATE HTML parts (cover, one per language, back) with the SHARED
 *      builder — each language part carries a color-coded edge thumb-tab (a position:fixed bar can
 *      only repeat per page in a SINGLE-language render, so it can't vary per language in one doc);
 *   3. render each part with PDFShift (Chromium), then MERGE them with pdf-lib and stamp continuous
 *      page numbers + the running footer onto the merged pages;
 *   4. upload to im-print and return the public URL.
 *
 * Engine note: PDFShift is Chromium-based — screen-grade output. Per-part right margin is 0 so the
 * thumb-tabs sit flush to the paper edge (the builder restores the text inset via padding).
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   PDFSHIFT_API_KEY             — print engine credential
 *   SUPABASE_URL                 — project URL (public manifest URL + storage)
 *   SUPABASE_SERVICE_ROLE_KEY    — service role, so the upload bypasses RLS
 */

import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { buildPrintPartsHtml, PrintManual, PrintHtmlOptions } from '../../src/services/im/im-print-html';

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
  headers: Record<string, string | undefined>;
}

interface RenderRequest {
  projectId: string;
  templateType: 'im' | 'warning_leaflet';
  languages: string[];
  pageSize: 'a4' | 'a5';
  cover: PrintHtmlOptions['cover'];
  back: PrintHtmlOptions['back'];
  version?: number;
}

const BUCKET = 'im-print';
const PDFSHIFT_ENDPOINT = 'https://api.pdfshift.io/v3/convert/pdf';

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return (await res.json()) as T;
};

const isValid = (b: unknown): b is RenderRequest => {
  const r = b as Partial<RenderRequest>;
  return (
    !!r &&
    typeof r.projectId === 'string' &&
    (r.templateType === 'im' || r.templateType === 'warning_leaflet') &&
    Array.isArray(r.languages) &&
    r.languages.length > 0 &&
    (r.pageSize === 'a4' || r.pageSize === 'a5') &&
    typeof r.cover === 'object' &&
    typeof r.back === 'object'
  );
};

const MM_TO_PT = 72 / 25.4;

/** Strip diacritics / non-ASCII so the stamped footer is safe for pdf-lib's standard font. */
const toAscii = (text: string): string =>
  text.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').trim();

/** Render one standalone HTML part to PDF bytes via PDFShift. Right margin is 0 so the edge
 *  thumb-tabs are flush to the paper edge; page numbers are stamped later on the merged pdf. */
const renderPart = async (html: string, format: string, apiKey: string, rightMargin: string): Promise<Uint8Array> => {
  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const res = await fetch(PDFSHIFT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      source: html,
      format,
      use_print: true,
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: rightMargin },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Print engine failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

/**
 * Merge rendered parts in order and stamp the running footer + "page / total" onto every page
 * from page 2 (the cover, page 1, stays clean). Continuous numbering across the whole booklet.
 */
const mergeAndStamp = async (partPdfs: Uint8Array[], runningText: string): Promise<Buffer> => {
  const merged = await PDFDocument.create();
  const font = await merged.embedFont(StandardFonts.Helvetica);
  for (const bytes of partPdfs) {
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }

  const running = toAscii(runningText);
  const total = merged.getPageCount();
  const size = 8;
  const color = rgb(0.39, 0.45, 0.55);
  const y = 9 * MM_TO_PT;
  merged.getPages().forEach((page, i) => {
    if (i < 1) return; // skip the cover (page 1)
    const width = page.getWidth();
    if (running) page.drawText(running, { x: 14 * MM_TO_PT, y, size, font, color });
    const right = `${i + 1} / ${total}`;
    const rw = font.widthOfTextAtSize(right, size);
    page.drawText(right, { x: width - 14 * MM_TO_PT - rw, y, size, font, color });
  });

  return Buffer.from(await merged.save());
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

  // Require a valid logged-in user. This endpoint costs render credits and writes to the public
  // bucket, so it must not be callable anonymously.
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Authentication required.' });
  const { data: userData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !userData?.user) return json(401, { error: 'Invalid or expired session.' });
  const createdBy = userData.user.email ?? userData.user.id;

  let req: RenderRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!isValid(req)) return json(400, { error: 'Invalid request body.' });

  try {
    // 1. Published manifest → per-language ResolvedManual JSON (in the requested order).
    const base = supabaseUrl.replace(/\/$/, '');
    const manifestUrl = `${base}/storage/v1/object/public/im-published/${req.projectId}/${req.templateType}/manifest.json`;
    const manifest = await fetchJson<{ languages: Array<{ lang: string; url: string }> }>(manifestUrl);
    const byLang = new Map(manifest.languages.map((l) => [l.lang, l.url]));

    const ordered = req.languages.filter((l) => byLang.has(l));
    if (!ordered.length) return json(400, { error: 'None of the requested languages are published for this IM.' });

    const manuals: PrintManual[] = [];
    for (const lang of ordered) manuals.push(await fetchJson<PrintManual>(byLang.get(lang)!));

    // 2. Booklet as separate HTML parts (cover, one per language w/ edge tab, back).
    const parts = buildPrintPartsHtml(manuals, {
      pageSize: req.pageSize,
      cover: req.cover,
      back: req.back,
      version: req.version,
    });

    const name = `${req.templateType}-${ordered.join('-')}-${req.pageSize}`;
    const running = [req.cover.footerText, req.cover.title].filter(Boolean).join(' · ');
    const format = req.pageSize.toUpperCase(); // A4 | A5

    // 3. Render every part (in parallel) then merge + stamp continuous page numbers.
    const partPdfs = await Promise.all(parts.map((p) => renderPart(p.html, format, apiKey, p.edge ? '0mm' : '14mm')));
    const pdf = await mergeAndStamp(partPdfs, running);

    // 4. Upload to im-print under a UNIQUE path (never overwrite — history is preserved).
    const storagePath = `${req.projectId}/${req.templateType}/${name}-v${req.version ?? 0}-${Date.now()}.pdf`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, pdf, {
      upsert: false,
      contentType: 'application/pdf',
      cacheControl: '0',
    });
    if (upErr) throw new Error(`Upload failed (${storagePath}): ${upErr.message}`);

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    // 5. Record the render so the app can show history + guard against unchanged duplicates.
    const { data: row, error: insErr } = await supabase
      .from('im_print_renders')
      .insert({
        project_id: req.projectId,
        template_type: req.templateType,
        im_version: req.version ?? null,
        languages: ordered,
        page_size: req.pageSize,
        storage_path: storagePath,
        url: publicUrl,
        bytes: pdf.byteLength,
        created_by: createdBy,
      })
      .select()
      .single();
    if (insErr) console.error('[render-print-pdf] render-row insert failed:', insErr.message);

    return json(200, { url: publicUrl, storagePath, bytes: pdf.byteLength, render: row ?? null });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Print render failed.';
    return json(502, { error: message });
  }
};
