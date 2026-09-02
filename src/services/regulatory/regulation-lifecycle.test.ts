import { describe, it, expect } from 'vitest';

import {
  MAX_REPLACEMENT_DEPTH,
  collectBlocks,
  indexRegulations,
  isBlocking,
  resolveEffective,
  resolveReplacement,
  summarizeBlocks,
} from './regulation-lifecycle';
import type { Regulation, RegulationStatus } from '../../types';

const reg = (
  id: string,
  status: RegulationStatus = 'active',
  supersededById: string | null = null,
  extra: Partial<Regulation> = {},
): Regulation => ({
  id,
  title: `Title ${id}`,
  referenceCode: id.toUpperCase(),
  summaryBytes: 0,
  applicableCategories: [],
  status,
  supersededById,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...extra,
});

describe('resolveReplacement', () => {
  it('leaves an active regulation alone', () => {
    const a = reg('a');
    const r = resolveReplacement(a, indexRegulations([a]));
    expect(r).toMatchObject({ outcome: 'not-expired', blocking: false });
    expect(r.effective).toBe(a);
  });

  it('does not block a superseded regulation', () => {
    // Superseded is the tidy-the-picker button and has never stopped anything. Making it
    // block retroactively would freeze every manual citing a row retired months ago.
    const a = reg('a', 'superseded');
    expect(resolveReplacement(a, indexRegulations([a])).blocking).toBe(false);
  });

  it('blocks an expired regulation with no replacement recorded', () => {
    const a = reg('a', 'expired');
    const r = resolveReplacement(a, indexRegulations([a]));
    expect(r).toMatchObject({ outcome: 'unreplaced', blocking: true });
    expect(r.effective).toBe(a);
  });

  it('lifts the block once a replacement is recorded, and hands back the successor', () => {
    const b = reg('b');
    const a = reg('a', 'expired', 'b');
    const r = resolveReplacement(a, indexRegulations([a, b]));
    expect(r).toMatchObject({ outcome: 'replaced', blocking: false });
    expect(r.effective).toBe(b);
    expect(r.chain).toEqual([b]);
  });

  it('accepts a superseded successor — retiring it from the picker is not a claim about the law', () => {
    const b = reg('b', 'superseded');
    const a = reg('a', 'expired', 'b');
    expect(resolveReplacement(a, indexRegulations([a, b])).blocking).toBe(false);
  });

  it('follows a chain through an expired successor to the one still in force', () => {
    const c = reg('c');
    const b = reg('b', 'expired', 'c');
    const a = reg('a', 'expired', 'b');
    const r = resolveReplacement(a, indexRegulations([a, b, c]));
    expect(r).toMatchObject({ outcome: 'replaced', blocking: false });
    expect(r.effective).toBe(c);
    expect(r.chain).toEqual([b, c]);
  });

  it('blocks when the whole chain is expired and runs out', () => {
    const b = reg('b', 'expired');
    const a = reg('a', 'expired', 'b');
    expect(resolveReplacement(a, indexRegulations([a, b])))
      .toMatchObject({ outcome: 'replacement-expired', blocking: true });
  });

  it('blocks when the replacement is not in the library', () => {
    const a = reg('a', 'expired', 'gone');
    expect(resolveReplacement(a, indexRegulations([a])))
      .toMatchObject({ outcome: 'replacement-missing', blocking: true });
  });

  it('blocks on a cycle instead of hanging', () => {
    // superseded_by_id is a self-referencing FK with nothing stopping A -> B -> A, and this
    // resolution runs inside the publish gate — a naive walk would spin forever there.
    const a = reg('a', 'expired', 'b');
    const b = reg('b', 'expired', 'a');
    expect(resolveReplacement(a, indexRegulations([a, b])))
      .toMatchObject({ outcome: 'replacement-cycle', blocking: true });
  });

  it('blocks on a self-reference', () => {
    const a = reg('a', 'expired', 'a');
    expect(resolveReplacement(a, indexRegulations([a])))
      .toMatchObject({ outcome: 'replacement-cycle', blocking: true });
  });

  it('gives up on a chain longer than the depth limit rather than accepting the last hop', () => {
    const library: Regulation[] = [];
    for (let i = 0; i <= MAX_REPLACEMENT_DEPTH + 2; i++) {
      library.push(reg(`r${i}`, 'expired', `r${i + 1}`));
    }
    expect(resolveReplacement(library[0], indexRegulations(library)).blocking).toBe(true);
  });
});

