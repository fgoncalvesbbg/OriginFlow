/**
 * Category filter popover: pick any node of the L1 › L2 › L3 tree, not just a leaf.
 *
 * Picking an L1 or L2 matches every leaf under it (see `matchesCategoryFilter` in the
 * caller) — a PM narrowing "Large Appliances" shouldn't have to know or pick all of its
 * ~20 leaves one at a time. Search filters the tree in place and auto-expands any branch
 * with a match, rather than replacing the tree with a flat result list, so the picked
 * node's position in the hierarchy stays visible.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryL3 } from '../../types';
import { ChevronDown, ChevronRight, Tag, X } from 'lucide-react';

export type CategoryFilterLevel = 'l1' | 'l2' | 'l3';

export interface CategoryFilterValue {
  level: CategoryFilterLevel;
  id: string;
  label: string;
}

interface L3Node { id: string; name: string; active: boolean }
interface L2Node { id: string; name: string; children: L3Node[] }
interface L1Node { id: string; name: string; children: L2Node[] }

/**
 * Nest the flat leaf list into L1 > L2 > L3, in the tree order `getCategories()` returns.
 * A leaf with no L1/L2 parent (see `category-tree.utils.ts`) is a legitimate orphan, not a
 * bug — it is returned separately rather than forced under a fake L1/L2 id, because there
 * is no real id to filter on if that whole group were picked.
 */
const buildTree = (categories: CategoryL3[]): { l1: L1Node[]; uncategorised: L3Node[] } => {
  const l1Map = new Map<string, L1Node>();
  const uncategorised: L3Node[] = [];

  for (const c of categories) {
    if (!c.l1Id || !c.l2Id) { uncategorised.push({ id: c.id, name: c.name, active: c.active }); continue; }
    let l1 = l1Map.get(c.l1Id);
    if (!l1) { l1 = { id: c.l1Id, name: c.l1Name || c.l1Id, children: [] }; l1Map.set(c.l1Id, l1); }
    let l2 = l1.children.find(g => g.id === c.l2Id);
    if (!l2) { l2 = { id: c.l2Id, name: c.l2Name || c.l2Id, children: [] }; l1.children.push(l2); }
    l2.children.push({ id: c.id, name: c.name, active: c.active });
  }

  return { l1: [...l1Map.values()], uncategorised };
};

const matchesQuery = (name: string, q: string) => name.toLowerCase().includes(q);

interface Props {
  categories: CategoryL3[];
  value: CategoryFilterValue | null;
  onChange: (value: CategoryFilterValue | null) => void;
  className?: string;
}

