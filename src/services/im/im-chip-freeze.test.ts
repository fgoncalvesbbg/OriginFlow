import { describe, it, expect } from 'vitest';
import { freeze, freezeVerbatims, thaw, hasProse, countTokens } from './im-chip-freeze';

// Real chip HTML shapes taken from im_sections content in the DB.
const PLACEHOLDER = `<p><strong>Technical Data</strong></p><td>Power Supply</td><td>&nbsp;<span class="im-placeholder bg-amber-100 border-yellow-300 text-amber-800 border px-2 py-0.5 rounded text-xs font-bold select-none mx-1" contenteditable="false" data-type="text" data-id="b2c73541" data-attr-id="b2c73541" data-label="Voltage%20Range">[Voltage Range [V / Hz]]</span>&nbsp;</td>`;

// Condition chip nests an inner <span> — the scanner must match the OUTER close.
const CONDITION = `<p>Optional note: &nbsp;<span class="im-condition bg-purple-50 border-indigo-300 text-purple-800 border border-dashed px-2 py-1 rounded text-sm mx-1" contenteditable="false" data-id="x1" data-feature-id="manual" data-content="foo%20bar" data-feature-name="" title="Condition: Optional"><span class="font-bold text-xs uppercase mr-1">[Optional]</span> foo bar...</span>&nbsp; keep translating this tail.</p>`;

const WITH_IMG = `<ul><li>Upright for <strong>4 hours</strong>.</li></ul><img src="https://x/y.png" alt="Front view" style="max-width:100%;height:auto;" />`;

const CHIP_ONLY = `<p>&nbsp;<span class="im-placeholder" contenteditable="false" data-id="__sku" data-label="SKU">[SKU]</span>&nbsp;</p>`;

describe('im-chip-freeze', () => {
  it('round-trips placeholder chips exactly and hides them from prose', () => {
    const { text, frozen } = freeze(PLACEHOLDER);
    expect(thaw(text, frozen)).toBe(PLACEHOLDER);
    expect(countTokens(text)).toBe(1);
    expect(text).not.toMatch(/im-placeholder/);
    expect(text).not.toMatch(/data-id/);
    expect(hasProse(text)).toBe(true); // "Technical Data", "Power Supply"
  });

  it('handles NESTED condition chips (matches the outer </span>) and keeps the tail translatable', () => {
    const { text, frozen } = freeze(CONDITION);
    expect(thaw(text, frozen)).toBe(CONDITION);
    expect(countTokens(text)).toBe(1);
    expect(text).not.toMatch(/im-condition/);
    // The prose after the chip must remain (proves we didn't over-consume).
    expect(text).toMatch(/keep translating this tail/);
    expect(hasProse(text)).toBe(true);
  });

  it('freezes <img> tags whole', () => {
    const { text, frozen } = freeze(WITH_IMG);
    expect(thaw(text, frozen)).toBe(WITH_IMG);
    expect(text).not.toMatch(/<img/);
    expect(text).toMatch(/Upright for/);
  });

  it('reports no prose for a chip-only fragment (so no API call is made)', () => {
    const { text, frozen } = freeze(CHIP_ONLY);
    expect(thaw(text, frozen)).toBe(CHIP_ONLY);
    expect(hasProse(text)).toBe(false);
  });

  it('preserves condition chip attribute ORDER (resolver depends on it)', () => {
    const { frozen } = freeze(CONDITION);
    // The frozen fragment is verbatim, so data-feature-id … data-content order is intact.
    expect(frozen[0].indexOf('data-feature-id')).toBeLessThan(frozen[0].indexOf('data-content'));
  });
});

