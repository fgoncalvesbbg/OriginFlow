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
    // Matched loosely: the same rule also carries the table font size.
    expect(out).toMatch(new RegExp(`\.imv-content table \{[^}]*margin: ${gap} 0;`));
    expect(out).toContain(`.imv-annotated { margin: ${gap} 0; }`);
    expect(out).toMatch(new RegExp(`\.imv-legend-table \{[^}]*margin: ${gap} 0;`));
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

describe('paragraph and list rhythm', () => {
  it('drives the gap after paragraphs and lists from the setting, not a 1em web default', () => {
    const out = bodyHtmlFor('a5', textNode);
    const paraGap = `${a5.paragraphSpacingEm}em`;
    expect(out).toContain(`.imv-content p { margin: 0 0 ${paraGap}; }`);
    expect(out).toContain(`margin: 0 0 ${paraGap}; }`);
    expect(out).not.toContain('margin: 0 0 1em');
  });

  it('sets list items tighter than paragraphs, from the same setting', () => {
    const out = bodyHtmlFor('a5', textNode);
    const itemGap = Number((a5.paragraphSpacingEm * 0.3).toFixed(3));
    expect(out).toContain(`.imv-content li { display: list-item; margin-bottom: ${itemGap}em; }`);
    expect(itemGap).toBeLessThan(a5.paragraphSpacingEm);
  });

  it('keeps leaflets at the 0.35em their compact override used, so output is unchanged', () => {
    expect(defaultTypographyFor('warning_leaflet', 'a5').paragraphSpacingEm).toBe(0.35);
  });

  it('no longer duplicates the tightening in a compact override', () => {
    // The base rule plus the per-profile setting now covers both paths.
    const leaflet = buildPrintPartsHtml(
      [{ ...manualWith(textNode), metadata: { pageSize: 'a5', primaryColor: '#000', companyName: 'A' } }],
      { pageSize: 'a5', cover: { title: 'T' }, back: {}, templateType: 'warning_leaflet' } as PrintHtmlOptions,
    )[1].html;
    expect(leaflet).not.toContain('.imv-content p, .imv-content ul, .imv-content ol { margin: 0 0 0.35em; }');
  });
});

describe('table text size', () => {
  it('renders tables a step below body, from the scale', () => {
    const out = bodyHtmlFor('a5', textNode);
    const expected = Number((a5.bodyPt * a5.tableFontScale).toFixed(2));
    expect(out).toContain(`font-size: ${expected}pt`);
    expect(expected).toBeLessThan(a5.bodyPt);
  });

  it('applies to legend tables too, so the two table flavours match', () => {
    const out = bodyHtmlFor('a5', textNode);
    const expected = Number((a5.bodyPt * a5.tableFontScale).toFixed(2));
    const rule = out.split('\n').find((l) => l.includes('.imv-legend-table {'));
    expect(rule).toContain(`font-size: ${expected}pt`);
  });

  it('floors the result, so no scale can shrink safety content without limit', () => {
    // A 6pt leaflet body at the 0.6 minimum scale would otherwise render 3.6pt tables.
    const leaflet = defaultTypographyFor('warning_leaflet', 'a5');
    const out = buildPrintPartsHtml([manualWith(textNode)], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      typography: { ...leaflet, tableFontScale: 0.6 },
    } as PrintHtmlOptions)[1].html;
    expect(out).not.toContain('font-size: 3.6pt');
    expect(out).toContain('font-size: 6pt');
  });

  it('leaves leaflet tables at body size — 6pt is already the floor', () => {
    expect(defaultTypographyFor('warning_leaflet', 'a5').tableFontScale).toBe(1);
  });
});

describe('floated images leave room for text', () => {
  const floated = (style: string) => bodyHtmlFor('a5', html(`<p><img src="a.png" style="${style}" /> Body text that should wrap beside it.</p>`));

  it('caps an unsized float so text gets a usable column beside it', () => {
    const out = floated('float:left;');
    expect(out).toContain('data-print-width="auto"');
    expect(out).toContain('[data-print-width="auto"] { max-width: 45%; }');
  });

  it('respects an explicit author width instead of capping it', () => {
    const out = floated('float:left;width:75%;');
    expect(out).toContain('data-print-width="set"');
    expect(out).toContain('width:75%');
  });

  it('treats max-width alone as unsized — it is not an author width', () => {
    expect(floated('float:right;max-width:100%;')).toContain('data-print-width="auto"');
  });

  it('counts the presentational width attribute as sized', () => {
    const out = bodyHtmlFor('a5', html('<p><img src="a.png" width="200" style="float:left;" /></p>'));
    expect(out).toContain('data-print-width="set"');
  });

  it('does not cap a centred or block image, which has no text beside it', () => {
    const out = bodyHtmlFor('a5', html('<p><img src="a.png" data-align="center" /></p>'));
    expect(out).toContain('data-print-align="center"');
    expect(out).not.toMatch(/\[data-print-align="center"\]\[data-print-width="auto"\]/);
  });
});

