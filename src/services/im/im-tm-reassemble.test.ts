import { describe, it, expect } from 'vitest';
import { buildTmSourceUnits } from './im-tm-core';
import { reassembleFragment } from './im-tm-reassemble';
import type { TmSourceUnitsResult } from './im-tm-core';
import type { TranslatedSegment } from './im-tm-types';

const build = (html: string, brands?: string[]): TmSourceUnitsResult =>
  buildTmSourceUnits('f#inline:0', html, { sourceLocale: 'en', brands });

const rebuild = (
  r: TmSourceUnitsResult,
  translated: TranslatedSegment[],
  targetLang = 'de',
) =>
  reassembleFragment(r.segmented, translated, {
    targetLang,
    placeholdersBySegment: r.placeholdersBySegment,
  });

/** Same corpus shapes as the segmenter suite — the guarantee has to hold on real markup. */
const CORPUS: string[] = [
  '',
  'Safety warnings',
  '<p>Do not immerse in water.</p>',
  '<p>Fill to the <strong>MAX</strong> line. Do not overfill.</p>',
  '<h2>Cleaning and maintenance</h2>',
  '<ul><li>Unplug the appliance.</li><li>Let it cool down.</li></ul>',
  '<table class="im-table"><thead><tr><th data-align="left">Property</th><th>Value</th></tr></thead>'
    + '<tbody><tr><td>Voltage</td><td>230 V</td></tr></tbody></table>',
  '<p>The <span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>'
    + ' must be earthed. Check it first.</p>',
  '<p><img src="https://example.test/a.png" alt="Wiring" data-align="center"> See the diagram.</p>',
  '<div class="im-block-wrapper im-block-warning"><div class="im-block-content">'
    + '<strong class="im-block-title">WARNING</strong><p>Risk of shock. Disconnect the plug.</p></div></div>',
  '<!--im-en-src:abc123--><p>Already machine translated.</p>',
  '<p>Line one here<br>Line two here</p>',
  '<p>The tank holds 2.5 l of water.</p>',
];

describe('the untranslated identity', () => {
  it('returns byte-identical source HTML when nothing is translated', () => {
    for (const html of CORPUS) {
      const r = build(html);
      const out = rebuild(r, []);
      expect(out.ok).toBe(true);
      expect(out.html).toBe(html);
    }
  });

  it('reports no failures and no applied segments for an empty translation set', () => {
    const out = rebuild(build('<p>Do not immerse in water.</p>'), []);
    expect(out.failures).toHaveLength(0);
    expect(out.perSegment).toHaveLength(0);
  });
});

