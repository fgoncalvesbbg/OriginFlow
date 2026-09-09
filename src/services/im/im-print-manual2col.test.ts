/**
 * The two-column INSTRUCTION MANUAL layout (`layout: 'compact2col'` on a full IM).
 *
 * The thing worth testing here is not that columns appear — it is the boundary. A manual in two
 * columns must take the column division from the leaflet's compact layout and nothing else:
 * every part of its structure that indexes a page BY LANGUAGE (the cover directory, the TOC's
 * stamped page numbers, the edge thumb tabs, per-language page counts) depends on there being
 * one render part per language, and the leaflet's compact layout gives exactly that up. So the
 * assertions come in three groups:
 *
 *   1. the columns and the narrow-measure typography are actually applied;
 *   2. the part composition, and therefore everything downstream in render-print-merge.ts, is
 *      byte-for-byte what a classic manual produces;
 *   3. full-measure figures and wide tables are recognised and spanned, rather than silently
 *      rescaled to a quarter of their area.
 *
 * Kept out of im-print-compact2col.test.ts so that file stays the leaflet's contract.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPrintPartsHtml,
  tableColumnCount,
  WIDE_IMAGE_MIN_PX,
  WIDE_TABLE_MIN_COLS,
  type PrintManual,
  type PrintHtmlOptions,
} from './im-print-html';
import { compactColumnsFor } from './im-print-typography';

const manual = (nodes: PrintManual['sections'][number]['nodes'], language = 'en'): PrintManual => ({
  language,
  metadata: { pageSize: 'a4', primaryColor: '#123456', companyName: 'Acme' },
  sections: [
    { id: 'A', title: 'Chapter A', parentId: null, order: 10, nodes },
    { id: 'B', title: 'Chapter B', parentId: null, order: 20, nodes: [{ type: 'html', id: 'n2', html: '<p>More</p>' }] },
  ],
});

const prose = manual([{ type: 'html', id: 'n1', html: '<p>Body copy</p>' }]);

const opts = (layout: 'classic' | 'compact2col', pageSize: 'a4' | 'a5' = 'a4'): PrintHtmlOptions => ({
  pageSize,
  cover: { title: 'T', skus: ['SKU-1'] },
  back: {},
  layout,
});

const joined = (m: PrintManual[], layout: 'classic' | 'compact2col', pageSize: 'a4' | 'a5' = 'a4') =>
  buildPrintPartsHtml(m, opts(layout, pageSize))
    .map((p) => p.html)
    .join('');

/**
 * The MARKUP only, with every <style> block dropped.
 *
 * Needed because the two-column stylesheet names `data-print-wide` in its own selectors, so a
 * whole-document `not.toContain` for that attribute passes on the CSS and never sees whether
 * the annotation was actually applied to a tag — the assertion would be vacuously true and the
 * negative cases untested.
 */
const markupOf = (m: PrintManual[], layout: 'classic' | 'compact2col', pageSize: 'a4' | 'a5' = 'a4') =>
  joined(m, layout, pageSize).replace(/<style>[\s\S]*?<\/style>/g, '');