describe('table rule weight', () => {
  it('draws a hairline from the setting, not the old 0.75pt web default', () => {
    const out = bodyHtmlFor('a5', textNode);
    expect(out).toContain(`border: ${a5.tableBorderMm}mm solid`);
    expect(out).not.toContain('border: 1px solid #cbd5e1');
  });

  it('uses the same rule on both table flavours', () => {
    const out = bodyHtmlFor('a5', textNode);
    const rule = `border: ${a5.tableBorderMm}mm solid`;
    expect(out.split(rule).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('stays absolute, so A4 and A5 tables read as one document', () => {
    // Routing it through mm() would have made the A5 rule 0.82x the A4 one.
    expect(a4.tableBorderMm).toBe(a5.tableBorderMm);
    expect(bodyHtmlFor('a4', textNode)).toContain(`border: ${a4.tableBorderMm}mm solid`);
  });

  it('is finer than the old default but still above the press dropout floor', () => {
    const pt = a5.tableBorderMm * 72 / 25.4;
    expect(pt).toBeLessThan(0.75); // the 1px it replaced
    expect(pt).toBeGreaterThanOrEqual(0.25); // hairlines below this can drop out
  });

  it('allows rules to be turned off entirely', () => {
    const out = buildPrintPartsHtml([manualWith(textNode)], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      typography: { ...a5, tableBorderMm: 0 },
    } as PrintHtmlOptions)[1].html;
    expect(out).toContain('border: 0mm solid');
  });
});

describe('author cell styles that were overriding the settings', () => {
  const cell = (style: string) => bodyHtmlFor('a5', html(`<table><tr><td style="${style}">Text</td></tr></table>`));

  it('drops inline cell padding, which beat the setting on every row', () => {
    // The real value in the corpus: 12px is 3.18mm a side, 6.35mm per row against a 1.2mm setting.
    const out = cell('width: 22%; padding: 12px; border: 1px solid #ccc; text-align: center;');
    expect(out).not.toContain('padding: 12px');
    expect(out).toContain(`padding: ${a5.tableCellPaddingMm}mm`);
  });

  it('drops a visible inline border, so the hairline setting actually reaches the table', () => {
    const out = cell('padding: 5px; border: 1px solid #ccc;');
    expect(out).not.toContain('border: 1px solid #ccc');
    expect(out).toContain(`border: ${a5.tableBorderMm}mm solid`);
  });

  it('KEEPS a border the author zeroed — an invisible layout table is a real decision', () => {
    expect(cell('width:48%; padding:8px; border:0;')).toContain('border:0');
    expect(cell('border: none;')).toContain('border: none');
  });

  it('drops a pinned px column width but keeps a percentage', () => {
    expect(cell('width: 40px; padding: 5px;')).not.toContain('width: 40px');
    expect(cell('width: 48%; padding: 8px;')).toContain('width: 48%');
  });

  it('preserves alignment and other author formatting', () => {
    const out = cell('padding: 12px; text-align: center; vertical-align: middle;');
    expect(out).toContain('text-align: center');
    expect(out).toContain('vertical-align: middle');
  });

  it('collapses the trailing margin of a paragraph used to hold cell text', () => {
    const out = bodyHtmlFor('a5', textNode);
    expect(out).toContain('.imv-content td > p:last-child, .imv-content th > p:last-child { margin-bottom: 0; }');
  });

  it('leaves cells outside tables alone — there is no such thing', () => {
    // Guards the regex: a <td> only ever appears inside a table, so normalisation is unconditional.
    const out = bodyHtmlFor('a5', html('<p style="padding: 12px;">Not a cell</p>'));
    expect(out).toContain('padding: 12px');
  });
});

describe('data-align is authoritative on the print path', () => {
  // Guards the regexes in normalizeAuthorHtmlForPrint: a corrupted DATA_ALIGN_RE would silently
  // fall through to inline-style inference, which agrees often enough to hide the bug.
  it('honours data-align over a conflicting inline float', () => {
    const out = bodyHtmlFor('a5', html('<p><img src="a.png" data-align="right" style="float:left;" /></p>'));
    // Asserted against the emitted tag, not the whole document: the stylesheet names every
    // placement, so a document-wide toContain would pass no matter what the image got.
    const tag = out.match(/<img[^>]*>/)?.[0] ?? '';
    expect(tag).toContain('data-print-align="right"');
    expect(tag).not.toContain('data-print-align="left"');
  });

  it('reads a centred image from data-align alone, with no inline hint', () => {
    expect(bodyHtmlFor('a5', html('<p><img src="a.png" data-align="center" /></p>'))).toContain('data-print-align="center"');
  });

  it('detects an inline width declaration, not just the attribute', () => {
    expect(bodyHtmlFor('a5', html('<p><img src="a.png" style="float:left;width:60%;" /></p>'))).toContain('data-print-width="set"');
  });
});
