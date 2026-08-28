import { describe, it, expect } from 'vitest';
import { buildSkuQrSvg, skuQrUrl } from './im-qr-code';

describe('skuQrUrl', () => {
  it('encodes the SKU number under use.berlin', () => {
    expect(skuQrUrl('10035294')).toBe('https://use.berlin/10035294');
  });

  it('falls back to the bare root when there is no SKU (e.g. a category-wide leaflet)', () => {
    expect(skuQrUrl(undefined)).toBe('https://use.berlin');
    expect(skuQrUrl('')).toBe('https://use.berlin');
  });
});

describe('buildSkuQrSvg', () => {
  it('returns a self-contained, sized inline SVG', () => {
    const svg = buildSkuQrSvg('10035294', 22);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
    expect(svg).toContain('width:22mm');
    expect(svg).toContain('height:22mm');
  });

  it('produces different codes for different SKUs', () => {
    expect(buildSkuQrSvg('10035294')).not.toBe(buildSkuQrSvg('10035295'));
  });

  it('still renders (root-URL) when no SKU is given, instead of going blank', () => {
    const svg = buildSkuQrSvg(undefined, 12);
    expect(svg).toContain('<svg');
    expect(svg).toContain('width:12mm');
    expect(svg).not.toBe(buildSkuQrSvg('10035294', 12));
  });
});
