import { describe, it, expect } from 'vitest';
import {
  applyTranslationFragment,
  collectTranslationFragments,
  hasLegacyPositionalIds,
  isLegacyPositionalFragmentId,
  parseTranslationFragmentId,
  readTranslationFragmentValue,
} from './im-translation-fragments';
import type { IMSection } from '../../types';

const inline = (id: string | undefined, en: string) => ({
  kind: 'inline' as const,
  ...(id ? { id } : {}),
  content: { en },
});

const section = (over: Partial<IMSection> = {}): IMSection =>
  ({
    id: 'sec-1',
    templateId: 'tpl-1',
    title: 'Safety',
    order: 0,
    isPlaceholder: false,
    content: {},
    blockRefs: [],
    ...over,
  }) as IMSection;

const TWO_ROWS = [
  section({
    blockRefs: [
      inline('ref-aaa', 'Do not immerse in water.'),
      inline('ref-bbb', 'Wipe with a damp cloth.'),
    ],
  }),
];

describe('collectTranslationFragments', () => {
  it('addresses an inline row by its stable uuid', () => {
    const ids = collectTranslationFragments(TWO_ROWS).map((f) => f.id);
    expect(ids).toEqual(['sec-1#title', 'sec-1#inline:ref:ref-aaa', 'sec-1#inline:ref:ref-bbb']);
  });

  it('falls back to a positional id for a ref that has no uuid yet', () => {
    const sections = [section({ blockRefs: [inline(undefined, 'Unsaved row.')] })];
    expect(collectTranslationFragments(sections).map((f) => f.id)).toContain('sec-1#inline:0');
  });

  it('addresses a sku-slot label by uuid too', () => {
    const sections = [
      section({
        blockRefs: [
          { kind: 'sku_slot', id: 'ref-slot', slot: 'dims', schema: 'rich_text', label: { en: 'Dimensions' }, required: false } as any,
        ],
      }),
    ];
    expect(collectTranslationFragments(sections).map((f) => f.id)).toContain(
      'sec-1#sku_label:ref:ref-slot',
    );
  });

  it('still skips shared library blocks', () => {
    const sections = [
      section({ blockRefs: [{ kind: 'block', id: 'ref-x', block_id: 'blk-1' } as any] }),
    ];
    expect(collectTranslationFragments(sections).map((f) => f.kind)).toEqual(['title']);
  });

  it('reports both the uuid and the display index', () => {
    const f = collectTranslationFragments(TWO_ROWS)[2];
    expect(f.refId).toBe('ref-bbb');
    expect(f.refIndex).toBe(1);
    expect(f.label).toContain('row 2');
  });
});

describe('the reorder corruption this fix exists for', () => {
  it('writes to the row the uuid names, even after the rows are swapped', () => {
    // Export order: [aaa, bbb]. An author then swaps the two rows. Importing the
    // pre-swap file must still put each translation on its own row.
    const exported = collectTranslationFragments(TWO_ROWS);
    const bbbId = exported.find((f) => f.sourceHtml.startsWith('Wipe'))!.id;

    const swapped = [
      section({
        blockRefs: [
          inline('ref-bbb', 'Wipe with a damp cloth.'),
          inline('ref-aaa', 'Do not immerse in water.'),
        ],
      }),
    ];

    const out = applyTranslationFragment(swapped, bbbId, 'de', 'Mit einem feuchten Tuch abwischen.');
    expect(out).not.toBeNull();
    const refs = out![0].blockRefs as any[];
    // The translation landed on the "Wipe" row, which is now at index 0.
    expect(refs[0].content.de).toBe('Mit einem feuchten Tuch abwischen.');
    expect(refs[1].content.de).toBeUndefined();
  });

  it('demonstrates that a legacy positional id CANNOT detect the same swap', () => {
    // Documents the residual risk a pre-upgrade file carries, which is exactly what
    // hasLegacyPositionalIds warns the operator about.
    const swapped = [
      section({
        blockRefs: [
          inline('ref-bbb', 'Wipe with a damp cloth.'),
          inline('ref-aaa', 'Do not immerse in water.'),
        ],
      }),
    ];
    const out = applyTranslationFragment(swapped, 'sec-1#inline:1', 'de', 'Nicht eintauchen.');
    // It resolves, and it resolves to whatever now sits at index 1.
    expect(out).not.toBeNull();
    expect((out![0].blockRefs as any[])[1].content.de).toBe('Nicht eintauchen.');
  });

  it('returns null when the addressed row was deleted', () => {
    const withoutBbb = [section({ blockRefs: [inline('ref-aaa', 'Do not immerse in water.')] })];
    expect(applyTranslationFragment(withoutBbb, 'sec-1#inline:ref:ref-bbb', 'de', 'x')).toBeNull();
  });

  it('returns null when the addressed row changed kind', () => {
    const retyped = [
      section({
        blockRefs: [
          { kind: 'sku_slot', id: 'ref-aaa', slot: 's', schema: 'rich_text', label: { en: 'L' }, required: false } as any,
        ],
      }),
    ];
    expect(applyTranslationFragment(retyped, 'sec-1#inline:ref:ref-aaa', 'de', 'x')).toBeNull();
  });
});

