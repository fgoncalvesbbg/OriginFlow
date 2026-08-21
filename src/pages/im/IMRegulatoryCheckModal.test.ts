import { describe, it, expect } from 'vitest';

// `locateBlock` is the bridge between a finding and the block it points at — get it wrong
// and "Fix block" either edits the wrong text or silently offers nothing. Pure, so tested
// directly rather than through the modal.
import { locateBlock } from './IMRegulatoryCheckModal';
import type { IMSection } from '../../types';

const section = (over: Partial<IMSection> & { id: string }): IMSection => ({
  templateId: 'tmpl-1',
  parentId: null,
  title: 'Safety',
  order: 1,
  isPlaceholder: false,
  content: {},
  blockRefs: [],
  ...over,
});

const sections: IMSection[] = [
  section({
    id: 'sec-a',
    title: 'Safety',
    blockRefs: [
      { kind: 'inline', id: 'ref-1', content: { en: 'First' } },
      { kind: 'block', id: 'ref-2', block_id: 'blk-9' },
      { kind: 'inline', content: { en: 'No id — legacy' } },
    ],
  }),
  section({ id: 'sec-b', title: 'Installation', order: 2, blockRefs: [] , content: { en: '<p>Legacy prose</p>' } }),
];

describe('locateBlock', () => {
  it('finds a block by its real ref id', () => {
    const found = locateBlock(sections, 'ref-1')!;
    expect(found.section.id).toBe('sec-a');
    expect(found.index).toBe(0);
    expect(found.ref).toMatchObject({ kind: 'inline' });
  });

  it('finds a shared block ref, so the panel can explain why it is not editable', () => {
    const found = locateBlock(sections, 'ref-2')!;
    expect(found.index).toBe(1);
    expect(found.ref).toMatchObject({ kind: 'block', block_id: 'blk-9' });
  });

  it('resolves the positional fallback the serializer emits for refs with no id', () => {
    // The serializer emits `${sectionId}#${index}` when a ref predates id backfill; an
    // older template must still be fixable from the report.
    const found = locateBlock(sections, 'sec-a#2')!;
    expect(found.section.id).toBe('sec-a');
    expect(found.index).toBe(2);
    expect(found.ref).toMatchObject({ kind: 'inline', content: { en: 'No id — legacy' } });
  });

  it('resolves the legacy whole-section marker with no block', () => {
    const found = locateBlock(sections, 'sec-b#legacy')!;
    expect(found.section.id).toBe('sec-b');
    expect(found.index).toBe(-1);
    expect(found.ref).toBeNull();
  });

  it('returns null for an unknown ref id', () => {
    expect(locateBlock(sections, 'nope')).toBeNull();
  });

  it('returns null for a positional ref whose index no longer exists', () => {
    // Blocks were deleted since the report was produced — better to offer nothing than to
    // edit whatever now sits at that index.
    expect(locateBlock(sections, 'sec-a#9')).toBeNull();
  });

  it('returns null for a positional ref naming an unknown section', () => {
    expect(locateBlock(sections, 'gone#0')).toBeNull();
  });

  it('returns null when the finding has no ref at all', () => {
    expect(locateBlock(sections, undefined)).toBeNull();
    expect(locateBlock(sections, '')).toBeNull();
  });

  it('prefers a real id over a same-looking positional match', () => {
    const tricky = [
      section({ id: 'sec-x', blockRefs: [{ kind: 'inline', id: 'sec-x#0', content: { en: 'By id' } }] }),
      section({ id: 'sec-x#0', order: 2, blockRefs: [{ kind: 'inline', content: { en: 'By position' } }] }),
    ];
    const found = locateBlock(tricky, 'sec-x#0')!;
    expect(found.section.id).toBe('sec-x');
    expect(found.ref).toMatchObject({ content: { en: 'By id' } });
  });
});
