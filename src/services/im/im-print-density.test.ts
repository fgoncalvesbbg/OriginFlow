/**
 * Table, image and block density in the print stylesheet (migrations 123 and 125).
 *
 * Guards the values that made content blocks the largest source of wasted page space in the A5
 * booklets. All of them were `rem`/`px`, so they belonged to neither of the renderer's two
 * scales — the pt scale for type and the mm() furniture scale with its 0.82 A5 factor — and
 * were therefore identical on a 6pt leaflet and a 10.77pt A4 manual. At the live A5 setting one
 * line box is 2.96mm, against 8.47mm for a 1rem margin.
 */
import { describe, it, expect } from 'vitest';
import { buildPrintPartsHtml, type PrintManual, type PrintHtmlOptions } from './im-print-html';
import { defaultTypographyFor } from './im-print-typography';

const manualWith = (nodes: PrintManual['sections'][0]['nodes']): PrintManual => ({
  language: 'en',
  metadata: { pageSize: 'a5', primaryColor: '#000', companyName: 'Acme' },
  sections: [{ id: 'A', title: 'Chapter A', parentId: null, order: 10, nodes }],
});

const bodyHtmlFor = (pageSize: 'a4' | 'a5', nodes: PrintManual['sections'][0]['nodes']) => {
  const opts: PrintHtmlOptions = { pageSize, cover: { title: 'T' }, back: {} };
  return buildPrintPartsHtml([manualWith(nodes)], opts)[1].html;
};

const html = (markup: string): PrintManual['sections'][0]['nodes'] => [
  { type: 'html', id: 'n', html: markup },
];

const textNode = html('<p>Body</p>');
const a5 = defaultTypographyFor('im', 'a5');
const a4 = defaultTypographyFor('im', 'a4');

describe('table cell padding', () => {
  it('comes from the setting, in mm, instead of a hardcoded 0.5rem', () => {
    const out = bodyHtmlFor('a5', textNode);
    expect(out).toContain(`padding: ${a5.tableCellPaddingMm}mm`);
    expect(out).not.toContain('padding: 0.5rem');
  });

  it('is absolute — the A5 furniture scale must not shrink it behind the operator', () => {
    // Routing it through mm() would have silently produced 0.98mm on A5.
    expect(a4.tableCellPaddingMm).toBe(a5.tableCellPaddingMm);
    const padding = `padding: ${a4.tableCellPaddingMm}mm`;
    expect(bodyHtmlFor('a4', textNode)).toContain(padding);
    expect(bodyHtmlFor('a5', textNode)).toContain(padding);
  });
});

describe('block spacing', () => {
  it('drives the vertical rhythm between content blocks from one setting', () => {
    const out = bodyHtmlFor('a5', textNode);
    const gap = `${a5.blockSpacingMm}mm`;
    // Tables, callouts, step lists, legends and annotated sets all shared 1rem/1.25rem.
    expect(out).toContain(`.imv-content table { width: 100%; border-collapse: collapse; margin: ${gap} 0; }`);
    expect(out).toContain(`.imv-annotated { margin: ${gap} 0; }`);
    expect(out).toContain(`.imv-legend-table { width: 100%; border-collapse: collapse; margin: ${gap} 0; }`);
    expect(out).toContain(`margin: ${gap} 0; border-radius: 6px; border-left: 6px solid`); // callout box
  });

  it('leaves no unscaled rem spacing behind in the content styles', () => {
    const out = bodyHtmlFor('a5', textNode);
    for (const stale of ['margin: 1rem 0', 'margin: 1.25rem 0', 'padding: 1.25rem', 'gap: 1.25rem']) {
      expect(out).not.toContain(stale);
    }
  });

  it('runs leaflets tighter than manuals, as they already did', () => {
    expect(defaultTypographyFor('warning_leaflet', 'a5').blockSpacingMm).toBeLessThan(a5.blockSpacingMm);
  });
});

describe('image height cap', () => {
  it('caps body images so one illustration cannot set a table row height', () => {
    const out = bodyHtmlFor('a5', textNode);
    expect(out).toContain(`max-height: ${a5.cellImageMaxHeightMm}mm`);
    // Aspect ratio must survive the cap on an image whose width the author pinned.
    expect(out).toContain('object-fit: contain');
  });

  it("allows A4 a taller illustration than A5, which has 182mm of text height to A4's 263mm", () => {
    expect(a4.cellImageMaxHeightMm).toBeGreaterThan(a5.cellImageMaxHeightMm);
  });
});

describe('author-chosen image placement', () => {
  it('honours the editor Align control by hoisting data-align to data-print-align', () => {
    const out = bodyHtmlFor('a5', html('<p><img src="a.png" data-align="left" style="float:left;margin:0.25rem 1rem 0.5rem 0;" /></p>'));
    expect(out).toContain('data-print-align="left"');
    expect(out).toContain('.imv-content img[data-print-align="left"] { float: left;');
  });

  it('reads placement off a legacy inline float, so migrated images keep wrapping text', () => {
    // Library images predate data-align and carry the intent inline instead.
    const out = bodyHtmlFor('a5', html('<p><img src="a.png" style="display: inline; float: left; width: 150px;" /></p>'));
    expect(out).toContain('data-print-align="left"');
  });

  it('falls back to a full-width band when no placement was chosen', () => {
    const out = bodyHtmlFor('a5', html('<p><img src="a.png" style="max-width:100%;" /></p>'));
    expect(out).toContain('data-print-align="block"');
  });

  it('strips the inline margins the editor bakes in, so spacing follows the setting', () => {
    const out = bodyHtmlFor('a5', html('<p><img src="a.png" style="max-width:100%;height:auto;margin:1rem 0;" /></p>'));
    expect(out).not.toContain('margin:1rem 0');
    // The stylesheet supplies it instead, at the configured rhythm.
    expect(out).toContain(`.imv-content img[data-print-align="block"] { display: block; margin: ${a5.blockSpacingMm}mm 0; }`);
  });

  it('clears floats so one cannot drag into the next section and shift pagination', () => {
    expect(bodyHtmlFor('a5', textNode)).toContain('.imv-node.imv-content::after');
  });
});

describe('pinned image widths', () => {
  it('drops a px width inside a table, which pinned a ~42mm column on every row', () => {
    const out = bodyHtmlFor('a5', html(
      '<table><tr><td><img src="a.png" style="width:160px;max-width:100%;height:auto;" /></td><td>One line</td></tr></table>',
    ));
    expect(out).not.toContain('width:160px');
    expect(out).toContain('max-width:100%');
  });

  it('drops the presentational width attribute inside a table too', () => {
    const out = bodyHtmlFor('a5', html('<table><tr><td><img src="a.png" width="160" height="90" /></td></tr></table>'));
    expect(out).not.toContain('width="160"');
    expect(out).not.toContain('height="90"');
  });

  it('PRESERVES a px width outside a table — there it is a deliberate editorial choice', () => {
    // A floated logo sized to 150px has no phantom-column problem to solve, and stripping the
    // width would let it grow toward the full column.
    const out = bodyHtmlFor('a5', html('<p><img src="logo.png" style="width:150px;float:left;" /> Wrapped text.</p>'));
    expect(out).toContain('width:150px');
  });

  it('keeps percentage widths, which are relative to the cell and print correctly', () => {
    const out = bodyHtmlFor('a5', html('<table><tr><td><img src="a.png" style="width:50%;" /></td></tr></table>'));
    expect(out).toContain('width:50%');
  });
});
