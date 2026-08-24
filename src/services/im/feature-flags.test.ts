import { describe, expect, it } from 'vitest';
import { flagEnabled } from './feature-flags';

describe('flagEnabled', () => {
  it('accepts "true" in any casing', () => {
    // The regression this guards: VITE_MARKUP_REVIEW_ENABLED=TRUE silently
    // disabled the whole Markup.io review feature under a strict === 'true'.
    for (const v of ['true', 'TRUE', 'True', 'tRuE']) {
      expect(flagEnabled(v), v).toBe(true);
    }
  });

  it('ignores surrounding whitespace', () => {
    expect(flagEnabled('  true  ')).toBe(true);
    expect(flagEnabled('\ttrue\n')).toBe(true);
  });

  it('is false for anything that is not "true"', () => {
    for (const v of ['false', 'FALSE', '', '1', 'yes', 'on', 'truthy', 'no']) {
      expect(flagEnabled(v), v).toBe(false);
    }
  });

  it('is false when the variable is unset', () => {
    expect(flagEnabled(undefined)).toBe(false);
  });
});
