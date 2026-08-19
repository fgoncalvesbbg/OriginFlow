import { describe, it, expect } from 'vitest';
import { buildTmSourceUnits, translatableUnits } from './im-tm-core';
import { reassembleFragment } from './im-tm-reassemble';
import type { TranslatedSegment } from './im-tm-types';

/**
 * A realistic inline block: two paragraphs, a placeholder chip, a condition chip,
 * an image, a table, a callout wrapper and a specification sentence. This is the
 * shape a single `im_sections.block_refs[i].content.en` value actually takes.
 */
const GOLDEN =
  '<div class="im-block-wrapper im-block-warning"><div class="im-block-content">'
  + '<strong class="im-block-title">WARNING</strong>'
  + '<p>Risk of electric shock. Disconnect the mains plug before cleaning.</p></div></div>'
  + '<h3>Technical data</h3>'
  + '<p>The <span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>'
  + ' operates at 230 V and 50 Hz. Max. capacity is 2.5 l.</p>'
  + '<table class="im-table"><thead><tr><th>Property</th><th>Value</th></tr></thead>'
  + '<tbody><tr><td>Power</td><td>1450 W</td></tr></tbody></table>'
  + '<p>Applies to <span class="im-condition" data-id="c1" data-feature-id="has_timer"'
  + ' data-content="Set%20the%20timer.">[Timer]</span> models only.</p>'
  + '<p><img src="https://example.test/wiring.png" alt="Wiring"> See Fig. 4 for details.</p>';

const build = (html: string) =>
  buildTmSourceUnits('sec-1#inline:0', html, { sourceLocale: 'en', brands: ['Klarstein'] });

