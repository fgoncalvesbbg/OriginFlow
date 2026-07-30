import { describe, it, expect } from 'vitest';
import {
  MANUAL_STATUS_META,
  MANUAL_STATUS_ORDER,
  groupByStatus,
  manualStatusOf,
  type ManualStatus,
} from './im-manual-status';

const im = (status: 'draft' | 'generated', isFinalized = false) => ({ status, isFinalized });

describe('manualStatusOf', () => {
  it('reports Final regardless of the underlying status', () => {
    expect(manualStatusOf(im('generated', true), false)).toBe('final');
    expect(manualStatusOf(im('draft', true), false)).toBe('final');
  });

  it('keeps Final ahead of staleness', () => {
    // A locked manual whose sources drifted is still, first and foremost, locked.
    expect(manualStatusOf(im('generated', true), true)).toBe('final');
  });

  it('distinguishes a stale publish from an up-to-date one', () => {
    expect(manualStatusOf(im('generated'), true)).toBe('needs_republish');
    expect(manualStatusOf(im('generated'), false)).toBe('published');
  });

  it('reports Draft when never published, and ignores staleness there', () => {
    expect(manualStatusOf(im('draft'), false)).toBe('draft');
    expect(manualStatusOf(im('draft'), true)).toBe('draft');
  });
});

describe('groupByStatus', () => {
  const rows = [
    { id: 'a', ...im('generated') },
    { id: 'b', ...im('draft') },
    { id: 'c', ...im('generated', true) },
    { id: 'd', ...im('generated') },
    { id: 'e', ...im('draft') },
  ];

  it('orders groups action-first and drops empty ones', () => {
    const groups = groupByStatus(rows, r => r.id === 'd');
    expect(groups.map(g => g.status)).toEqual(['needs_republish', 'draft', 'published', 'final']);
  });

  it('omits groups with no members', () => {
    const groups = groupByStatus([{ id: 'x', ...im('draft') }], () => false);
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('draft');
  });

  it('preserves the incoming order inside a group', () => {
    const groups = groupByStatus(rows, () => false);
    const published = groups.find(g => g.status === 'published')!;
    expect(published.items.map(i => i.id)).toEqual(['a', 'd']);
  });

  it('accounts for every row exactly once', () => {
    const groups = groupByStatus(rows, r => r.id === 'd');
    const ids = groups.flatMap(g => g.items.map(i => i.id));
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns nothing for an empty list, so the caller renders its own empty state', () => {
    expect(groupByStatus([], () => false)).toEqual([]);
  });
});

describe('status metadata', () => {
  it('covers every status in the display order', () => {
    for (const status of MANUAL_STATUS_ORDER) {
      expect(MANUAL_STATUS_META[status]?.label).toBeTruthy();
      expect(MANUAL_STATUS_META[status]?.hint).toBeTruthy();
    }
  });

  it('orders every known status exactly once', () => {
    const keys = Object.keys(MANUAL_STATUS_META) as ManualStatus[];
    expect([...MANUAL_STATUS_ORDER].sort()).toEqual(keys.sort());
  });
});
