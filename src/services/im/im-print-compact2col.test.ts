/**
 * The compact two-column Warning Leaflet layout.
 *
 * Every number asserted here was measured out of docs/Gas-Hob-Leaflet-EXAMPLE-v2-ISO7010.pdf
 * with pdfjs — text positions, font sizes, fill colours and path geometry — not chosen. The
 * guards that matter are the ones that would silently undo the reformat: the type floors, the
 * absence of anything tinted behind body text, and the ISO sign height.
 *
 * Kept in its own file so im-print-html.test.ts stays exactly what it was: the contract for
 * the classic leaflet and the full manual, which this layout must not disturb.
 */
import { describe, it, expect } from 'vitest';
import { buildPrintPartsHtml, type PrintManual, type PrintHtmlOptions } from './im-print-html';
import { defaultTypographyFor, normalizePrintTypography } from './im-print-typography';

/**
 * A leaflet section shaped like the real published one: a "Safety Warnings" chapter whose
 * nodes are callouts carrying a run-in bold topic label and imperative prose. The three
 * variants the live Nevora leaflet actually uses are all hazard TYPES (electric, flammable,
 * hot_surface) — not one of them is a severity level, which is the whole reason this layout
 * has to split the axes.
 */
const hazardManual = (variant: string, language = 'en'): PrintManual => ({
  language,
  metadata: { pageSize: 'a5', primaryColor: '#000', companyName: 'Acme' },
  sections: [
    {
      id: 'S',
      title: 'Safety Warnings',
      parentId: null,
      order: 10,
      nodes: [
        {
          type: 'callout',
          id: 'c1',
          variant,
          html: '<p><strong>Escaping gas kills</strong> Turn every control knob fully off.</p>',
        },
      ],
    },
  ],
});

const fullManual: PrintManual = {
  language: 'en',
  metadata: { pageSize: 'a4', primaryColor: '#000', companyName: 'Acme' },
  sections: [
    { id: 'A', title: 'Chapter A', parentId: null, order: 10, nodes: [{ type: 'html', id: 'n', html: '<p>Body</p>' }] },
  ],
};

const compact = (m: PrintManual, pageSize: 'a4' | 'a5' = 'a5') =>
  buildPrintPartsHtml([m], {
    pageSize,
    cover: { title: 'T' },
    back: {},
    compact: true,
    leafletLayout: 'compact2col',
  })[0].html;

const classic = (m: PrintManual, pageSize: 'a4' | 'a5' = 'a5') =>
  buildPrintPartsHtml([m], { pageSize, cover: { title: 'T' }, back: {}, compact: true })[0].html;

describe('compact2col — page geometry', () => {
  it('sets two 64mm columns with a 4mm gutter on A5, the reference measure', () => {
    // Asserted as the PAIR: the shared stylesheet already sets `columns: 2` on the full-IM
    // cover's language directory, so matching `columns: 2` alone would pass on any part.
    expect(compact(hazardManual('flammable'))).toContain('columns: 2; column-gap: 4mm;');
  });

  it('fills column 1 before starting column 2 instead of balancing them', () => {
    // Balancing would leave both columns half-height on the last page of every locale.
    expect(compact(hazardManual('flammable'))).toContain('column-fill: auto;');
  });

  it('keeps ~64mm columns on A4 by taking three, not two 95mm ones', () => {
    expect(compact(hazardManual('flammable'), 'a4')).toContain('columns: 3; column-gap: 4mm;');
  });

  it('divides whatever measure the profile leaves, rather than a fixed column width', () => {
    // The columns are a COUNT, so tightening the leaflet margins in Admin → IM Print widens
    // the columns instead of pushing content off the page. At the reference's A5 margins the
    // 132mm measure divides into the 2 x 64mm the PDF was measured at.
    const html = compact(hazardManual('flammable'));
    expect(html).toContain('columns: 2; column-gap: 4mm;');
    expect(html).not.toContain('width: 64mm');
  });
});

