import { describe, it, expect } from 'vitest';
import { removeRowRef } from './im-row-refs';
import { BlockRef } from '../../types';

const inline = (en: string): BlockRef => ({ kind: 'inline', content: { en } });
const shared = (id: string): BlockRef => ({ kind: 'block', block_id: id });

describe('removeRowRef', () => {
  it('empties the legacy content mirror when the last inline row goes', () => {
    // The Angled Hoods "App Control" shape: one inline row plus one shared block.
    // Deleting the inline row used to leave content behind, so the load-time shim
    // and the resolver both put the box straight back.
    const refs = [inline('<p>Security information</p>'), shared('b1')];
    const out = removeRowRef(refs, 0, { en: '<p>Security information</p>' });
    expect(out.blockRefs).toEqual([shared('b1')]);
    expect(out.content).toEqual({});
  });

  it('empties the mirror for a section whose only row was inline', () => {
    const out = removeRowRef([inline('<p>gone</p>')], 0, { en: '<p>gone</p>', de: '<p>weg</p>' });
    expect(out.blockRefs).toEqual([]);
    expect(out.content).toEqual({});
  });

  it('re-points the mirror at the leading survivor when inline rows remain', () => {
    const refs = [inline('<p>first</p>'), inline('<p>second</p>')];
    const out = removeRowRef(refs, 0, { en: '<p>first</p>' });
    expect(out.blockRefs).toEqual([inline('<p>second</p>')]);
    expect(out.content).toEqual({ en: '<p>second</p>' });
  });

  it('leaves the mirror untouched when a shared block is removed', () => {
    const refs = [inline('<p>prose</p>'), shared('b1')];
    const out = removeRowRef(refs, 1, { en: '<p>prose</p>' });
    expect(out.blockRefs).toEqual([inline('<p>prose</p>')]);
    expect(out.content).toEqual({ en: '<p>prose</p>' });
  });

  it('leaves the mirror untouched when removing a SKU slot from a block-only section', () => {
    // No inline row to begin with: the mirror is genuine un-migrated prose that the
    // resolver's hybrid mode still owns, so row deletion must not touch it.
    const slot: BlockRef = { kind: 'sku_slot', slot: 'dimensions', schema: 'rich_text', label: { en: 'Dimensions' }, required: false };
    const refs: BlockRef[] = [shared('b1'), slot];
    const out = removeRowRef(refs, 1, { en: '<p>legacy prose</p>' });
    expect(out.blockRefs).toEqual([shared('b1')]);
    expect(out.content).toEqual({ en: '<p>legacy prose</p>' });
  });

  it('is a no-op on an out-of-range index', () => {
    const refs = [inline('<p>a</p>')];
    const out = removeRowRef(refs, 5, { en: '<p>a</p>' });
    expect(out.blockRefs).toEqual(refs);
    expect(out.content).toEqual({ en: '<p>a</p>' });
  });
});
