/**
 * How a review anchor reads on screen — pure, so it can be tested and so the shell and the
 * PM-side panel cannot describe the same note two different ways.
 *
 * A note in the shared review layer points at EITHER rendered text (a chapter plus the
 * wording selected) or a PDF page (a normalised position). Every surface that lists notes
 * needs a short label and, where there is one, an excerpt — and both had to come from
 * somewhere once the anchor became a union in migration 162.
 */

import type { ReviewAnchor } from '../../types/review.types';

/** Fallback when a row satisfies neither anchor shape, which the database forbids. */
const UNANCHORED = 'Unanchored';

/**
 * The short label above a note: the chapter for a text anchor, the page for a pin.
 *
 * `fallback` covers a text anchor whose chapter title was never snapshotted — the IM used
 * to write notes without one — so the caller can say "Chapter" rather than showing nothing.
 */
export const anchorLabel = (anchor: ReviewAnchor | null, fallback = 'Chapter'): string => {
  if (!anchor) return UNANCHORED;
  if (anchor.kind === 'pdf') {
    // "Page 3" for a pin, "Page 3 · area" for a dragged region — the reader should be able
    // to tell from the list which kind of mark they are looking at.
    return anchor.w != null && anchor.h != null
      ? `Page ${anchor.page} · area`
      : `Page ${anchor.page}`;
  }
  return anchor.sectionTitle?.trim() || fallback;
};

/**
 * The quoted excerpt shown under the label, or null when the anchor has none.
 *
 * A pin has no text to quote — the PDF's words are not ours to read — so a PDF note shows
 * its position and nothing else. Returning null rather than an empty string is what lets
 * the caller drop the blockquote entirely instead of rendering an empty one.
 */
export const anchorExcerpt = (anchor: ReviewAnchor | null): string | null => {
  if (!anchor || anchor.kind !== 'text') return null;
  const quote = anchor.quote?.trim();
  return quote ? quote : null;
};

/** Sort key that keeps a PDF's notes in reading order: by page, then down the page. */
export const anchorSortKey = (anchor: ReviewAnchor | null): [number, number] => {
  if (!anchor || anchor.kind !== 'pdf') return [0, 0];
  return [anchor.page, anchor.y];
};

/**
 * Order notes the way the reviewer reads the document.
 *
 * For a PDF that is page order then top-to-bottom, which is what makes a numbered pin list
 * match the pins on the page. For text anchors the creation order already matches the
 * chapter order closely enough, and re-sorting would shuffle a rail the reviewer is looking
 * at — so this is a stable no-op for them.
 */
export const orderByAnchor = <T extends { anchor: ReviewAnchor | null; createdAt: string }>(
  comments: readonly T[],
): T[] => {
  const anyPdf = comments.some(c => c.anchor?.kind === 'pdf');
  if (!anyPdf) return [...comments];
  return [...comments].sort((a, b) => {
    const [ap, ay] = anchorSortKey(a.anchor);
    const [bp, by] = anchorSortKey(b.anchor);
    if (ap !== bp) return ap - bp;
    if (ay !== by) return ay - by;
    // Two pins in the same spot fall back to when they were written, so the order is stable
    // rather than dependent on the sort implementation.
    return a.createdAt.localeCompare(b.createdAt);
  });
};
