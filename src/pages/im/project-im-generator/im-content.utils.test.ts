import { describe, it, expect } from 'vitest';
import { escapeXml, getTokensInFragment, matchesConditionValue, refHasCondition } from './im-content.utils';
import type { CategoryAttribute, BlockRef } from '../../../types';

const attr = (dataType: CategoryAttribute['dataType']): CategoryAttribute => ({ dataType } as CategoryAttribute);

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`<a href="x" id='y'> & </a>`))
      .toBe('&lt;a href=&quot;x&quot; id=&apos;y&apos;&gt; &amp; &lt;/a&gt;');
  });

  it('returns an empty string for empty/undefined input', () => {
    expect(escapeXml('')).toBe('');
    expect(escapeXml(undefined as unknown as string)).toBe('');
  });

  it('leaves safe text unchanged', () => {
    expect(escapeXml('hello world 123')).toBe('hello world 123');
  });
});

describe('getTokensInFragment', () => {
  it('extracts trimmed {{ token }} names in order', () => {
    expect(getTokensInFragment('<p>{{ name }} and {{sku_code}}</p>')).toEqual(['name', 'sku_code']);
  });

  it('returns [] when there are no tokens', () => {
    expect(getTokensInFragment('<p>plain text</p>')).toEqual([]);
  });
});

describe('matchesConditionValue', () => {
  it('matches booleans against Yes/No', () => {
    expect(matchesConditionValue('true', 'Yes', attr('boolean'))).toBe(true);
    expect(matchesConditionValue('false', 'No', attr('boolean'))).toBe(true);
    expect(matchesConditionValue('true', 'No', attr('boolean'))).toBe(false);
  });

  it('matches enum membership from a comma list', () => {
    expect(matchesConditionValue('Red', 'Red, Blue, Green', attr('enum'))).toBe(true);
    expect(matchesConditionValue('Pink', 'Red, Blue', attr('enum'))).toBe(false);
  });

  it('matches numeric ranges and exact values', () => {
    expect(matchesConditionValue('5', '1 - 10', attr('integer'))).toBe(true);
    expect(matchesConditionValue('11', '1 - 10', attr('integer'))).toBe(false);
    expect(matchesConditionValue('5', '5', attr('decimal'))).toBe(true);
    expect(matchesConditionValue('abc', '1-10', attr('integer'))).toBe(false);
  });

  it('matches text case-insensitively', () => {
    expect(matchesConditionValue('Hello', 'hello', attr('text'))).toBe(true);
    expect(matchesConditionValue('Hello', 'world', attr('text'))).toBe(false);
  });
});

describe('refHasCondition', () => {
  it('is true when a ref requires a feature (present or absent)', () => {
    expect(refHasCondition({ kind: 'block', requires_feature: 'f1' } as unknown as BlockRef)).toBe(true);
    expect(refHasCondition({ kind: 'inline', requires_feature_absent: 'f2' } as unknown as BlockRef)).toBe(true);
  });

  it('is false for sku_slot refs and refs without a condition', () => {
    expect(refHasCondition({ kind: 'sku_slot', requires_feature: 'f' } as unknown as BlockRef)).toBe(false);
    expect(refHasCondition({ kind: 'block' } as unknown as BlockRef)).toBe(false);
  });
});