describe('applying translations', () => {
  it('replaces only the translated sentence and leaves markup byte-identical', () => {
    const html = '<p>Do not immerse in water. Wipe with a damp cloth.</p>';
    const r = build(html);
    const out = rebuild(r, [
      { segmentIndex: 0, targetKeyText: 'Nicht in Wasser eintauchen.', origin: 'engine' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.html).toBe('<p>Nicht in Wasser eintauchen. Wipe with a damp cloth.</p>');
  });

  it('preserves a chip byte-for-byte through a translated segment', () => {
    const chip = '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>';
    const r = build('<p>The ' + chip + ' must be earthed.</p>');
    const unit = r.units[0];
    expect(unit.segment.keyText).toBe('The {{T0:chip.model_name}} must be earthed.');
    const out = rebuild(r, [
      {
        segmentIndex: 0,
        targetKeyText: 'Das {{T0:chip.model_name}} muss geerdet sein.',
        origin: 'tm_exact',
      },
    ]);
    expect(out.ok).toBe(true);
    expect(out.html).toBe('<p>Das ' + chip + ' muss geerdet sein.</p>');
  });

  it('preserves inline formatting through a translated segment', () => {
    const r = build('<p>Fill to the <strong>MAX</strong> line.</p>');
    const out = rebuild(r, [
      {
        segmentIndex: 0,
        targetKeyText: 'Bis zur {{T0:o.strong}}MAX{{T1:c.strong}} Markierung.',
        origin: 'tm_exact',
      },
    ]);
    expect(out.html).toBe('<p>Bis zur <strong>MAX</strong> Markierung.</p>');
  });

  it('accepts markers reordered for target word order', () => {
    const r = build('<p>Fill to the <strong>MAX</strong> line.</p>');
    const out = rebuild(r, [
      {
        segmentIndex: 0,
        // Same multiset, different order — legitimate for many target languages.
        targetKeyText: '{{T0:o.strong}}MAX{{T1:c.strong}} bis zur Markierung.',
        origin: 'tm_exact',
      },
    ]);
    expect(out.ok).toBe(true);
    expect(out.perSegment[0].applied).toBe(true);
  });

  it('renumbers a segment-local marker back to the fragment-global frozen token', () => {
    const chip = '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>';
    // The image is FRZ_0, so the chip is FRZ_1 — but inside its segment the chip is T0.
    const r = build('<p><img src="a.png" alt="a"> Alpha beta gamma.</p><p>The ' + chip + ' is earthed.</p>');
    const chipUnit = r.units.find((u) => u.segment.keyText.includes('chip.model_name'));
    expect(chipUnit).toBeDefined();
    expect(chipUnit?.segment.tokens[0].frozenIndex).toBe(1);
    const out = rebuild(r, [
      {
        segmentIndex: chipUnit!.segment.index,
        targetKeyText: 'Das {{T0:chip.model_name}} ist geerdet.',
        origin: 'tm_exact',
      },
    ]);
    expect(out.ok).toBe(true);
    expect(out.html).toContain('<p>Das ' + chip + ' ist geerdet.</p>');
    expect(out.html).toContain('<img src="a.png" alt="a">');
  });
});

describe('placeholder re-injection', () => {
  const capacity = () => build('<p>The tank holds 2.5 l of water.</p>');

  it('localizes a numeric value for the target language', () => {
    const r = capacity();
    expect(r.units[0].placeholdered.patternText).toBe('The tank holds {{P0}} of water.');
    const out = rebuild(r, [
      { segmentIndex: 0, targetKeyText: 'Der Tank fasst {{P0}} Wasser.', origin: 'tm_exact' },
    ]);
    expect(out.html).toBe('<p>Der Tank fasst 2,5 l Wasser.</p>');
  });

  it('keeps a dot separator for an English target', () => {
    const out = rebuild(
      capacity(),
      [{ segmentIndex: 0, targetKeyText: 'Holds {{P0}} of water.', origin: 'tm_exact' }],
      'en',
    );
    expect(out.html).toBe('<p>Holds 2.5 l of water.</p>');
  });

  it('never reformats an identifier or a regulation number', () => {
    const r = build('<p>Complies with (EU) 2019/2016 and part KG350X.</p>');
    const types = r.units[0].placeholdered.placeholders.map((p) => p.type);
    expect(types).toEqual(['regnum', 'code']);
    const out = rebuild(r, [
      {
        segmentIndex: 0,
        targetKeyText: 'Entspricht {{P0}} und Teil {{P1}}.',
        origin: 'tm_exact',
      },
    ]);
    expect(out.html).toBe('<p>Entspricht (EU) 2019/2016 und Teil KG350X.</p>');
  });

  it('does not touch a literal engine target that has no placeholder markers', () => {
    const out = rebuild(capacity(), [
      { segmentIndex: 0, targetKeyText: 'Der Tank fasst 2,5 l Wasser.', origin: 'engine' },
    ]);
    expect(out.html).toBe('<p>Der Tank fasst 2,5 l Wasser.</p>');
  });
});

describe('per-segment gates fail closed', () => {
  const chipHtml =
    '<p>The <span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>'
    + ' must be earthed.</p>';

  it.each([
    ['a dropped marker', 'Das muss geerdet sein.', 'token_multiset_mismatch'],
    [
      'a duplicated marker',
      'Das {{T0:chip.model_name}} {{T0:chip.model_name}} muss geerdet sein.',
      'token_multiset_mismatch',
    ],
    ['an unknown marker index', 'Das {{T9:chip.model_name}} muss geerdet sein.', 'token_multiset_mismatch'],
    ['a mismatched marker identity', 'Das {{T0:chip.other}} muss geerdet sein.', 'token_multiset_mismatch'],
  ])('leaves the segment untranslated on %s', (_label, target, reason) => {
    const r = build(chipHtml);
    const out = rebuild(r, [{ segmentIndex: 0, targetKeyText: target, origin: 'tm_exact' }]);
    expect(out.ok).toBe(true);
    expect(out.perSegment[0]).toMatchObject({ applied: false, reason });
    expect(out.html).toBe(chipHtml);
    expect(out.failures[0].code).toBe(reason);
  });

  it('rejects a target missing a placeholder', () => {
    const r = build('<p>The tank holds 2.5 l of water.</p>');
    const out = rebuild(r, [
      { segmentIndex: 0, targetKeyText: 'Der Tank fasst Wasser.', origin: 'tm_exact' },
    ]);
    expect(out.perSegment[0]).toMatchObject({ applied: false, reason: 'placeholder_missing' });
    expect(out.html).toBe('<p>The tank holds 2.5 l of water.</p>');
  });

  it('rejects a target referencing a placeholder that does not exist', () => {
    const r = build('<p>The tank holds 2.5 l of water.</p>');
    const out = rebuild(r, [
      { segmentIndex: 0, targetKeyText: 'Der Tank fasst {{P0}} und {{P9}}.', origin: 'tm_exact' },
    ]);
    expect(out.perSegment[0]).toMatchObject({ applied: false, reason: 'placeholder_unknown_index' });
  });

  it('rejects unbalanced inline formatting', () => {
    const r = build('<p>Fill to the <strong>MAX</strong> line.</p>');
    const out = rebuild(r, [
      {
        segmentIndex: 0,
        targetKeyText: '{{T0:o.strong}}{{T0:o.strong}} Markierung.',
        origin: 'tm_exact',
      },
    ]);
    expect(out.perSegment[0].applied).toBe(false);
  });

  it('rejects a literal target that still carries a marker', () => {
    const r = build('<p>The tank holds 2.5 l of water.</p>');
    const out = rebuild(r, [
      { segmentIndex: 0, targetKeyText: 'Der Tank fasst {{P0}}.', origin: 'engine' },
    ]);
    expect(out.perSegment[0]).toMatchObject({ applied: false, reason: 'marker_residue' });
  });

  it('applies the good segments and skips only the bad one', () => {
    const html = '<p>Do not immerse in water. Wipe with a damp cloth.</p>';
    const r = build(html);
    const out = rebuild(r, [
      { segmentIndex: 0, targetKeyText: 'Nicht in Wasser eintauchen.', origin: 'engine' },
      { segmentIndex: 1, targetKeyText: 'Mit {{P3}} abwischen.', origin: 'tm_exact' },
    ]);
    expect(out.ok).toBe(true);
    expect(out.perSegment).toEqual([
      { segmentIndex: 0, applied: true },
      { segmentIndex: 1, applied: false, reason: 'placeholder_unknown_index' },
    ]);
    expect(out.html).toBe('<p>Nicht in Wasser eintauchen. Wipe with a damp cloth.</p>');
  });
});

describe('output hygiene', () => {
  it('never leaves one of our markers in a successful result', () => {
    const r = build('<p>Fill to the <strong>MAX</strong> line at 2.5 l.</p>');
    const out = rebuild(r, [
      {
        segmentIndex: 0,
        targetKeyText: 'Bis {{T0:o.strong}}MAX{{T1:c.strong}} bei {{P0}}.',
        origin: 'tm_exact',
      },
    ]);
    expect(out.ok).toBe(true);
    expect(out.html).not.toMatch(/\{\{/);
  });
});
