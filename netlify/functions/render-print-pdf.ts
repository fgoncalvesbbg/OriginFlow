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
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  buildPrintPartsHtml,
  buildCoverPartHtml,
  getTabLayout,
  PrintManual,
  PrintHtmlOptions,
  PrintPart,
} from '../../src/services/im/im-print-html';

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

/** Render one standalone HTML part to PDF bytes via PDFShift. Edge thumb-tabs are drawn
 *  onto the MERGED pdf afterwards, so parts keep normal (symmetric) margins here. */
const renderPart = async (html: string, format: string, apiKey: string): Promise<Uint8Array> => {
  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const res = await fetch(PDFSHIFT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      source: html,
      format,
      use_print: true,
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Print engine failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

/** hex ('#rrggbb') → pdf-lib rgb (0..1). */
const hexRgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/**
 * Merge rendered parts in order, then on each merged page stamp:
 *   - the running footer + continuous "page / total" (from page 2 on), and
 *   - the language's color-coded edge thumb-tab (for language-body pages), on the OUTER
 *     edge — right on recto (odd) pages, left on verso (even) pages, so it lands on the
 *     open edge of a bound double-sided booklet and reads as a flag when fanned.
 */
const mergeAndStamp = async (
  partPdfs: Uint8Array[],
  parts: PrintPart[],
  runningText: string,
  pageSize: 'a4' | 'a5',
): Promise<Buffer> => {
  const merged = await PDFDocument.create();
  const font = await merged.embedFont(StandardFonts.Helvetica);

  // Track which language tab (if any) each merged page belongs to.
  const pageTabs: (PrintPart['tab'])[] = [];
  for (let i = 0; i < partPdfs.length; i++) {
    const doc = await PDFDocument.load(partPdfs[i]);
    const copied = await merged.copyPages(doc, doc.getPageIndices());
    for (const p of copied) { merged.addPage(p); pageTabs.push(parts[i].tab); }
  }

  const running = toAscii(runningText);
  const total = merged.getPageCount();
  const size = 8;
  const footColor = rgb(0.39, 0.45, 0.55);
  const tabTextColor = rgb(0.2, 0.25, 0.32);
  const footY = 9 * MM_TO_PT;

  merged.getPages().forEach((page, i) => {
    const pageNum = i + 1;
    const width = page.getWidth();
    const height = page.getHeight();

    // Footer + page number (cover stays clean).
    if (pageNum >= 2) {
      if (running) page.drawText(running, { x: 14 * MM_TO_PT, y: footY, size, font, color: footColor });
      const right = `${pageNum} / ${total}`;
      const rw = font.widthOfTextAtSize(right, size);
      page.drawText(right, { x: width - 14 * MM_TO_PT - rw, y: footY, size, font, color: footColor });
    }

    // Edge thumb-tab (language bodies only).
    const tab = pageTabs[i];
    if (tab) {
      const lay = getTabLayout(tab.index, tab.total, pageSize);
      const w = lay.widthMm * MM_TO_PT;
      const h = lay.heightMm * MM_TO_PT;
      const y = height - lay.topMm * MM_TO_PT - h; // pdf-lib origin is bottom-left
      const onRight = pageNum % 2 === 1;           // recto → outer edge is the right
      const x = onRight ? width - w : 0;
      page.drawRectangle({ x, y, width: w, height: h, color: hexRgb(lay.color) });

      // Language code, rotated to run along the bar (dark text stays legible in B&W).
      const label = toAscii(tab.code.toUpperCase()) || tab.code.toUpperCase();
      const ts = 7;
      const tw = font.widthOfTextAtSize(label, ts);
      page.drawText(label, {
        x: x + w / 2 + ts / 2,
        y: y + h / 2 - tw / 2,
        size: ts,
        font,
        color: tabTextColor,
        rotate: degrees(90),
      });
    }
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

    // 3. Render every part (in parallel).
    const partPdfs = await Promise.all(parts.map((p) => renderPart(p.html, format, apiKey)));

    // 3a. Cover language directory: with page counts now known, compute each language's start
    // page and re-render the cover with real numbers. The directory's row count is unchanged,
    // so the cover's own page count is stable. parts = [cover, lang0, lang1, …, back].
    if (manuals.length > 1) {
      const counts = await Promise.all(
        partPdfs.map(async (b) => (await PDFDocument.load(b)).getPageCount()),
      );
      const langStart: number[] = [];
      let acc = counts[0]; // pages before the first language body = the cover
      for (let i = 0; i < manuals.length; i++) {
        langStart.push(acc + 1);
        acc += counts[i + 1];
      }
      const coverHtml = buildCoverPartHtml(
        manuals,
        { pageSize: req.pageSize, cover: req.cover, back: req.back, version: req.version },
        langStart,
      );
      partPdfs[0] = await renderPart(coverHtml, format, apiKey);
    }

    // 3b. Merge + stamp page numbers + edge tabs.
    const pdf = await mergeAndStamp(partPdfs, parts, running, req.pageSize);

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
