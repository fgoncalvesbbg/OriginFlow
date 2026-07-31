import { describe, expect, it } from 'vitest';
import {
  assembleMarkdown,
  buildFrontMatter,
  buildPageMarker,
  detectColumns,
  estimateTokens,
  groupIntoLines,
  isImageOnlyPage,
  joinLineItems,
  reconstructPageText,
} from './pdf-to-markdown.utils';
import { TextItemLike } from './types';

const item = (str: string, x: number, y: number, width: number, height = 10): TextItemLike => ({
  str,
  x,
  y,
  width,
  height,
});

describe('groupIntoLines', () => {
  it('groups items with close y-coordinates into one line', () => {
    const items = [item('Hello', 0, 100, 30), item('World', 40, 101, 30)];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0].items).toHaveLength(2);
  });

  it('splits items into separate lines when y differs beyond tolerance', () => {
    const items = [item('Line one', 0, 100, 30), item('Line two', 0, 80, 30)];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(2);
  });

  it('skips items with empty strings', () => {
    const items = [item('', 0, 100, 0), item('Text', 10, 100, 30)];
    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0].items).toHaveLength(1);
  });
});

describe('joinLineItems', () => {
  it('concatenates directly when items are adjacent (no inserted space)', () => {
    // "Hello" ends at x=50; "World" starts at x=50 — no gap, should NOT get an extra space
    // beyond whatever whitespace is already in the strings.
    const items = [item('Hello ', 0, 100, 50), item('World', 50, 100, 50)];
    expect(joinLineItems(items)).toBe('Hello World');
  });

  it('inserts a space across a wide gap between words', () => {
    const items = [item('Hello', 0, 100, 40), item('World', 100, 100, 40)];
    // mean char width = 40/5 = 8, threshold = 2.4; gap = 100 - 40 = 60 > threshold
    expect(joinLineItems(items)).toBe('Hello World');
  });

  it('does not insert a space inside a run of tightly-kerned glyphs', () => {
    const items = [item('W', 0, 100, 10), item('o', 9.5, 100, 8), item('rd', 17, 100, 16)];
    expect(joinLineItems(items)).toBe('Word');
  });

  it('sorts items by x before joining regardless of input order', () => {
    const items = [item('World', 60, 100, 40), item('Hello', 0, 100, 40)];
    expect(joinLineItems(items)).toBe('Hello World');
  });
});

describe('detectColumns', () => {
  it('detects two clusters separated by a wide gap', () => {
    const lines = [
      { x: 10 }, { x: 12 }, { x: 11 }, // left column
      { x: 300 }, { x: 302 }, { x: 301 }, // right column
    ];
    const groups = detectColumns(lines, 400, 0.15, 2);
    expect(groups).toHaveLength(2);
    expect(groups[0].sort()).toEqual([0, 1, 2]);
    expect(groups[1].sort()).toEqual([3, 4, 5]);
  });

  it('returns a single group when there is no clear gap', () => {
    const lines = [{ x: 10 }, { x: 15 }, { x: 20 }, { x: 25 }];
    const groups = detectColumns(lines, 400, 0.15, 2);
    expect(groups).toHaveLength(1);
  });

  it('folds a lone stray line (e.g. a page number) into its nearest column', () => {
    const lines = [
      { x: 10 }, { x: 12 }, { x: 11 }, // left column
      { x: 300 }, { x: 302 }, { x: 301 }, // right column
      { x: 390 }, // stray single line far to the right
    ];
    const groups = detectColumns(lines, 400, 0.15, 2);
    expect(groups).toHaveLength(2);
    expect(groups.reduce((n, g) => n + g.length, 0)).toBe(7);
  });

  it('does not treat a page with too few lines as columns', () => {
    const groups = detectColumns([{ x: 10 }, { x: 300 }], 400, 0.15, 2);
    expect(groups).toHaveLength(1);
  });
});