describe('freezeVerbatims — regulation phrases use stored official wording', () => {
  const v = (phrase: string, replacement?: string) => ({ phrase, replacement });

  it('freezes an exact match and thaws it back byte-identical when no translation is stored', () => {
    const fh = freeze('<p>Complies with (EU) 2019/2016 requirements.</p>');
    const out = freezeVerbatims(fh, [v('(EU) 2019/2016')]);
    expect(out.text).not.toContain('(EU) 2019/2016');
    expect(countTokens(out.text)).toBe(1);
    expect(thaw(out.text, out.frozen)).toBe('<p>Complies with (EU) 2019/2016 requirements.</p>');
  });

  it('thaws a match back as the STORED translation for the target language', () => {
    const fh = freeze('<p>Keep out of reach of children.</p>');
    const out = freezeVerbatims(fh, [v('Keep out of reach of children.', 'Außerhalb der Reichweite von Kindern aufbewahren.')]);
    expect(out.text).not.toContain('Keep out of reach');
    expect(thaw(out.text, out.frozen)).toBe('<p>Außerhalb der Reichweite von Kindern aufbewahren.</p>');
  });

  it('a blank stored translation falls back to keeping the source phrase', () => {
    const fh = freeze('<p>See EN 60335 for details.</p>');
    const out = freezeVerbatims(fh, [v('EN 60335', '  ')]);
    expect(thaw(out.text, out.frozen)).toBe('<p>See EN 60335 for details.</p>');
  });

  it('replaces every occurrence of a phrase with the stored wording', () => {
    const fh = freeze('<p>EN 60335 applies. See EN 60335 for details.</p>');
    const out = freezeVerbatims(fh, [v('EN 60335', 'EN 60335-1')]);
    expect(countTokens(out.text)).toBe(2);
    expect(thaw(out.text, out.frozen)).toBe('<p>EN 60335-1 applies. See EN 60335-1 for details.</p>');
  });

  it('matches longest phrase first so a shorter overlap cannot split it', () => {
    const fh = freeze('<p>Regulation (EU) 2019/2016 of the Commission</p>');
    const out = freezeVerbatims(fh, [v('(EU) 2019/2016'), v('Regulation (EU) 2019/2016')]);
    // The longer phrase wins; the shorter one finds nothing left to match.
    expect(countTokens(out.text)).toBe(1);
    expect(thaw(out.text, out.frozen)).toBe('<p>Regulation (EU) 2019/2016 of the Commission</p>');
  });

  it('never matches inside HTML tags', () => {
    const html = '<p class="EN 60335">EN 60335</p>';
    const out = freezeVerbatims(freeze(html), [v('EN 60335')]);
    // Only the prose occurrence is frozen; the attribute stays literal.
    expect(countTokens(out.text)).toBe(1);
    expect(out.text).toContain('class="EN 60335"');
    expect(thaw(out.text, out.frozen)).toBe(html);
  });

  it('never matches inside existing chip tokens and preserves chips through thaw', () => {
    const html = '<p>Power: <span class="im-placeholder" data-id="watts">[EN 60335]</span> per EN 60335.</p>';
    const fh = freeze(html); // the chip becomes {{FRZ_0}}
    expect(countTokens(fh.text)).toBe(1);
    const out = freezeVerbatims(fh, [v('EN 60335')]);
    expect(countTokens(out.text)).toBe(2); // chip + one prose match only
    expect(thaw(out.text, out.frozen)).toBe(html);
  });

  it('a later shorter phrase cannot match inside a freshly minted token', () => {
    // "0" would otherwise match the digits inside a "{{FRZ_10}}"-style token.
    const fh = freeze('<p>Value 2019/2016 and 0 more.</p>');
    const out = freezeVerbatims(fh, [v('2019/2016'), v('0')]);
    expect(thaw(out.text, out.frozen)).toBe('<p>Value 2019/2016 and 0 more.</p>');
  });

  it('is a no-op for empty entry lists and blank phrases', () => {
    const fh = freeze('<p>Nothing to protect.</p>');
    expect(freezeVerbatims(fh, [])).toEqual(fh);
    expect(freezeVerbatims(fh, [v(''), v('  ')])).toEqual(fh);
  });
});
