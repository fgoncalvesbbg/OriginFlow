import { describe, it, expect } from 'vitest';
import { previewScrollTopFor, PREVIEW_SCROLL_MARGIN_PX } from './preview-scroll.utils';

const scroller = (top: number, scrollTop: number) => ({
  getBoundingClientRect: () => ({ top }),
  scrollTop,
});
const target = (top: number) => ({ getBoundingClientRect: () => ({ top }) });

describe('previewScrollTopFor', () => {
  it('converts a viewport delta into a scroll offset, less the top margin', () => {
    // Target sits 300px below the pane's top edge, pane already scrolled 200px.
    expect(previewScrollTopFor(scroller(100, 200), target(400))).toBe(500 - PREVIEW_SCROLL_MARGIN_PX);
  });

  it('accounts for the pane already being scrolled', () => {
    const unscrolled = previewScrollTopFor(scroller(0, 0), target(1000));
    const scrolled = previewScrollTopFor(scroller(0, 640), target(360));
    // Same chapter, same absolute position in the document — same destination either way.
    expect(scrolled).toBe(unscrolled);
  });

  it('handles a target above the current viewport (scrolling back up)', () => {
    // Target is 500px ABOVE the pane's top edge: negative delta, still a valid offset.
    expect(previewScrollTopFor(scroller(100, 900), target(-400))).toBe(400 - PREVIEW_SCROLL_MARGIN_PX);
  });

  it('never returns a negative offset', () => {
    // First chapter already at the top: the margin subtraction would otherwise go below zero.
    expect(previewScrollTopFor(scroller(100, 0), target(105))).toBe(0);
  });
});
