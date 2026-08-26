import { describe, it, expect } from 'vitest';
import {
  fitWithin,
  validateImageFile,
  outputTypeFor,
  MAX_IMAGE_EDGE_PX,
  MAX_ATTACHMENTS,
  MAX_SOURCE_BYTES,
} from './review-image';

describe('fitWithin', () => {
  it('scales a landscape image down by its longest edge, keeping the ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
  });

  it('scales a portrait image by its height, not its width', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it('leaves an already-small image alone rather than blowing it up', () => {
    // Upscaling would produce a bigger, blurrier file carrying no more information.
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('leaves an image exactly at the bound alone', () => {
    expect(fitWithin(MAX_IMAGE_EDGE_PX, 900)).toEqual({ width: MAX_IMAGE_EDGE_PX, height: 900 });
  });

  it('keeps at least one pixel on the short edge of an extreme panorama', () => {
    // Rounding 1px down to 0 would make the canvas throw.
    const out = fitWithin(8000, 1);
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1);
  });

  it('rounds to whole pixels', () => {
    const out = fitWithin(3333, 1777);
    expect(Number.isInteger(out.width)).toBe(true);
    expect(Number.isInteger(out.height)).toBe(true);
  });

  it('honours a custom bound', () => {
    expect(fitWithin(1000, 500, 200)).toEqual({ width: 200, height: 100 });
  });

  it('returns zeroes for a degenerate size instead of dividing by zero', () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-5, 10)).toEqual({ width: 0, height: 0 });
  });
});

describe('validateImageFile', () => {
  const jpeg = { type: 'image/jpeg', size: 2_000_000 };

  it('accepts an ordinary photo', () => {
    expect(validateImageFile(jpeg, 0)).toBeNull();
  });

  it('accepts every type the bucket allows', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateImageFile({ type, size: 1000 }, 0)).toBeNull();
    }
  });

  it('refuses a non-image, naming the types that work', () => {
    expect(validateImageFile({ type: 'application/pdf', size: 1000 }, 0)).toContain('JPEG');
  });

  it('refuses a HEIC, which phones offer but the bucket does not accept', () => {
    expect(validateImageFile({ type: 'image/heic', size: 1000 }, 0)).not.toBeNull();
  });

  it('refuses a file past the source ceiling', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: MAX_SOURCE_BYTES + 1 }, 0)).toContain('too large');
  });

  it('accepts a file exactly at the ceiling', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: MAX_SOURCE_BYTES }, 0)).toBeNull();
  });

  it('refuses an empty file', () => {
    expect(validateImageFile({ type: 'image/png', size: 0 }, 0)).not.toBeNull();
  });

  it('refuses once the note is already full', () => {
    expect(validateImageFile(jpeg, MAX_ATTACHMENTS)).not.toBeNull();
    expect(validateImageFile(jpeg, MAX_ATTACHMENTS - 1)).toBeNull();
  });

  it('checks the count before the type, so a full note says so rather than blaming the file', () => {
    expect(validateImageFile({ type: 'application/pdf', size: 1000 }, MAX_ATTACHMENTS))
      .toContain('at most');
  });
});

describe('outputTypeFor', () => {
  it('keeps a PNG a PNG', () => {
    // A screenshot of text re-encoded as JPEG rings around the glyphs — which is the very
    // detail the reviewer is pointing at.
    expect(outputTypeFor('image/png')).toBe('image/png');
  });

  it('re-encodes photographic sources as JPEG', () => {
    expect(outputTypeFor('image/jpeg')).toBe('image/jpeg');
    expect(outputTypeFor('image/webp')).toBe('image/jpeg');
  });
});
