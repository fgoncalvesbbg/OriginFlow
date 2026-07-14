/**
 * Print-PDF pipeline, step 3/4: MERGE (Netlify Function).
 *
 * Downloads every part rendered by `render-print-part` (one PDF per cover/
 * language/back), re-renders the cover ONCE with real page numbers (needs the
 * other parts' page counts, which are only known after they've all rendered),
 * merges everything with pdf-lib and stamps continuous page numbers + the
 * running footer + language edge tabs, uploads the final booklet, and records
 * the render. See lib/print-render-shared.ts for why this pipeline is split.
 */

import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  buildCoverPartHtml,
  getTabLayout,
  PrintPart,
} from '../../src/services/im/im-print-html';
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

interface MergeRequest extends RenderRequestBase {
  jobId: string;
}

const isValidMergeRequest = (b: unknown): b is MergeRequest => {
  if (!isValidBase(b)) return false;
  const r = b as MergeRequest;
  return typeof r.jobId === 'string' && !!r.jobId;
};

const MM_TO_PT = 72 / 25.4;

/** Strip diacritics / non-ASCII so the stamped footer is safe for pdf-lib's standard font. */
const toAscii = (text: string): string =>
  text.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').trim();

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
  compact: boolean,
  copyrightText: string,
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
  const copyright = toAscii(copyrightText);

  merged.getPages().forEach((page, i) => {
    const pageNum = i + 1;
    const width = page.getWidth();
    const height = page.getHeight();

    if (compact) {
      // Leaflet: fully clean pages (no running footer, no page numbers). A single minimal
      // copyright/version line is stamped, centered, at the bottom of the LAST page only.
      if (copyright && pageNum === total) {
        const cw = font.widthOfTextAtSize(copyright, 7);
        page.drawText(copyright, { x: (width - cw) / 2, y: 5 * MM_TO_PT, size: 7, font, color: footColor });
      }
    } else if (pageNum >= 2) {
      // Full IM: footer + page number (cover stays clean).
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
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let req: MergeRequest;
  try {
    req = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!isValidMergeRequest(req)) return json(400, { error: 'Invalid request body.' });

  try {
    const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new AuthError('Authentication required.');
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) throw new AuthError('Invalid or expired session.');
    const createdBy = userData.user.email ?? userData.user.id;

    const { manuals, ordered } = await fetchManifestAndManuals(supabaseUrl, req);
    const { parts, compact } = buildParts(manuals, req);

    // Download every part rendered by render-print-part. A missing part means the client
    // called merge before every part-render call finished/succeeded — a client-side bug,
    // not a recoverable condition here.
    const partPdfs: Uint8Array[] = [];
    for (let i = 0; i < parts.length; i++) {
      const path = tempPartPath(req.projectId, req.templateType, req.jobId, i);
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(`Missing rendered part ${i} (${path}) — render every part before merging.`);
      partPdfs.push(new Uint8Array(await data.arrayBuffer()));
    }

    // Cover language directory: with page counts now known, compute each language's start
    // page and re-render the cover with real numbers. The directory's row count is unchanged,
    // so the cover's own page count is stable. parts = [cover, lang0, lang1, …, back].
    // Skipped for compact leaflets — they have no cover part (partPdfs[0] is a language body).
    if (manuals.length > 1 && !compact) {
      const counts = await Promise.all(partPdfs.map(async (b) => (await PDFDocument.load(b)).getPageCount()));
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
      partPdfs[0] = await renderPartPdf(coverHtml, req.pageSize.toUpperCase(), apiKey, marginFor(compact));
    }

    // Merge + stamp (footer/page numbers for IMs; a single last-page copyright line for leaflets) + edge tabs.
    const name = `${req.templateType}-${ordered.join('-')}-${req.pageSize}`;
    const running = [req.cover.footerText, req.cover.title].filter(Boolean).join(' · ');
    const year = new Date().getFullYear();
    const companyName = req.cover.companyName ?? '';
    const versionLabel = req.version ? ` · v${req.version}` : '';
    const copyrightText = `© ${year} ${companyName}. All rights reserved.${versionLabel}`;
    const pdf = await mergeAndStamp(partPdfs, parts, running, req.pageSize, compact, copyrightText);

    // Upload to im-print under a UNIQUE path (never overwrite — history is preserved).
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

    // Record the render so the app can show history + guard against unchanged duplicates.
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
    if (insErr) console.error('[render-print-merge] render-row insert failed:', insErr.message);

    return json(200, { url: publicUrl, storagePath, bytes: pdf.byteLength, render: row ?? null });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    const message = e instanceof Error ? e.message : 'Print merge failed.';
    return json(502, { error: message });
  }
};
