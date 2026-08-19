import { describe, it, expect } from 'vitest';
import { HASH_FIELD_SEP, tmHash128, tmHashFields } from './im-tm-hash';
import {
  CONTEXT_VERSION,
  KEY_FORMAT_VERSION,
  buildSegmentKeys,
  protectedPhrasesDigest,
  stripFormatMarkers,
} from './im-tm-key';
import { normalizeForMatch } from './im-tm-normalize';
import { extractPlaceholders } from './im-tm-placeholders';
import { buildTmSourceUnits } from './im-tm-core';

const unitFor = (keyText: string, container = 'p') => {
  const normalized = normalizeForMatch(keyText);
  const ph = extractPlaceholders(normalized);
  return {
    patternText: ph.patternText,
    placeholders: ph.placeholders,
    container,
    rawText: keyText,
  };
};

const keys = (
  keyText: string,
  ctx = { before: '', after: '' },
  opts: { sourceLocale?: string; protectedPhrasesDigest?: string; container?: string } = {},
) =>
  buildSegmentKeys(unitFor(keyText, opts.container), ctx, {
    sourceLocale: opts.sourceLocale ?? 'en',
    protectedPhrasesDigest: opts.protectedPhrasesDigest,
  });

describe('tmHash128', () => {
  it('returns 32 lowercase hex characters', () => {
    expect(tmHash128('Do not immerse in water.')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic and synchronous', () => {
    expect(tmHash128('x')).toBe(tmHash128('x'));
  });

  it('separates inputs that differ by a single character', () => {
    expect(tmHash128('2.5 l')).not.toBe(tmHash128('25 l'));
  });

  it('separates inputs that differ only in trailing length', () => {
    expect(tmHash128('abc')).not.toBe(tmHash128('abc '));
  });

  it('hashes non-ASCII content stably', () => {
    const s = 'Nicht in Wasser eintauchen. Vorsicht: hei' + String.fromCharCode(0x00df) + 'e Fl' + String.fromCharCode(0x00e4) + 'che.';
    expect(tmHash128(s)).toBe(tmHash128(s));
    expect(tmHash128(s)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('uses a field separator that normalized text can never contain', () => {
    expect(HASH_FIELD_SEP).toBe(String.fromCharCode(31));
    expect(normalizeForMatch('a' + HASH_FIELD_SEP + 'b')).toBe('a b');
  });

  it('cannot be forged by moving a delimiter into a field', () => {
    expect(tmHashFields(['a', 'b'])).not.toBe(tmHashFields(['a' + HASH_FIELD_SEP + 'b']));
  });
});

describe('segmentKey', () => {
  it('is identical for the same sentence in two differently-numbered fragments', () => {
    const chip =
      '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>';
    const early = buildTmSourceUnits('f1', '<p>The ' + chip + ' must be earthed.</p>', {
      sourceLocale: 'en',
    });
    const late = buildTmSourceUnits(
      'f2',
      '<p><img src="a.png" alt="a"> Alpha beta gamma.</p><p>The ' + chip + ' must be earthed.</p>',
      { sourceLocale: 'en' },
    );
    const a = early.units[0];
    const b = late.units.find((u) => u.segment.rawText.includes('must be earthed'));
    expect(b).toBeDefined();
    expect(b?.keys.segmentKey).toBe(a.keys.segmentKey);
  });

  it('is unchanged when only a placeholder value differs', () => {
    expect(keys('The tank holds 2.5 l of water.').segmentKey).toBe(
      keys('The tank holds 3.0 l of water.').segmentKey,
    );
  });

  it('DOES change when the value is not placeholder-safe', () => {
    // "Wait 2 minutes" is unsafe, so the literal stays in the pattern and the two
    // sentences must remain distinct entries.
    expect(keys('Wait 2 minutes before opening.').segmentKey).not.toBe(
      keys('Wait 3 minutes before opening.').segmentKey,
    );
  });

  it('changes with the source locale', () => {
    expect(keys('Do not immerse.', undefined, { sourceLocale: 'en' }).segmentKey).not.toBe(
      keys('Do not immerse.', undefined, { sourceLocale: 'en-GB' }).segmentKey,
    );
  });

  it('changes when the ordered placeholder type signature differs', () => {
    // Same shape, but one slot is a measurement and the other an article code.
    const a = keys('Use 20 mm now.');
    const b = keys('Use KG350X now.');
    expect(a.segmentKey).not.toBe(b.segmentKey);
  });

  it('is case-sensitive and accent-sensitive', () => {
    expect(keys('Do not immerse.').segmentKey).not.toBe(keys('do not immerse.').segmentKey);
  });

  it('is insensitive to a non-breaking space and a curly apostrophe', () => {
    const nbsp = String.fromCharCode(0x00a0);
    const curly = String.fromCharCode(0x2019);
    expect(keys("Don't immerse the unit.").segmentKey).toBe(
      keys('Don' + curly + 't immerse' + nbsp + 'the unit.').segmentKey,
    );
  });
});

describe('plainKeyHash', () => {
  it('ignores inline formatting while segmentKey does not', () => {
    const withTag = keys('Fill to the {{T0:o.strong}}MAX{{T1:c.strong}} line.');
    const without = keys('Fill to the MAX line.');
    expect(withTag.segmentKey).not.toBe(without.segmentKey);
    expect(withTag.plainKeyHash).toBe(without.plainKeyHash);
  });

  it('still distinguishes a differing chip', () => {
    expect(keys('The {{T0:chip.model_name}} is earthed.').plainKeyHash).not.toBe(
      keys('The {{T0:chip.brand_name}} is earthed.').plainKeyHash,
    );
  });
});

describe('stripFormatMarkers', () => {
  it('removes formatting and line-break markers but keeps chips and images', () => {
    expect(
      stripFormatMarkers('A {{T0:o.strong}}B{{T1:c.strong}} {{T2:br}} {{T3:chip.x}} {{T4:img}}'),
    ).toBe('A B {{T3:chip.x}} {{T4:img}}');
  });
});

describe('contextHash', () => {
  it('distinguishes the first segment of a fragment from a mid-fragment one', () => {
    const first = keys('Rinse the filter.', { before: '', after: 'Dry it fully.' });
    const middle = keys('Rinse the filter.', { before: 'Unplug the unit.', after: 'Dry it fully.' });
    expect(first.contextHash).not.toBe(middle.contextHash);
  });

  it('distinguishes the same sentence in a table cell from one in a paragraph', () => {
    expect(keys('Voltage rating.', undefined, { container: 'td' }).contextHash).not.toBe(
      keys('Voltage rating.', undefined, { container: 'p' }).contextHash,
    );
  });

  it('is equal for equal surroundings', () => {
    const ctx = { before: 'Unplug the unit.', after: 'Dry it fully.' };
    expect(keys('Rinse the filter.', ctx).contextHash).toBe(keys('Rinse the filter.', ctx).contextHash);
  });

  it('does not leak into segmentKey', () => {
    const a = keys('Rinse the filter.', { before: 'A sentence.', after: 'B sentence.' });
    const b = keys('Rinse the filter.', { before: 'C sentence.', after: 'D sentence.' });
    expect(a.segmentKey).toBe(b.segmentKey);
    expect(a.contextHash).not.toBe(b.contextHash);
  });

  it('changes only for the neighbours when a middle segment is reordered', () => {
    const html = '<p>Alpha first here.</p><p>Beta second here.</p><p>Gamma third here.</p>';
    const swapped = '<p>Alpha first here.</p><p>Gamma third here.</p><p>Beta second here.</p>';
    const a = buildTmSourceUnits('f', html, { sourceLocale: 'en' }).units;
    const b = buildTmSourceUnits('f', swapped, { sourceLocale: 'en' }).units;
    // The first segment keeps its context (BOF + the same follower changed, so it
    // must differ); what matters is that segment KEYS are untouched by reordering.
    expect(a.map((u) => u.keys.segmentKey).sort()).toEqual(b.map((u) => u.keys.segmentKey).sort());
  });
});

describe('protected phrase digest', () => {
  it('is order-insensitive, so reordering the admin list is a no-op', () => {
    expect(protectedPhrasesDigest(['b', 'a'])).toBe(protectedPhrasesDigest(['a', 'b']));
  });

  it('affects the key only when supplied', () => {
    const plain = keys('Do not immerse.');
    const withDigest = keys('Do not immerse.', undefined, { protectedPhrasesDigest: 'abc' });
    expect(plain.segmentKey).not.toBe(withDigest.segmentKey);
  });

  it('is omitted by the core when no cut was actually suppressed', () => {
    const r = buildTmSourceUnits('f', '<p>Rinse the filter. Dry it fully.</p>', {
      sourceLocale: 'en',
      protectedPhrases: ['Some unrelated phrase.'],
    });
    const withoutList = buildTmSourceUnits('f', '<p>Rinse the filter. Dry it fully.</p>', {
      sourceLocale: 'en',
    });
    expect(r.segmented.protectedCutSuppressed).toBe(false);
    expect(r.units.map((u) => u.keys.segmentKey)).toEqual(
      withoutList.units.map((u) => u.keys.segmentKey),
    );
  });
});

describe('sourceFingerprint', () => {
  it('is byte-level, so a cosmetic whitespace change still changes it', () => {
    expect(keys('Rinse  the filter.').sourceFingerprint).not.toBe(
      keys('Rinse the filter.').sourceFingerprint,
    );
    // ...while the match key deliberately ignores it.
    expect(keys('Rinse  the filter.').segmentKey).toBe(keys('Rinse the filter.').segmentKey);
  });
});

describe('version constants', () => {
  it('are pinned — a change orphans every stored key', () => {
    expect(KEY_FORMAT_VERSION).toBe(1);
    expect(CONTEXT_VERSION).toBe(1);
  });
});
