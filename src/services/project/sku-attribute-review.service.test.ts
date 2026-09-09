import { describe, it, expect } from 'vitest';
import { mergeCategorySkus } from './sku-attribute-review.service';
import type { CategorySku } from './sku-attribute-review.service';

const sku = (overrides: Partial<CategorySku> & { id: string; skuNumber: string }): CategorySku => ({
  projectId: null,
  categoryId: 'cat-1',
  skuTitle: '',
  attributeValues: [],
  sortOrder: 0,
  isFinal: false,
  pendingExport: false,
  lastExportedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  projectName: '',
  ...overrides,
});

describe('mergeCategorySkus', () => {
  it('unions the two reads', () => {
    // The live shape this fixes: Beverage Coolers returned 27 SKUs via the project join while
    // 138 carry the category themselves. The 111 difference is every project-less catalog SKU.
    const own = [sku({ id: 's1', skuNumber: '10000001' }), sku({ id: 's2', skuNumber: '10000002' })];
    const viaProject = [sku({ id: 's3', skuNumber: '10000003', projectId: 'p1', projectName: 'P' })];
    expect(mergeCategorySkus(own, viaProject).map(s => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('deduplicates a SKU that matches both ways', () => {
    const row = sku({ id: 's1', skuNumber: '10000001', projectId: 'p1', projectName: 'P' });
    expect(mergeCategorySkus([row], [row])).toHaveLength(1);
  });

  it('keeps BOTH records when two SKUs share a number', () => {
    // A SKU number is not unique in OriginFlow — live, 10046631 and many others name two
    // different records. Collapsing them by number would silently hide one product behind
    // the other; the grid has to show both and badge them.
    const merged = mergeCategorySkus([
      sku({ id: 'a', skuNumber: '10046631', projectId: 'p1', projectName: 'Project One' }),
      sku({ id: 'b', skuNumber: '10046631', projectId: 'p2', projectName: 'Project Two' }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map(s => s.projectName)).toEqual(['Project One', 'Project Two']);
  });

  it('prefers the SKU-stamped row when a SKU is matched both ways', () => {
    // First batch wins, and getSkusByCategory passes the SKU-stamped read first, so a SKU
    // carrying its own category keeps that row rather than inheriting its project's.
    const ownRow = sku({ id: 's1', skuNumber: '1', categoryId: 'cat-own' });
    const projectRow = sku({ id: 's1', skuNumber: '1', categoryId: 'cat-via-project' });
    expect(mergeCategorySkus([ownRow], [projectRow])[0].categoryId).toBe('cat-own');
  });

  it('orders by SKU number numerically, not lexically', () => {
    const merged = mergeCategorySkus([
      sku({ id: 'c', skuNumber: '10000010' }),
      sku({ id: 'a', skuNumber: '9' }),
      sku({ id: 'b', skuNumber: '10000002' }),
    ]);
    expect(merged.map(s => s.skuNumber)).toEqual(['9', '10000002', '10000010']);
  });

  it('handles an empty read on either side', () => {
    expect(mergeCategorySkus([], [])).toEqual([]);
    expect(mergeCategorySkus([sku({ id: 's1', skuNumber: '1' })], [])).toHaveLength(1);
    expect(mergeCategorySkus([], [sku({ id: 's1', skuNumber: '1' })])).toHaveLength(1);
  });
});
