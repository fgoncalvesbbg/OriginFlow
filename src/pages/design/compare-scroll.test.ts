/**
 * Scroll mapping between two design spec versions.
 *
 * Worth testing on its own because it is the half of the compare view that can be wrong
 * without looking wrong: two panes scrolling together always *look* synchronised, and a
 * reader only discovers the mapping was off by a page when they act on the wrong artwork.
 * The arithmetic is pure, so the cases that matter — differing page heights, differing page
 * counts, the gap between pages, a zoomed pane — are all reachable here.
 */
import { describe, it, expect } from 'vitest';
import {
  readScrollPosition, scrollTopFor, mapPage,
  type PageBox,
} from './compare-scroll';

/** Pages of uniform height h, separated by a 24px gap, after 24px of top padding. */
const boxes = (count: number, h: number, gap = 24, pad = 24): PageBox[] =>
  Array.from({ length: count }, (_, i) => ({
    page: i + 1,
    top: pad + i * (h + gap),
    height: h,
  }));

describe('readScrollPosition', () => {
  const pages = boxes(5, 1000);

  it('reads the top of the document as page 1', () => {
    expect(readScrollPosition(pages, 0)).toEqual({ page: 1, fraction: 0 });
  });

  it('reads a position part-way down a page', () => {
    // Page 3 starts at 24 + 2*1024 = 2072; a quarter down is 2322.
    expect(readScrollPosition(pages, 2322)).toEqual({ page: 3, fraction: 0.25 });
  });

  it('reads the gap between two pages as the bottom of the earlier one', () => {
    // 1036 is inside the gap after page 1 (which ends at 1024). Rounding it forward would
    // jump the other pane to page 2 while the reader is still looking at page 1.
    const pos = readScrollPosition(pages, 1036);
    expect(pos.page).toBe(1);
    expect(pos.fraction).toBe(1);
  });

  it('never reports a fraction outside the page', () => {
    for (const top of [-500, 0, 1036, 99999]) {
      const { fraction } = readScrollPosition(pages, top);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });

  it('survives a document with no pages rendered yet', () => {
    expect(readScrollPosition([], 400)).toEqual({ page: 1, fraction: 0 });
  });

  it('is independent of scale — the whole point of storing a fraction', () => {
    // The same page, the same place on it, rendered at half the size.
    const zoomed = boxes(5, 500);
    const atFull = readScrollPosition(pages, 2072 + 1000 * 0.4);
    const atHalf = readScrollPosition(zoomed, 24 + 2 * 524 + 500 * 0.4);
    expect(atHalf).toEqual(atFull);
  });
});

describe('scrollTopFor', () => {
  it('round-trips a position through a pane of identical geometry', () => {
    const pages = boxes(5, 1000);
    const top = scrollTopFor(pages, readScrollPosition(pages, 2322));
    expect(top).toBe(2322);
  });

  it('lands on the same relative place in a differently sized page', () => {
    const a = boxes(3, 1000);
    const b = boxes(3, 600);
    // Half-way down page 2 on the left is half-way down page 2 on the right, whatever the
    // two pages measure.
    const top = scrollTopFor(b, readScrollPosition(a, 24 + 1024 + 500));
    expect(top).toBe(24 + 624 + 300);
  });

  it('clamps a page the other version does not have to its last page', () => {
    const shorter = boxes(2, 1000);
    const top = scrollTopFor(shorter, { page: 9, fraction: 0 });
    expect(top).toBe(24 + 1024);
  });

  it('clamps a page before the first to the first', () => {
    const pages = boxes(3, 1000);
    expect(scrollTopFor(pages, { page: -4, fraction: 0.5 })).toBe(24 + 500);
  });

  it('returns the top when the other pane has not rendered yet', () => {
    expect(scrollTopFor([], { page: 3, fraction: 0.5 })).toBe(0);
  });
});

describe('mapPage', () => {
  it('is the identity at offset zero', () => {
    expect(mapPage(4, 0, 10)).toBe(4);
  });

  it('applies the reader-dialled offset in both directions', () => {
    expect(mapPage(5, -1, 10)).toBe(4);
    expect(mapPage(5, 2, 10)).toBe(7);
  });

  it('clamps into the target document rather than asking for a page that is not there', () => {
    expect(mapPage(1, -5, 10)).toBe(1);
    expect(mapPage(9, 5, 10)).toBe(10);
  });

  it('treats an empty document as one page rather than page zero', () => {
    expect(mapPage(3, 0, 0)).toBe(1);
  });
});