describe('reconstructPageText', () => {
  it('orders single-column text top-to-bottom', () => {
    const items = [
      item('Second line', 0, 80, 100),
      item('First line', 0, 100, 100),
    ];
    expect(reconstructPageText(items, 400, true)).toBe('First line\nSecond line');
  });

  it('emits two-column text sequentially rather than interleaved', () => {
    const items = [
      // Left column, top to bottom
      item('Left A', 10, 200, 60),
      item('Left B', 10, 180, 60),
      item('Left C', 10, 160, 60),
      // Right column, top to bottom, interleaved by y with the left column
      item('Right A', 300, 190, 60),
      item('Right B', 300, 170, 60),
      item('Right C', 300, 150, 60),
    ];
    const text = reconstructPageText(items, 600, true);
    expect(text).toBe('Left A\nLeft B\nLeft C\n\nRight A\nRight B\nRight C');
  });

  it('falls back to plain top-to-bottom order when column detection is disabled', () => {
    const items = [
      item('Left A', 10, 200, 60),
      item('Right A', 300, 190, 60),
      item('Left B', 10, 180, 60),
      item('Right B', 300, 170, 60),
    ];
    const text = reconstructPageText(items, 600, false);
    expect(text).toBe('Left A\nRight A\nLeft B\nRight B');
  });
});

describe('estimateTokens', () => {
  it('divides characters by 4, rounding up', () => {
    expect(estimateTokens(400)).toBe(100);
    expect(estimateTokens(401)).toBe(101);
    expect(estimateTokens(0)).toBe(0);
  });
});

describe('isImageOnlyPage', () => {
  it('flags pages under the character threshold', () => {
    expect(isImageOnlyPage(0)).toBe(true);
    expect(isImageOnlyPage(19)).toBe(true);
    expect(isImageOnlyPage(20)).toBe(false);
  });
});

describe('buildPageMarker', () => {
  it('emits a bare marker for a normal text page', () => {
    expect(buildPageMarker(12, false, 0)).toBe('--- page 12 ---');
  });

  it('annotates image-only pages, ignoring image count', () => {
    expect(buildPageMarker(12, true, 3)).toBe('--- page 12 --- [NO TEXT LAYER — image only]');
  });

  it('annotates pages that contain images, with correct pluralization', () => {
    expect(buildPageMarker(12, false, 1)).toBe('--- page 12 --- [1 image]');
    expect(buildPageMarker(12, false, 3)).toBe('--- page 12 --- [3 images]');
  });
});

describe('buildFrontMatter', () => {
  it('includes all required summary fields', () => {
    const fm = buildFrontMatter({
      fileName: 'manual.pdf',
      pageCount: 50,
      charCount: 48000,
      estimatedTokens: 12000,
      imageOnlyPageCount: 2,
      pagesWithImagesCount: 14,
      pages: [],
    });
    expect(fm).toContain('source: manual.pdf');
    expect(fm).toContain('pages: 50');
    expect(fm).toContain('characters: 48000');
    expect(fm).toContain('estimated_tokens: 12000');
    expect(fm).toContain('image_only_pages: 2');
    expect(fm).toContain('pages_with_images: 14');
  });
});

describe('assembleMarkdown', () => {
  it('inserts an exact page marker before each page and computes summary meta', () => {
    const pageOneText = 'Hello world, this is a normal text page.';
    const { meta, markdown } = assembleMarkdown('manual.pdf', [
      { pageNumber: 1, text: pageOneText, imageCount: 0 },
      { pageNumber: 2, text: '', imageCount: 0 },
      { pageNumber: 3, text: 'Diagram caption text here', imageCount: 2 },
    ]);

    expect(markdown).toContain(`--- page 1 ---\n\n${pageOneText}`);
    expect(markdown).toContain('--- page 2 --- [NO TEXT LAYER — image only]');
    expect(markdown).toContain('--- page 3 --- [2 images]\n\nDiagram caption text here');

    expect(meta.pageCount).toBe(3);
    expect(meta.imageOnlyPageCount).toBe(1);
    expect(meta.pagesWithImagesCount).toBe(1);
    expect(meta.charCount).toBe(pageOneText.length + 'Diagram caption text here'.length);
  });

  it('never silently emits an empty page for image-only pages', () => {
    const { markdown } = assembleMarkdown('scan.pdf', [{ pageNumber: 1, text: '', imageCount: 0 }]);
    expect(markdown).toContain('[NO TEXT LAYER — image only]');
  });
});
