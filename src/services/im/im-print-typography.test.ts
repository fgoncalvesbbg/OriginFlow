import { describe, it, expect } from 'vitest';
import {
  normalizePrintTypography,
  defaultTypographyFor,
  DEFAULT_PRINT_TYPOGRAPHY,
  PRINT_FONT_FAMILIES,
  PRINT_SETTING_LIMITS,
} from './im-print-typography';

// normalizePrintTypography is the render pipeline's trust boundary: the browser sends the
// typography in the request body, and the Netlify functions hand what comes back straight to
// PDFShift (font stack, point sizes) and to the page-margin option. A value that slips
// through unchecked is a booklet rendered at 900pt or with negative margins.
describe('normalizePrintTypography — untrusted input', () => {
  const fallback = defaultTypographyFor('im', 'a4');

  it('passes a valid set through unchanged', () => {
    // Built from a real profile and then overridden, so the set stays complete as settings are
    // added — the assertion is that valid values survive, not that this list is exhaustive.
    const input = {
      ...defaultTypographyFor('im', 'a5'),
      fontFamily: 'Lato',
      bodyPt: 11,
      headingPt: 18,
      lineHeight: 1.5,
      margins: { top: 20, bottom: 20, left: 15, right: 15 },
    };
    expect(normalizePrintTypography(input, fallback)).toEqual(input);
  });

  it('falls back entirely for null / undefined', () => {
    expect(normalizePrintTypography(undefined, fallback)).toEqual(fallback);
    expect(normalizePrintTypography(null, fallback)).toEqual(fallback);
  });

  it('clamps out-of-range point sizes instead of passing them to the print engine', () => {
    const out = normalizePrintTypography({ bodyPt: 900, headingPt: -12 }, fallback);
    expect(out.bodyPt).toBe(PRINT_SETTING_LIMITS.bodyPt.max);
    expect(out.headingPt).toBe(PRINT_SETTING_LIMITS.headingPt.min);
  });

  it('clamps the bottom margin up to the footer band minimum', () => {
    // The merge step stamps the running footer and page number into the bottom margin, so a
    // 0mm bottom would print them over the body text.
    const out = normalizePrintTypography({ margins: { top: 0, bottom: 0, left: 0, right: 0 } }, fallback);
    expect(out.margins.bottom).toBe(PRINT_SETTING_LIMITS.marginBottom.min);
    expect(out.margins.top).toBe(0);
  });

  it('rejects a font family the print HTML cannot embed', () => {
    // Only the families in GOOGLE_FONT_IMPORTS are actually imported; anything else would
    // silently render in the fallback stack, so it is refused outright.
    expect(normalizePrintTypography({ fontFamily: 'Comic Sans MS' }, fallback).fontFamily).toBe(fallback.fontFamily);
    expect(normalizePrintTypography({ fontFamily: 'Montserrat' }, fallback).fontFamily).toBe('Montserrat');
  });

  it('coerces numeric strings (PostgREST returns NUMERIC columns as strings)', () => {
    const out = normalizePrintTypography(
      { bodyPt: '9.5', lineHeight: '1.45', margins: { top: '12' } } as never,
      fallback,
    );
    expect(out.bodyPt).toBe(9.5);
    expect(out.lineHeight).toBe(1.45);
    expect(out.margins.top).toBe(12);
  });

  it('falls back per-field for NaN, not to zero', () => {
    const out = normalizePrintTypography({ bodyPt: Number.NaN, headingPt: 20 }, fallback);
    expect(out.bodyPt).toBe(fallback.bodyPt);
    expect(out.headingPt).toBe(20);
  });
});

describe('built-in profiles', () => {
  it('covers every (template type, page size) combination', () => {
    for (const templateType of ['im', 'warning_leaflet']) {
      for (const pageSize of ['a4', 'a5']) {
        expect(DEFAULT_PRINT_TYPOGRAPHY[`${templateType}::${pageSize}`]).toBeDefined();
      }
    }
  });

  it('every built-in value is inside its own allowed range and font list', () => {
    // A default outside the limits would be clamped on its way into a render — i.e. the
    // shipped default would not be the default anyone actually gets.
    for (const [name, profile] of Object.entries(DEFAULT_PRINT_TYPOGRAPHY)) {
      expect(normalizePrintTypography(profile, profile), name).toEqual(profile);
      expect(PRINT_FONT_FAMILIES as readonly string[], name).toContain(profile.fontFamily);
    }
  });

  it('leaflets are set smaller than full manuals — they must fit a few pages', () => {
    expect(defaultTypographyFor('warning_leaflet', 'a4').bodyPt)
      .toBeLessThan(defaultTypographyFor('im', 'a4').bodyPt);
  });

  it('A5 is set smaller than A4 for the same document kind', () => {
    expect(defaultTypographyFor('im', 'a5').bodyPt).toBeLessThan(defaultTypographyFor('im', 'a4').bodyPt);
  });

  it('an unknown combination degrades to the full-IM A4 profile rather than throwing', () => {
    expect(defaultTypographyFor('nonsense', 'a9')).toEqual(DEFAULT_PRINT_TYPOGRAPHY['im::a4']);
  });
});
