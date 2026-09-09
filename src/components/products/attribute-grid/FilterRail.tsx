/**
 * Every filter in one panel that collapses to a RAIL.
 *
 * The rail carries the number of active filters, so **a collapsed panel can never conceal that
 * it is filtering**. That is the point of the whole component: a hidden panel plus a filtered
 * grid is how somebody concludes a category has 4 SKUs when it has 138.
 *
 * Phase 4 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import React from 'react';
import type { CategoryAttribute } from '../../../types';
import {
  COLUMN_FILTER_LABELS,
  NO_VALUE,
  ROW_FILTER_LABELS,
  activeFilterCount,
  type ColumnFilter,
  type GridFilterState,
  type RowFilter,
} from './grid-filters.utils';
import { Filter, PanelLeftClose, PanelLeftOpen, X, Plus } from 'lucide-react';

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  filters: GridFilterState;
  onChange: (next: GridFilterState) => void;
  attributes: readonly CategoryAttribute[];
  /** Distinct stored values per attribute, for the value-filter dropdown. */
  valueOptions: Map<string, string[]>;
}

const FilterRail: React.FC<Props> = ({
  collapsed,
  onToggleCollapsed,
  filters,
  onChange,
  attributes,
  valueOptions,
}) => {
  const count = activeFilterCount(filters);
  const [newAttr, setNewAttr] = React.useState('');
  const [newValue, setNewValue] = React.useState('');

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-l-xl border border-r-0 border-gray-200 bg-white py-3 hover:bg-gray-50"
        title={count > 0 ? `${count} filter${count === 1 ? '' : 's'} active` : 'Show filters'}
        aria-expanded={false}
      >
        <PanelLeftOpen size={15} className="text-gray-400" />
        <Filter size={15} className={count > 0 ? 'text-indigo-600' : 'text-gray-400'} />
        {/* The count is the whole reason this rail exists. */}
        {count > 0 && (
          <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
        <span
          className="text-[10px] uppercase tracking-wide text-gray-400"
          style={{ writingMode: 'vertical-rl' }}
        >
          {count > 0 ? 'filtering' : 'filters'}
        </span>
      </button>
    );
  }

  const set = (patch: Partial<GridFilterState>) => onChange({ ...filters, ...patch });

  const addValueFilter = () => {
    if (!newAttr || newValue === '') return;
    set({ valueFilters: [...filters.valueFilters, { attributeId: newAttr, value: newValue }] });
    setNewAttr('');
    setNewValue('');
  };

  const attrName = (id: string) => attributes.find(a => a.id === id)?.name ?? id;

  return (
    <aside className="w-60 shrink-0 space-y-4 rounded-l-xl border border-r-0 border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
          <Filter size={13} /> Filters
          {count > 0 && (
            <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white">
              {count}
            </span>
          )}
        </span>
        <button
          onClick={onToggleCollapsed}
          aria-expanded
          title="Collapse to a rail"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {count > 0 && (
        <button
          onClick={() =>
            onChange({
              search: '',
              rowFilter: 'all',
              columnFilter: 'all',
              valueFilters: [],
              flaggedOnly: false,
            })
          }
          className="w-full rounded border border-gray-300 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
        >
          Clear all filters
        </button>
      )}

      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gray-500">
          Attribute rows
        </label>
        <select
          value={filters.rowFilter}
          onChange={e => set({ rowFilter: e.target.value as RowFilter })}
          className="w-full rounded border border-gray-300 p-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {(Object.keys(ROW_FILTER_LABELS) as RowFilter[]).map(f => (
            <option key={f} value={f}>
              {ROW_FILTER_LABELS[f]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gray-500">
          SKU columns
        </label>
        <select
          value={filters.columnFilter}
          onChange={e => set({ columnFilter: e.target.value as ColumnFilter })}
          className="w-full rounded border border-gray-300 p-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {(Object.keys(COLUMN_FILTER_LABELS) as ColumnFilter[]).map(f => (
            <option key={f} value={f}>
              {COLUMN_FILTER_LABELS[f]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gray-500">
          Per-attribute value
        </label>
        <div className="space-y-1">
          {filters.valueFilters.map((f, i) => (
            <span
              key={`${f.attributeId}-${i}`}
              className="flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-1 text-[11px] text-indigo-800"
            >
              <span className="min-w-0 flex-1 truncate">
                {attrName(f.attributeId)}:{' '}
                {f.value === NO_VALUE ? <em>no value</em> : `“${f.value}”`}
              </span>
              <button
                onClick={() =>
                  set({ valueFilters: filters.valueFilters.filter((_, idx) => idx !== i) })
                }
                aria-label="Remove filter"
                className="shrink-0 hover:text-indigo-900"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>

        <select
          value={newAttr}
          onChange={e => {
            setNewAttr(e.target.value);
            setNewValue('');
          }}
          className="mt-1 w-full rounded border border-gray-300 p-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Attribute…</option>
          {attributes.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {newAttr && (
          <>
            <select
              value={newValue}
              onChange={e => setNewValue(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {/* A blank <option> would mean "no option chosen", which is indistinguishable
                  from "filter for a blank". Hence the spelled-out sentinel. */}
              <option value="">Value…</option>
              <option value={NO_VALUE}>— no value —</option>
              {(valueOptions.get(newAttr) ?? []).map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <button
              onClick={addValueFilter}
              disabled={newValue === ''}
              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
            >
              <Plus size={11} /> Add filter
            </button>
          </>
        )}
      </div>

      <label className="flex items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-700">
        <input
          type="checkbox"
          checked={filters.flaggedOnly}
          onChange={e => set({ flaggedOnly: e.target.checked })}
          className="accent-indigo-600"
        />
        Only rows with an open flag
      </label>
    </aside>
  );
};

export default FilterRail;
