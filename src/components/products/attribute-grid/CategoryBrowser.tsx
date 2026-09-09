/**
 * The Attribute Viewer's entry point — not a filter.
 *
 * Nothing loads until something is picked, because opening a category means reading every
 * attribute of every one of its SKUs. And it shows the HIERARCHY rather than a flat list
 * because the catalogue is ~200 categories and nobody holds that as one list — they hold it as
 * "the hoods under Kitchen".
 *
 * **A category with no attributes defined is listed and marked, never hidden.** Only three of
 * the ~200 categories carry a real definition today, so "no definition yet" is the single most
 * useful thing this screen can say — a thing to fix, not a category to leave out.
 *
 * Phase 4 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import React, { useMemo, useState } from 'react';
import type { CategoryL3 } from '../../../types';
import { groupByL1L2 } from '../../../utils/category-tree.utils';
import Thumb from './Thumb';
import { ChevronDown, ChevronRight, AlertTriangle, Search, Table2 } from 'lucide-react';

interface Props {
  categories: readonly CategoryL3[];
  /** SKU count per category id. */
  skuCounts: Map<string, number>;
  /** Defined attribute count per category id. */
  attributeCounts: Map<string, number>;
  /** Up to three item numbers per category, so the section can carry a picture. */
  sampleSkus: Map<string, string[]>;
  onPick: (categoryId: string) => void;
}

const CategoryBrowser: React.FC<Props> = ({
  categories,
  skuCounts,
  attributeCounts,
  sampleSkus,
  onPick,
}) => {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.l1Name ?? '').toLowerCase().includes(q) ||
        (c.l2Name ?? '').toLowerCase().includes(q),
    );
  }, [categories, search]);

  const groups = useMemo(() => groupByL1L2([...matching]), [matching]);

  const toggle = (key: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const withoutDefinition = categories.filter(c => (attributeCounts.get(c.id) ?? 0) === 0).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 p-4">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Find a category…"
            className="w-full rounded border border-gray-300 p-2 pl-8 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
          {withoutDefinition > 0 && (
            <>
              {' · '}
              <span className="text-amber-700">
                {withoutDefinition} with no attributes defined yet
              </span>
            </>
          )}
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted">No category matches “{search}”.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {groups.map(group => {
            const isCollapsed = collapsed.has(group.key);
            const groupSkus = group.categories.reduce(
              (n, c) => n + (skuCounts.get(c.id) ?? 0),
              0,
            );
            const pictures = group.categories.flatMap(c => sampleSkus.get(c.id) ?? []).slice(0, 3);

            return (
              <li key={group.key}>
                <button
                  onClick={() => toggle(group.key)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span className="text-sm font-semibold text-primary">{group.label}</span>
                  <span className="text-[11px] text-gray-400">
                    {group.categories.length} categor
                    {group.categories.length === 1 ? 'y' : 'ies'} · {groupSkus} SKU
                    {groupSkus === 1 ? '' : 's'}
                  </span>
                  {/* The picture stands for the whole section, so which item provides it does
                      not matter — only that something loads. Hence three candidates. */}
                  {pictures.length > 0 && (
                    <span className="ml-auto flex items-center gap-1">
                      {pictures.map(n => (
                        <Thumb key={n} skuNumbers={[n]} size={24} width={60} />
                      ))}
                    </span>
                  )}
                </button>

                {!isCollapsed && (
                  <ul className="pb-1">
                    {group.categories.map(c => {
                      const attrs = attributeCounts.get(c.id) ?? 0;
                      const skus = skuCounts.get(c.id) ?? 0;
                      const defined = attrs > 0;
                      return (
                        <li key={c.id}>
                          <button
                            onClick={() => onPick(c.id)}
                            className="flex w-full items-center gap-2 py-1.5 pl-11 pr-4 text-left hover:bg-indigo-50/40"
                          >
                            <Table2 size={13} className="shrink-0 text-indigo-400" />
                            <span className="truncate text-sm text-gray-800">{c.name}</span>
                            <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-gray-400">
                              <span>
                                {skus} SKU{skus === 1 ? '' : 's'}
                              </span>
                              {defined ? (
                                <span>{attrs} attributes</span>
                              ) : (
                                // Marked, not hidden. This is a thing to fix.
                                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                                  <AlertTriangle size={9} />
                                  no attributes yet
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default CategoryBrowser;
