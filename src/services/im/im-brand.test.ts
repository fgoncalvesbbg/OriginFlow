/**
 * Brand logo selection for print exports (config/im.constants).
 *
 * The guarantee under test is narrow but load-bearing: Klarstein is the default and its two
 * historical logo URLs are unchanged, so every export that does not deliberately pick another
 * brand comes out byte-identical to the ones printed before brands existed.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_IM_BRAND,
  DEFAULT_IM_LOGO_URL,
  DEFAULT_LEAFLET_LOGO_URL,
  IM_BRANDS,
  IM_BRAND_ORDER,
  brandForLogoUrl,
  brandLogoUrl,
} from '../../config/im.constants';

describe('IM brands', () => {
  it('defaults to Klarstein with the historical logo URLs', () => {
    expect(DEFAULT_IM_BRAND).toBe('klarstein');
    expect(brandLogoUrl('klarstein', false)).toBe(DEFAULT_IM_LOGO_URL);
    expect(brandLogoUrl('klarstein', true)).toBe(DEFAULT_LEAFLET_LOGO_URL);
    expect(IM_BRAND_ORDER[0]).toBe('klarstein');
  });

  it('gives Blumfeldt its own wordmark on both the cover and the leaflet header', () => {
    const cover = brandLogoUrl('blumfeldt', false);
    const leaflet = brandLogoUrl('blumfeldt', true);
    expect(cover).toContain('blumfeldt');
    expect(leaflet).toContain('blumfeldt');
    expect(cover).not.toBe(DEFAULT_IM_LOGO_URL);
    expect(leaflet).not.toBe(DEFAULT_LEAFLET_LOGO_URL);
  });

  it('round-trips a brand logo back to its brand, and reports custom logos as no brand', () => {
    for (const brand of IM_BRAND_ORDER) {
      expect(brandForLogoUrl(IM_BRANDS[brand].coverLogoUrl)).toBe(brand);
      expect(brandForLogoUrl(IM_BRANDS[brand].leafletLogoUrl)).toBe(brand);
    }
    expect(brandForLogoUrl('https://example.test/uploaded-logo.png')).toBeNull();
    expect(brandForLogoUrl('')).toBeNull();
    expect(brandForLogoUrl(undefined)).toBeNull();
  });
});
