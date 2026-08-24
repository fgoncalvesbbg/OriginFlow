/**
 * The image-placement rule shared by the editor and the print renderer.
 *
 * The fallback to inline `float`/`display` is the part that matters: the editor's serializer
 * rebuilds an image's style from scratch, so a placement it cannot read is destroyed on the
 * first edit — a legacy floated image silently becomes a full-width band and text stops
 * wrapping beside it.
 */
import { describe, it, expect } from 'vitest';
import { inferImageAlign, isFloatAlign, IMAGE_ALIGNS, FLOAT_MAX_WIDTH_PCT } from './im-image-align';

describe('inferImageAlign', () => {
  it('takes data-align when the Align control set one', () => {
    for (const align of IMAGE_ALIGNS) expect(inferImageAlign(align)).toBe(align);
  });

  it('prefers data-align over a stale inline style', () => {
    expect(inferImageAlign('right', { cssFloat: 'left' })).toBe('right');
  });

  it('ignores a data-align value the control could not have produced', () => {
    expect(inferImageAlign('middle')).toBeUndefined();
    expect(inferImageAlign('')).toBeUndefined();
  });

  it('tolerates casing and stray whitespace from hand-edited HTML', () => {
    expect(inferImageAlign(' LEFT ')).toBe('left');
    expect(inferImageAlign(null, { cssFloat: ' Right ' })).toBe('right');
  });

  it('recovers a float from the inline style — the legacy library case', () => {
    expect(inferImageAlign(null, { cssFloat: 'left' })).toBe('left');
    expect(inferImageAlign(undefined, { cssFloat: 'right' })).toBe('right');
  });

  it('reads a centred image off an auto margin, shorthand or per-side', () => {
    expect(inferImageAlign(null, { margin: '1rem auto' })).toBe('center');
    expect(inferImageAlign(null, { margin: 'auto' })).toBe('center');
  });

  it('reads a single-line inline image off display', () => {
    expect(inferImageAlign(null, { display: 'inline' })).toBe('inline');
  });

  it('ranks float above display, since a float is also display:inline in old markup', () => {
    // The migrated WEEE logo carried exactly this pair, and it must wrap text, not sit on a line.
    expect(inferImageAlign(null, { cssFloat: 'left', display: 'inline' })).toBe('left');
  });

  it('expresses nothing when the style says nothing about placement', () => {
    expect(inferImageAlign(null, { display: 'block' })).toBeUndefined();
    expect(inferImageAlign(null, {})).toBeUndefined();
    expect(inferImageAlign(null, { cssFloat: 'none', margin: '1rem 0' })).toBeUndefined();
  });
});

describe('isFloatAlign', () => {
  it('is true only for the placements that keep text beside the image', () => {
    expect(isFloatAlign('left')).toBe(true);
    expect(isFloatAlign('right')).toBe(true);
    expect(isFloatAlign('center')).toBe(false);
    expect(isFloatAlign('inline')).toBe(false);
    expect(isFloatAlign(undefined)).toBe(false);
  });
});

describe('FLOAT_MAX_WIDTH_PCT', () => {
  it('leaves more of the column to the text than to the image', () => {
    // Otherwise the wrap yields a sliver of text and the float buys nothing.
    expect(FLOAT_MAX_WIDTH_PCT).toBeLessThan(50);
  });
});