describe('compact2col — typography is the admin profile, shared with classic', () => {
  it('sets body text at the profile bodyPt and line spacing, not a layout-owned size', () => {
    const t = { ...defaultTypographyFor('warning_leaflet', 'a5'), bodyPt: 6.5, lineHeight: 1.25 };
    const html = buildPrintPartsHtml([hazardManual('flammable')], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      compact: true,
      leafletLayout: 'compact2col',
      typography: t,
    })[0].html;
    expect(html).toContain('font-size: 6.5pt');
    expect(html).toContain('line-height: 1.25');
  });

  it('sets the severity band and hazard descriptor at the profile headingPt', () => {
    // Both sit in the heading slot, exactly as the classic path's callout title does. The band
    // is told apart from the descriptor by being reversed out of a solid colour, not by size.
    const t = { ...defaultTypographyFor('warning_leaflet', 'a5'), bodyPt: 6.5, headingPt: 9 };
    const html = buildPrintPartsHtml([hazardManual('flammable')], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      compact: true,
      leafletLayout: 'compact2col',
      typography: t,
    })[0].html;
    expect(html).toContain('font-size: 9pt; line-height: 1.45; font-weight: 800;');
    expect(html).toContain('.imv-hz-desc { font-size: 9pt;');
  });

  it('resolves the SAME typography as the classic layout for the same profile', () => {
    // The guard that matters: a layout must never quietly print at a different size than the
    // one the operator set and the other layout uses.
    const each = (layout: 'classic' | 'compact2col') =>
      buildPrintPartsHtml([hazardManual('flammable')], {
        pageSize: 'a5',
        cover: { title: 'T' },
        back: {},
        compact: true,
        leafletLayout: layout,
      })[0].html;
    const profile = defaultTypographyFor('warning_leaflet', 'a5');
    for (const html of [each('classic'), each('compact2col')]) {
      expect(html).toContain(`font-size: ${profile.bodyPt}pt`);
      expect(html).toContain(`font-size: ${profile.headingPt}pt`);
    }
  });

  it('imposes no floor of its own — the profile is the only source of size', () => {
    // An earlier revision clamped this layout to 7pt / 1.20. It does not: the admin profile
    // is authoritative for both layouts, so the two stay comparable and one setting moves both.
    const tiny = normalizePrintTypography(
      { ...defaultTypographyFor('warning_leaflet', 'a5'), bodyPt: 4.75, lineHeight: 1 },
      defaultTypographyFor('warning_leaflet', 'a5'),
    );
    expect(tiny.bodyPt).toBe(4.75);
    expect(tiny.lineHeight).toBe(1);
    const html = buildPrintPartsHtml([hazardManual('flammable')], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      compact: true,
      leafletLayout: 'compact2col',
      typography: tiny,
    })[0].html;
    expect(html).toContain('font-size: 4.75pt');
  });
});

describe('compact2col — justification and hyphenation', () => {
  it('justifies and hyphenates', () => {
    const html = compact(hazardManual('flammable', 'de'));
    expect(html).toContain('text-align: justify;');
    expect(html).toContain('hyphens: auto;');
  });

  it('carries a per-locale lang inside the shared flow, which is what picks the dictionary', () => {
    // Without a lang in scope `hyphens: auto` silently does nothing — and German is the
    // binding locale precisely because of its compounds. The document element cannot carry
    // it (one part now spans every language), so each locale's wrapper does.
    const html = buildPrintPartsHtml([hazardManual('flammable', 'en'), hazardManual('flammable', 'de')], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      compact: true,
      leafletLayout: 'compact2col',
    })[0].html;
    expect(html).toContain('<div class="imv-lang" lang="en">');
    expect(html).toContain('<div class="imv-lang" lang="de">');
    // And no document-level language, which would be wrong for every locale but the first.
    expect(html).not.toContain('<html lang=');
  });
});

