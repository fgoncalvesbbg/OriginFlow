/**
 * AttributePicker — a single, reusable searchable attribute selector used by every
 * "make this conditional" flow in the IM template editor (chapter/section conditions,
 * inline-text conditions and shared-block conditions).
 *
 * It only ever lists attributes applicable to the current category (the caller passes the
 * already category-scoped list, e.g. `categoryFeatures`) and lets the author filter that
 * list with a simple search. Optional non-attribute choices (e.g. inline text's "Manual
 * Selection") can be surfaced via `leadingOptions`.
 */
import { useMemo, useState } from 'react';
import { Search, Check } from 'lucide-react';
import { CategoryAttribute } from '../../../types';

export interface AttributePickerLeadingOption {
  id: string;
  label: string;
  hint?: string;
}

interface AttributePickerProps {
  /** Attributes to choose from — already scoped to the current category by the caller. */
  attributes: CategoryAttribute[];
  /** Currently selected id (an attribute id, a leading-option id, or '' for none). */
  value: string;
  onChange: (id: string) => void;
  /** Non-attribute choices rendered above the list (e.g. inline text's "Manual Selection"). */
  leadingOptions?: AttributePickerLeadingOption[];
  /** Colour theme, matched to the host modal. */
  accent?: 'indigo' | 'violet';
  /** Placeholder for the search box. */
  searchPlaceholder?: string;
  /** Message shown when nothing matches the search. */
  emptyText?: string;
}

const ACCENT = {
  indigo: {
    ring: 'focus:ring-indigo-500',
    selBorder: 'border-indigo-400',
    selBg: 'bg-indigo-50',
    selText: 'text-indigo-800',
    hover: 'hover:bg-indigo-50',
    check: 'text-indigo-600',
  },
  violet: {
    ring: 'focus:ring-violet-500',
    selBorder: 'border-violet-400',
    selBg: 'bg-violet-50',
    selText: 'text-violet-800',
    hover: 'hover:bg-violet-50',
    check: 'text-violet-600',
  },
} as const;

export function AttributePicker({
  attributes,
  value,
  onChange,
  leadingOptions = [],
  accent = 'indigo',
  searchPlaceholder = 'Search attributes…',
  emptyText = 'No attributes match your search.',
}: AttributePickerProps) {
  const [query, setQuery] = useState('');
  const c = ACCENT[accent];

  // Group the (search-filtered) attributes by their attribute group so long lists stay scannable.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = attributes.filter(a =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      a.dataType.toLowerCase().includes(q) ||
      (a.group ?? '').toLowerCase().includes(q)
    );
    const byGroup = new Map<string, CategoryAttribute[]>();
    for (const a of matches) {
      const g = a.group?.trim() || 'General';
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(a);
    }
    return Array.from(byGroup.entries());
  }, [attributes, query]);

  const totalMatches = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Search */}
      <div className="relative border-b border-gray-100">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          autoFocus
          type="text"
          className={`w-full pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 ${c.ring}`}
          placeholder={searchPlaceholder}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* Options */}
      <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5">
        {/* Leading (non-attribute) options — always visible, not affected by search */}
        {leadingOptions.map(opt => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-md border text-sm transition-colors ${
                selected ? `${c.selBorder} ${c.selBg} ${c.selText}` : `border-transparent ${c.hover} text-gray-700`
              }`}
            >
              <Check size={14} className={selected ? c.check : 'text-transparent'} />
              <span className="flex-1 min-w-0">
                <span className="font-medium">{opt.label}</span>
                {opt.hint && <span className="block text-xs text-gray-400">{opt.hint}</span>}
              </span>
            </button>
          );
        })}

        {leadingOptions.length > 0 && totalMatches > 0 && <div className="my-1 border-t border-gray-100" />}

        {totalMatches === 0 && (
          <p className="text-center py-6 text-xs text-gray-400 italic">{emptyText}</p>
        )}

        {groups.map(([group, list]) => (
          <div key={group}>
            <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{group}</p>
            {list.map(a => {
              const selected = value === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onChange(a.id)}
                  className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-md border text-sm transition-colors ${
                    selected ? `${c.selBorder} ${c.selBg} ${c.selText}` : `border-transparent ${c.hover} text-gray-700`
                  }`}
                >
                  <Check size={14} className={selected ? c.check : 'text-transparent'} />
                  <span className="flex-1 min-w-0 truncate">{a.name}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{a.dataType}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
