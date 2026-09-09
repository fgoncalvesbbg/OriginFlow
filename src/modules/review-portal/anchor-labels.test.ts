import { describe, it, expect } from 'vitest';
import { anchorLabel, anchorExcerpt, anchorSortKey, orderByAnchor } from './anchor-labels';
import type { PdfReviewAnchor, ReviewAnchor, TextReviewAnchor } from '../../types/review.types';

const text = (over: Partial<TextReviewAnchor> = {}): TextReviewAnchor => ({
  kind: 'text',
  sectionId: 'sec-1',
  sectionTitle: 'Safety',
  quote: 'wrong voltage',
  quoteBefore: null,
  quoteAfter: null,
  ...over,
});

const pin = (over: Partial<PdfReviewAnchor> = {}): PdfReviewAnchor => ({
  kind: 'pdf', page: 2, x: 0.5, y: 0.5, w: null, h: null, ...over,
});

describe('anchorLabel', () => {
  it('uses the chapter title for a text anchor', () => {
    expect(anchorLabel(text())).toBe('Safety');
  });

  it('falls back when a text anchor has no snapshotted title', () => {
    // IM notes were written without one before the title was snapshotted.
    expect(anchorLabel(text({ sectionTitle: null }))).toBe('Chapter');
    expect(anchorLabel(text({ sectionTitle: '   ' }))).toBe('Chapter');
    expect(anchorLabel(text({ sectionTitle: null }), 'Selected text')).toBe('Selected text');
  });

  it('names the page for a pin', () => {
    expect(anchorLabel(pin({ page: 3 }))).toBe('Page 3');
  });

  it('distinguishes a dragged region from a point pin', () => {
    // A reader scanning the rail should be able to tell which kind of mark a note is.
    expect(anchorLabel(pin({ page: 4, w: 0.2, h: 0.1 }))).toBe('Page 4 · area');
  });

  it('says so when a row has no anchor at all', () => {
    expect(anchorLabel(null)).toBe('Unanchored');
  });
});

describe('anchorExcerpt', () => {
  it('quotes the selected wording for a text anchor', () => {
    expect(anchorExcerpt(text())).toBe('wrong voltage');
  });

  it('is null for a chapter-level text note', () => {
    expect(anchorExcerpt(text({ quote: null }))).toBeNull();
    expect(anchorExcerpt(text({ quote: '  ' }))).toBeNull();
  });

  it('is null for a pin — a PDF has no words of ours to quote', () => {
    expect(anchorExcerpt(pin())).toBeNull();
  });

  it('is null when there is no anchor', () => {
    expect(anchorExcerpt(null)).toBeNull();
  });
});

describe('anchorSortKey', () => {
  it('keys a pin by page then depth', () => {
    expect(anchorSortKey(pin({ page: 3, y: 0.25 }))).toEqual([3, 0.25]);
  });

  it('keys anything else at the origin, so text anchors do not reorder', () => {
    expect(anchorSortKey(text())).toEqual([0, 0]);
    expect(anchorSortKey(null)).toEqual([0, 0]);
  });
});

describe('orderByAnchor', () => {
  const note = (id: string, anchor: ReviewAnchor | null, createdAt: string) =>
    ({ id, anchor, createdAt });

  it('puts a PDF s notes in reading order: page, then down the page', () => {
    const out = orderByAnchor([
      note('c', pin({ page: 2, y: 0.9 }), '2026-09-01T00:00:00Z'),
      note('a', pin({ page: 1, y: 0.2 }), '2026-09-03T00:00:00Z'),
      note('b', pin({ page: 2, y: 0.1 }), '2026-09-02T00:00:00Z'),
    ]);
    expect(out.map(n => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a tie by when the note was written, so the order is stable', () => {
    const out = orderByAnchor([
      note('second', pin({ page: 1, y: 0.5 }), '2026-09-02T00:00:00Z'),
      note('first', pin({ page: 1, y: 0.5 }), '2026-09-01T00:00:00Z'),
    ]);
    expect(out.map(n => n.id)).toEqual(['first', 'second']);
  });

  it('leaves text-anchored notes in the order they arrived', () => {
    // Re-sorting would shuffle a rail the reviewer is already looking at, and creation order
    // already tracks chapter order closely enough for the IM.
    const out = orderByAnchor([
      note('z', text(), '2026-09-03T00:00:00Z'),
      note('y', text(), '2026-09-01T00:00:00Z'),
    ]);
    expect(out.map(n => n.id)).toEqual(['z', 'y']);
  });

  it('does not mutate the input', () => {
    const input = [
      note('c', pin({ page: 2, y: 0.9 }), '2026-09-01T00:00:00Z'),
      note('a', pin({ page: 1, y: 0.2 }), '2026-09-03T00:00:00Z'),
    ];
    orderByAnchor(input);
    expect(input.map(n => n.id)).toEqual(['c', 'a']);
  });
});
