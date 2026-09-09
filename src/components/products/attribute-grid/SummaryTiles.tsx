/**
 * The summary strip — six numbers about the open category, each a **toggle**, not a one-way
 * door.
 *
 * Clicking the tile for a filter that is already on turns it back OFF, so nobody ends up in a
 * filtered grid they cannot find their way out of by clicking the thing that got them there.
 * That is the whole reason these are buttons rather than read-outs.
 *
 * The numbers describe the WHOLE category, not the filtered view: a tile is how you get to a
 * filtered view, so showing the filtered count would make each tile describe the state it just
 * put you in rather than the state you might want next.
 *
 * Phase 4 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import React from 'react';
import type { ColumnFilter, GridSummary, RowFilter } from './grid-filters.utils';

interface Props {
  summary: GridSummary;
  rowFilter: RowFilter;
  columnFilter: ColumnFilter;
  onRowFilter: (f: RowFilter) => void;
  onColumnFilter: (f: ColumnFilter) => void;
}

interface Tile {
  key: string;
  label: string;
  value: string;
  hint: string;
  /** Absent = this tile is a read-out with no filter behind it. */
  active?: boolean;
  onClick?: () => void;
  tone?: 'neutral' | 'warn' | 'bad';
}

const TONES: Record<NonNullable<Tile['tone']>, string> = {
  neutral: 'text-primary',
  warn: 'text-amber-600',
  bad: 'text-red-600',
};

const SummaryTiles: React.FC<Props> = ({
  summary,
  rowFilter,
  columnFilter,
  onRowFilter,
  onColumnFilter,
}) => {
  // A toggle: the same filter twice means off.
  const row = (f: RowFilter) => () => onRowFilter(rowFilter === f ? 'all' : f);
  const col = (f: ColumnFilter) => () => onColumnFilter(columnFilter === f ? 'all' : f);

  const tiles: Tile[] = [
    {
      key: 'skus',
      label: `SKU${summary.skus === 1 ? '' : 's'} · attributes`,
      value: `${summary.skus} · ${summary.attributes}`,
      hint: 'Every SKU this category holds, and the attributes defined for it.',
    },
    {
      key: 'coverage',
      label: 'Coverage',
      value: `${summary.coveragePercent}%`,
      hint: `${summary.filledCells} of ${summary.totalCells} cells have a value. Click to show only the attributes that are not complete.`,
      active: rowFilter === 'incomplete',
      onClick: row('incomplete'),
    },
    {
      key: 'required',
      label: 'Required gaps',
      value: String(summary.requiredGaps),
      hint:
        'Cells that a required attribute leaves empty. Required-ness is per attribute rather ' +
        'than per category, so a global rule applies everywhere it appears.',
      active: rowFilter === 'required-gap',
      onClick: row('required-gap'),
      tone: summary.requiredGaps > 0 ? 'warn' : 'neutral',
    },
    {
      key: 'invalid',
      label: 'Invalid values',
      value: String(summary.invalidCells),
      hint:
        'Values the attribute cannot hold — an off-list option, or a non-number in a numeric ' +
        'field. Usually a definition that changed underneath stored values.',
      active: rowFilter === 'invalid',
      onClick: row('invalid'),
      tone: summary.invalidCells > 0 ? 'bad' : 'neutral',
    },
    {
      key: 'duplicates',
      label: 'Duplicate numbers',
      value: String(summary.duplicateRecords),
      hint:
        'SKU records whose item number also names another record. Nothing merges them — they ' +
        'are shown as separate columns.',
      active: columnFilter === 'duplicates',
      onClick: col('duplicates'),
      tone: summary.duplicateRecords > 0 ? 'warn' : 'neutral',
    },
    {
      key: 'no-project',
      label: 'Not in a project',
      value: String(summary.withoutProject),
      hint:
        'Catalog SKUs, with no project attached. This is the population most likely to have ' +
        'gaps, and the one the old project-only view could not see at all.',
      active: columnFilter === 'no-project',
      onClick: col('no-project'),
    },
  ];

  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map(t => {
        const clickable = !!t.onClick;
        const Tag = clickable ? 'button' : 'div';
        return (
          <Tag
            key={t.key}
            {...(clickable
              ? { onClick: t.onClick, 'aria-pressed': !!t.active, type: 'button' as const }
              : {})}
            title={t.hint}
            className={`rounded-lg border p-2.5 text-left transition-colors ${
              t.active
                ? 'border-indigo-400 bg-indigo-50'
                : `border-gray-200 bg-white ${clickable ? 'hover:border-indigo-300 hover:bg-gray-50' : ''}`
            }`}
          >
            <div className={`text-lg font-bold tabular-nums ${TONES[t.tone ?? 'neutral']}`}>
              {t.value}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">{t.label}</div>
            {/* Colour is never the only carrier: an active tile says so in words too. */}
            {t.active && (
              <div className="mt-0.5 text-[10px] font-semibold text-indigo-700">
                filtering · click to clear
              </div>
            )}
          </Tag>
        );
      })}
    </div>
  );
};

export default SummaryTiles;
