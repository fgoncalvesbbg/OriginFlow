import { describe, expect, it } from 'vitest';
import { flagEnabled } from './feature-flags';

describe('flagEnabled', () => {
  it('accepts "true" in any casing', () => {
    // The regression this guards: a VITE_..._ENABLED=TRUE in an env file silently
    // disabled the whole feature under a strict === 'true' check.
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
