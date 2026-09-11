/**
 * Render smoke test — same `renderToString` approach as
 * ../products/attribute-grid/render-smoke.test.tsx: this repo's tests run with `environment:
 * 'node'` (no jsdom), so there is no click/expand/search interaction to exercise here, only
 * that the closed popover renders the right static markup for a given picked value.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { CategoryTreeFilter } from './CategoryTreeFilter';
import type { CategoryL3 } from '../../types';

const noop = () => {};

const CATS = [
  { id: 'c1', name: 'Angled Hoods', active: true, isFinalized: false, l1Id: 'l1a', l1Name: 'Kitchen', l2Id: 'l2a', l2Name: 'Extractor Hoods' },
  { id: 'c2', name: 'Ceiling Hoods', active: false, isFinalized: false, l1Id: 'l1a', l1Name: 'Kitchen', l2Id: 'l2a', l2Name: 'Extractor Hoods' },
  { id: 'c3', name: 'Orphan Leaf', active: true, isFinalized: false, l2Id: null },
] as unknown as CategoryL3[];

describe('CategoryTreeFilter renders', () => {
  it('renders without throwing with no selection', () => {
    expect(() => renderToString(<CategoryTreeFilter categories={CATS} value={null} onChange={noop} />)).not.toThrow();
  });

  it('shows "All Categories" when nothing is picked', () => {
    const html = renderToString(<CategoryTreeFilter categories={CATS} value={null} onChange={noop} />);
    expect(html).toContain('All Categories');
  });

  it("shows the picked node's label instead", () => {
    const html = renderToString(
      <CategoryTreeFilter
        categories={CATS}
        value={{ level: 'l2', id: 'l2a', label: 'Kitchen › Extractor Hoods' }}
        onChange={noop}
      />,
    );
    expect(html).toContain('Kitchen › Extractor Hoods');
  });

  it('renders with an empty category list', () => {
    expect(() => renderToString(<CategoryTreeFilter categories={[]} value={null} onChange={noop} />)).not.toThrow();
  });
});
