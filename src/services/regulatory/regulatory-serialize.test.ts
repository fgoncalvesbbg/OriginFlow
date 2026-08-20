import { describe, it, expect } from 'vitest';

// Pure module — nothing is mocked, because nothing is injected. Every assertion here
// guards against a specific way of manufacturing a FALSE "requirement is missing"
// finding, which is the failure mode that destroys trust in the check fastest.
import {
  chunkRegCheckDocument,
  htmlToStructuredText,
  serializeTemplateForRegCheck,
  REG_CHECK_BLOCK_CHAR_CAP,
  REG_CHECK_CHUNK_CHARS,
} from './regulatory-serialize';
import type { IMBlock, IMSection, IMTemplate } from '../../types';

const template: Pick<IMTemplate, 'id' | 'templateType' | 'name' | 'categoryId'> = {
  id: 'tmpl-1',
  templateType: 'im',
  name: 'Fridge Manual Template',
  categoryId: 'cat-1',
};

const section = (over: Partial<IMSection> & { id: string }): IMSection => ({
  templateId: 'tmpl-1',
  parentId: null,
  title: 'Section',
  order: 0,
  isPlaceholder: false,
  content: {},
  blockRefs: [],
  ...over,
});

const sharedBlock = (over: Partial<IMBlock> & { id: string }): IMBlock => ({
  slug: 'slug',
  title: 'Title',
  blockType: 'warning',
  sourceLanguage: 'en',
  content: {},
  placeholders: [],
  applicableCategories: [],
  regulationRefs: [],
  approvalStatus: 'approved',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...over,
});

describe('htmlToStructuredText', () => {
  it('turns table cells into pipe-separated rows on separate lines', () => {
    // A rating-plate/energy-label requirement IS a table. Collapsing it into one
    // run-on line is how the model concludes the required table is absent.
    const html =
      '<table><tr><th>Model</th><th>Volume</th></tr>' +
      '<tr><td>KS-100</td><td>100 L</td></tr></table>';
    expect(htmlToStructuredText(html)).toBe('Model | Volume\nKS-100 | 100 L');
  });

  it('breaks list items and paragraphs onto their own lines', () => {
    const html = '<p>Before use:</p><ul><li>Read this</li><li>Keep it</li></ul>';
    expect(htmlToStructuredText(html)).toBe('Before use:\nRead this\nKeep it');
  });

  it('keeps {{placeholder}} chips verbatim', () => {
    // Stripping a chip reads to the model as a missing value.
    expect(htmlToStructuredText('<p>Rated at {{voltage}} V</p>')).toBe('Rated at {{voltage}} V');
  });

  it('decodes entities without merging words', () => {
    expect(htmlToStructuredText('<p>A&nbsp;B &amp; C</p>')).toBe('A B & C');
  });

  it('returns an empty string for empty or tag-only input', () => {
    expect(htmlToStructuredText('')).toBe('');
    expect(htmlToStructuredText('<p></p><div></div>')).toBe('');
  });
});

