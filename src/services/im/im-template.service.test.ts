import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks the DATABASE PORT (template lookups + insert) and the section service
// (source read + clone writes) so duplicateIMTemplate's remapping logic — the
// part that can silently corrupt a clone — is what's under test.
const { templateRows, insertedTemplates, sourceSections, savedSections } = vi.hoisted(() => ({
  templateRows: { current: [] as any[] },
  insertedTemplates: [] as any[],
  sourceSections: { current: [] as any[] },
  savedSections: [] as any[],
}));

vi.mock('../../data', () => ({
  db: {
    selectMaybeOne: vi.fn((_table: string, opts: any) => {
      const w = opts?.where ?? {};
      const row = templateRows.current.find((t) =>
        (w.id && t.id === w.id) ||
        (w.category_id && t.category_id === w.category_id && t.template_type === w.template_type));
      return Promise.resolve(row ?? null);
    }),
    insert: vi.fn((_table: string, row: any) => { insertedTemplates.push(row); return Promise.resolve(row); }),
    select: vi.fn(() => Promise.resolve([])),
  },
  orEmpty: (p: Promise<any>) => p,
  orUndefined: (p: Promise<any>) => p.then((v: any) => v ?? undefined),
}));

vi.mock('../../config/environment.config', () => ({ isLive: true }));

vi.mock('./im-section.service', () => ({
  getIMSections: vi.fn(() => Promise.resolve(sourceSections.current)),
  saveIMSection: vi.fn((s: any) => { savedSections.push(s); return Promise.resolve(s); }),
}));

import { duplicateIMTemplate } from './im-template.service';

const template = (over: Record<string, unknown> = {}) => ({
  id: 'tpl-src', category_id: 'cat-a', template_type: 'im', name: 'Fridge Manual',
  languages: ['en', 'de'], is_finalized: true, metadata: { pageSize: 'a4' }, updated_at: '', ...over,
});

describe('duplicateIMTemplate', () => {
  beforeEach(() => {
    templateRows.current = [template()];
    insertedTemplates.length = 0;
    sourceSections.current = [];
    savedSections.length = 0;
  });

  it('refuses when the target category already has a template of this type', async () => {
    templateRows.current.push(template({ id: 'tpl-b', category_id: 'cat-b' }));
    await expect(duplicateIMTemplate('tpl-src', 'cat-b', 'Copy')).rejects.toThrow(/already has a template/);
  });

  it('clones the template unlocked with source languages and metadata', async () => {
    await duplicateIMTemplate('tpl-src', 'cat-b', 'Freezer Manual');
    expect(insertedTemplates).toHaveLength(1);
    const t = insertedTemplates[0];
    expect(t.category_id).toBe('cat-b');
    expect(t.is_finalized).toBe(false);
    expect(t.languages).toEqual(['en', 'de']);
    // Metadata is carried over through the normalizer (which fills defaults),
    // so assert the source value survived rather than exact shape.
    expect(t.metadata.pageSize).toBe('a4');
    expect(t.id).not.toBe('tpl-src');
  });

  it('remaps section ids and parent links, writing parents before children', async () => {
    // Deliberately scrambled: child listed before its parent.
    sourceSections.current = [
      { id: 'sB', templateId: 'tpl-src', parentId: 'sA', title: 'Child', order: 0, blockRefs: [] },
      { id: 'sA', templateId: 'tpl-src', parentId: null, title: 'Parent', order: 0, blockRefs: [] },
      { id: 'sC', templateId: 'tpl-src', parentId: 'sB', title: 'Grandchild', order: 0, blockRefs: [] },
    ];
    const target = await duplicateIMTemplate('tpl-src', 'cat-b', 'Copy');
    expect(savedSections).toHaveLength(3);

    const byTitle = Object.fromEntries(savedSections.map((s) => [s.title, s]));
    // Every clone belongs to the new template with a fresh id.
    for (const s of savedSections) {
      expect(s.templateId).toBe(target.id);
      expect(['sA', 'sB', 'sC']).not.toContain(s.id);
    }
    // Parent links point at the CLONED ids, not the source ids.
    expect(byTitle['Parent'].parentId).toBeNull();
    expect(byTitle['Child'].parentId).toBe(byTitle['Parent'].id);
    expect(byTitle['Grandchild'].parentId).toBe(byTitle['Child'].id);
    // Waves: parent written before child before grandchild.
    const order = savedSections.map((s) => s.title);
    expect(order.indexOf('Parent')).toBeLessThan(order.indexOf('Child'));
    expect(order.indexOf('Child')).toBeLessThan(order.indexOf('Grandchild'));
  });

  it('strips block-ref ids (fresh overrides keys) and clears per-section FINAL flags', async () => {
    sourceSections.current = [{
      id: 'sA', templateId: 'tpl-src', parentId: null, title: 'Safety', order: 0, isFinal: true,
      blockRefs: [
        { id: 'ref-1', kind: 'inline', content: { en: '<p>Hi</p>' } },
        { id: 'ref-2', kind: 'block', block_id: 'blk-9' },
      ],
    }];
    await duplicateIMTemplate('tpl-src', 'cat-b', 'Copy');
    const s = savedSections[0];
    expect(s.isFinal).toBe(false);
    expect(s.blockRefs.map((r: any) => r.id)).toEqual([undefined, undefined]);
    // Shared-block references keep pointing at the same library block.
    expect(s.blockRefs[1].block_id).toBe('blk-9');
  });
});
