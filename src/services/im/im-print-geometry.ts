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

import type { PrintTypography, PrintPageSizeKey } from './im-print-typography';

/** CSS reference pixel: 1px is 1/96 inch, which is what makes px absolute in print. */
export const CSS_PX_PER_MM = 96 / 25.4;
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
  };
};

/**
 * Legibility bounds for the preview zoom.
 *
 * The column is scaled to fill whatever width the editor has, which keeps proportions exact and
 * avoids a horizontal scrollbar. The clamp stops the extremes: a narrow pane must not shrink
 * 7pt text to something unreadable, and a very wide one must not blow it up absurdly.
 */
export const MIN_PREVIEW_ZOOM = 0.9;
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
