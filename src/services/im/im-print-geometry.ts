/**
 * The printed text column, expressed in CSS pixels, so the editor can be an exact model of it.
 *
 * WHY this exists. Authors were sizing images in the editor, exporting, finding the image had
 * changed size, going back and adjusting — repeatedly. Two separate causes:
 *
 *  1. The editor put no height cap on images, while print clamps them to cellImageMaxHeightMm.
 *     A tall image looked right while editing and was clamped in the PDF.
 *
 *  2. The print column has a FIXED width relative to the body size — 128mm at 7pt is 51.8em on
 *     A5 — whereas the editor canvas is fluid. At an 800px window it happened to be ~50em; at
 *     1200px it was 75em. So the same image occupied a different fraction of the column
 *     depending on the author's window size, and a pixel width was out by up to 2.5x: 150px is
 *     31% of the A5 column but 12.5% of a 1200px canvas.
 *
 * Giving the editor these numbers plus a `zoom` makes every unit — %, px and mm alike — land
 * where it will in print, because `zoom` scales all lengths uniformly.
 */

import { effectiveTablePt, type PrintTypography, type PrintPageSizeKey } from './im-print-typography';

/** CSS reference pixel: 1px is 1/96 inch, which is what makes px absolute in print. */
export const CSS_PX_PER_MM = 96 / 25.4;

/**
 * Page furniture on A5 is drawn at this fraction of its A4 size — icons, rules, tab widths and
 * the like. Type and the density settings deliberately do NOT go through it. Shared with the
 * renderer so the editor cannot drift from it.
 */
export const A5_FURNITURE_SCALE = 0.82;

/** Callout icon box in mm at A4, before the furniture scale. Mirrors the renderer's mm(8). */
const CALLOUT_ICON_MM = 8;
const PT_PER_INCH = 72;

/** Trim width of each page size, in mm. Heights live in PAGE_DIMS in im-print-html.ts. */
export const PAGE_WIDTH_MM: Record<PrintPageSizeKey, number> = { a4: 210, a5: 148 };

export interface PrintColumnGeometry {
  /** Text column between the left and right margins, in mm. */
  columnMm: number;
  /** The same column in CSS pixels — the width the editor canvas should be. */
  columnPx: number;
  /** Body size in CSS pixels, so text sits at the printed scale. */
  bodyPx: number;
  /** Image height ceiling in CSS pixels, mirroring the print stylesheet's max-height. */
  imageMaxHeightPx: number;
  /**
   * The same ceiling in em of body size.
   *
   * Expressed relative to the text so it stays proportionally correct in BOTH editor modes: at
   * the printed text size it resolves to exactly cellImageMaxHeightMm, and on the fluid canvas
   * it scales with the larger editing font instead of looking wrongly small.
   */
  imageMaxHeightEm: number;
  /**
   * Block spacing (blockSpacingMm) in em of body size.
   *
   * The editor used to bake `margin:1rem 0` onto every image inline, which beat both
   * stylesheets — so the editor showed 8.47mm of gap where print applies blockSpacingMm. In em
   * the same value is proportionally right on the fluid canvas and exact in the print preview.
   */
  blockSpacingEm: number;
  /** Column width measured in body ems — the ratio that was drifting with window size. */
  columnEm: number;
  /**
   * The remaining profile values the editor needs to look like the page.
   *
   * All expressed relative to the text (em) or as plain ratios, so they are proportionally right
   * on the fluid canvas and exact in the print-width preview. The editor stylesheet had its own
   * hardcoded copies of every one of these — `padding: 0.5rem`, `border: 1px`, `margin: 1em` —
   * which is why a table looked nothing like its printed self.
   */
  paragraphSpacingEm: number;
  listItemSpacingEm: number;
  cellPaddingEm: number;
  cellBorderEm: number;
  /** Table font size as a fraction of body, with the MIN_TABLE_PT floor already applied. */
  tableFontRatio: number;
  lineHeight: number;
  /** Callout icon box in em, furniture scale included. The editor had a fixed 64px (16.9mm). */
  calloutIconEm: number;
}

