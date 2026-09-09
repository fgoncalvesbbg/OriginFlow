import { useEffect, useRef, useState } from 'react';
import { ALL_CATEGORIES, ALL_CATEGORIES_LABEL } from '../roadmap.constants';
import type { RoadmapCategory } from '../../../types';

/**
 * A searchable picker over the export's System Index values. There are ~160 of them, so a bare
 * `<select>` is unusable — this filters as you type and shows each category's SKU count.
 *
 * A pinned "All categories" row sits above the results (and is matched by the query too, so
 * typing "all" still finds it). Picking it feeds ALL_CATEGORIES to the rest of the page, which
 * only History and Summary know how to work with — the board and the ladder show a "pick one
 * category" notice instead of pretending to pivot everything at once.
 *
 * The count carries an "(n old)" suffix when a category holds delisted SKUs, so the guarantee is
 * visible before you even open the board.
 */

export interface CategoryComboProps {
  categories: RoadmapCategory[];
  value: string;
  onChange: (systemIndex: string) => void;
}

export default function CategoryCombo({ categories, value, onChange }: CategoryComboProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const filtered = query
    ? categories.filter(c => c.systemIndex.toLowerCase().includes(query.toLowerCase()))
    : categories;
  const showAllOption = !query || ALL_CATEGORIES_LABEL.toLowerCase().includes(query.toLowerCase());
  const totalSkuCount = categories.reduce((sum, c) => sum + c.skuCount, 0);

  const displayValue = value === ALL_CATEGORIES ? ALL_CATEGORIES_LABEL : value;

  const pick = (systemIndex: string) => {
    onChange(systemIndex);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="rdmp-combo" ref={wrapRef}>
      <input
        className="rdmp-input rdmp-combo-input"
        value={open ? query : displayValue}
        placeholder="Search categories…"
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
          }
          if (e.key === 'Enter') {
            if (showAllOption) pick(ALL_CATEGORIES);
            else if (filtered.length) pick(filtered[0].systemIndex);
          }
        }}
      />
      {open && (
        <div className="rdmp-combo-list" role="listbox">
          {!showAllOption && filtered.length === 0 ? (
            <div className="rdmp-combo-empty">No matches</div>
          ) : (
            <>
              {showAllOption && (
                <button
                  type="button"
                  role="option"
                  aria-selected={value === ALL_CATEGORIES}
                  className={`rdmp-combo-item is-all${value === ALL_CATEGORIES ? ' is-sel' : ''}`}
                  onClick={() => pick(ALL_CATEGORIES)}
                >
                  <span>{ALL_CATEGORIES_LABEL}</span>
                  <span className="rdmp-combo-count">{totalSkuCount}</span>
                </button>
              )}
              {filtered.map(c => (
                <button
                  key={c.systemIndex}
                  type="button"
                  role="option"
                  aria-selected={c.systemIndex === value}
                  className={`rdmp-combo-item${c.systemIndex === value ? ' is-sel' : ''}`}
                  onClick={() => pick(c.systemIndex)}
                >
                  <span>{c.systemIndex}</span>
                  <span className="rdmp-combo-count">
                    {c.skuCount}
                    {c.currentCount < c.skuCount && (
                      <em title={`${c.skuCount - c.currentCount} not in latest file`}>
                        {' '}
                        ({c.skuCount - c.currentCount} old)
                      </em>
                    )}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
