import { describe, it, expect } from 'vitest';
import { countInHtml, replaceInHtml, findInTemplate, applyReplacements } from './im-find-replace';
import type { IMSection, InlineBlockRef } from '../../types';

const CHIP = '<span class="im-placeholder" data-id="p1" data-attr-id="a1">EN 60335</span>';

describe('replaceInHtml (chip/tag safety)', () => {
  it('replaces prose occurrences and reports the count', () => {
    const r = replaceInHtml('<p>EN 60335 applies. See EN 60335.</p>', 'EN 60335', 'EN 60335-1', true);
    expect(r.replaced).toBe(2);
    expect(r.html).toBe('<p>EN 60335-1 applies. See EN 60335-1.</p>');
  });

  it('never touches text inside placeholder/condition chips', () => {
    const html = `<p>${CHIP} but prose EN 60335 changes.</p>`;
    const r = replaceInHtml(html, 'EN 60335', 'EN 62233', true);
    expect(r.replaced).toBe(1);
    expect(r.html).toContain(CHIP); // chip byte-identical
    expect(r.html).toContain('prose EN 62233 changes');
  });

  it('never touches tag attributes', () => {
    const html = '<img src="https://x.test/EN 60335.png" alt="EN 60335"><p>EN 60335</p>';
    const r = replaceInHtml(html, 'EN 60335', 'X', true);
    expect(r.replaced).toBe(1);
    expect(r.html).toContain('src="https://x.test/EN 60335.png"');
    expect(r.html).toContain('alt="EN 60335"');
    expect(r.html).toContain('<p>X</p>');
  });

  it('does not match across a tag boundary (deliberate)', () => {
    const r = replaceInHtml('<p>foo</p><p>bar</p>', 'foobar', 'X', true);
    expect(r.replaced).toBe(0);
  });

  it('honors case sensitivity both ways', () => {
    expect(replaceInHtml('<p>Warning warning</p>', 'warning', 'W', true).replaced).toBe(1);
    expect(replaceInHtml('<p>Warning warning</p>', 'warning', 'W', false).replaced).toBe(2);
  });

  it('escapes regex metacharacters in the query', () => {
    const r = replaceInHtml('<p>(EU) 2019/2016 applies.</p>', '(EU) 2019/2016', '(EU) 2023/999', true);
    expect(r.replaced).toBe(1);
    expect(r.html).toContain('(EU) 2023/999 applies.');
  });

  it('countInHtml agrees with replaceInHtml', () => {
    const html = `<p>${CHIP} EN 60335 and EN 60335</p>`;
    expect(countInHtml(html, 'EN 60335', true)).toBe(2);
  });
});

const section = (over: Partial<IMSection>): IMSection => ({
  id: 's1', templateId: 't1', title: 'Safety', order: 0, isPlaceholder: false,
  content: {}, blockRefs: [], ...over,
} as IMSection);

describe('findInTemplate / applyReplacements', () => {
  const inlineRef = (content: Record<string, string>): InlineBlockRef =>
    ({ kind: 'inline', content } as InlineBlockRef);

  it('finds matches in inline rows, titles, and shared blocks (blocks read-only)', () => {
    const sections = [section({
      title: 'Cleaning the filter',
      blockRefs: [
        inlineRef({ en: '<p>Clean the filter monthly.</p>', de: '<p>Filter reinigen.</p>' }),
        { kind: 'block', block_id: 'b1' } as never,
      ],
    })];
    const blocksById = { b1: { id: 'b1', title: 'Warnings', content: { en: '<p>filter warning</p>' } } as never };
    const matches = findInTemplate(sections, blocksById, ['en', 'de'], 'filter', false);
    const kinds = matches.map((m) => `${m.target.kind}:${m.language}`).sort();
    // Case-insensitive "filter" also matches German "Filter" in the DE inline row.
    expect(kinds).toEqual(['block:en', 'inline:de', 'inline:en', 'title:en']);
    expect(matches.find((m) => m.target.kind === 'block')!.replaceable).toBe(false);
  });

  it('applies replacement only to selected rows and keeps untouched sections by reference', () => {
    const s1 = section({ id: 's1', blockRefs: [inlineRef({ en: '<p>old term here</p>' })] });
    const s2 = section({ id: 's2', title: 'Other', blockRefs: [inlineRef({ en: '<p>old term there</p>' })] });
    const matches = findInTemplate([s1, s2], {}, ['en'], 'old term', true);
    const onlyS1 = matches.filter((m) => m.sectionId === 's1');
    const result = applyReplacements([s1, s2], onlyS1, 'old term', 'new term', true);
    expect(result.replaced).toBe(1);
    expect((result.sections[0].blockRefs![0] as InlineBlockRef).content.en).toContain('new term here');
    expect(result.sections[1]).toBe(s2); // untouched by reference → not marked dirty
  });

  it('English title replacement updates BOTH title and titleI18n.en; other languages only titleI18n', () => {
    const s = section({ title: 'Old name', titleI18n: { en: 'Old name', de: 'Alter Name' } });
    const matches = findInTemplate([s], {}, ['en', 'de'], 'Old name', true)
      .concat(findInTemplate([s], {}, ['de'], 'Alter Name', true));
    const result = applyReplacements([s], matches.filter((m) => m.target.kind === 'title'), 'Old name', 'New name', true);
    const out = result.sections[0];
    expect(out.title).toBe('New name');
    expect(out.titleI18n?.en).toBe('New name');
    // DE row searched for a different query — replacement of 'Old name' finds nothing in DE.
    expect(out.titleI18n?.de).toBe('Alter Name');
  });
});
