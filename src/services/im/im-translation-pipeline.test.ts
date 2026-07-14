import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai/translation-verbatim.service', () => ({ getTranslationVerbatims: vi.fn(async () => []) }));

import { getTranslationVerbatims } from '../ai/translation-verbatim.service';
import { buildTranslationXliff } from './im-translation-export.service';
import { parseTranslationXliff, applyTranslationImport } from './im-translation-import.service';
import { collectTranslationFragments } from './im-translation-fragments';
import type { IMSection, InlineBlockRef, SharedBlockRef, SKUSlotRef } from '../../types';

const sectionA: IMSection = {
  id: 'sec-a',
  templateId: 't1',
  title: 'Safety',
  order: 0,
  isPlaceholder: false,
  content: {},
  blockRefs: [
    {
      kind: 'inline',
      content: { en: '<p>Fill to the <strong>MAX</strong> line.<span class="im-placeholder" data-id="p1">[X]</span></p>' },
    } as InlineBlockRef,
    { kind: 'block', block_id: 'blk-1' } as SharedBlockRef, // shared — must never become a fragment
    {
      kind: 'sku_slot',
      slot: 'diagram',
      schema: 'rich_text',
      label: { en: 'Diagram label' },
      required: true,
    } as SKUSlotRef,
  ],
};

const sectionB: IMSection = {
  id: 'sec-b',
  templateId: 't1',
  title: 'Cleaning',
  order: 1,
  isPlaceholder: false,
  content: { en: '<p>Legacy-only section content.</p>' },
  blockRefs: [],
};

const sections: IMSection[] = [sectionA, sectionB];
const template = { id: 'tmpl-1', name: 'Coffee Machine IM' };

/** Simulate a translator round-trip that leaves every fragment's text unchanged. */
const fillTargetsWithSource = (xml: string): string =>
  xml.replace(
    /(<trans-unit\b[^>]*>\s*<source>)([\s\S]*?)(<\/source>\s*<target>)<\/target>/g,
    (_m, pre: string, sourceInner: string, mid: string) => `${pre}${sourceInner}${mid}${sourceInner}</target>`,
  );

describe('IM translation export/import pipeline', () => {
  beforeEach(() => {
    vi.mocked(getTranslationVerbatims).mockResolvedValue([]);
  });

  it('skips shared blocks and collects one fragment per translatable field', () => {
    const fragments = collectTranslationFragments(sections);
    expect(fragments.map(f => f.id).sort()).toEqual(
      ['sec-a#inline:0', 'sec-a#sku_label:2', 'sec-a#title', 'sec-b#legacy', 'sec-b#title'].sort(),
    );
  });

  it('builds an XLIFF file, and a translator-filled copy round-trips back onto sections', async () => {
    const xml = await buildTranslationXliff({ template, sections, targetLangs: ['de'], skipExisting: true });
    expect(xml).toBeTruthy();
    expect(xml).toContain('target-language="de"');

    // Untranslated: every target should come back empty.
    const untouched = parseTranslationXliff(xml!);
    expect(untouched.files).toHaveLength(1);
    expect(untouched.files[0].units).toHaveLength(5);
    expect(untouched.files[0].units.every(u => u.html === null && u.warning)).toBe(true);

    const translatedXml = fillTargetsWithSource(xml!);
    const parsed = parseTranslationXliff(translatedXml);
    expect(parsed.errors).toEqual([]);
    expect(parsed.files[0].units.every(u => u.html !== null)).toBe(true);

    const { sections: updated, changedSectionIds, report } = applyTranslationImport(sections, parsed);
    expect(report.ok).toBe(5);
    expect(report.total).toBe(5);
    expect(report.failures).toEqual([]);
    expect(changedSectionIds).toEqual(new Set(['sec-a', 'sec-b']));

    const a = updated.find(s => s.id === 'sec-a')!;
    expect(a.titleI18n?.de).toBe('Safety');
    expect((a.blockRefs![0] as InlineBlockRef).content.de).toBe(
      '<p>Fill to the <strong>MAX</strong> line.<span class="im-placeholder" data-id="p1">[X]</span></p>',
    );
    expect((a.blockRefs![2] as SKUSlotRef).label.de).toBe('Diagram label');
    // The shared block ref is untouched — it was never turned into a fragment.
    expect(a.blockRefs![1]).toEqual({ kind: 'block', block_id: 'blk-1' });

    const b = updated.find(s => s.id === 'sec-b')!;
    expect(b.titleI18n?.de).toBe('Cleaning');
    expect(b.content.de).toBe('<p>Legacy-only section content.</p>');
  });

  it('pre-fills verbatim phrases with the approved target-language wording', async () => {
    vi.mocked(getTranslationVerbatims).mockResolvedValue([
      {
        id: 'v1',
        phrase: 'Do not immerse in water',
        translations: { de: 'Nicht in Wasser tauchen' },
        createdAt: '',
        updatedAt: '',
      },
    ]);
    const withVerbatim: IMSection[] = [
      {
        ...sectionA,
        id: 'sec-c',
        blockRefs: [
          { kind: 'inline', content: { en: '<p>Do not immerse in water</p>' } } as InlineBlockRef,
        ],
      },
    ];
    const xml = await buildTranslationXliff({ template, sections: withVerbatim, targetLangs: ['de'], skipExisting: false });
    expect(xml).toContain('Nicht in Wasser tauchen');
    expect(xml).not.toContain('Do not immerse in water');
  });

  it('skips fragments whose target language already has content when skipExisting is true', async () => {
    const alreadyTranslated: IMSection[] = [
      { ...sectionB, id: 'sec-d', titleI18n: { de: 'Reinigung' }, content: { en: sectionB.content.en, de: 'schon da' } },
    ];
    const xml = await buildTranslationXliff({ template, sections: alreadyTranslated, targetLangs: ['de'], skipExisting: true });
    expect(xml).toBeNull();
  });

  it('flags a fragment id that no longer resolves as a structural-drift failure', () => {
    const parsed = {
      files: [{ targetLang: 'de', units: [{ id: 'sec-a#inline:99', html: '<p>Ghost row</p>' }] }],
      errors: [],
    };
    const { report, changedSectionIds } = applyTranslationImport(sections, parsed);
    expect(report.ok).toBe(0);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].error).toMatch(/structure changed/i);
    expect(changedSectionIds.size).toBe(0);
  });
});
