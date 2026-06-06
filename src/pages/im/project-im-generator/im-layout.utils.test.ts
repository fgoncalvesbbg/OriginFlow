import { describe, it, expect } from 'vitest';
import { getBackgroundStyle, joinAttrValues, DEFAULT_MASTER_PAGES } from './im-layout.utils';
import type { IMMasterPageOverride } from '../../../types';

const override = (background: string): IMMasterPageOverride => ({ background } as IMMasterPageOverride);

describe('getBackgroundStyle', () => {
  it('returns undefined when there is no background', () => {
    expect(getBackgroundStyle(undefined)).toBeUndefined();
    expect(getBackgroundStyle(override('   '))).toBeUndefined();
  });

  it('returns a backgroundColor for a plain value', () => {
    expect(getBackgroundStyle(override('#ffffff'))).toEqual({ backgroundColor: '#ffffff' });
  });

  it('wraps URLs in url(...) with cover sizing', () => {
    expect(getBackgroundStyle(override('https://cdn/x.png'))).toEqual({
      backgroundImage: 'url(https://cdn/x.png)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    });
  });

  it('keeps gradient values in the background image', () => {
    const style = getBackgroundStyle(override('linear-gradient(red, blue)'));
    expect(style?.backgroundImage).toContain('gradient');
  });
});

describe('joinAttrValues', () => {
  it('joins non-empty values in order, separated by a space', () => {
    expect(joinAttrValues(['a', 'b', 'c'], { a: 'x', b: '   ', c: 'z' })).toBe('x z');
  });

  it('returns an empty string when nothing resolves', () => {
    expect(joinAttrValues(['a', 'b'], {})).toBe('');
  });
});

describe('DEFAULT_MASTER_PAGES', () => {
  it('defines an empty override for every layout slot', () => {
    expect(Object.keys(DEFAULT_MASTER_PAGES).sort()).toEqual(['appendix', 'body', 'chapter', 'cover', 'end']);
  });
});