describe('compact2col — languages flow continuously', () => {
  const twoLangs = () =>
    buildPrintPartsHtml([hazardManual('flammable', 'en'), hazardManual('hot_surface', 'de')], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      compact: true,
      leafletLayout: 'compact2col',
    });

  it('renders every language as ONE part', () => {
    // The load-bearing fact: in this pipeline each part is its own PDFShift conversion and the
    // parts are merged whole-page, so a part boundary IS a page boundary. One part is the only
    // way a locale can start part-way down a column.
    const parts = twoLangs();
    expect(parts).toHaveLength(1);
    expect(parts[0].html).toContain('lang="en"');
    expect(parts[0].html).toContain('lang="de"');
  });

  it('puts every language in a SINGLE multicol container', () => {
    // A second .im-page-content would start its own column set below the tallest column of the
    // first — a page-break-shaped gap at every language boundary.
    const html = twoLangs()[0].html;
    expect(html.match(/class="im-page im-page-content"/g)).toHaveLength(1);
  });

  it('forces no break and adds no spacing at a language boundary', () => {
    const html = twoLangs()[0].html;
    expect(html).toContain('.imv-lang { margin: 0; padding: 0; break-before: auto; page-break-before: auto; }');
    expect(html).not.toContain('im-page im-break');
    // Nothing may single out the last section of a locale — the boundary costs exactly what a
    // chapter boundary costs. Measured on the real leaflet: EN's last line and DE's first line
    // land in the SAME column, 2.32mm apart.
    expect(html).not.toContain('.imv-lang > .im-section:last-child');
  });

  it('prints the header once for the booklet, not once per language', () => {
    // Repeated per locale it would be a full-measure band inside the column flow — a spanner,
    // which splits the columns into separate groups and reintroduces the gap.
    const html = twoLangs()[0].html;
    expect(html.match(/class="im-leaflet-header"/g)).toHaveLength(1);
  });

  it('spans only the FIRST title across the columns', () => {
    const html = twoLangs()[0].html;
    expect(html).toContain(
      '.im-page-content > .imv-lang:first-child > .im-section:first-child > .im-section-title { column-span: all; }',
    );
  });

  it('separates locales with a small black bar naming the language in its own language', () => {
    const html = buildPrintPartsHtml(
      [hazardManual('flammable', 'en'), hazardManual('flammable', 'de'), hazardManual('flammable', 'el')],
      { pageSize: 'a5', cover: { title: 'T' }, back: {}, compact: true, leafletLayout: 'compact2col' },
    )[0].html;
    // The endonym, not the English name: a reader looking for their section may not be able to
    // read the language it would otherwise be labelled in.
    expect(html).toContain('<span class="imv-lang-bar-name">Deutsch</span>');
    expect(html).toContain('<span class="imv-lang-bar-name">Ελληνικά</span>');
    expect(html).not.toContain('>German<');
    // Plus the ISO code, which is legible whatever script the reader knows.
    expect(html).toContain('<span class="imv-lang-bar-code">DE</span>');
    expect(html).toContain('<span class="imv-lang-bar-code">EL</span>');
    expect(html).toContain('background: #000; color: #fff;');
  });

  it('puts the bar BETWEEN languages — the first locale has none', () => {
    // The first locale is announced by its own full-measure opening title, and a bar above a
    // spanner would sit in the narrow column group the spanner creates above itself.
    const html = buildPrintPartsHtml([hazardManual('flammable', 'en'), hazardManual('flammable', 'de')], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      compact: true,
      leafletLayout: 'compact2col',
    })[0].html;
    expect(html.match(/class="imv-lang-bar"/g)).toHaveLength(1);
    expect(html).toContain('<span class="imv-lang-bar-name">Deutsch</span>');
    expect(html).not.toContain('<span class="imv-lang-bar-name">English</span>');
  });

  it('emits no language bar at all for a single-locale export', () => {
    // The stylesheet always defines the rule; only the ELEMENT is conditional — the same
    // split the leaflet header's QR follows.
    expect(compact(hazardManual('flammable', 'de'))).not.toContain('<div class="imv-lang-bar">');
  });

  it('keeps the bar an in-column block, not a spanner that would split the columns', () => {
    const html = buildPrintPartsHtml([hazardManual('flammable', 'en'), hazardManual('flammable', 'de')], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      compact: true,
      leafletLayout: 'compact2col',
    })[0].html;
    // Measured on the real leaflet: the bars land 12.2mm / 74.5mm / 100mm into their columns,
    // i.e. the flow runs straight through them.
    expect(html).toMatch(/\.imv-lang-bar \{[^}]*clear: both; break-after: avoid; break-inside: avoid;/);
    expect(html).not.toMatch(/\.imv-lang-bar \{[^}]*column-span/);
  });

  it('carries no edge thumb-tab, because pages are no longer language-aligned', () => {
    // A tab indexes a PAGE by language. Once a page can hold the end of one locale and the
    // start of the next, there is no correct language to label it with.
    expect(twoLangs()[0].tab).toBeNull();
  });
});

