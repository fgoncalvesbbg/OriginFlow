import { describe, it, expect } from 'vitest';
import { enSourceHash, markTranslatedFromEn, translationStaleAgainstEn, EN_SRC_MARK_RE } from './im-translation-marker';

describe('im-translation-marker', () => {
  it('marks a translation with the EN source hash and detects freshness', () => {
    const en = '<p>Do not immerse the appliance in water.</p>';
    const de = markTranslatedFromEn('<p>Das Gerät nicht in Wasser tauchen.</p>', en);
    expect(de).toMatch(EN_SRC_MARK_RE);
    expect(translationStaleAgainstEn(en, de)).toBe(false);
  });

  it('flags the translation as stale once the EN source changes', () => {
    const en = '<p>Do not immerse the appliance in water.</p>';
    const de = markTranslatedFromEn('<p>Das Gerät nicht in Wasser tauchen.</p>', en);
    expect(translationStaleAgainstEn('<p>Never immerse the appliance.</p>', de)).toBe(true);
  });

  it('never flags unmarked (human-written or imported) content', () => {
    expect(translationStaleAgainstEn('<p>anything</p>', '<p>Handgeschrieben.</p>')).toBe(false);
    expect(translationStaleAgainstEn('<p>anything</p>', undefined)).toBe(false);
  });

  it('hashes deterministically', () => {
    expect(enSourceHash('abc')).toBe(enSourceHash('abc'));
    expect(enSourceHash('abc')).not.toBe(enSourceHash('abd'));
  });
});
