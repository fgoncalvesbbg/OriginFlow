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
import {
  PDFDocument, degrees, rgb,
  PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, type PDFFont,
} from 'pdf-lib';
import {
  buildCoverPartHtml,
  getTabLayout,
  PrintPart,
} from '../../src/services/im/im-print-html';
import { embedStampFonts } from './lib/fonts/inter-stamp';
import {
  NetlifyEvent,
  RenderRequestBase,
  isValidBase,
  json,
  fetchManifestAndManuals,
  buildParts,
  renderPartPdf,
  marginFor,
  resolveTypography,
  tempPartPath,
  BUCKET,
  AuthError,
  PermanentError,
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

/**
 * Minimum clearance between any stamped ink and the trimmed paper edge (mm).
 *
 * Mirrors PRINT_SETTING_LIMITS.marginBottom.min (src/services/im/im-print-typography.ts).
 * The admin panel enforces 8mm on the *margin*; nothing used to enforce it on the stamp
 * itself, so a 15mm bottom margin centred the footer baseline at 7.5mm and put ink 6.9mm
 * from trim — inside a bookbinder's trim tolerance on a perfect-bound booklet.
 */
const MIN_INK_CLEARANCE_MM = 8;

/** Fraction of the font size below the baseline. Inter and Helvetica are both ~0.21em;
 *  0.22 keeps the floor pessimistic rather than optimistic. */
const DESCENDER_RATIO = 0.22;

/** Fraction of the font size above the baseline, used only to detect a stamp reaching
 *  up into the text block. */
const ASCENDER_RATIO = 0.78;

/**
 * Baseline Y (pt) for text stamped into the bottom margin band.
 *
 * Centres the text in the band (the long-standing behaviour), then lifts it if the
 * descender would cross the MIN_INK_CLEARANCE_MM trim guard. `band` is the fraction of
 * the bottom margin used for centring — 0.5 for the running footer, 0.625 for the
 * leaflet copyright line, both preserved from the original heuristic.
 */
const stampBaselineY = (bottomMarginMm: number, sizePt: number, band: number): number =>
  Math.max(
    bottomMarginMm * band * MM_TO_PT,
    MIN_INK_CLEARANCE_MM * MM_TO_PT + sizePt * DESCENDER_RATIO,
  );

/**
 * True when the bottom margin is too thin to hold a stamp of `sizePt` above the trim
 * guard without reaching into the text block. Both constraints cannot be met at once;
 * trim safety wins in stampBaselineY and the caller warns, because the only real fix is
 * a larger bottom margin.
 */
const bandTooThinForStamp = (bottomMarginMm: number, sizePt: number, band: number): boolean =>
  stampBaselineY(bottomMarginMm, sizePt, band) + sizePt * ASCENDER_RATIO > bottomMarginMm * MM_TO_PT;

/**
 * Human-friendly download filename: "SKU - Name - Instruction Manual.pdf".
 * SKU = the article number(s) on the cover, Name = the cover title. Empty segments are
 * dropped so a missing SKU/title doesn't leave stray " - " in the name. Characters that
 * are illegal in filenames are stripped; the browser gets this via the ?download= param.
 */
const buildDownloadName = (req: MergeRequest): string => {
  const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  const kind = req.templateType === 'warning_leaflet' ? 'Warning Leaflet' : 'Instruction Manual';
  const sku = (req.cover.skus ?? []).map((s) => s.trim()).filter(Boolean).join(', ');
  const name = (req.cover.title ?? '').trim();
  const base = [sku, name, kind].map(sanitize).filter(Boolean).join(' - ');
  return `${base || kind}.pdf`;
};


/**
 * TOC page numbers + internal-link repair.
 *
 * Chromium (PDFShift's engine) cannot print target page numbers in CSS, so the
 * HTML TOC ships as clickable internal links only (see im-print-html.ts). Those
 * links survive as PDF link annotations whose GoTo destination references the
 * target PAGE OBJECT — but destinations must be resolved in each SOURCE part
 * BEFORE copyPages: pdf-lib's object copier duplicates a destination page
 * reached via the annotation graph into an orphan object (distinct ref AND
 * distinct instance from the page-tree copy), so post-merge resolution finds
 * nothing — and, worse, the merged links point at orphans, i.e. the booklet's
 * clickable TOC has silently been dead in PDF viewers.
 *
 * So: collectInternalLinks() maps each link to its target page index inside its
 * own part (same-document lookups are exact); the merge loop translates both
 * ends by the part's page offset; stampTocPageNumbers() then (a) draws the
 * final page number right-aligned inside each link's rectangle — matching the
 * continuous "n / total" footers — and (b) re-points the merged annotation at
 * the real page-tree page, resurrecting the clickable link.
 *
 * A page is treated as a TOC page when it carries ≥ 2 internal links (section
 * content has none; external URLs don't count). Named destinations are skipped
 * (Chromium emits explicit /Dest or /GoTo arrays). Best-effort by design: any
 * surprise skips that link — a numberless TOC is today's status quo, never
 * worth failing a paid merge over.
 */
interface InternalLink {
  /** Page the link sits on / page it targets — merged 0-based indices. */
  pageIdx: number;
  targetIdx: number;
  /** Index within the page's /Annots array (identical in source and merged copy). */
  annotIdx: number;
  /** Link rectangle (PDF coords, origin bottom-left). */
  x2: number;
  y1: number;
  y2: number;
}

const resolveIn = (doc: PDFDocument, obj: unknown): unknown =>
  obj instanceof PDFRef ? doc.context.lookup(obj) : obj;

/** The internal /Dest (or /GoTo) array of a link annotation, resolved; null otherwise. */
const internalDestOf = (doc: PDFDocument, annot: PDFDict): PDFArray | null => {
  let dest = resolveIn(doc, annot.get(PDFName.of('Dest')));
  if (!dest) {
    const action = resolveIn(doc, annot.get(PDFName.of('A')));
    if (action instanceof PDFDict && action.get(PDFName.of('S'))?.toString() === '/GoTo') {
      dest = resolveIn(doc, action.get(PDFName.of('D')));
    }
  }
  return dest instanceof PDFArray && dest.size() >= 1 ? dest : null;
};

/** Every internal link in ONE part document, with part-local page indices. */
export const collectInternalLinks = (doc: PDFDocument): InternalLink[] => {
  const pages = doc.getPages();
  const idxByNode = new Map<unknown, number>();
  pages.forEach((p, i) => idxByNode.set(p.node, i));

  const out: InternalLink[] = [];
  pages.forEach((page, pageIdx) => {
    const annots = resolveIn(doc, page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) return;
    for (let annotIdx = 0; annotIdx < annots.size(); annotIdx++) {
      const a = resolveIn(doc, annots.get(annotIdx));
      if (!(a instanceof PDFDict) || a.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue;
      const dest = internalDestOf(doc, a);
      if (!dest) continue;
      const destPage = resolveIn(doc, dest.get(0));
      const targetIdx = idxByNode.get(destPage);
      if (targetIdx === undefined) continue;
      const rect = resolveIn(doc, a.get(PDFName.of('Rect')));
      if (!(rect instanceof PDFArray) || rect.size() !== 4) continue;
      const nums = [0, 1, 2, 3].map((k) => {
        const v = resolveIn(doc, rect.get(k));
        return v instanceof PDFNumber ? v.asNumber() : NaN;
      });
      if (nums.some(Number.isNaN)) continue;
      out.push({
        pageIdx, targetIdx, annotIdx,
        x2: Math.max(nums[0], nums[2]), y1: Math.min(nums[1], nums[3]), y2: Math.max(nums[1], nums[3]),
      });
    }
  });
  return out;
};

/** Draw the page numbers onto TOC pages and re-point their annotations at the real pages. */
export const stampTocPageNumbers = (merged: PDFDocument, font: PDFFont, links: InternalLink[]): void => {
  const pages = merged.getPages();
  const byPage = new Map<number, InternalLink[]>();
  for (const l of links) {
    if (!byPage.has(l.pageIdx)) byPage.set(l.pageIdx, []);
    byPage.get(l.pageIdx)!.push(l);
  }

  for (const [pageIdx, rows] of byPage) {
    const page = pages[pageIdx];
    if (!page) continue;

    // Repair EVERY internal link on the page (they all point at copier orphans);
    // only TOC-looking pages (≥ 2 internal links) additionally get numbers drawn.
    for (const row of rows) {
      const target = pages[row.targetIdx];
      if (!target) continue;
      try {
        const annots = resolveIn(merged, page.node.get(PDFName.of('Annots')));
        if (!(annots instanceof PDFArray)) continue;
        const a = resolveIn(merged, annots.get(row.annotIdx));
        if (!(a instanceof PDFDict)) continue;
        const dest = internalDestOf(merged, a);
        if (dest) dest.set(0, target.ref);
      } catch { /* leave this link as-is */ }
    }

    if (rows.length < 2) continue;
    for (const row of rows) {
      const label = String(row.targetIdx + 1);
      const size = 10;
      const w = font.widthOfTextAtSize(label, size);
      page.drawText(label, {
        // Right-aligned inside the row's own link rectangle, vertically centered.
        x: row.x2 - w,
        y: row.y1 + (row.y2 - row.y1) / 2 - size * 0.35,
        size,
        font,
        color: rgb(0.12, 0.16, 0.22),
      });
    }
  }
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
export interface PrintPreflight {
  /** Every font in the finished document, and whether it carries its own program. */
  fonts: { name: string; embedded: boolean }[];
  /** Names of fonts a print vendor would reject. Empty is the passing state. */
  nonEmbeddedFonts: string[];
  /** Distance from the trimmed edge to the lowest stamped ink, in mm. */
  footerInkClearanceMm: number | null;
  /** The floor that distance must clear. */
  minInkClearanceMm: number;
  /** True when the bottom margin cannot satisfy both the trim guard and the text block. */
  bottomMarginTooThin: boolean;
  /** Characters in stamped text that no embedded subset could draw. */
  unsupportedStampCharacters: string[];
}

const FONT_FILE_KEYS = ['FontFile', 'FontFile2', 'FontFile3'];

/**
 * Which fonts the finished document actually embeds.
 *
 * A PDF font is embedded only if its descriptor carries a FontFile/FontFile2/FontFile3
 * stream. The base-14 (Helvetica, Times, Courier) are referenced by name and rely on the
 * consumer owning them, which is exactly what fails preflight at a print vendor — and what
 * this pipeline used to do for every stamped footer, page number and edge tab.
 *
 * A Type0 font keeps its descriptor on the descendant CIDFont, so that has to be followed
 * before concluding a font is unembedded.
 */
const auditEmbeddedFonts = (doc: PDFDocument): { name: string; embedded: boolean }[] => {
  const found = new Map<string, boolean>();

  const descriptorOf = (font: PDFDict): PDFDict | null => {
    const direct = resolveIn(doc, font.get(PDFName.of('FontDescriptor')));
    if (direct instanceof PDFDict) return direct;
    const descendants = resolveIn(doc, font.get(PDFName.of('DescendantFonts')));
    if (descendants instanceof PDFArray) {
      for (let i = 0; i < descendants.size(); i++) {
        const child = resolveIn(doc, descendants.get(i));
        if (child instanceof PDFDict) {
          const nested = resolveIn(doc, child.get(PDFName.of('FontDescriptor')));
          if (nested instanceof PDFDict) return nested;
        }
      }
    }
    return null;
  };

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of('Type'));
    if (!(type instanceof PDFName) || type.asString() !== '/Font') continue;
    const base = obj.get(PDFName.of('BaseFont'));
    const raw = base instanceof PDFName ? base.asString() : '';
    const name = (raw.startsWith('/') ? raw.slice(1) : raw) || '(unnamed)';
    const descriptor = descriptorOf(obj);
    const embedded = !!descriptor && FONT_FILE_KEYS.some((k) => descriptor.get(PDFName.of(k)) !== undefined);
    // A Type0 parent and its CIDFont child share a BaseFont. Keep the optimistic result so a
    // parent that delegates its descriptor is not reported as a second, unembedded font.
    found.set(name, (found.get(name) ?? false) || embedded);
  }
  return [...found].map(([name, embedded]) => ({ name, embedded }));
};

const mergeAndStamp = async (
  partPdfs: Uint8Array[],
  parts: PrintPart[],
  runningText: string,
  pageSize: 'a4' | 'a5',
  compact: boolean,
  copyrightText: string,
  /** Page margins (mm) the parts were rendered with — the stamped footer has to land
   *  inside that band and align with the text block, not at a hardcoded 14/9mm. */
  margins: { top: number; bottom: number; left: number; right: number },
): Promise<{ pdf: Buffer; preflight: PrintPreflight }> => {
  const merged = await PDFDocument.create();
  // Every string this function stamps, so only the needed Inter subsets get embedded.
  const stampTexts = [runningText, copyrightText, ...parts.map((p) => p.tab?.code.toUpperCase() ?? '')];
  const fonts = await embedStampFonts(merged, stampTexts);
  // Anything still undrawable is now reported rather than silently dropped, which is how
  // Greek and Bulgarian footers used to lose their text.
  const unsupportedStampCharacters: string[] = [];
  for (const text of [runningText, copyrightText]) {
    const missing = fonts.unsupported(text);
    if (missing.length) {
      unsupportedStampCharacters.push(...missing);
      console.warn(
        '[render-print-merge] no embedded Inter subset covers', JSON.stringify(missing.join('')),
        'in stamped text', JSON.stringify(text), '- those characters are omitted.',
      );
    }
  }

  // Track which language tab (if any) each merged page belongs to. Internal links
  // (the TOC's) are collected per part BEFORE copying — see stampTocPageNumbers —
  // and translated into merged page indices by the part's offset.
  const pageTabs: (PrintPart['tab'])[] = [];
  const internalLinks: ReturnType<typeof collectInternalLinks> = [];
  let pageOffset = 0;
  for (let i = 0; i < partPdfs.length; i++) {
    const doc = await PDFDocument.load(partPdfs[i]);
    try {
      for (const l of collectInternalLinks(doc)) {
        internalLinks.push({ ...l, pageIdx: pageOffset + l.pageIdx, targetIdx: pageOffset + l.targetIdx });
      }
    } catch (e) { console.error('[render-print-merge] collecting TOC links failed (part', i, '):', e); }
    const copied = await merged.copyPages(doc, doc.getPageIndices());
    for (const p of copied) { merged.addPage(p); pageTabs.push(parts[i].tab); }
    pageOffset += copied.length;
  }

  // TOC page numbers + link repair — after merging (indices are final), before the
  // footer pass. Best-effort: a failure degrades to a numberless TOC, never a failed merge.
  if (!compact && internalLinks.length) {
    try { stampTocPageNumbers(merged, fonts.base, internalLinks); }
    catch (e) { console.error('[render-print-merge] TOC page-number stamping failed:', e); }
  }

  const running = runningText;
  const total = merged.getPageCount();
  const size = 8;
  const footColor = rgb(0.39, 0.45, 0.55);
  const tabTextColor = rgb(0.2, 0.25, 0.32);
  // Vertically centered in the bottom margin band, and aligned with the text block's
  // left/right edges — both derived from the configured margins, so widening or
  // tightening them in Admin → IM Print moves the footer with the text.
  const footY = stampBaselineY(margins.bottom, size, 0.5);
  if (!compact && bandTooThinForStamp(margins.bottom, size, 0.5)) {
    console.warn(
      '[render-print-merge] bottom margin', margins.bottom,
      'mm is too thin to hold the running footer clear of both the', MIN_INK_CLEARANCE_MM,
      'mm trim guard and the text block; the footer may overlap body text. Raise it in Admin -> IM Print.',
    );
  }
  const footLeft = margins.left * MM_TO_PT;
  const footRight = margins.right * MM_TO_PT;
  const copyright = copyrightText;

  merged.getPages().forEach((page, i) => {
    const pageNum = i + 1;
    const width = page.getWidth();
    const height = page.getHeight();

    if (compact) {
      // Leaflet: fully clean pages (no running footer, no page numbers). A single minimal
      // copyright/version line is stamped, centered, at the bottom of the LAST page only.
      if (copyright && pageNum === total) {
        const cw = fonts.widthOfText(copyright, 7);
        fonts.drawText(page, copyright, { x: (width - cw) / 2, y: stampBaselineY(margins.bottom, 7, 0.625), size: 7, color: footColor });
      }
    } else if (pageNum >= 2) {
      // Full IM: footer + page number (cover stays clean).
      if (running) fonts.drawText(page, running, { x: footLeft, y: footY, size, color: footColor });
      const right = `${pageNum} / ${total}`;
      const rw = fonts.widthOfText(right, size);
      fonts.drawText(page, right, { x: width - footRight - rw, y: footY, size, color: footColor });
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
      const label = tab.code.toUpperCase();
      const ts = 7;
      const tw = fonts.base.widthOfTextAtSize(label, ts);
      page.drawText(label, {
        x: x + w / 2 + ts / 2,
        y: y + h / 2 - tw / 2,
        size: ts,
        font: fonts.base,
        color: tabTextColor,
        rotate: degrees(90),
      });
    }
  });

  // Audited before save, on the document that is about to be serialized.
  const auditedFonts = auditEmbeddedFonts(merged);
  return {
    pdf: Buffer.from(await merged.save()),
    preflight: {
      fonts: auditedFonts,
      nonEmbeddedFonts: auditedFonts.filter((entry) => !entry.embedded).map((entry) => entry.name),
      footerInkClearanceMm: compact ? null : Number(((footY - size * DESCENDER_RATIO) / MM_TO_PT).toFixed(2)),
      minInkClearanceMm: MIN_INK_CLEARANCE_MM,
      bottomMarginTooThin: !compact && bandTooThinForStamp(margins.bottom, size, 0.5),
      unsupportedStampCharacters: [...new Set(unsupportedStampCharacters)],
    },
  };
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
    // Range-checked global print typography — drives the cover re-render below and where
    // the footer / page numbers are stamped.
    const typography = resolveTypography(req);

    // Download every part rendered by render-print-part. A missing part means the client
    // called merge before every part-render call finished/succeeded — a client-side bug,
    // not a recoverable condition here.
    const partPdfs: Uint8Array[] = [];
    for (let i = 0; i < parts.length; i++) {
      const path = tempPartPath(req.projectId, req.templateType, req.jobId, i);
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) throw new PermanentError(`Missing rendered part ${i} (${path}) — render every part before merging.`);
      partPdfs.push(new Uint8Array(await data.arrayBuffer()));
    }

    // Page count per part, in merge order. Needed twice: for the cover's language directory,
    // and for the render record — nothing used to store how long a booklet actually was, so a
    // template change that added pages across five languages was invisible until someone
    // opened two PDFs side by side.
    const partPageCounts = await Promise.all(
      partPdfs.map(async (bytes) => (await PDFDocument.load(bytes)).getPageCount()),
    );

    // Cover language directory: with page counts now known, compute each language's start
    // page and re-render the cover with real numbers. The directory's row count is unchanged,
    // so the cover's own page count is stable. parts = [cover, lang0, lang1, …, back].
    // Skipped for compact leaflets — they have no cover part (partPdfs[0] is a language body).
    if (manuals.length > 1 && !compact) {
      const langStart: number[] = [];
      let acc = partPageCounts[0]; // pages before the first language body = the cover
      for (let i = 0; i < manuals.length; i++) {
        langStart.push(acc + 1);
        acc += partPageCounts[i + 1];
      }
      const coverHtml = buildCoverPartHtml(
        // Same typography as the first cover render — omitting it here would re-render the
        // cover in the default font/scale and silently diverge from the rest of the book.
        manuals,
        { pageSize: req.pageSize, cover: req.cover, back: req.back, version: req.version, typography },
        langStart,
      );
      partPdfs[0] = await renderPartPdf(coverHtml, req.pageSize.toUpperCase(), apiKey, marginFor(typography));
      // The directory's row count is unchanged so this should match, but re-reading keeps the
      // recorded total honest if a long language list ever spills the cover onto a second page.
      partPageCounts[0] = (await PDFDocument.load(partPdfs[0])).getPageCount();
    }

    // parts = [cover, lang0, …, back] for a full IM, [lang0, …] for a compact leaflet, and
    // `manuals` is built by iterating `ordered`, so the two are index-aligned.
    const languagePartOffset = compact ? 0 : 1;
    const pagesByLanguage: Record<string, number> = {};
    ordered.forEach((lang, i) => {
      pagesByLanguage[lang] = partPageCounts[i + languagePartOffset] ?? 0;
    });
    const totalPages = partPageCounts.reduce((sum, n) => sum + n, 0);

    // Merge + stamp (footer/page numbers for IMs; a single last-page copyright line for leaflets) + edge tabs.
    const name = `${req.templateType}-${ordered.join('-')}-${req.pageSize}`;
    const running = [req.cover.footerText, req.cover.title].filter(Boolean).join(' · ');
    const year = new Date().getFullYear();
    const companyName = req.cover.companyName ?? '';
    const versionLabel = req.version ? ` · v${req.version}` : '';
    const copyrightText = `© ${year} ${companyName}. All rights reserved.${versionLabel}`;
    const { pdf, preflight } = await mergeAndStamp(partPdfs, parts, running, req.pageSize, compact, copyrightText, typography.margins);
    if (preflight.nonEmbeddedFonts.length) {
      console.warn('[render-print-merge] NOT embedded, will fail vendor preflight:', preflight.nonEmbeddedFonts.join(', '));
    }
    if (preflight.footerInkClearanceMm !== null && preflight.footerInkClearanceMm < preflight.minInkClearanceMm) {
      console.warn(
        '[render-print-merge] stamped footer ink sits', preflight.footerInkClearanceMm,
        'mm from trim, under the', preflight.minInkClearanceMm, 'mm guard.',
      );
    }

    // Upload to im-print under a UNIQUE path — keyed on the client-generated jobId, NOT a
    // timestamp, so the merge is IDEMPOTENT per job: when the client's 25s timeout fires
    // on a merge that actually completed server-side, its retry re-runs this function and
    // lands on the SAME path instead of producing a second PDF, a second history row, and
    // a second PDFShift cover charge. History across jobs is still never overwritten.
    const storagePath = `${req.projectId}/${req.templateType}/${name}-v${req.version ?? 0}-${req.jobId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}.pdf`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, pdf, {
      upsert: false,
      contentType: 'application/pdf',
      cacheControl: '0',
    });
    if (upErr) {
      const alreadyExists = /already exists|duplicate/i.test(upErr.message) || (upErr as { statusCode?: string | number }).statusCode === '409';
      if (!alreadyExists) throw new Error(`Upload failed (${storagePath}): ${upErr.message}`);
      // A previous invocation of THIS job already finished — return its result instead
      // of failing (and instead of inserting a duplicate history row).
      const { data: existingRow } = await supabase
        .from('im_print_renders')
        .select()
        .eq('storage_path', storagePath)
        .maybeSingle();
      const { data: { publicUrl: existingUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath, { download: buildDownloadName(req) });
      return json(200, { url: existingUrl, storagePath, bytes: existingRow?.bytes ?? pdf.byteLength, render: existingRow ?? null });
    }

    // Serve the download under a friendly "SKU - Name - Instruction Manual.pdf" name via the
    // ?download= param (Supabase sets Content-Disposition from it), instead of the opaque
    // versioned storage key. Stored on the row so history downloads keep the same name.
    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(storagePath, { download: buildDownloadName(req) });

    // Record the render so the app can show history + guard against unchanged duplicates.
    // The row is the compliance changelog entry for this PDF — retry once, and if it still
    // fails, say so in the response instead of silently returning an unrecorded artifact.
    const renderRow = {
      project_id: req.projectId,
      template_type: req.templateType,
      im_version: req.version ?? null,
      languages: ordered,
      page_size: req.pageSize,
      storage_path: storagePath,
      url: publicUrl,
      bytes: pdf.byteLength,
      pages: totalPages,
      pages_by_language: pagesByLanguage,
      created_by: createdBy,
      comment: req.comment ?? '',
      market: req.market ?? null,
    };
    let row: unknown = null;
    let insErrMsg: string | null = null;
    for (let attempt = 0; attempt < 2 && !row; attempt++) {
      const { data, error: insErr } = await supabase.from('im_print_renders').insert(renderRow).select().single();
      if (data) { row = data; insErrMsg = null; }
      else insErrMsg = insErr?.message ?? 'unknown error';
    }
    if (insErrMsg) console.error('[render-print-merge] render-row insert failed twice:', insErrMsg);

    return json(200, {
      url: publicUrl,
      storagePath,
      bytes: pdf.byteLength,
      pages: totalPages,
      pagesByLanguage,
      preflight,
      render: row ?? null,
      ...(insErrMsg ? {
        warning: 'The PDF was generated, but recording it in the render history failed — it will not appear ' +
          'in the export history or the duplicate guard. Keep the download link; contact support if this repeats.',
      } : {}),
    });
  } catch (e) {
    if (e instanceof AuthError) return json(401, { error: e.message });
    const message = e instanceof Error ? e.message : 'Print merge failed.';
    // Permanent failures get 422 — not in the client's transient-retry set, so it
    // fails immediately instead of re-running a merge that can never succeed.
    if (e instanceof PermanentError) return json(422, { error: message });
    return json(502, { error: message });
  }
};
