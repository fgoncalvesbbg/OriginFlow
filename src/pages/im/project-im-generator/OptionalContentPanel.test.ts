import { describe, it, expect } from 'vitest';
import { modeOf } from './OptionalContentPanel';

describe('modeOf', () => {
  it('maps an absent override to Auto', () => {
    expect(modeOf(undefined)).toBe('auto');
  });

  it('maps an explicit choice to Include or Exclude', () => {
    expect(modeOf(true)).toBe('include');
    expect(modeOf(false)).toBe('exclude');
  });

  /**
   * The bug this guards: `false` is a legitimate override meaning "force out", so any
   * truthiness check would collapse it into Auto and silently drop the PM's decision.
   */
  it('does not confuse a forced Exclude with Auto', () => {
    expect(modeOf(false)).not.toBe(modeOf(undefined));
  });
});