describe('buildTmSourceUnits on a realistic block', () => {
  const r = build(GOLDEN);

  it('cuts it into the expected sentence-scale units', () => {
    // Note two deliberate behaviours visible here: an inline <strong> stays INSIDE
    // its segment (prose flows through formatting tags), and a frozen <img> that
    // sits inside a paragraph stays inside the segment as a token rather than
    // fencing the sentence around it.
    expect(r.units.map((u) => u.segment.rawText)).toEqual([
      '<strong class="im-block-title">WARNING</strong>',
      'Risk of electric shock.',
      'Disconnect the mains plug before cleaning.',
      'Technical data',
      'The {{FRZ_0}} operates at 230 V and 50 Hz.',
      'Max. capacity is 2.5 l.',
      'Property',
      'Value',
      'Power',
      'Applies to {{FRZ_1}} models only.',
      '{{FRZ_2}} See Fig. 4 for details.',
    ]);
  });

  it('records a stable, distinct anchor path per unit', () => {
    const paths = r.units.map((u) => u.anchor.structuralPath);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('h3[0]/s0');
  });

  it('reports the container each unit came from', () => {
    const byText = new Map(r.units.map((u) => [u.segment.rawText, u.segment.container]));
    expect(byText.get('Technical data')).toBe('h3');
    expect(byText.get('Property')).toBe('th');
    expect(byText.get('Power')).toBe('td');
    expect(byText.get('Risk of electric shock.')).toBe('p');
  });

  it('placeholders the measurements and the cross-reference', () => {
    const patterns = new Map(r.units.map((u) => [u.segment.index, u.placeholdered.patternText]));
    expect(patterns.get(4)).toBe('The {{T0:chip.model_name}} operates at {{P0}} and {{P1}}.');
    expect(patterns.get(5)).toBe('Max. capacity is {{P0}}.');
    expect(patterns.get(10)).toBe('{{T0:img}} See Fig. {{P0}} for details.');
  });

  it('does not emit a unit for the data-only power cell', () => {
    // "1450 W" is pure data; "Power" is its translatable header.
    expect(r.units.map((u) => u.segment.rawText)).not.toContain('1450 W');
  });

  it('gives every unit a full key set', () => {
    for (const u of r.units) {
      expect(u.keys.segmentKey).toMatch(/^[0-9a-f]{32}$/);
      expect(u.keys.plainKeyHash).toMatch(/^[0-9a-f]{32}$/);
      expect(u.keys.contextHash).toMatch(/^[0-9a-f]{32}$/);
      expect(u.keys.sourceFingerprint).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('precomputes comparison tokens for the retrieval layer', () => {
    const unit = r.units[1];
    expect(unit.compareTokens.map((t) => t.text)).toEqual([
      'Risk', 'of', 'electric', 'shock', '.',
    ]);
  });

  it('marks every emitted unit translatable', () => {
    expect(translatableUnits(r)).toHaveLength(r.units.length);
  });
});

describe('the identity round trip', () => {
  it('rebuilds byte-identical HTML when every segment is translated to itself', () => {
    const r = build(GOLDEN);
    const translated: TranslatedSegment[] = r.units.map((u) => ({
      segmentIndex: u.segment.index,
      targetKeyText: u.segment.keyText,
      origin: 'engine',
    }));
    const out = reassembleFragment(r.segmented, translated, {
      targetLang: 'de',
      placeholdersBySegment: r.placeholdersBySegment,
    });
    expect(out.ok).toBe(true);
    expect(out.failures).toHaveLength(0);
    expect(out.perSegment.every((p) => p.applied)).toBe(true);
    expect(out.html).toBe(GOLDEN);
  });
});

describe('the mutation round trip', () => {
  it('changes only prose when a stub translator uppercases the words', () => {
    const r = build(GOLDEN);
    // Uppercase letters outside any {{...}} marker: markup, chips and images must
    // survive untouched even though every translatable character changed.
    const shout = (keyText: string): string =>
      keyText
        .split(/(\{\{[^{}]*\}\})/g)
        .map((part, i) => (i % 2 === 1 ? part : part.toUpperCase()))
        .join('');

    const out = reassembleFragment(
      r.segmented,
      r.units.map((u) => ({
        segmentIndex: u.segment.index,
        targetKeyText: shout(u.segment.keyText),
        origin: 'engine' as const,
      })),
      { targetLang: 'de', placeholdersBySegment: r.placeholdersBySegment },
    );

    expect(out.ok).toBe(true);
    expect(out.perSegment.every((p) => p.applied)).toBe(true);
    // Every chip, image and attribute is byte-identical...
    expect(out.html).toContain(
      '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>',
    );
    expect(out.html).toContain('<img src="https://example.test/wiring.png" alt="Wiring">');
    expect(out.html).toContain('data-content="Set%20the%20timer."');
    expect(out.html).toContain('<table class="im-table">');
    // ...while the prose was genuinely replaced.
    expect(out.html).toContain('RISK OF ELECTRIC SHOCK.');
    expect(out.html).not.toContain('Risk of electric shock.');
  });
});

describe('ineligible and empty fragments', () => {
  it('yields no units but still round-trips an ambiguous fragment', () => {
    const html = '<p data-note="a > b">Text here.</p>';
    const r = build(html);
    expect(r.ineligibleReason).toBe('ambiguous_markup');
    expect(r.units).toHaveLength(0);
    const out = reassembleFragment(r.segmented, [], { targetLang: 'de' });
    expect(out.html).toBe(html);
  });

  it('yields no units for content with nothing to translate', () => {
    for (const html of ['', '<p>&nbsp;</p>', '<p>230 V</p>']) {
      expect(build(html).units).toHaveLength(0);
    }
  });
});

describe('cross-fragment reuse', () => {
  it('gives the same key to boilerplate re-authored in a different block', () => {
    const a = build('<p>Do not immerse the appliance in water.</p>');
    const b = buildTmSourceUnits(
      'sec-9#inline:3',
      '<h3>Safety</h3><p>Do not immerse the appliance in water.</p>',
      { sourceLocale: 'en' },
    );
    const bUnit = b.units.find((u) => u.segment.rawText.startsWith('Do not immerse'));
    expect(bUnit?.keys.segmentKey).toBe(a.units[0].keys.segmentKey);
    // The context differs (a heading precedes it in one), which is exactly the
    // distinction between the perfect and the exact tier.
    expect(bUnit?.keys.contextHash).not.toBe(a.units[0].keys.contextHash);
  });
});
