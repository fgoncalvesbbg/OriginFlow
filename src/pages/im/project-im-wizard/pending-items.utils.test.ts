import { describe, it, expect } from 'vitest';
import { groupPendingItems, summarizePendingItems, type PendingItem } from './pending-items.utils';

const item = (overrides: Partial<PendingItem> = {}): PendingItem => ({
  key: 'k1',
  label: 'Rated power',
  sectionTitle: 'Safety',
  tier: 'optional',
  scope: 'project',
  target: { pane: 'fill', anchor: 'value:k1' },
  ...overrides,
});

describe('summarizePendingItems', () => {
  it('splits regulatory-tier items from everything else', () => {
    const items = [item({ tier: 'regulatory' }), item({ tier: 'recommended' }), item({ tier: 'optional' })];
    expect(summarizePendingItems(items)).toEqual({ total: 3, regulatory: 1, advisory: 2 });
  });

  it('reports zeros for an empty list', () => {
    expect(summarizePendingItems([])).toEqual({ total: 0, regulatory: 0, advisory: 0 });
  });
});

describe('groupPendingItems', () => {
  it('groups items by section title, preserving first-appearance order', () => {
    const items = [
      item({ key: 'a', sectionTitle: 'Cleaning' }),
      item({ key: 'b', sectionTitle: 'Safety' }),
      item({ key: 'c', sectionTitle: 'Cleaning' }),
    ];
    const groups = groupPendingItems(items);
    expect(groups.map((g) => g.sectionTitle)).toEqual(['Cleaning', 'Safety']);
    expect(groups[0].items.map((i) => i.key)).toEqual(['a', 'c']);
  });

  it('returns [] for an empty list', () => {
    expect(groupPendingItems([])).toEqual([]);
  });
});