describe('manual2col — the columns and the measure', () => {
  it('sets two columns on A4, not the leaflet three', () => {
    // The leaflet takes three columns of A4 because it is set at 4.75pt; a manual at 8pt would
    // read ~41 characters per line in a 58mm column. The count follows the body size, which is
    // the whole reason COMPACT_COLUMNS is keyed on the template type as well as the page size.
    expect(compactColumnsFor('im', 'a4')).toEqual({ columns: 2, gapMm: 4 });
    expect(compactColumnsFor('warning_leaflet', 'a4')).toEqual({ columns: 3, gapMm: 4 });
    expect(joined([prose], 'compact2col')).toContain('columns: 2; column-gap: 4mm;');
  });

  it('sets two columns on A5 as well', () => {
    expect(joined([prose], 'compact2col', 'a5')).toContain('columns: 2; column-gap: 4mm;');
  });

  it('justifies and hyphenates running text', () => {
    const html = joined([prose], 'compact2col');
    expect(html).toContain('text-align: justify;');
    expect(html).toContain('hyphens: auto;');
    expect(html).toContain('orphans: 2; widows: 2;');
  });

  it('declares the part language so a hyphenation dictionary can be selected', () => {
    // Without this `hyphens: auto` is a silent no-op — Chromium picks a dictionary from the
    // document language and has none to fall back on.
    const parts = buildPrintPartsHtml([manual([{ type: 'html', id: 'n', html: '<p>x</p>' }], 'de')], opts('compact2col'));
    expect(parts.some((p) => p.html.includes('<html lang="de">'))).toBe(true);
  });

  it('lets callout panels break across a column', () => {
    // The shared stylesheet sets break-inside: avoid, which is right at 182mm and wrong at
    // 89mm: a callout taller than the space left jumps the column and leaves a hole.
    expect(joined([prose], 'compact2col')).toContain('.imv-block-wrapper { break-inside: auto; }');
  });

  it('changes nothing about a classic manual', () => {
    const classic = joined([prose], 'classic');
    expect(classic).not.toContain('columns: 2; column-gap: 4mm;');
    expect(classic).not.toContain('text-align: justify;');
    expect(classic).not.toContain('break-inside: auto;');
    // No document language on a classic part — see partLang in im-print-html.ts.
    expect(classic).toContain('<html>');
  });
});

describe('manual2col — what it must not disturb', () => {
  it('keeps the cover / per-language / back part composition exactly', () => {
    const twoLangs = [
      manual([{ type: 'html', id: 'n', html: '<p>x</p>' }], 'en'),
      manual([{ type: 'html', id: 'n', html: '<p>y</p>' }], 'de'),
    ];
    const classicParts = buildPrintPartsHtml(twoLangs, opts('classic'));
    const columnParts = buildPrintPartsHtml(twoLangs, opts('compact2col'));

    // Part COUNT and ORDER are what render-print-merge.ts derives page offsets, the cover's
    // language directory, the TOC page numbers and languagePartOffset from. A different count
    // here would silently misattribute every page in the booklet.
    expect(columnParts).toHaveLength(classicParts.length);
    expect(columnParts.map((p) => p.tab)).toEqual(classicParts.map((p) => p.tab));
    // One part per language, each still carrying its own edge thumb tab. This is the single
    // biggest difference from the leaflet's compact layout, which collapses to one part and
    // loses the tabs with it.
    expect(columnParts.filter((p) => p.tab !== null)).toHaveLength(2);
    expect(columnParts.map((p) => p.tab?.code ?? null)).toEqual([null, 'en', 'de', null]);
  });

  it('keeps the TOC, its section anchors and the cover directory', () => {
    const html = joined(
      [manual([{ type: 'html', id: 'n', html: '<p>x</p>' }], 'en'), manual([{ type: 'html', id: 'n', html: '<p>y</p>' }], 'de')],
      'compact2col',
    );
    // The TOC's <a href="#sec-…"> links are what the merge step reads back out of the part PDF
    // to stamp page numbers; the anchors are their targets.
    expect(html).toContain('href="#sec-A"');
    expect(html).toContain('id="sec-A"');
    expect(html).toContain('im-cover-index');
  });

  it('still forces the content block onto a fresh page', () => {
    // The leaflet's compact CSS resets break-before to auto because its header and content are
    // one part. Leaking that into a manual would run every language's content onto its own
    // contents page.
    const html = joined([prose], 'compact2col');
    expect(html).toContain('im-page im-break im-page-content');
    expect(html).not.toContain('padding: 0; break-before: auto;');
  });

  it('keeps callouts as tinted panels, not severity bands', () => {
    const html = joined([manual([{ type: 'callout', id: 'c', variant: 'danger', html: '<p>Do not</p>' }])], 'compact2col');
    expect(html).toContain('imv-block-wrapper imv-block-danger');
    expect(html).toContain('imv-block-icon');
    expect(html).not.toContain('imv-hz-band');
  });
});