describe('applyTranslationFragment', () => {
  it('does not mutate the input sections', () => {
    const before = JSON.stringify(TWO_ROWS);
    applyTranslationFragment(TWO_ROWS, 'sec-1#inline:ref:ref-aaa', 'de', 'Nicht eintauchen.');
    expect(JSON.stringify(TWO_ROWS)).toBe(before);
  });

  it('writes a section title into titleI18n', () => {
    const out = applyTranslationFragment(TWO_ROWS, 'sec-1#title', 'de', 'Sicherheit');
    expect(out![0].titleI18n?.de).toBe('Sicherheit');
  });

  it('writes legacy section content', () => {
    const legacy = [section({ blockRefs: [], content: { en: '<p>Old.</p>' } })];
    const out = applyTranslationFragment(legacy, 'sec-1#legacy', 'de', '<p>Alt.</p>');
    expect(out![0].content.de).toBe('<p>Alt.</p>');
  });

  it('returns null for an unknown section', () => {
    expect(applyTranslationFragment(TWO_ROWS, 'sec-9#title', 'de', 'x')).toBeNull();
  });

  it.each(['', 'no-hash', '#title', 'sec-1#bogus', 'sec-1#inline', 'sec-1#inline:x', 'sec-1#title:1'])(
    'returns null for the malformed id %s',
    (id) => {
      expect(applyTranslationFragment(TWO_ROWS, id, 'de', 'x')).toBeNull();
    },
  );
});

describe('readTranslationFragmentValue', () => {
  it('reads the current target value by uuid', () => {
    const sections = [
      section({
        blockRefs: [
          { kind: 'inline', id: 'ref-aaa', content: { en: 'A', de: 'Bestehend' } } as any,
        ],
      }),
    ];
    expect(readTranslationFragmentValue(sections, 'sec-1#inline:ref:ref-aaa', 'de')).toBe('Bestehend');
  });

  it('returns null for a blank slot and for an unresolvable id', () => {
    expect(readTranslationFragmentValue(TWO_ROWS, 'sec-1#inline:ref:ref-aaa', 'de')).toBeNull();
    expect(readTranslationFragmentValue(TWO_ROWS, 'sec-1#inline:ref:nope', 'de')).toBeNull();
  });
});

describe('parseTranslationFragmentId', () => {
  it.each([
    ['sec-1#title', { sectionId: 'sec-1', kind: 'title' }],
    ['sec-1#legacy', { sectionId: 'sec-1', kind: 'legacy' }],
    ['sec-1#inline:ref:abc', { sectionId: 'sec-1', kind: 'inline', refId: 'abc' }],
    ['sec-1#sku_label:ref:abc', { sectionId: 'sec-1', kind: 'sku_label', refId: 'abc' }],
    ['sec-1#inline:2', { sectionId: 'sec-1', kind: 'inline', refIndex: 2 }],
  ])('parses %s', (id, expected) => {
    expect(parseTranslationFragmentId(id)).toEqual(expected);
  });

  it('keeps a section id containing a hash intact up to the first hash only', () => {
    expect(parseTranslationFragmentId('sec-1#inline:ref:a#b')?.refId).toBe('a#b');
  });
});

describe('legacy detection', () => {
  it('flags only positional ref ids', () => {
    expect(isLegacyPositionalFragmentId('sec-1#inline:0')).toBe(true);
    expect(isLegacyPositionalFragmentId('sec-1#sku_label:3')).toBe(true);
    expect(isLegacyPositionalFragmentId('sec-1#inline:ref:abc')).toBe(false);
    // Titles and legacy content are inherently stable — they address no row.
    expect(isLegacyPositionalFragmentId('sec-1#title')).toBe(false);
    expect(isLegacyPositionalFragmentId('sec-1#legacy')).toBe(false);
  });

  it('detects a pre-upgrade file from its unit ids', () => {
    expect(hasLegacyPositionalIds(['sec-1#title', 'sec-1#inline:0'])).toBe(true);
    expect(hasLegacyPositionalIds(['sec-1#title', 'sec-1#inline:ref:abc'])).toBe(false);
    expect(hasLegacyPositionalIds([])).toBe(false);
  });
});
