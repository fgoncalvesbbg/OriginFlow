import { describe, it, expect } from 'vitest';
import { thaw } from './im-chip-freeze';
import {
  SEGMENTATION_VERSION,
  hasAmbiguousMarkup,
  renderParts,
  segmentFragment,
} from './im-tm-segment';

const seg = (html: string, lang = 'en', protectedPhrases?: string[]) =>
  segmentFragment(html, { sourceLang: lang, protectedPhrases });

const texts = (html: string, lang = 'en'): string[] =>
  seg(html, lang).segments.map((s) => s.rawText);

/**
 * A corpus of real-shaped IM content: the chip and callout markup the editor
 * actually emits, plus the table/list/image shapes that appear in manuals.
 * Reused by the losslessness property so a boundary bug in any one of them
 * cannot slip through.
 */
const CORPUS: string[] = [
  '',
  'Safety warnings',
  '<p>Do not immerse in water.</p>',
  '<p>Fill to the <strong>MAX</strong> line. Do not overfill.</p>',
  '<p>Max. 2.5 l of water. Approx. 3 min.</p>',
  '<h2>Cleaning and maintenance</h2>',
  '<ul><li>Unplug the appliance.</li><li>Let it cool down.</li></ul>',
  '<ol><li>Open the lid.</li><li>Remove the filter. Rinse it.</li></ol>',
  '<table class="im-table"><thead><tr><th data-align="left">Property</th><th>Value</th></tr></thead>'
    + '<tbody><tr><td>Voltage</td><td>230 V</td></tr><tr><td>Capacity</td><td>Max. 2.5 l</td></tr></tbody></table>',
  '<p>See Fig. 4 for details.</p>',
  '<p>The <span class="im-placeholder im-chip" contenteditable="false" data-type="text" data-id="p1"'
    + ' data-attr-id="model_name" data-label="Model">[Model]</span> must be earthed. Check first.</p>',
  '<p>Applies to <span class="im-condition im-chip" data-id="c1" data-feature-id="has_timer"'
    + ' data-feature-name="Timer" data-content="Set%20the%20timer." data-condition-value="yes">'
    + '<span class="im-condition-label">[Timer]</span> preview</span> only.</p>',
  '<p>Diagram:</p><p><img src="https://example.test/a.png" alt="Wiring" style="width:50%"'
    + ' data-align="center" data-width="50"></p>',
  '<div class="im-block-wrapper im-block-warning"><div class="im-block-icon">'
    + '<svg viewBox="0 0 24 24"><path d="M12 2L2 20h20z"/></svg></div>'
    + '<div class="im-block-content"><strong class="im-block-title">WARNING</strong>'
    + '<p>Risk of electric shock. Disconnect the mains plug.</p></div></div>',
  '<!--im-en-src:abc123--><p>Already machine translated.</p>',
  '<p>Line one<br>Line two</p>',
  '<p>Complies with (EU) 2019/2016 and EN 60335-1. See section 4.2. Then proceed.</p>',
  '<p>&nbsp;</p>',
  '<p>230 V</p>',
];

describe('SEGMENTATION_VERSION', () => {
  it('is 1 — a change here orphans the stored corpus and needs a migration', () => {
    expect(SEGMENTATION_VERSION).toBe(1);
  });
});

describe('segmentFragment losslessness', () => {
  it('reproduces the frozen text from parts alone, for every corpus fragment', () => {
    for (const html of CORPUS) {
      const sf = seg(html);
      expect(renderParts(sf)).toBe(sf.frozenText);
    }
  });

  it('round-trips to BYTE-IDENTICAL source HTML when nothing is translated', () => {
    for (const html of CORPUS) {
      const sf = seg(html);
      expect(thaw(renderParts(sf), sf.frozen)).toBe(html);
    }
  });

  it('keeps every segment rawText as a verbatim slice of the frozen text', () => {
    for (const html of CORPUS) {
      const sf = seg(html);
      for (const s of sf.segments) expect(sf.frozenText).toContain(s.rawText);
    }
  });

  it('never emits a segment that is empty or whitespace-only', () => {
    for (const html of CORPUS) {
      for (const s of seg(html).segments) expect(s.rawText.trim()).not.toBe('');
    }
  });
});

