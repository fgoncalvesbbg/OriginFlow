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

export const profileKey = (templateType: string, pageSize: string): string => `${templateType}::${pageSize}`;

/**
 * Built-in fallbacks, one per (template type, page size). These are the values the renderer
 * hardcoded before migration 122 — A4 body 3.8mm = 10.77pt, section title 6.2mm = 17.58pt,
 * A5 = those × the old 0.82 type scale, leaflets 6pt/8pt with the tight LEAFLET_MARGIN — so
 * an un-migrated or unreachable database still renders the output everyone is used to.
 */
export const DEFAULT_PRINT_TYPOGRAPHY: Record<string, PrintTypography> = {
  'im::a4': { fontFamily: 'Inter', bodyPt: 10.77, headingPt: 17.58, lineHeight: 1.6, margins: { top: 16, bottom: 18, left: 14, right: 14 } },
  'im::a5': { fontFamily: 'Inter', bodyPt: 8.83, headingPt: 14.41, lineHeight: 1.6, margins: { top: 16, bottom: 18, left: 14, right: 14 } },
  'warning_leaflet::a4': { fontFamily: 'Inter', bodyPt: 6, headingPt: 8, lineHeight: 1.3, margins: { top: 8, bottom: 8, left: 10, right: 10 } },
  'warning_leaflet::a5': { fontFamily: 'Inter', bodyPt: 6, headingPt: 8, lineHeight: 1.3, margins: { top: 8, bottom: 8, left: 10, right: 10 } },
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
export const PRINT_SETTING_LIMITS = {
  bodyPt: { min: 4, max: 32, step: 0.25 },
  headingPt: { min: 4, max: 48, step: 0.25 },
  lineHeight: { min: 1, max: 3, step: 0.05 },
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
    margins: {
      top: clamp(raw?.margins?.top, L.marginTop.min, L.marginTop.max, fallback.margins.top),
      bottom: clamp(raw?.margins?.bottom, L.marginBottom.min, L.marginBottom.max, fallback.margins.bottom),
      left: clamp(raw?.margins?.left, L.marginLeft.min, L.marginLeft.max, fallback.margins.left),
      right: clamp(raw?.margins?.right, L.marginRight.min, L.marginRight.max, fallback.margins.right),
    },
  };
};