describe('manual2col — full-measure figures', () => {
  const withHtml = (html: string) => markupOf([manual([{ type: 'html', id: 'n', html }])], 'compact2col');

  it('marks and spans an image authored to fill the text block', () => {
    expect(withHtml(`<p><img src="a.png" style="width:${WIDE_IMAGE_MIN_PX + 250}px" /></p>`)).toContain('data-print-wide="1"');
    expect(joined([prose], 'compact2col')).toContain('.imv-content img[data-print-wide="1"][data-print-align="block"]');
  });

  it('leaves a small in-line image in the column flow', () => {
    // 240px and 320-360px are real bands in the live manuals: icons and part photos, which read
    // fine at column width and would waste a full measure if spanned.
    expect(withHtml('<p><img src="a.png" style="width:240px" /></p>')).not.toContain('data-print-wide="1"');
  });

  it('accepts mm, cm and percentage widths, not only px', () => {
    expect(withHtml('<p><img src="a.png" style="width:150mm" /></p>')).toContain('data-print-wide="1"');
    expect(withHtml('<p><img src="a.png" style="width:15cm" /></p>')).toContain('data-print-wide="1"');
    expect(withHtml('<p><img src="a.png" style="width:100%" /></p>')).toContain('data-print-wide="1"');
    expect(withHtml('<p><img src="a.png" style="width:40mm" /></p>')).not.toContain('data-print-wide="1"');
  });

  it('never marks an unsized image', () => {
    // An unsized image is already capped to the measure by the shared stylesheet, so there is
    // no authored intent to honour and nothing to span.
    expect(withHtml('<p><img src="a.png" /></p>')).not.toContain('data-print-wide="1"');
  });

  it('does not confuse max-width for a width', () => {
    expect(withHtml('<p><img src="a.png" style="max-width:900px" /></p>')).not.toContain('data-print-wide="1"');
  });
});

describe('manual2col — wide tables', () => {
  const table = (cols: number, rows = 2) => {
    const body = Array.from({ length: rows }, () =>
      `<tr>${Array.from({ length: cols }, (_, i) => `<td>c${i}</td>`).join('')}</tr>`).join('');
    return `<table><tbody>${body}</tbody></table>`;
  };

  it('counts the widest row, not the first', () => {
    // A spec table whose first row is a single spanning caption would otherwise measure as one
    // column and stay squeezed into 89mm.
    expect(tableColumnCount('<table><tr><td colspan="4">Caption</td></tr><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></table>')).toBe(4);
    expect(tableColumnCount(table(2))).toBe(2);
    expect(tableColumnCount('<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead></table>')).toBe(3);
  });

  it('spans a table at or above the column threshold and leaves narrower ones in the flow', () => {
    expect(markupOf([manual([{ type: 'html', id: 'n', html: table(WIDE_TABLE_MIN_COLS) }])], 'compact2col'))
      .toContain('<table data-print-wide="1"');
    expect(joined([prose], 'compact2col')).toContain('.imv-content table[data-print-wide="1"] { column-span: all; }');

    // 2.46 columns is the live average — those are the tables this must NOT touch.
    expect(markupOf([manual([{ type: 'html', id: 'n', html: table(WIDE_TABLE_MIN_COLS - 1) }])], 'compact2col'))
      .not.toContain('data-print-wide="1"');
  });

  it('drops author mm column widths for a table that stays in a column', () => {
    // The widths are absolute mm chosen against the one-column measure; a colgroup summing past
    // the column can only overflow, so an in-flow table falls back to the auto algorithm.
    const html = joined([prose], 'compact2col');
    expect(html).toContain('.imv-content table[data-col-widths]:not([data-print-wide="1"]) col { width: auto !important; }');
  });
});
