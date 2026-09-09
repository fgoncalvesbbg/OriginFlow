import { useState } from 'react';
import { Plus } from 'lucide-react';
import { searchSkus } from '../search';
import { useSearchCombo } from '../use-search-combo';
import type { RoadmapSku } from '../../../types';

/**
 * "+ Compare with…", as a type-to-search picker.
 *
 * This replaced a bare `<select>` over every SKU on the board. A category can carry a few hundred
 * products, and the one you want to compare against is one you already have in mind — scrolling a
 * native dropdown to find it is the slow way to express that.
 *
 * Two things make it fast enough to use mid-conversation:
 *   · the query matches the SKU number OR the description, term by term, so "fan 122" and "10035"
 *     both land — nobody remembers which half of the label they know;
 *   · the input KEEPS FOCUS after a pick, so adding a third and fourth column is
 *     type-enter, type-enter, without ever going back to the mouse.
 */

/**
 * Rendered rows are capped: past this the list is a scrolling wall, and typing one more character
 * is faster than reading it. The count of what is left is shown instead.
 */
const MAX_ROWS = 50;

export interface CompareComboProps {
  options: RoadmapSku[];
  onPick: (sku: string) => void;
}

export default function CompareCombo({ options, onPick }: CompareComboProps) {
  const [query, setQuery] = useState('');
  const hits = searchSkus(options, query);
  const shown = hits.slice(0, MAX_ROWS);
  const overflow = hits.length - shown.length;

  const { open, setOpen, active, setActive, wrapRef, inputRef, activeRef, onKeyDown, pick } =
    useSearchCombo<RoadmapSku>({
      shown,
      // Cleared, not closed: the common case after adding one column is adding another.
      onPick: record => {
        onPick(record.sku);
        setQuery('');
      },
    });

  if (!options.length) return null;

  return (
    <div className="rdmp-combo rdmp-cmpcombo" ref={wrapRef}>
      <input
        ref={inputRef}
        className="rdmp-input rdmp-combo-input rdmp-cmpcombo-input"
        value={query}
        placeholder="+ Compare with… (type a SKU or name)"
        aria-label="Add a SKU to the comparison"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="rdmp-cmpcombo-list"
        onFocus={() => setOpen(true)}
        onChange={e => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="rdmp-combo-list" id="rdmp-cmpcombo-list" role="listbox">
          {shown.length === 0 ? (
            <div className="rdmp-combo-empty">No SKU matches “{query.trim()}”.</div>
          ) : (
            <>
              {shown.map((r, i) => (
                <button
                  key={r.sku}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  ref={i === active ? activeRef : null}
                  className={`rdmp-combo-item${i === active ? ' is-sel' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(r)}
                >
                  <span className="rdmp-cmpcombo-sku">
                    <Plus size={11} /> {r.sku}
                  </span>
                  <span className="rdmp-cmpcombo-desc">{r.description || '—'}</span>
                </button>
              ))}
              {overflow > 0 && (
                <div className="rdmp-combo-empty">
                  {overflow} more — keep typing to narrow it down.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