describe('serializeTemplateForRegCheck', () => {
  it('pins English even when another language key comes first', () => {
    // This is the exportTemplateForReview bug: Object.keys(content)[0] is whatever
    // order the JSONB came back in, not the source language.
    const doc = serializeTemplateForRegCheck(template, [
      section({
        id: 's1',
        blockRefs: [{ kind: 'inline', id: 'r1', content: { de: 'Deutscher Text', en: 'English text' } }],
      }),
    ], []);
    expect(doc.sections[0].blocks[0].text).toBe('English text');
    expect(doc.language).toBe('en');
  });

  it('resolves a shared block to its English library content, not a placeholder label', () => {
    const doc = serializeTemplateForRegCheck(template, [
      section({ id: 's1', blockRefs: [{ kind: 'block', id: 'r1', block_id: 'b1' }] }),
    ], [sharedBlock({ id: 'b1', slug: 'general-safety-01', blockType: 'danger', content: { en: '<p>Do not damage the refrigerant circuit.</p>' } })]);

    const block = doc.sections[0].blocks[0];
    expect(block.text).toBe('Do not damage the refrigerant circuit.');
    expect(block.blockId).toBe('b1');
    expect(block.blockSlug).toBe('general-safety-01');
    expect(block.variant).toBe('danger');
    // Regression guard: never re-introduce the "[shared standardized block]" flattening.
    expect(block.text).not.toContain('shared standardized block');
  });

  it('says so explicitly when a shared block has no English content', () => {
    const doc = serializeTemplateForRegCheck(template, [
      section({ id: 's1', blockRefs: [{ kind: 'block', id: 'r1', block_id: 'b1' }] }),
    ], [sharedBlock({ id: 'b1', slug: 'empty-block', content: { de: 'nur Deutsch' } })]);
    // A silent omission would let the model report a gap that isn't one.
    expect(doc.sections[0].blocks[0].text).toContain('empty-block');
    expect(doc.sections[0].blocks[0].text).toContain('no English content');
  });

  it('uses the ref id when present and a positional fallback for legacy refs', () => {
    const doc = serializeTemplateForRegCheck(template, [
      section({
        id: 's1',
        blockRefs: [
          { kind: 'inline', id: 'ref-abc', content: { en: 'First' } },
          { kind: 'inline', content: { en: 'Second' } },
        ],
      }),
    ], []);
    expect(doc.sections[0].blocks.map((b) => b.refId)).toEqual(['ref-abc', 's1#1']);
  });

  it('flags conditional and optional blocks so they are not reported as missing', () => {
    const doc = serializeTemplateForRegCheck(template, [
      section({
        id: 's1',
        blockRefs: [
          { kind: 'inline', id: 'r1', content: { en: 'Gated' }, requires_feature: 'attr-1' },
          { kind: 'inline', id: 'r2', content: { en: 'Opt-in' }, isPlaceholder: true },
          { kind: 'inline', id: 'r3', content: { en: 'Plain' } },
        ],
      }),
    ], []);
    const [a, b, c] = doc.sections[0].blocks;
    expect(a.conditional).toBe(true);
    expect(b.optional).toBe(true);
    expect(c.conditional).toBeUndefined();
    expect(c.optional).toBeUndefined();
  });

  it('describes an SKU slot rather than pretending content is present', () => {
    const doc = serializeTemplateForRegCheck(template, [
      section({
        id: 's1',
        blockRefs: [{
          kind: 'sku_slot', id: 'r1', slot: 'dimensions',
          schema: 'legend_table', label: { en: 'Dimensions' }, required: true,
        }],
      }),
    ], []);
    expect(doc.sections[0].blocks[0].text).toBe('[per-product legend_table slot: Dimensions]');
    expect(doc.sections[0].blocks[0].kind).toBe('sku_slot');
  });

  it('numbers the outline by parent and order, and returns sections in outline order', () => {
    const doc = serializeTemplateForRegCheck(template, [
      section({ id: 'b', title: 'Second root', order: 2 }),
      section({ id: 'a', title: 'First root', order: 1 }),
      section({ id: 'a2', title: 'Child two', parentId: 'a', order: 2 }),
      section({ id: 'a1', title: 'Child one', parentId: 'a', order: 1 }),
      section({ id: 'a1x', title: 'Grandchild', parentId: 'a1', order: 1 }),
    ], []);
    expect(doc.sections.map((s) => [s.path, s.sectionId])).toEqual([
      ['1', 'a'],
      ['1.1', 'a1'],
      ['1.1.1', 'a1x'],
      ['1.2', 'a2'],
      ['2', 'b'],
    ]);
  });

  it('treats a section whose parent is missing as a root rather than dropping it', () => {
    // A corrupt parent link must never hide content from a compliance audit.
    const doc = serializeTemplateForRegCheck(template, [
      section({ id: 'orphan', title: 'Orphan', parentId: 'gone', order: 1 }),
    ], []);
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].path).toBe('1');
  });

  it('falls back to legacy section content when a section has no block refs', () => {
    const doc = serializeTemplateForRegCheck(template, [
      section({ id: 's1', blockRefs: [], content: { en: '<p>Legacy prose</p>' } }),
    ], []);
    expect(doc.sections[0].blocks).toHaveLength(1);
    expect(doc.sections[0].blocks[0].text).toBe('Legacy prose');
    expect(doc.sections[0].blocks[0].refId).toBe('s1#legacy');
  });

  it('caps an over-long block and counts the truncation', () => {
    const long = 'x'.repeat(REG_CHECK_BLOCK_CHAR_CAP + 500);
    const doc = serializeTemplateForRegCheck(template, [
      section({ id: 's1', blockRefs: [{ kind: 'inline', id: 'r1', content: { en: long } }] }),
    ], []);
    expect(doc.sections[0].blocks[0].truncated).toBe(true);
    expect(doc.sections[0].blocks[0].text.length).toBe(REG_CHECK_BLOCK_CHAR_CAP + 1); // + ellipsis
    expect(doc.truncatedBlocks).toBe(1);
  });

  it('skips a block whose English content is empty', () => {
    const doc = serializeTemplateForRegCheck(template, [
      section({
        id: 's1',
        blockRefs: [
          { kind: 'inline', id: 'r1', content: { de: 'nur Deutsch' } },
          { kind: 'inline', id: 'r2', content: { en: 'Kept' } },
        ],
      }),
    ], []);
    expect(doc.sections[0].blocks.map((b) => b.refId)).toEqual(['r2']);
  });
});

