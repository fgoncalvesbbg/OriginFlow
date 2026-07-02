import { describe, it, expect } from 'vitest';
import { freeze, thaw, hasProse, countTokens } from './im-chip-freeze';

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
