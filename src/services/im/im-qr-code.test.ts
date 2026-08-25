import { describe, it, expect } from 'vitest';
import { buildSkuQrSvg, skuQrUrl } from './im-qr-code';

describe('skuQrUrl', () => {
  it('encodes the SKU number under use.berlin', () => {
    expect(skuQrUrl('10035294')).toBe('https://use.berlin/10035294');
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
});