describe('sentence boundaries', () => {
  it('splits a two-sentence paragraph and keeps the space in the skeleton', () => {
    const sf = seg('<p>Do not immerse in water. Wipe with a damp cloth.</p>');
    expect(sf.segments.map((s) => s.rawText)).toEqual([
      'Do not immerse in water.',
      'Wipe with a damp cloth.',
    ]);
    expect(renderParts(sf)).toBe(sf.frozenText);
  });

  it.each([
    ['max.', '<p>Fill to max. 2.5 l of water and close the lid.</p>'],
    ['approx.', '<p>Wait approx. 5 units then open the lid carefully.</p>'],
    ['Fig.', '<p>See Fig. 4 for the wiring diagram of the appliance.</p>'],
    ['No.', '<p>Order spare part No. 12 from your dealer directly.</p>'],
    ['e.g.', '<p>Use a mild detergent, e.g. dish soap, on the surface.</p>'],
    ['i.e.', '<p>Only descale with acid, i.e. citric acid, once monthly.</p>'],
    ['etc.', '<p>Remove crumbs, dust, etc. before storing the appliance.</p>'],
  ])('does not split after the abbreviation %s', (_label, html) => {
    expect(texts(html)).toHaveLength(1);
  });

  it.each([
    ['z. B.', 'de', '<p>Reinigen Sie z. B. mit einem feuchten Tuch und Seife.</p>'],
    ['d. h.', 'de', '<p>Nur Trockenreinigung, d. h. ohne Wasser, ist erlaubt.</p>'],
    ['p. ex.', 'fr', '<p>Utilisez p. ex. un chiffon doux pour nettoyer le corps.</p>'],
    ['p. ej.', 'es', '<p>Limpie p. ej. con un pano humedo y detergente suave.</p>'],
    ['np.', 'pl', '<p>Czysc np. wilgotna szmatka i lagodnym detergentem teraz.</p>'],
  ])('does not split after the %s abbreviation in %s', (_label, lang, html) => {
    expect(texts(html, lang)).toHaveLength(1);
  });

  it('does not split inside a decimal number', () => {
    expect(texts('<p>The tank holds 2.5 l of water in total.</p>')).toHaveLength(1);
  });

  it('does not split after a list number', () => {
    expect(texts('<p>1. Open the lid of the appliance carefully.</p>')).toHaveLength(1);
  });

  it('does not split after a cross-reference number', () => {
    const out = texts('<p>See section 4.2. Then close the lid again.</p>');
    expect(out).toEqual(['See section 4.2. Then close the lid again.']);
  });

  it('does not split after an initial or a lettered enumerator', () => {
    expect(texts('<p>Contact J. Smith for spare parts and service.</p>')).toHaveLength(1);
    expect(texts('<p>Options are a. water and b. mild detergent only.</p>')).toHaveLength(1);
  });

  it('does not split before a lowercase continuation', () => {
    expect(texts('<p>Rinse the filter. then dry it fully before use.</p>')).toHaveLength(1);
  });

  it('splits before a tag that starts the next sentence', () => {
    const out = texts('<p>Let it cool down. <strong>Never</strong> use solvents.</p>');
    expect(out).toEqual(['Let it cool down.', '<strong>Never</strong> use solvents.']);
  });

  it('rejects a boundary that would leave a leading piece with no words', () => {
    // Stray leading punctuation must not become a segment of its own.
    expect(texts('<p>?! Rinse the filter well.</p>')).toEqual(['?! Rinse the filter well.']);
  });

  it('rejects a boundary that would leave a trailing piece with no words', () => {
    // A dangling single letter is merged back rather than stored as a segment.
    expect(texts('<p>Rinse the filter well. A</p>')).toEqual(['Rinse the filter well. A']);
  });
});

