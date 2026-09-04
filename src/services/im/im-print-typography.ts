/**
 * Print typography contract — the shape, limits and built-in defaults of the global print
 * settings, with no I/O of any kind.
 *
 * Kept separate from im-print-settings.service.ts on purpose: the Netlify render functions
 * import this module (they must validate whatever typography the browser sent them), and the
 * service reaches the database through `../../data` → `config/environment.config`, which
 * reads `import.meta.env` and therefore cannot be bundled into a Node function. Anything
 * both sides need lives here; anything that talks to the database lives there.
 */

import type { IMTemplateType } from '../../types';

export type PrintPageSizeKey = 'a4' | 'a5';

/**
 * Which printed LAYOUT a Warning Leaflet is set in. A layout is not a document type — the
 * template, its content, its translations and its leaflet-coverage issues are the same
 * artefact either way — so this is a per-export render choice, not a new IMTemplateType.
 *
 *  - `classic`     — one full-measure column per page, the layout every leaflet has printed
 *                    in so far.
 *  - `compact2col` — the dense two-column booklet after
 *                    docs/Gas-Hob-Leaflet-EXAMPLE-v2-ISO7010.pdf: two columns, justified and
 *                    hyphenated, severity-band hazard headers and no tinted panels.
 *
 * BOTH layouts read the SAME typography — the operator's im_print_settings row for
 * (warning_leaflet, page size). Point sizes, line spacing and margins are one admin-owned
 * house style; a layout decides how the page is DIVIDED and how a hazard block is DRAWN, never
 * how big the type is. So changing the leaflet profile in Admin → IM Print moves both layouts
 * together, and the two are directly comparable at the same size.
 *
 * `classic` is the default everywhere, so every existing call site, stored row and render
 * keeps its current meaning.
 */
export type PrintLeafletLayout = 'classic' | 'compact2col';

/** Page margins in millimetres, as the PDF engine wants them. */
export interface PrintMarginsMm {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** One resolved typography profile — everything the renderer needs to set a page. */
export interface PrintTypography {
  /** Google-font family name; an unknown value degrades to Inter at render time. */
  fontFamily: string;
  /** Body text size in points, applied to all running text. */
  bodyPt: number;
  /** Section-title size in points; in-content h1/h2/h3 derive from it. */
  headingPt: number;
  /** Unitless line-height multiplier for body text. */
  lineHeight: number;
  /**
   * Padding inside every print table cell, per side, in mm.
   *
   * Replaces a hardcoded `padding: 0.5rem` (8px ~ 2.12mm), which put 4.23mm of chrome on
   * every row — more than a whole line box at the A5 body size — and, being rem-based,
   * ignored both the pt and the mm scale.
   */
  tableCellPaddingMm: number;
  /**
   * Largest rendered height, in mm, of an image inside body content.
   *
   * The print stylesheet had no max-height at all, so an illustration dictated its table
   * row height and the sibling text cells stretched to match it.
   */
  cellImageMaxHeightMm: number;
  /**
   * Vertical rhythm between content blocks (tables, images, callouts, step lists, legends,
   * annotated sets), in mm.
   *
   * Replaces a spread of `rem`/`px` values that belonged to neither of the renderer's two
   * scales, so they were identical on a 6pt A5 leaflet and a 10.77pt A4 manual. At the live A5
   * setting a 1rem margin was 8.47mm against a 2.96mm line box — nearly three lines of page
   * per table and per image.
   */
  blockSpacingMm: number;
  /**
   * Bottom margin on paragraphs and lists, in em of body size (list items use 0.3x this).
   *
   * Already em-based, so it scaled with the type correctly — the default was simply a web one.
   * At the live A5 setting 1em is 2.47mm against a 2.96mm line box, so every paragraph break
   * cost 0.83 of a line: 9.4 A5 pages per language of pure gap over the section corpus.
   */
  paragraphSpacingEm: number;
  /**
   * Table text size as a ratio of bodyPt, floored at MIN_TABLE_PT by the renderer.
   *
   * A ratio rather than an absolute size so tables cannot drift away from body text when the
   * body size changes.
   */
  tableFontScale: number;
  /**
   * Table rule weight in mm. 0 draws no rules at all.
   *
   * Was a hardcoded `1px`, which in print is 0.265mm = 0.75pt — 11% of the table type size,
   * so the grid read heavier than the content it was supporting.
   */
  tableBorderMm: number;
  margins: PrintMarginsMm;
}

/**
 * The font families the print HTML can actually embed — mirrors GOOGLE_FONT_IMPORTS in
 * im-print-html.ts. A family missing from that map silently renders in the fallback stack, so
 * the admin picker must offer exactly this list and nothing else.
 */
export const PRINT_FONT_FAMILIES = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Source Serif 4',
  'Noto Sans',
] as const;