describe('compact2col — severity, hazard and sign as three axes', () => {
  it('prints a severity band, an ISO sign and a descriptor instead of a tinted panel', () => {
    const html = compact(hazardManual('flammable'));
    expect(html).toContain('class="imv-hz imv-hz-danger"');
    expect(html).toContain('class="imv-hz-band"');
    expect(html).toContain('class="imv-hz-signs"');
    expect(html).not.toContain('imv-block-wrapper imv-block-flammable');
    expect(html).not.toContain('<div class="imv-block-icon">');
    // The author's run-in bold topic label survives untouched.
    expect(html).toContain('<strong>Escaping gas kills</strong>');
  });

  it('maps each stored variant onto a severity level', () => {
    expect(compact(hazardManual('flammable'))).toContain('<div class="imv-hz-band">DANGER</div>');
    expect(compact(hazardManual('electric'))).toContain('<div class="imv-hz-band">DANGER</div>');
    // The injury-you-recover-from case, not a fatality.
    expect(compact(hazardManual('hot_surface'))).toContain('<div class="imv-hz-band">WARNING</div>');
    expect(compact(hazardManual('caution'))).toContain('<div class="imv-hz-band">CAUTION</div>');
  });

  it('prints the hazard TYPE as the descriptor line under the band', () => {
    expect(compact(hazardManual('flammable'))).toContain('<div class="imv-hz-desc">RISK OF FIRE</div>');
    expect(compact(hazardManual('hot_surface'))).toContain('<div class="imv-hz-desc">HOT SURFACE</div>');
  });

  it('drops the descriptor when the variant IS the severity level', () => {
    // Otherwise the band word prints twice — the "four severity levels, two unrecognisable"
    // failure the single-axis variant causes once colour is the only signal.
    const html = compact(hazardManual('danger'));
    expect(html).toContain('<div class="imv-hz-band">DANGER</div>');
    expect(html).not.toContain('class="imv-hz-desc"');
  });

  it('localizes BOTH the band word and the descriptor', () => {
    // Neither is new content: CALLOUT_TITLES_I18N already covers all 22 locales for all seven
    // variants, which is what makes this layout need no translation work at all.
    const html = compact(hazardManual('flammable', 'de'));
    expect(html).toContain('<div class="imv-hz-band">GEFAHR</div>');
    expect(html).toContain('<div class="imv-hz-desc">BRANDGEFAHR</div>');
  });

  it('reverses the band word out of a solid colour so severity survives greyscale', () => {
    const html = compact(hazardManual('flammable'));
    expect(html).toContain('.imv-hz-danger  .imv-hz-band { background: #c1121f; }');
    expect(html).toContain('.imv-hz-warning .imv-hz-band { background: #d97706; }');
    expect(html).toContain('.imv-hz-caution .imv-hz-band { background: #b45309; }');
    expect(html).toContain('.imv-hz-info    .imv-hz-band { background: #1d4ed8; }');
    expect(html).toContain('color: #fff;');
  });

  it('sizes each sign so its OUTER shape prints at 7.5mm, per viewBox convention', () => {
    // The measurement trap: W001/W012 draw their triangle across 81 of 100 viewBox units,
    // W021/W017 across ~523 of 525, M002's circle across 92. One shared box height would
    // print the first group 19% under the ISO floor while reporting "7.5mm".
    expect(compact(hazardManual('flammable'))).toContain('style="height:7.53mm"');
    expect(compact(hazardManual('hot_surface'))).toContain('style="height:7.53mm"');
    expect(compact(hazardManual('electric'))).toContain('style="height:9.26mm"');
    expect(compact(hazardManual('info'))).toContain('style="height:8.15mm"');
  });

  it('floats the sign into the text instead of giving it a row of its own', () => {
    // A sign on its own row costs ~8mm of column per hazard block and sets no text. Floated,
    // it occupies vertical space the body copy needs anyway. Measured on the real leaflet:
    // 7.87mm recovered per block, i.e. essentially the whole row.
    const html = compact(hazardManual('flammable'));
    expect(html).toContain('.imv-hz-signs { float: right; line-height: 0; margin: 0 0 0.6mm 1.4mm; }');
    expect(html).not.toContain('.imv-hz-signs { text-align: right;');
  });

  it('clears a floating sign before the next band or chapter title', () => {
    // Without this, a hazard block whose text is too short to consume the float would print
    // its sign on top of the following severity band.
    expect(compact(hazardManual('flammable'))).toContain('.imv-hz-band, .im-section-title { clear: both; }');
  });

  it('keeps the sign markup AFTER the band, so the float lands below it', () => {
    // A float is placed at the current vertical position. Declared before the band it would
    // sit on top of the coloured bar — a yellow triangle over a red ground.
    const html = compact(hazardManual('flammable'));
    expect(html.indexOf('imv-hz-band')).toBeLessThan(html.indexOf('imv-hz-signs'));
  });

  it('never lets anything tinted sit behind body text', () => {
    const html = compact(hazardManual('flammable'));
    // The classic per-variant tints still exist in the shared stylesheet, so the layout
    // neutralises the wrappers that could carry them rather than trusting that none is
    // emitted — authored .im-block-* markup inside a rich-text node is the other route in.
    expect(html).toContain('.imv-block-wrapper, .im-block-wrapper {');
    expect(html).toContain('background: none; border: 0;');
  });

  it('keeps a severity band from being orphaned from its instructions', () => {
    const html = compact(hazardManual('flammable'));
    expect(html).toContain('.imv-hz-head { break-inside: avoid; break-after: avoid; }');
    // The block itself stays breakable: the reference's DANGER block flows across the column
    // break, so pinning it whole would blow a hole in column 1.
    expect(html).not.toMatch(/\.imv-hz \{[^}]*break-inside:\s*avoid/);
  });
});