describe('containers', () => {
  it('never splits inside a table cell or a heading', () => {
    const cells = texts(
      '<table class="im-table"><tbody><tr><td>Max. 2.5 l. Do not exceed.</td></tr></tbody></table>',
    );
    expect(cells).toEqual(['Max. 2.5 l. Do not exceed.']);
    expect(texts('<h2>Cleaning. Maintenance.</h2>')).toEqual(['Cleaning. Maintenance.']);
  });

  it('makes each list item its own segment', () => {
    expect(texts('<ul><li>Unplug the appliance.</li><li>Let it cool down.</li></ul>')).toEqual([
      'Unplug the appliance.',
      'Let it cool down.',
    ]);
  });

  it('splits sentences inside a single list item', () => {
    expect(texts('<ol><li>Remove the filter. Rinse it well.</li></ol>')).toEqual([
      'Remove the filter.',
      'Rinse it well.',
    ]);
  });

  it('emits no segment for a data-only table cell', () => {
    const sf = seg('<table class="im-table"><tbody><tr><td>Voltage</td><td>230 V</td></tr></tbody></table>');
    expect(sf.segments.map((s) => s.rawText)).toEqual(['Voltage']);
  });

  it('treats a bare fragment with no tags as a root container', () => {
    const sf = seg('Safety warnings');
    expect(sf.segments).toHaveLength(1);
    expect(sf.segments[0].container).toBe('root');
    expect(sf.segments[0].anchorPath).toBe('s0');
  });

  it('reports distinct anchor paths for sibling containers', () => {
    const sf = seg('<p>First sentence here.</p><p>Second sentence here.</p>');
    expect(sf.segments.map((s) => s.anchorPath)).toEqual(['p[0]/s0', 'p[1]/s0']);
  });

  it('does not collide anchors between a nested paragraph and its container tail', () => {
    const sf = seg('<td><p>Inner sentence text.</p> Outer tail text.</td>');
    const paths = sf.segments.map((s) => s.anchorPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('fences a <br> so a broken line does not merge into one segment', () => {
    expect(texts('<p>Line one here<br>Line two here</p>')).toEqual([
      'Line one here',
      'Line two here',
    ]);
  });
});

describe('chips and markup', () => {
  it('keeps a mid-sentence chip inside the segment as a renumbered token', () => {
    const html =
      '<p>The <span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>'
      + ' must be earthed.</p>';
    const sf = seg(html);
    expect(sf.segments).toHaveLength(1);
    const s = sf.segments[0];
    expect(s.tokens).toHaveLength(1);
    expect(s.tokens[0].kind).toBe('placeholder_chip');
    expect(s.tokens[0].identity).toBe('chip.model_name');
    expect(s.keyText).toBe('The {{T0:chip.model_name}} must be earthed.');
  });

  it('gives the same keyText to the same sentence regardless of fragment-level FRZ numbering', () => {
    const chip =
      '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>';
    const early = seg('<p>The ' + chip + ' must be earthed.</p>');
    const late = seg(
      '<p><img src="a.png" alt="a"> First. Second.</p><p>The ' + chip + ' must be earthed.</p>',
    );
    const lateSeg = late.segments.find((s) => s.rawText.includes('must be earthed'));
    // The chip is {{FRZ_0}} in one fragment and {{FRZ_1}} in the other...
    expect(early.segments[0].rawText).not.toBe(lateSeg?.rawText);
    // ...but the position-independent key is identical, which is the whole point.
    expect(lateSeg?.keyText).toBe(early.segments[0].keyText);
  });

  it('records inline formatting in the key, so emphasis cannot be silently dropped', () => {
    const withTag = seg('<p>Fill to the <strong>MAX</strong> line.</p>').segments[0];
    const without = seg('<p>Fill to the MAX line.</p>').segments[0];
    expect(withTag.keyText).not.toBe(without.keyText);
    expect(withTag.tokens.map((t) => t.identity)).toEqual(['o.strong', 'c.strong']);
  });

  it('puts a stale-translation marker comment in the skeleton, not in prose', () => {
    const sf = seg('<!--im-en-src:abc123--><p>Already translated.</p>');
    expect(sf.segments.map((s) => s.rawText)).toEqual(['Already translated.']);
    expect(sf.parts.some((p) => p.kind === 'skeleton' && p.text.includes('im-en-src'))).toBe(true);
  });

  it('identifies a condition chip by its feature id', () => {
    const sf = seg(
      '<p>Only for <span class="im-condition" data-id="c1" data-feature-id="has_timer"'
      + ' data-content="x">[Timer]</span> models.</p>',
    );
    expect(sf.segments[0].tokens[0].identity).toBe('cond.has_timer');
  });
});

describe('protected phrases', () => {
  it('suppresses a boundary that would cut through mandated wording', () => {
    const phrase = 'Complies with Regulation (EU) 2019/2016. Tested to EN 60335-1';
    const sf = seg('<p>' + phrase + ' by the manufacturer.</p>', 'en', [phrase]);
    expect(sf.protectedCutSuppressed).toBe(true);
    expect(sf.segments).toHaveLength(1);
  });

  it('leaves segmentation untouched when no protected phrase is involved', () => {
    const sf = seg('<p>Rinse the filter. Dry it fully.</p>', 'en', ['Some other phrase.']);
    expect(sf.protectedCutSuppressed).toBe(false);
    expect(sf.segments).toHaveLength(2);
  });
});

describe('ineligible fragments', () => {
  it('flags a > hidden inside a quoted attribute value', () => {
    const html = '<p data-note="a > b">Text here.</p>';
    expect(hasAmbiguousMarkup(html)).toBe(true);
    const sf = seg(html);
    expect(sf.ineligibleReason).toBe('ambiguous_markup');
    expect(sf.segments).toHaveLength(0);
    expect(thaw(renderParts(sf), sf.frozen)).toBe(html);
  });

  it('accepts ordinary attribute-rich markup', () => {
    expect(
      hasAmbiguousMarkup('<th data-align="center" style="text-align:center">Value</th>'),
    ).toBe(false);
  });

  it('accepts a stale-marker comment', () => {
    expect(hasAmbiguousMarkup('<!--im-en-src:abc123--><p>x</p>')).toBe(false);
  });

  it('flags an unterminated tag', () => {
    expect(hasAmbiguousMarkup('<p>text <stro')).toBe(true);
  });
});

describe('empty and prose-free input', () => {
  it('returns no segments for empty, whitespace, or entity-only content', () => {
    for (const html of ['', '   ', '<p></p>', '<p>&nbsp;</p>', '<p>230 V</p>']) {
      expect(seg(html).segments).toHaveLength(0);
    }
  });
});
