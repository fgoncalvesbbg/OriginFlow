import { describe, it, expect } from 'vitest';
import {
  buildPrintHtml,
  buildPrintPartsHtml,
  DEFAULT_LEAFLET_TEXT_PT,
  DEFAULT_LEAFLET_HEADING_PT,
  PrintManual,
  PrintHtmlOptions,
} from './im-print-html';
import { DEFAULT_IM_LOGO_URL, DEFAULT_LEAFLET_LOGO_URL } from '../../config/im.constants';

// A manual whose section `order` is assigned per sibling-group (10/20 within each parent).
// Roots: A(10) with child A1(10); B(20) with child B1(10). Correct reading order is the
// per-parent DFS: A, A1, B, B1. A flat global sort by `order` would produce A(10), A1(10),
// B1(10), B(20) — interleaving B1 before its parent — which is the bug this guards against.
const manual: PrintManual = {
  language: 'en',
  metadata: { pageSize: 'a4', primaryColor: '#000', companyName: 'Acme' },
  sections: [
    { id: 'A', title: 'Chapter A', parentId: null, order: 10, nodes: [{ type: 'html', id: 'nA', html: '<p>A body</p>' }] },
    { id: 'A1', title: 'A sub', parentId: 'A', order: 10, nodes: [{ type: 'html', id: 'nA1', html: '<p>A1 body</p>' }] },
    { id: 'B', title: 'Chapter B', parentId: null, order: 20, nodes: [{ type: 'html', id: 'nB', html: '<p>B body</p>' }] },
    { id: 'B1', title: 'B sub', parentId: 'B', order: 10, nodes: [{ type: 'html', id: 'nB1', html: '<p>B1 body</p>' }] },
  ],
};

const opts: PrintHtmlOptions = { pageSize: 'a4', cover: { title: 'T' }, back: {} };

