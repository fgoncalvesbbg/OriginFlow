/**
 * Mapping a scroll position from one design spec version's pages onto another's.
 *
 * WHY NOT JUST COPY `scrollTop`. Two versions of a spec are two different PDFs. They can
 * differ in page size, in page count, and — once a reader zooms one pane — in rendered
 * scale. Copying a pixel offset from one pane to the other therefore drifts immediately and
 * gets worse the further down the document you go, which is precisely where a reader needs
 * the two sides to agree.
 *
 * So a position is expressed the way a person describes one: **which page, and how far down
 * it**. Both halves survive a different page size, a different zoom on each side, and a
 * re-render at a new scale, because they are re-derived from whatever geometry each pane
 * actually has on screen.
 *
 * WHAT THIS CANNOT DO. It maps page N to page N + offset and nothing cleverer. If the design
 * team inserted a page in the middle of v3, every page after it is off by one and the reader
 * fixes that with the offset control — there is no content matching here, and pretending
 * otherwise would silently line up two unrelated pages. The offset is deliberately visible
 * for that reason.
 *
 * Pure and DOM-free so the arithmetic is testable; collecting the boxes is the component's
 * job. See docs/originflow-design-spec-version-review.md, step 2.
 */

/** One page's geometry inside a pane's scroll container, in that pane's own pixels. */
export interface PageBox {
  /** 1-based page number. */
  page: number;
  /** Offset of the page's top edge from the top of the scrollable content. */
  top: number;
  height: number;
}

/** A position in a document, independent of scale and page size. */
export interface ScrollPosition {
  page: number;
  /** How far into that page, 0 (its top edge) to 1 (its bottom edge). */
  fraction: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Which page the reader is looking at, and how far into it.
 *
 * `boxes` must be in page order, which is what the DOM hands back. A scroll position in the
 * gap *between* two pages reads as the bottom of the earlier one rather than the top of the
 * next: the gap belongs to neither, and rounding it forward would make the other pane jump a
 * page ahead while the reader is still looking at the previous one.
 *
 * Above the first page — the container's top padding — reads as the top of page 1.
 */
export const readScrollPosition = (
  boxes: readonly PageBox[],
  scrollTop: number,
): ScrollPosition => {
  if (boxes.length === 0) return { page: 1, fraction: 0 };
  let current = boxes[0];
  for (const box of boxes) {
    if (box.top > scrollTop) break;
    current = box;
  }
  const fraction = current.height > 0 ? (scrollTop - current.top) / current.height : 0;
  return { page: current.page, fraction: clamp01(fraction) };
};

/**
 * The `scrollTop` that puts a position at the top of a pane's viewport.
 *
 * A page number this pane does not have is clamped to its nearest end rather than ignored,
 * so comparing a 20-page draft against a 12-page one parks the shorter side at its last page
 * instead of leaving it wherever it happened to be — the reader can see it has run out.
 */
export const scrollTopFor = (
  boxes: readonly PageBox[],
  position: ScrollPosition,
): number => {
  if (boxes.length === 0) return 0;
  const exact = boxes.find(b => b.page === position.page);
  const box = exact ?? (position.page < boxes[0].page ? boxes[0] : boxes[boxes.length - 1]);
  return box.top + clamp01(position.fraction) * box.height;
};

/**
 * The facing page in the other pane.
 *
 * `offset` is what the reader dials in when the two versions stopped lining up — "v3's page
 * 5 is v2's page 4" is an offset of -1 going that way. Clamped into the target's real range
 * so an offset larger than the document cannot ask for a page that does not exist.
 */
export const mapPage = (page: number, offset: number, pageCount: number): number => {
  const last = Math.max(1, pageCount);
  const target = page + offset;
  return target < 1 ? 1 : target > last ? last : target;
};