describe('chunkRegCheckDocument', () => {
  /**
   * Sized in BLOCKS, not raw characters: each block is independently capped at
   * REG_CHECK_BLOCK_CHAR_CAP, so a single enormous block cannot exceed the chunk
   * budget on its own — only several capped blocks can.
   */
  const sectionOfBlocks = (id: string, blocks: number): IMSection =>
    section({
      id,
      title: id,
      blockRefs: Array.from({ length: blocks }, (_, i) => ({
        kind: 'inline' as const, id: `${id}r${i}`, content: { en: 'y'.repeat(REG_CHECK_BLOCK_CHAR_CAP) },
      })),
    });

  /** Blocks needed to fill just under one chunk. */
  const NEARLY_FULL = Math.floor(REG_CHECK_CHUNK_CHARS / REG_CHECK_BLOCK_CHAR_CAP);

  const bigSection = (id: string, chars: number): IMSection =>
    section({ id, title: id, blockRefs: [{ kind: 'inline', id: `${id}r`, content: { en: 'y'.repeat(chars) } }] });

  it('never splits a section across chunks', () => {
    const doc = serializeTemplateForRegCheck(template, [
      sectionOfBlocks('a', NEARLY_FULL),
      sectionOfBlocks('b', NEARLY_FULL),
    ], []);
    const chunks = chunkRegCheckDocument(doc);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].sections.map((s) => s.sectionId)).toEqual(['a']);
    expect(chunks[1].sections.map((s) => s.sectionId)).toEqual(['b']);
  });

  it('packs several small sections into one chunk', () => {
    const doc = serializeTemplateForRegCheck(template, [
      bigSection('a', 100), bigSection('b', 100), bigSection('c', 100),
    ], []);
    const chunks = chunkRegCheckDocument(doc);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sections).toHaveLength(3);
  });

  it('gives an over-budget single section its own chunk instead of cutting it', () => {
    const doc = serializeTemplateForRegCheck(template, [
      bigSection('small', 100),
      // Over the chunk budget even after the per-block cap, via many blocks.
      section({
        id: 'huge',
        title: 'huge',
        blockRefs: Array.from({ length: 6 }, (_, i) => ({
          kind: 'inline' as const, id: `h${i}`, content: { en: 'z'.repeat(REG_CHECK_BLOCK_CHAR_CAP) },
        })),
      }),
      bigSection('after', 100),
    ], []);
    const chunks = chunkRegCheckDocument(doc);
    const hugeChunk = chunks.find((c) => c.sections.some((s) => s.sectionId === 'huge'))!;
    expect(hugeChunk.sections.map((s) => s.sectionId)).toEqual(['huge']);
    // Nothing is lost: every section still appears exactly once across the chunks.
    expect(chunks.flatMap((c) => c.sections.map((s) => s.sectionId)).sort())
      .toEqual(['after', 'huge', 'small']);
  });

  it('carries the template identity onto every chunk', () => {
    const doc = serializeTemplateForRegCheck(template, [
      sectionOfBlocks('a', NEARLY_FULL), sectionOfBlocks('b', NEARLY_FULL),
    ], []);
    for (const chunk of chunkRegCheckDocument(doc)) {
      expect(chunk.templateId).toBe('tmpl-1');
      expect(chunk.templateType).toBe('im');
      expect(chunk.language).toBe('en');
    }
  });

  it('yields one empty chunk for a template with no sections', () => {
    const chunks = chunkRegCheckDocument(serializeTemplateForRegCheck(template, [], []));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sections).toEqual([]);
  });

  it('reports truncatedBlocks once, on the first chunk only', () => {
    const doc = serializeTemplateForRegCheck(template, [
      section({ id: 'a', blockRefs: [{ kind: 'inline', id: 'r1', content: { en: 'x'.repeat(REG_CHECK_BLOCK_CHAR_CAP + 10) } }] }),
      section({ id: 'b', blockRefs: [{ kind: 'inline', id: 'r2', content: { en: 'x'.repeat(REG_CHECK_BLOCK_CHAR_CAP + 10) } }] }),
      section({ id: 'c', blockRefs: [{ kind: 'inline', id: 'r3', content: { en: 'x'.repeat(REG_CHECK_BLOCK_CHAR_CAP + 10) } }] }),
      section({ id: 'd', blockRefs: [{ kind: 'inline', id: 'r4', content: { en: 'x'.repeat(REG_CHECK_BLOCK_CHAR_CAP + 10) } }] }),
      section({ id: 'e', blockRefs: [{ kind: 'inline', id: 'r5', content: { en: 'x'.repeat(REG_CHECK_BLOCK_CHAR_CAP + 10) } }] }),
    ], []);
    const chunks = chunkRegCheckDocument(doc);
    expect(chunks[0].truncatedBlocks).toBe(5);
    expect(chunks.slice(1).every((c) => c.truncatedBlocks === 0)).toBe(true);
  });
});