describe('buildPrintHtml — section ordering + pagination', () => {
  it('emits sections in per-parent DFS reading order (not a flat global sort)', () => {
    const html = buildPrintHtml([manual], opts);
    const order = ['A', 'A1', 'B', 'B1'].map((id) => html.indexOf(`id="sec-${id}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    // Strictly increasing → A, A1, B, B1.
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Specifically: the sub of B must come AFTER chapter B (the old global sort put B1 before B).
    expect(html.indexOf('id="sec-B"')).toBeLessThan(html.indexOf('id="sec-B1"'));
  });

  it('the TOC lists sections in the same DFS order', () => {
    const html = buildPrintHtml([manual], opts);
    const toc = html.slice(html.indexOf('class="im-toc"'));
    const order = ['A', 'A1', 'B', 'B1'].map((id) => toc.indexOf(`href="#sec-${id}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('flows sections continuously — no forced page break per section', () => {
    const html = buildPrintHtml([manual], opts);
    // Individual sections are plain flowing blocks…
    expect(html).toContain('<section id="sec-A" class="im-section">');
    // …and none of them carries the page-break class.
    expect(html).not.toContain('class="im-page im-break im-page-content"><section');
    expect(/id="sec-\w+" class="im-page im-break/.test(html)).toBe(false);
    // Exactly one content page container wraps the whole (single-language) flow.
    const contentPages = html.match(/class="im-page im-break im-page-content"/g) ?? [];
    expect(contentPages).toHaveLength(1);
  });
});

describe('buildPrintPartsHtml — Warning Leaflet compact layout', () => {
  const de: PrintManual = { ...manual, language: 'de' };

  it('compact: one part per language — no cover / TOC / divider / back parts', () => {
    const parts = buildPrintPartsHtml([manual, de], { ...opts, compact: true });
    // Exactly one part per language (no separate cover or back parts).
    expect(parts).toHaveLength(2);
    const all = parts.map((p) => p.html).join('\n');
    // Assert on the actual page ELEMENT markup (the class names also appear in the shared CSS).
    expect(all).not.toContain('class="im-page im-page-cover"');
    expect(all).not.toContain('im-page im-break im-page-toc');
    expect(all).not.toContain('im-page im-break im-page-divider');
    expect(all).not.toContain('im-page im-break im-page-end');
  });

  it('compact: each language part starts with the logo header and carries its edge tab', () => {
    const parts = buildPrintPartsHtml([manual, de], { ...opts, compact: true });
    parts.forEach((p, i) => {
      expect(p.html).toContain('im-leaflet-header');
      expect(p.html).toContain('im-leaflet-logo');
      // Multi-language → every language body gets a tab with the correct index/code.
      expect(p.tab).toEqual({ index: i, total: 2, code: i === 0 ? 'en' : 'de' });
    });
  });

  it('compact: single language has no edge tab (matches the main manual)', () => {
    const [part] = buildPrintPartsHtml([manual], { ...opts, compact: true });
    expect(part.tab).toBeNull();
    expect(part.html).toContain('im-leaflet-header');
  });

  it('compact: the content block does NOT force a page break (header stays with content)', () => {
    const [part] = buildPrintPartsHtml([manual], { ...opts, compact: true });
    // The compact stylesheet neutralizes the forced break on the content container.
    expect(part.html).toContain('break-before: auto');
  });

  it('compact: custom font sizes are applied to all text + all headings', () => {
    const [part] = buildPrintPartsHtml([manual], {
      ...opts,
      compact: true,
      leafletTextPt: 8,
      leafletHeadingPt: 11,
    });
    // Universal body-text rule and the heading rule carry the chosen pt sizes.
    expect(part.html).toContain('.im-page-content * { font-size: 8pt');
    expect(part.html).toContain('font-size: 11pt');
  });

  it('compact: font sizes fall back to the defaults when not provided', () => {
    const [part] = buildPrintPartsHtml([manual], { ...opts, compact: true });
    expect(part.html).toContain(`font-size: ${DEFAULT_LEAFLET_TEXT_PT}pt`);
    expect(part.html).toContain(`font-size: ${DEFAULT_LEAFLET_HEADING_PT}pt`);
  });

  it('regression: non-compact still emits cover + TOC + back parts', () => {
    const parts = buildPrintPartsHtml([manual, de], opts);
    // [cover, lang0, lang1, back]
    expect(parts).toHaveLength(4);
    const all = parts.map((p) => p.html).join('\n');
    expect(all).toContain('class="im-page im-page-cover"');
    expect(all).toContain('im-page im-break im-page-toc');
    expect(all).toContain('im-page im-break im-page-end');
    expect(all).not.toContain('im-leaflet-header');
  });
});

describe('default logo fallback — normalized-empty companyLogoUrl', () => {
  // normalizeIMTemplateMetadata stores a missing companyLogoUrl as '' (not undefined),
  // so published manifests carry the empty string. The default logo must still apply.
  const normalized: PrintManual = {
    ...manual,
    metadata: { ...manual.metadata, companyLogoUrl: '' },
  };

  it('compact leaflet: header falls back to the standard leaflet logo', () => {
    const [part] = buildPrintPartsHtml([normalized], { ...opts, compact: true });
    expect(part.html).toContain(DEFAULT_LEAFLET_LOGO_URL);
    expect(part.html).toContain('im-leaflet-logo');
  });

  it('full manual: cover falls back to the standard IM logo', () => {
    const html = buildPrintHtml([normalized], opts);
    expect(html).toContain(DEFAULT_IM_LOGO_URL);
  });

  it('an explicit cover logo still wins over both defaults', () => {
    const [part] = buildPrintPartsHtml([normalized], {
      ...opts,
      compact: true,
      cover: { title: 'T', logoUrl: 'https://example.com/custom.png' },
    });
    expect(part.html).toContain('https://example.com/custom.png');
    expect(part.html).not.toContain(DEFAULT_LEAFLET_LOGO_URL);
  });
});
