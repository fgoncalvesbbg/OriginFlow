import { describe, it, expect } from 'vitest';
import {
  newInlineBlock,
  blockTypeToVariant,
  seedPlaceholderBlocks,
  sectionToInlineBlocks,
  isInlineBlockEmpty,
  isExtraSection,
  type AvailableBlocks,
} from './im-blocks.utils';
import type { BlockRef, IMSection, InlineBlockRef } from '../../../types';

const section = (over: Partial<IMSection> = {}): IMSection => ({
  id: 's1',
  templateId: 't1',
  title: 'Safety',
  order: 0,
  isPlaceholder: false,
  content: {},
  ...over,
});

const inline = (content: Record<string, string>, variant?: InlineBlockRef['variant']): InlineBlockRef =>
  ({ kind: 'inline', content, ...(variant ? { variant } : {}) } as InlineBlockRef);

describe('newInlineBlock', () => {
  it('is an empty inline block', () => {
    expect(newInlineBlock()).toEqual({ kind: 'inline', content: {} });
  });

  it('returns a fresh object each call', () => {
    const a = newInlineBlock();
    const b = newInlineBlock();
    a.content.en = 'typed here';
    expect(b.content).toEqual({});
  });
});

describe('blockTypeToVariant', () => {
  it('maps every known block type to its callout variant', () => {
    for (const t of ['warning', 'danger', 'caution', 'electric', 'flammable', 'hot_surface', 'info']) {
      expect(blockTypeToVariant(t)).toBe(t);
    }
  });

  it('returns undefined for a missing or unknown type', () => {
    expect(blockTypeToVariant(undefined)).toBeUndefined();
    expect(blockTypeToVariant('')).toBeUndefined();
    expect(blockTypeToVariant('not_a_variant')).toBeUndefined();
  });
});

describe('seedPlaceholderBlocks', () => {
  it('keeps the section inline refs, with their variants', () => {
    const refs: BlockRef[] = [inline({ en: 'one' }, 'warning'), inline({ en: 'two' })];
    expect(seedPlaceholderBlocks(section({ blockRefs: refs }))).toEqual([
      { kind: 'inline', content: { en: 'one' }, variant: 'warning' },
      { kind: 'inline', content: { en: 'two' }, variant: undefined },
    ]);
  });

  it('ignores non-inline refs when seeding', () => {
    const refs = [{ kind: 'block', block_id: 'b1' }] as unknown as BlockRef[];
    // No inline ref and no content: falls through to a single empty block.
    expect(seedPlaceholderBlocks(section({ blockRefs: refs }))).toEqual([{ kind: 'inline', content: {} }]);
  });

  it('turns legacy content-only sections into one block', () => {
    expect(seedPlaceholderBlocks(section({ content: { en: '<p>legacy</p>' } }))).toEqual([
      { kind: 'inline', content: { en: '<p>legacy</p>' } },
    ]);
  });

  it('treats all-empty content as no content', () => {
    expect(seedPlaceholderBlocks(section({ content: { en: '', de: '' } }))).toEqual([{ kind: 'inline', content: {} }]);
  });

  it('copies content rather than aliasing the section', () => {
    const src = section({ content: { en: 'original' } });
    const seeded = seedPlaceholderBlocks(src);
    seeded[0].content.en = 'edited';
    expect(src.content.en).toBe('original');
  });
});

describe('sectionToInlineBlocks', () => {
  const blocks: AvailableBlocks = {
    b1: { content: { en: 'shared danger' }, blockType: 'danger' },
    b2: { content: { en: 'plain shared' }, blockType: 'unmapped' },
  };

  it('flattens shared blocks to inline, carrying the callout look across', () => {
    const refs = [{ kind: 'block', block_id: 'b1' }] as unknown as BlockRef[];
    expect(sectionToInlineBlocks(section({ blockRefs: refs }), {}, blocks)).toEqual([
      { kind: 'inline', content: { en: 'shared danger' }, variant: 'danger' },
    ]);
  });

  it('leaves the variant off a shared block whose type has no callout', () => {
    const refs = [{ kind: 'block', block_id: 'b2' }] as unknown as BlockRef[];
    expect(sectionToInlineBlocks(section({ blockRefs: refs }), {}, blocks)[0].variant).toBeUndefined();
  });

  it('prefers a saved override over the template refs', () => {
    const s = section({ blockRefs: [inline({ en: 'from template' })] });
    const overrides = { s1: [inline({ en: 'pm edited' })] };
    expect(sectionToInlineBlocks(s, overrides, blocks)).toEqual([{ kind: 'inline', content: { en: 'pm edited' }, variant: undefined }]);
  });

  it('drops sku_slot refs', () => {
    const refs = [{ kind: 'sku_slot', slot: 'specs' }, inline({ en: 'kept' })] as unknown as BlockRef[];
    expect(sectionToInlineBlocks(section({ blockRefs: refs }), {}, blocks)).toEqual([
      { kind: 'inline', content: { en: 'kept' }, variant: undefined },
    ]);
  });

  it('skips a shared ref whose block is not in the library', () => {
    const refs = [{ kind: 'block', block_id: 'gone' }] as unknown as BlockRef[];
    // Nothing resolved, so the caller still gets one editable block.
    expect(sectionToInlineBlocks(section({ blockRefs: refs }), {}, blocks)).toEqual([{ kind: 'inline', content: {} }]);
  });

  it('falls back to legacy content when there are no refs at all', () => {
    expect(sectionToInlineBlocks(section({ content: { en: 'legacy' } }), {}, blocks)).toEqual([
      { kind: 'inline', content: { en: 'legacy' } },
    ]);
  });

  it('never returns an empty list', () => {
    expect(sectionToInlineBlocks(section(), {}, blocks)).toEqual([{ kind: 'inline', content: {} }]);
  });

  it('copies shared block content rather than aliasing the library', () => {
    const refs = [{ kind: 'block', block_id: 'b1' }] as unknown as BlockRef[];
    const out = sectionToInlineBlocks(section({ blockRefs: refs }), {}, blocks);
    out[0].content.en = 'edited';
    expect(blocks.b1.content.en).toBe('shared danger');
  });
});

describe('isInlineBlockEmpty', () => {
  it('treats markup with no text as empty', () => {
    expect(isInlineBlockEmpty(inline({ en: '<p><br></p>' }))).toBe(true);
    expect(isInlineBlockEmpty(inline({ en: '   ' }))).toBe(true);
  });

  it('is empty only when every language is empty', () => {
    expect(isInlineBlockEmpty(inline({ en: '', de: '<p>Achtung</p>' }))).toBe(false);
    expect(isInlineBlockEmpty(inline({ en: '', de: '<p></p>' }))).toBe(true);
  });

  it('treats a block with no content at all as empty', () => {
    expect(isInlineBlockEmpty(inline({}))).toBe(true);
  });
});

describe('isExtraSection', () => {
  it('is true only for the project-only marker', () => {
    expect(isExtraSection({ ...section(), __projectExtra: true } as IMSection)).toBe(true);
    expect(isExtraSection(section())).toBe(false);
    expect(isExtraSection({ ...section(), __projectExtra: 'yes' } as unknown as IMSection)).toBe(false);
  });
});