/**
 * The profile key for a (template type, page size) pair.
 *
 * Layout is deliberately NOT an axis: both leaflet layouts are set from the same profile, so
 * there is nothing per-layout to store or key.
 */
export const profileKey = (templateType: string, pageSize: string): string => `${templateType}::${pageSize}`;

/**
 * Columns and gutter for the compact leaflet layout, per page size.
 *
 * A column COUNT rather than a width, so the columns divide whatever measure the profile's
 * margins leave: at the reference's A5 margins that is 132mm split into 2 × 64mm with a 4mm
 * gutter, exactly the column width in docs/Gas-Hob-Leaflet-EXAMPLE-v2-ISO7010.pdf. A4 takes
 * three columns of its wider measure rather than two ~95mm ones, which would read as a wall of
 * text.
 */
export const COMPACT_LEAFLET_COLUMNS: Record<PrintPageSizeKey, { columns: number; gapMm: number }> = {
  a5: { columns: 2, gapMm: 4 },
  a4: { columns: 3, gapMm: 4 },
};

/**
 * Built-in fallbacks, one per (template type, page size). These are the values the renderer
 * hardcoded before migration 122 — A4 body 3.8mm = 10.77pt, section title 6.2mm = 17.58pt,
 * A5 = those × the old 0.82 type scale, leaflets 6pt/8pt with the tight LEAFLET_MARGIN — so
 * an un-migrated or unreachable database still renders the output everyone is used to.
 */
export const DEFAULT_PRINT_TYPOGRAPHY: Record<string, PrintTypography> = {
  'im::a4': { fontFamily: 'Inter', bodyPt: 10.77, headingPt: 17.58, lineHeight: 1.6, tableCellPaddingMm: 1.2, cellImageMaxHeightMm: 60, blockSpacingMm: 2.5, paragraphSpacingEm: 0.5, tableFontScale: 0.95, tableBorderMm: 0.1, margins: { top: 16, bottom: 18, left: 14, right: 14 } },
  'im::a5': { fontFamily: 'Inter', bodyPt: 8.83, headingPt: 14.41, lineHeight: 1.6, tableCellPaddingMm: 1.2, cellImageMaxHeightMm: 40, blockSpacingMm: 2.5, paragraphSpacingEm: 0.5, tableFontScale: 0.95, tableBorderMm: 0.1, margins: { top: 16, bottom: 18, left: 14, right: 14 } },
  'warning_leaflet::a4': { fontFamily: 'Inter', bodyPt: 6, headingPt: 8, lineHeight: 1.3, tableCellPaddingMm: 1.2, cellImageMaxHeightMm: 30, blockSpacingMm: 1.5, paragraphSpacingEm: 0.35, tableFontScale: 1, tableBorderMm: 0.1, margins: { top: 8, bottom: 8, left: 10, right: 10 } },
  'warning_leaflet::a5': { fontFamily: 'Inter', bodyPt: 6, headingPt: 8, lineHeight: 1.3, tableCellPaddingMm: 1.2, cellImageMaxHeightMm: 30, blockSpacingMm: 1.5, paragraphSpacingEm: 0.35, tableFontScale: 1, tableBorderMm: 0.1, margins: { top: 8, bottom: 8, left: 10, right: 10 } },

};

/** The built-in profile for a combination (never throws — falls back to the full-IM A4 set). */
export const defaultTypographyFor = (
  templateType: IMTemplateType | string,
  pageSize: PrintPageSizeKey | string,
): PrintTypography => DEFAULT_PRINT_TYPOGRAPHY[profileKey(templateType, pageSize)] ?? DEFAULT_PRINT_TYPOGRAPHY['im::a4'];

/**
 * Allowed ranges, shared by the admin form's inputs, the clamp below and the table's CHECK
 * constraints — so a value that passes here also passes the database.
 *
 * The 8mm floor on the bottom margin is load-bearing: the merge step stamps the running
 * footer and the page number into that band (render-print-merge.ts), and a shallower band
 * would print them over the body text. Left/right have no such floor, but the language edge
 * tabs are ~7–8mm wide, so a leaflet set below that will have content run under its tab.
 */