describe('compact2col — what it must not disturb', () => {
  it('leaves the classic leaflet exactly as it was', () => {
    const html = classic(hazardManual('flammable'));
    expect(html).toContain('imv-block-wrapper imv-block-flammable');
    expect(html).toContain('<div class="imv-block-icon">');
    expect(html).not.toContain('columns: 2; column-gap: 4mm;');
    expect(html).not.toContain('column-fill: auto;');
    expect(html).not.toContain('imv-hz-band');
    expect(html).not.toContain('text-align: justify;');
    // The lang attribute is scoped to the layout that needs it, so the classic part's HTML
    // stays byte-for-byte what it has always been.
    expect(html).toContain('<html>');
  });

  it('treats an omitted leafletLayout as classic, byte for byte', () => {
    const omitted = classic(hazardManual('flammable'));
    const explicit = buildPrintPartsHtml([hazardManual('flammable')], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      compact: true,
      leafletLayout: 'classic',
    })[0].html;
    expect(explicit).toBe(omitted);
  });

  it('can never reach a full manual', () => {
    const opts: PrintHtmlOptions = {
      pageSize: 'a4',
      cover: { title: 'T' },
      back: {},
      leafletLayout: 'compact2col',
    };
    const all = buildPrintPartsHtml([fullManual], opts)
      .map((p) => p.html)
      .join('');
    expect(all).not.toContain('columns: 2; column-gap: 4mm;');
    expect(all).not.toContain('column-fill: auto;');
    expect(all).not.toContain('imv-hz-band');
  });

  it('leaves the classic leaflet one part per language, each with its edge tab', () => {
    // Classic part composition is untouched, which is what keeps every branch in the merge
    // step (per-language page counts, languagePartOffset, tab drawing) correct as-is.
    const parts = buildPrintPartsHtml([hazardManual('flammable', 'en'), hazardManual('flammable', 'de')], {
      pageSize: 'a5',
      cover: { title: 'T' },
      back: {},
      compact: true,
    });
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.tab?.code)).toEqual(['en', 'de']);
    expect(parts[0].html).toContain('im-page im-break im-page-content');
  });
});
