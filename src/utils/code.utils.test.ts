import { describe, it, expect } from 'vitest';
import { generateNumericCode } from './code.utils';

describe('generateNumericCode', () => {
  it('returns a zero-padded numeric string of the requested length', () => {
    for (const digits of [4, 6, 8]) {
      const code = generateNumericCode(digits);
      expect(code).toHaveLength(digits);
      expect(code).toMatch(/^[0-9]+$/);
    }
  });

  it('always honors the length invariant across many draws (zero-padding short values)', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateNumericCode(6)).toHaveLength(6);
    }
  });
});
