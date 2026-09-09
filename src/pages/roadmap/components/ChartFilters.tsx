import { AXIS_FIELDS } from '../roadmap.constants';

/**
 * The editable filter state.
 *
 * Deliberately NOT `ChartFilters` from chart.ts: that one takes `ReadonlySet`, because the pure
 * `applyFilters` has no business mutating what it is handed. This is the mutable state the
 * component owns and the page holds. A `Set` satisfies `ReadonlySet`, so it flows into
 * `applyFilters` unchanged — the readonly-ness only points one way, which is the point.
 */
export interface ChartFilterState {
  families: Set<string>;
  suppliers: Set<string>;
  segField: string;
  segVals: Set<string>;
  title: string;
}

/**
 * Filter chips for the step-up chart.
 *
 * Toggling is multi-select WITHIN a group and conjunctive ACROSS groups — pick two families and
 * you see both; pick a family and a supplier and you see the intersection. See `applyFilters` in
 * chart.ts, which is where that rule actually lives.
 */

export interface ChartFilterOptions {
  families: string[];
  suppliers: string[];
  segValues: string[];
}

function Chips({
  values,
  selected,
  onToggle,
  empty,
}: {
  values: string[];
  selected: ReadonlySet<string>;
  onToggle: (v: string) => void;
  empty: string;
}) {
  if (!values.length) return <span className="rdmp-chip-empty">{empty}</span>;
  return (
    <>
      {values.map(v => (
        <button
          key={v}
          type="button"
          className={`rdmp-chip${selected.has(v) ? ' is-on' : ''}`}
          aria-pressed={selected.has(v)}
          onClick={() => onToggle(v)}
        >
          {v}
        </button>
      ))}
    </>
  );
}

export interface ChartFiltersProps {
  options: ChartFilterOptions;
  filters: ChartFilterState;
  onChange: (next: ChartFilterState) => void;
  onClear: () => void;
}

export default function ChartFilters({ options, filters, onChange, onClear }: ChartFiltersProps) {
  const toggle = (key: 'families' | 'suppliers' | 'segVals', value: string) => {
    const next = new Set(filters[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange({ ...filters, [key]: next });
  };

  const activeCount =
    filters.families.size +
    filters.suppliers.size +
    filters.segVals.size +
    (filters.title.trim() ? 1 : 0);

  return (
    <div className="rdmp-filters">
      <div className="rdmp-fbox">
        <span className="rdmp-fieldlabel">Family</span>
        <div className="rdmp-chiprow">
          <Chips
            values={options.families}
            selected={filters.families}
            onToggle={v => toggle('families', v)}
            empty="no families"
          />
        </div>
      </div>

      <div className="rdmp-fbox">
        <span className="rdmp-fieldlabel">Supplier</span>
        <div className="rdmp-chiprow">
          <Chips
            values={options.suppliers}
            selected={filters.suppliers}
            onToggle={v => toggle('suppliers', v)}
            empty="no suppliers"
          />
        </div>
      </div>

      <div className="rdmp-fbox">
        <span className="rdmp-fieldlabel">Segment</span>
        <select
          className="rdmp-select"
          value={filters.segField}
          // Changing the field clears the values: they belonged to the old field and would
          // otherwise sit selected while matching nothing.
          onChange={e => onChange({ ...filters, segField: e.target.value, segVals: new Set() })}
        >
          <option value="">— pick field —</option>
          {AXIS_FIELDS.map(f => (
            <option key={f}>{f}</option>
          ))}
        </select>
        {filters.segField && (
          <div className="rdmp-chiprow" style={{ marginTop: 4 }}>
            <Chips
              values={options.segValues}
              selected={filters.segVals}
              onToggle={v => toggle('segVals', v)}
              empty="no values"
            />
          </div>
        )}
      </div>

      <div className="rdmp-fbox">
        <span className="rdmp-fieldlabel">Title contains</span>
        <input
          className="rdmp-input"
          value={filters.title}
          placeholder="e.g. 122cm"
          onChange={e => onChange({ ...filters, title: e.target.value })}
        />
      </div>

      <button type="button" className="rdmp-btn" onClick={onClear} disabled={!activeCount}>
        Clear filters{activeCount ? ` (${activeCount})` : ''}
      </button>
    </div>
  );
}
