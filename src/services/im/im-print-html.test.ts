import { describe, it, expect } from 'vitest';
import { buildPrintHtml, PrintManual, PrintHtmlOptions } from './im-print-html';

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