describe('resolveEffective', () => {
  it('is the successor for a replaced expiry and the row itself otherwise', () => {
    const b = reg('b');
    const a = reg('a', 'expired', 'b');
    const c = reg('c');
    const byId = indexRegulations([a, b, c]);
    expect(resolveEffective(a, byId).id).toBe('b');
    expect(resolveEffective(c, byId).id).toBe('c');
  });

  it('is never null, so a caller can read the obligations unconditionally', () => {
    const a = reg('a', 'expired', 'gone', { checklist: 'Check the label' });
    expect(resolveEffective(a, indexRegulations([a])).checklist).toBe('Check the label');
  });
});

describe('isBlocking', () => {
  it('agrees with resolveReplacement', () => {
    const a = reg('a', 'expired');
    const b = reg('b');
    const byId = indexRegulations([a, b]);
    expect(isBlocking(a, byId)).toBe(true);
    expect(isBlocking(b, byId)).toBe(false);
  });
});

describe('collectBlocks', () => {
  const expired = reg('a', 'expired', null, { expiredAt: '2026-07-17' });
  const fine = reg('b');
  const library = [expired, fine];

  it('returns one entry per blocking regulation, deduped', () => {
    const blocks = collectBlocks([expired, fine, expired], library);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].referenceCode).toBe('A');
  });

  it('names the regulation and the expiry date in the message', () => {
    const [block] = collectBlocks([expired], library);
    expect(block.message).toContain('"A" is marked expired (2026-07-17)');
    expect(block.message).toContain('Record the regulation that replaces it');
  });

  it('is empty when nothing is expired', () => {
    expect(collectBlocks([fine], library)).toEqual([]);
  });

  it('ignores null and undefined candidates', () => {
    // Assignments carry `regulation?: Regulation` — undefined when the library row vanished.
    expect(collectBlocks([null, undefined, fine], library)).toEqual([]);
  });

  it('prefers the library row over a stale copy carried by an assignment', () => {
    // A template loaded before the expiry still holds an 'active' copy. Trusting that copy
    // would let a manual publish against a regulation expired ten seconds earlier.
    const stale = reg('a', 'active');
    expect(collectBlocks([stale], library)).toHaveLength(1);
  });

  it('falls back to the candidate when it is not in the library at all', () => {
    const orphan = reg('z', 'expired');
    expect(collectBlocks([orphan], library)).toHaveLength(1);
  });

  it('orders by reference code so every gate lists them the same way', () => {
    const c = reg('c', 'expired');
    const blocks = collectBlocks([c, expired], [...library, c]);
    expect(blocks.map(b => b.referenceCode)).toEqual(['A', 'C']);
  });
});

describe('summarizeBlocks', () => {
  it('is empty when nothing is blocked, so it doubles as a truthiness test', () => {
    expect(summarizeBlocks([])).toBe('');
  });

  it('reads naturally for one and for many', () => {
    const one = collectBlocks([reg('a', 'expired')], [reg('a', 'expired')]);
    expect(summarizeBlocks(one)).toBe('A is expired and has no replacement recorded.');

    const lib = [reg('a', 'expired'), reg('c', 'expired')];
    expect(summarizeBlocks(collectBlocks(lib, lib)))
      .toBe('2 regulations are expired with no replacement recorded: A, C.');
  });
});