/**
 * Floor for table text, in points.
 *
 * tableFontScale exists so tabular matter can run a step below running text, as print manuals
 * conventionally set it. But this is safety content that has to stay readable at arm's length, so
 * the scale is clamped rather than trusted: at the 6pt leaflet body size a 0.6 scale would
 * otherwise produce 3.6pt. 6pt matches the smallest body size any profile ships with.
 *
 * Lives here rather than in the renderer because the editor needs the same floor to show tables
 * at the size they will print.
 */
export const MIN_TABLE_PT = 6;

/** Effective table point size for a profile, i.e. the scale with the floor applied. */
export const effectiveTablePt = (bodyPt: number, tableFontScale: number): number =>
  Math.max(MIN_TABLE_PT, bodyPt * tableFontScale);

export const PRINT_SETTING_LIMITS = {
  bodyPt: { min: 4, max: 32, step: 0.25 },
  headingPt: { min: 4, max: 48, step: 0.25 },
  lineHeight: { min: 1, max: 3, step: 0.05 },
  tableCellPaddingMm: { min: 0, max: 6, step: 0.1 },
  cellImageMaxHeightMm: { min: 5, max: 200, step: 1 },
  blockSpacingMm: { min: 0, max: 15, step: 0.1 },
  paragraphSpacingEm: { min: 0, max: 2, step: 0.05 },
  tableFontScale: { min: 0.6, max: 1, step: 0.05 },
  tableBorderMm: { min: 0, max: 1, step: 0.05 },
  marginTop: { min: 0, max: 60, step: 0.5 },
  marginBottom: { min: 8, max: 60, step: 0.5 },
  marginLeft: { min: 0, max: 60, step: 0.5 },
  marginRight: { min: 0, max: 60, step: 0.5 },
} as const;

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * Coerce anything into a valid typography set, filling each field from `fallback` when it is
 * missing or out of range. Used on both sides of the wire — mapping database rows in the
 * service, and validating the browser-supplied set inside the render functions (which must
 * not trust it: a tampered body could otherwise ask PDFShift for a 900pt page).
 */
export const normalizePrintTypography = (
  raw: Partial<PrintTypography> | null | undefined,
  fallback: PrintTypography,
): PrintTypography => {
  const L = PRINT_SETTING_LIMITS;
  const family = typeof raw?.fontFamily === 'string' && raw.fontFamily.trim() ? raw.fontFamily.trim() : fallback.fontFamily;
  return {
    fontFamily: (PRINT_FONT_FAMILIES as readonly string[]).includes(family) ? family : fallback.fontFamily,
    bodyPt: clamp(raw?.bodyPt, L.bodyPt.min, L.bodyPt.max, fallback.bodyPt),
    headingPt: clamp(raw?.headingPt, L.headingPt.min, L.headingPt.max, fallback.headingPt),
    lineHeight: clamp(raw?.lineHeight, L.lineHeight.min, L.lineHeight.max, fallback.lineHeight),
    tableCellPaddingMm: clamp(raw?.tableCellPaddingMm, L.tableCellPaddingMm.min, L.tableCellPaddingMm.max, fallback.tableCellPaddingMm),
    cellImageMaxHeightMm: clamp(raw?.cellImageMaxHeightMm, L.cellImageMaxHeightMm.min, L.cellImageMaxHeightMm.max, fallback.cellImageMaxHeightMm),
    blockSpacingMm: clamp(raw?.blockSpacingMm, L.blockSpacingMm.min, L.blockSpacingMm.max, fallback.blockSpacingMm),
    paragraphSpacingEm: clamp(raw?.paragraphSpacingEm, L.paragraphSpacingEm.min, L.paragraphSpacingEm.max, fallback.paragraphSpacingEm),
    tableFontScale: clamp(raw?.tableFontScale, L.tableFontScale.min, L.tableFontScale.max, fallback.tableFontScale),
    tableBorderMm: clamp(raw?.tableBorderMm, L.tableBorderMm.min, L.tableBorderMm.max, fallback.tableBorderMm),
    margins: {
      top: clamp(raw?.margins?.top, L.marginTop.min, L.marginTop.max, fallback.margins.top),
      bottom: clamp(raw?.margins?.bottom, L.marginBottom.min, L.marginBottom.max, fallback.margins.bottom),
      left: clamp(raw?.margins?.left, L.marginLeft.min, L.marginLeft.max, fallback.margins.left),
      right: clamp(raw?.margins?.right, L.marginRight.min, L.marginRight.max, fallback.margins.right),
    },
  };
};
