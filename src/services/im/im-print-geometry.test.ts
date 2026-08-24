/**
 * The printed column in CSS pixels — the numbers the editor uses to model print.
 *
 * These are the values that were implicitly wrong before: the editor's column-to-text ratio
 * drifted with window size while print's is fixed, so an image occupied a different fraction of
 * the column depending on the author's monitor.
 */
import { describe, it, expect } from 'vitest';
import {
  printColumnGeometry,
  previewZoomFor,
  widthAsColumnPercent,
  PAGE_WIDTH_MM,
  CSS_PX_PER_MM,
  MIN_PREVIEW_ZOOM,
  MAX_PREVIEW_ZOOM,
} from './im-print-geometry';
import { defaultTypographyFor } from './im-print-typography';

describe('printColumnGeometry', () => {
  it('measures the A5 column between its margins', () => {
    const t = { ...defaultTypographyFor('im', 'a5'), margins: { top: 13, bottom: 15, left: 10, right: 10 } };
    const g = printColumnGeometry('a5', t);
    expect(g.columnMm).toBe(128); // 148 - 10 - 10
    expect(g.columnPx).toBeCloseTo(128 * CSS_PX_PER_MM, 3);
  });

  it('converts body points to CSS pixels at 96dpi', () => {
    const t = { ...defaultTypographyFor('im', 'a5'), bodyPt: 7 };
    // 7pt = 7/72 inch = 9.333px
    expect(printColumnGeometry('a5', t).bodyPx).toBeCloseTo(9.333, 3);
  });

  it('reports the column in ems — the ratio the fluid canvas was getting wrong', () => {
    const t = { ...defaultTypographyFor('im', 'a5'), bodyPt: 7, margins: { top: 13, bottom: 15, left: 10, right: 10 } };
    // 128mm at 7pt is ~51.8em; a 1200px editor canvas at 16px text is 75em.
    expect(printColumnGeometry('a5', t).columnEm).toBeCloseTo(51.8, 1);
  });

  it('mirrors the print image height cap, which the editor had no equivalent of', () => {
    const t = { ...defaultTypographyFor('im', 'a5'), cellImageMaxHeightMm: 40 };
    expect(printColumnGeometry('a5', t).imageMaxHeightPx).toBeCloseTo(40 * CSS_PX_PER_MM, 3);
  });

  it('gives A4 a wider column than A5', () => {
    const t = defaultTypographyFor('im', 'a4');
    expect(printColumnGeometry('a4', t).columnMm).toBeGreaterThan(printColumnGeometry('a5', t).columnMm);
    expect(PAGE_WIDTH_MM.a4).toBeGreaterThan(PAGE_WIDTH_MM.a5);
  });

  it('survives a zero body size without dividing by it', () => {
    const t = { ...defaultTypographyFor('im', 'a5'), bodyPt: 0 };
    expect(printColumnGeometry('a5', t).columnEm).toBe(0);
  });
});

describe('previewZoomFor', () => {
  it('scales the column to fill the available width exactly', () => {
    expect(previewZoomFor(484, 968)).toBeCloseTo(2, 5);
  });

  it('stays at true print size until the width has been measured', () => {
    // First paint: a 0 width must not collapse the canvas.
    expect(previewZoomFor(484, 0)).toBe(1);
    expect(previewZoomFor(0, 800)).toBe(1);
  });

  it('will not shrink print text below the legibility floor', () => {
    expect(previewZoomFor(484, 100)).toBe(MIN_PREVIEW_ZOOM);
  });

  it('will not blow text up absurdly on a very wide pane', () => {
    expect(previewZoomFor(484, 100000)).toBe(MAX_PREVIEW_ZOOM);
  });
});

describe('widthAsColumnPercent', () => {
  it('resolves a pixel width against the printed column', () => {
    // The case that bit: 150px is 31% of the A5 column, not the ~13% a wide canvas suggested.
    expect(widthAsColumnPercent('150px', 128 * CSS_PX_PER_MM)).toBe(31);
  });

  it('leaves relative units alone — there is nothing to resolve', () => {
    expect(widthAsColumnPercent('50%', 484)).toBeNull();
    expect(widthAsColumnPercent('10em', 484)).toBeNull();
    expect(widthAsColumnPercent('', 484)).toBeNull();
  });

  it('tolerates whitespace and casing from hand-edited markup', () => {
    expect(widthAsColumnPercent(' 242PX ', 484)).toBe(50);
  });
});

describe('imageMaxHeightEm', () => {
  it('expresses the cap relative to text, so it holds in both editor modes', () => {
    const t = { ...defaultTypographyFor('im', 'a5'), bodyPt: 7, cellImageMaxHeightMm: 40 };
    const g = printColumnGeometry('a5', t);
    // 40mm = 151.2px, body 7pt = 9.333px -> 16.2em. At a 16px editing font that is 259px:
    // proportionally the same, which a fixed pixel cap would not have been.
    expect(g.imageMaxHeightEm).toBeCloseTo(16.2, 1);
    expect(g.imageMaxHeightEm * g.bodyPx).toBeCloseTo(g.imageMaxHeightPx, 3);
  });

  it('does not divide by a zero body size', () => {
    const t = { ...defaultTypographyFor('im', 'a5'), bodyPt: 0 };
    expect(printColumnGeometry('a5', t).imageMaxHeightEm).toBe(0);
  });
});

describe('blockSpacingEm', () => {
  it('carries the print block spacing to the editor in text-relative units', () => {
    const t = { ...defaultTypographyFor('im', 'a5'), bodyPt: 7, blockSpacingMm: 2.5 };
    const g = printColumnGeometry('a5', t);
    // 2.5mm = 9.45px against a 9.333px body -> ~1.01em. The editor used to bake 1rem (16px =
    // 4.23mm), which is where the extra gap came from.
    expect(g.blockSpacingEm).toBeCloseTo(1.01, 2);
    expect(g.blockSpacingEm * g.bodyPx).toBeCloseTo(2.5 * CSS_PX_PER_MM, 3);
  });

  it('does not divide by a zero body size', () => {
    expect(printColumnGeometry('a5', { ...defaultTypographyFor('im', 'a5'), bodyPt: 0 }).blockSpacingEm).toBe(0);
  });
});