export const CategoryTreeFilter: React.FC<Props> = ({ categories, value, onChange, className }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedL1, setExpandedL1] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedL2, setExpandedL2] = useState<ReadonlySet<string>>(() => new Set());
  const [uncategorisedOpen, setUncategorisedOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) { setOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const tree = useMemo(() => buildTree(categories), [categories]);

  const q = search.trim().toLowerCase();
  // With a query, every branch that contains a match auto-expands; without one, expansion
  // is manual (via `expandedL1`/`expandedL2`) so the tree opens collapsed by default.
  const visibleL1 = useMemo(() => {
    if (!q) return tree.l1;
    return tree.l1
      .map(l1 => {
        const l1Hit = matchesQuery(l1.name, q);
        const children = l1.children
          .map(l2 => {
            const l2Hit = matchesQuery(l2.name, q);
            const leaves = l1Hit || l2Hit ? l2.children : l2.children.filter(l3 => matchesQuery(l3.name, q));
            return leaves.length > 0 ? { ...l2, children: leaves } : null;
          })
          .filter((g): g is L2Node => g !== null);
        return children.length > 0 ? { ...l1, children } : null;
      })
      .filter((n): n is L1Node => n !== null);
  }, [tree, q]);

  const visibleUncategorised = useMemo(
    () => (q ? tree.uncategorised.filter(l3 => matchesQuery(l3.name, q)) : tree.uncategorised),
    [tree, q],
  );

  const isExpandedL1 = (id: string) => (q ? true : expandedL1.has(id));
  const isExpandedL2 = (id: string) => (q ? true : expandedL2.has(id));
  const isUncategorisedOpen = q ? visibleUncategorised.length > 0 : uncategorisedOpen;
  const toggleL1 = (id: string) => setExpandedL1(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleL2 = (id: string) => setExpandedL2(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pick = (level: CategoryFilterLevel, id: string, label: string) => {
    onChange({ level, id, label });
    setOpen(false);
    setSearch('');
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md transition-colors ${
          value ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-300 bg-white text-gray-600 hover:text-gray-800'
        }`}
      >
        <Tag size={14} />
        <span className="max-w-[160px] truncate">{value ? value.label : 'All Categories'}</span>
        {value ? (
          <X size={13} className="hover:text-indigo-900" onClick={clear} />
        ) : (
          <ChevronDown size={13} className="text-gray-400" />
        )}
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-80 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="sticky top-0 bg-white border-b border-gray-100 p-2">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search L1 / L2 / L3…"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
          <ul className="py-1">
            <li>
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); setSearch(''); }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50/60 ${!value ? 'font-semibold text-indigo-700' : 'text-gray-700'}`}
              >
                All Categories
              </button>
            </li>
            {visibleL1.length === 0 && visibleUncategorised.length === 0 ? (
              <li className="px-3 py-4 text-xs text-center text-gray-400 italic">No category matches “{search}”.</li>
            ) : (
              visibleL1.map(l1 => (
                <li key={l1.id}>
                  <div className="flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      onClick={() => toggleL1(l1.id)}
                      className="p-1.5 text-gray-400 hover:text-gray-600"
                      aria-label={isExpandedL1(l1.id) ? 'Collapse' : 'Expand'}
                    >
                      {isExpandedL1(l1.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => pick('l1', l1.id, l1.name)}
                      className={`flex-1 text-left py-1.5 text-sm font-semibold hover:text-indigo-700 ${
                        value?.level === 'l1' && value.id === l1.id ? 'text-indigo-700' : 'text-gray-800'
                      }`}
                    >
                      {l1.name}
                    </button>
                  </div>
                  {isExpandedL1(l1.id) && (
                    <ul>
                      {l1.children.map(l2 => (
                        <li key={l2.id}>
                          <div className="flex items-center gap-1 pl-6 pr-2">
                            <button
                              type="button"
                              onClick={() => toggleL2(l2.id)}
                              className="p-1.5 text-gray-400 hover:text-gray-600"
                              aria-label={isExpandedL2(l2.id) ? 'Collapse' : 'Expand'}
                            >
                              {isExpandedL2(l2.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => pick('l2', l2.id, `${l1.name} › ${l2.name}`)}
                              className={`flex-1 text-left py-1.5 text-sm font-medium hover:text-indigo-700 ${
                                value?.level === 'l2' && value.id === l2.id ? 'text-indigo-700' : 'text-gray-700'
                              }`}
                            >
                              {l2.name}
                            </button>
                          </div>
                          <ul>
                            {l2.children.map(l3 => (
                              <li key={l3.id}>
                                <button
                                  type="button"
                                  onClick={() => pick('l3', l3.id, `${l1.name} › ${l2.name} › ${l3.name}`)}
                                  className={`w-full text-left pl-11 pr-3 py-1.5 text-sm hover:bg-indigo-50/60 hover:text-indigo-700 ${
                                    value?.level === 'l3' && value.id === l3.id ? 'text-indigo-700 font-medium' : 'text-gray-600'
                                  }`}
                                >
                                  {l3.name}{l3.active ? '' : ' (inactive)'}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))
            )}
            {visibleUncategorised.length > 0 && (
              <li>
                <div className="flex items-center gap-1 pr-2">
                  <button
                    type="button"
                    onClick={() => setUncategorisedOpen(o => !o)}
                    className="p-1.5 text-gray-400 hover:text-gray-600"
                    aria-label={isUncategorisedOpen ? 'Collapse' : 'Expand'}
                  >
                    {isUncategorisedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  {/* Not itself pickable — there is no real L1/L2 id behind this bucket, only
                      the individual leaves it collects. */}
                  <span className="flex-1 py-1.5 text-sm font-semibold text-gray-500 italic">
                    Uncategorised
                  </span>
                </div>
                {isUncategorisedOpen && (
                  <ul>
                    {visibleUncategorised.map(l3 => (
                      <li key={l3.id}>
                        <button
                          type="button"
                          onClick={() => pick('l3', l3.id, l3.name)}
                          className={`w-full text-left pl-11 pr-3 py-1.5 text-sm hover:bg-indigo-50/60 hover:text-indigo-700 ${
                            value?.level === 'l3' && value.id === l3.id ? 'text-indigo-700 font-medium' : 'text-gray-600'
                          }`}
                        >
                          {l3.name}{l3.active ? '' : ' (inactive)'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CategoryTreeFilter;
