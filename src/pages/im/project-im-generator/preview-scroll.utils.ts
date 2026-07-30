/**
 * Helpers for jumping the Live Preview pane to a specific chapter.
 *
 * The preview marks every chapter it renders with `data-preview-section="<sectionId>"`. Only
 * chapters that survive their condition and SKU scope are rendered, so a lookup miss is
 * meaningful ("this chapter isn't in the manual right now") rather than an error.
 */

/** Attribute the preview stamps on each rendered chapter wrapper. */
export const PREVIEW_SECTION_ATTR = 'data-preview-section';

/** Breathing room above the target so its heading isn't flush against the pane's top edge. */
export const PREVIEW_SCROLL_MARGIN_PX = 24;

/**
 * Find a rendered chapter inside the preview scroller.
 *
 * Matches the attribute in JS rather than building an attribute selector: section ids come
 * from data and would otherwise need CSS escaping to be safe in a selector string.
 */
export const findPreviewSection = (
  scroller: HTMLElement,
  sectionId: string,
): HTMLElement | null => {
  const candidates = scroller.querySelectorAll<HTMLElement>(`[${PREVIEW_SECTION_ATTR}]`);
  for (const el of candidates) {
    if (el.getAttribute(PREVIEW_SECTION_ATTR) === sectionId) return el;
  }
  return null;
};

/**
 * Scroll offset within `scroller` that brings `target` to the top, minus a small margin.
 *
 * Computed from the delta between the two bounding rects plus the current `scrollTop`, rather
 * than `offsetTop`: the preview nests the chapter several positioned wrappers deep (page,
 * content column, spacing wrapper), so `offsetTop` is relative to an unpredictable ancestor.
 */
export const previewScrollTopFor = (
  scroller: { getBoundingClientRect(): { top: number }; scrollTop: number },
  target: { getBoundingClientRect(): { top: number } },
): number =>
  Math.max(
    0,
    target.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top
      + scroller.scrollTop
      - PREVIEW_SCROLL_MARGIN_PX,
  );