export const printColumnGeometry = (
  pageSize: PrintPageSizeKey,
  typography: PrintTypography,
): PrintColumnGeometry => {
  const columnMm = PAGE_WIDTH_MM[pageSize] - typography.margins.left - typography.margins.right;
  const columnPx = columnMm * CSS_PX_PER_MM;
  const bodyPx = (typography.bodyPt / PT_PER_INCH) * 96;
  return {
    columnMm,
    columnPx,
    bodyPx,
    imageMaxHeightPx: typography.cellImageMaxHeightMm * CSS_PX_PER_MM,
    imageMaxHeightEm: bodyPx > 0 ? (typography.cellImageMaxHeightMm * CSS_PX_PER_MM) / bodyPx : 0,
    blockSpacingEm: bodyPx > 0 ? (typography.blockSpacingMm * CSS_PX_PER_MM) / bodyPx : 0,
    columnEm: bodyPx > 0 ? columnPx / bodyPx : 0,
    paragraphSpacingEm: typography.paragraphSpacingEm,
    // Matches the renderer, which derives list items from the same setting rather than a second
    // knob that could contradict it.
    listItemSpacingEm: typography.paragraphSpacingEm * 0.3,
    cellPaddingEm: bodyPx > 0 ? (typography.tableCellPaddingMm * CSS_PX_PER_MM) / bodyPx : 0,
    cellBorderEm: bodyPx > 0 ? (typography.tableBorderMm * CSS_PX_PER_MM) / bodyPx : 0,
    tableFontRatio:
      typography.bodyPt > 0 ? effectiveTablePt(typography.bodyPt, typography.tableFontScale) / typography.bodyPt : 1,
    lineHeight: typography.lineHeight,
    calloutIconEm:
      bodyPx > 0
        ? (CALLOUT_ICON_MM * (pageSize === 'a5' ? A5_FURNITURE_SCALE : 1) * CSS_PX_PER_MM) / bodyPx
        : 0,
  };
};

/**
 * Legibility bounds for the preview zoom.
 *
 * The column is scaled to fill whatever width the editor has, which keeps proportions exact and
 * avoids a horizontal scrollbar. The clamp stops the extremes: a narrow pane must not shrink
 * 7pt text to something unreadable, and a very wide one must not blow it up absurdly.
 */
/**
 * Fitting beats legibility. The canvas is a FIXED pixel width, so a floor high enough to keep
 * 7pt text comfortable made the column overflow its pane and clip text mid-word in any editor
 * pane narrower than ~436px — much more likely now that the preview pane is resizable. Small
 * text can be read by widening the pane; clipped text is simply wrong.
 */
export const MIN_PREVIEW_ZOOM = 0.5;

/** Below this the modelled column is too small to work in; the UI says so rather than pretending. */
export const CRAMPED_PREVIEW_ZOOM = 0.8;
export const MAX_PREVIEW_ZOOM = 2.4;

/**
 * How much to scale the modelled column so it fills `availableWidth`.
 *
 * Returns 1 when the width is not yet measured (first paint), so the canvas renders at true
 * print size rather than jumping.
 */
export const previewZoomFor = (columnPx: number, availableWidth: number): number => {
  if (!(columnPx > 0) || !(availableWidth > 0)) return 1;
  const exact = availableWidth / columnPx;
  return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, exact));
};

/**
 * An author's image width expressed as a percentage of the printed column.
 *
 * Shown next to the width control so a pixel value is legible as a print proportion — the
 * relationship that was invisible before. Percentages and other relative units pass through
 * untouched; there is nothing to resolve.
 */
export const widthAsColumnPercent = (width: string, columnPx: number): number | null => {
  const match = width.trim().match(/^(\d+(?:\.\d+)?)px$/i);
  if (!match || !(columnPx > 0)) return null;
  return Math.round((Number(match[1]) / columnPx) * 100);
};
