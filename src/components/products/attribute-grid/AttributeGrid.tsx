/**
 * The comparison grid: one row per attribute, one column per SKU.
 *
 * WHY THIS WAY ROUND, and it earns the shape twice:
 *  - A SKU **column** can carry an identity — thumbnail, number, title, tick box, status,
 *    counts. None of that fits beside a row.
 *  - An attribute **row** is one question asked of every product ("what is the grease-filter
 *    class here?"), so comparing across products is reading along a single line, and "which
 *    of these is missing it" is the gaps in that line.
 *  - Cluster grouping gets simpler: a full-width band row is a real, collapsible section
 *    heading, where a `colspan` band above 70 columns was only a label.
 *
 * Both axes are sticky. A value is meaningless without both of its coordinates, and at this
 * size you are always scrolled away from at least one of them.
 *
 * All the maths lives in grid.utils.ts, pure and fixture-tested. This file is rendering and
 * event plumbing.
 *
 * Phase 2 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CategoryAttribute,
  SkuAttributeFlag,
  SkuAttributeValueRecord,
} from '../../../types';
import type { CategorySku } from '../../../services';
import type { EprelComparison } from './eprel-compare.utils';
import { cellKey, classifyCell } from '../../../utils/sku-attribute-value.utils';
import { CELL_STATES, EPREL_PRESENTATION } from './cell-state';
import SkuHeader, { type SkuHeaderCounts } from './SkuHeader';
import {
  buildClusterBands,
  nextCell,
  visibleRows,
  type CellPosition,
  type GridKey,
  type GridSort,
} from './grid.utils';
import { ChevronDown, ChevronRight, ArrowDown, ArrowUp, Flag, MessageSquare } from 'lucide-react';

interface Props {
  skus: readonly CategorySku[];
  attributes: readonly CategoryAttribute[];
  byCell: Map<string, SkuAttributeValueRecord>;
  flagMap: Record<string, SkuAttributeFlag>;
  /** Item numbers that name more than one record, and how many. */
  duplicateCounts: Map<string, number>;
  /**
   * Per-attribute coverage, computed by the caller over the WHOLE filtered category — not over
   * the columns this grid is currently rendering. "87 of 138 products answer this question" is
   * the useful number; "23 of the 25 on this page" is an artefact of where the pager is.
   */
  rowCoverage: Map<string, { filled: number; total: number }>;
  /**
   * The registry's verdict per cell, keyed by cellKey. Optional and arriving LATE on purpose:
   * EPREL is fetched after this grid has painted, so a slow or rate-limited public registry can
   * never delay or break the page. Absent = the axis has not been read (which is not the same
   * as "the registry agrees", and the header strip says which).
   */
  eprelByCell?: Map<string, EprelComparison>;
  sort: GridSort | null;
  onToggleSort: (attributeId: string) => void;
  selected: ReadonlySet<string>;
  onToggleSelected: (skuId: string) => void;
  onOpenSku: (skuId: string) => void;
  onOpenCell: (skuId: string, attributeId: string) => void;
  onCommitValue: (skuId: string, attribute: CategoryAttribute, value: string) => Promise<void>;
}

const AttributeGrid: React.FC<Props> = ({
  skus,
  attributes,
  byCell,
  flagMap,
  duplicateCounts,
  rowCoverage,
  eprelByCell,
  sort,
  onToggleSort,
  selected,
  onToggleSelected,
  onOpenSku,
  onOpenCell,
  onCommitValue,
}) => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState<CellPosition | null>(null);
  const [editing, setEditing] = useState<CellPosition | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const bands = useMemo(() => buildClusterBands(attributes), [attributes]);
  const rows = useMemo(() => visibleRows(bands, collapsed), [bands, collapsed]);
  const bounds = { rows: rows.length, cols: skus.length };

  // Collapsing a band can leave the selection pointing past the end of the visible rows.
  useEffect(() => {
    if (active && active.row >= rows.length) setActive(null);
  }, [rows.length, active]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  /** Per-column counts for the header: filled, invalid, open flags. */
  const columnCounts = useMemo(() => {
    const map = new Map<string, SkuHeaderCounts>();
    for (const sku of skus) {
      let filled = 0;
      let invalid = 0;
      let flags = 0;
      for (const attr of attributes) {
        const state = classifyCell(byCell.get(cellKey(sku.id, attr.id)), attr);
        if (state === 'filled' || state === 'invalid') filled += 1;
        if (state === 'invalid') invalid += 1;
        if (flagMap[cellKey(sku.id, attr.id)]?.status === 'open') flags += 1;
      }
      map.set(sku.id, { filled, invalid, flags, total: attributes.length });
    }
    return map;
  }, [skus, attributes, byCell, flagMap]);

  const toggleBand = (group: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const startEdit = useCallback(
    (pos: CellPosition) => {
      const attr = rows[pos.row];
      const sku = skus[pos.col];
      if (!attr || !sku) return;
      // A signed-off SKU is refused by the database anyway (migration 158). Not offering the
      // editor is the honest version of that: nobody should type into forty fields and only
      // then discover they cannot be saved.
      if (sku.isFinal) return;
      setDraft(byCell.get(cellKey(sku.id, attr.id))?.value ?? '');
      setEditing(pos);
    },
    [rows, skus, byCell],
  );

  /** Save the open editor, then move the selection the way the key that committed it means. */
  const commitAndMove = useCallback(
    async (key: GridKey | null) => {
      if (!editing) return;
      const attr = rows[editing.row];
      const sku = skus[editing.col];
      setEditing(null);
      if (attr && sku) {
        const stored = byCell.get(cellKey(sku.id, attr.id))?.value ?? '';
        // A blank commit is dropped rather than written: emptying a field on purpose is the
        // Clear action in the SKU drawer, and a blank here cannot say which one is meant.
        if (draft.trim() !== '' && draft !== stored) {
          await onCommitValue(sku.id, attr, draft);
        }
      }
      if (key) {
        const moved = nextCell(editing, key, bounds);
        if (moved) setActive(moved);
      }
    },
    [editing, rows, skus, byCell, draft, onCommitValue, bounds],
  );

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (!active) return;

    if (editing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEditing(null);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        void commitAndMove('Enter');
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        void commitAndMove(e.shiftKey ? 'ShiftTab' : 'Tab');
        return;
      }
      return; // every other key belongs to the input
    }

    // Shift+Enter opens the whole SKU, for filling one product in from empty.
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const sku = skus[active.col];
      if (sku) onOpenSku(sku.id);
      return;
    }

    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      startEdit(active);
      return;
    }

    const key: GridKey | null =
      e.key === 'Tab'
        ? e.shiftKey
          ? 'ShiftTab'
          : 'Tab'
        : e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight'
          ? (e.key as GridKey)
          : null;
    if (!key) return;
    e.preventDefault();
    const moved = nextCell(active, key, bounds);
    if (moved) setActive(moved);
  };

  if (skus.length === 0 || attributes.length === 0) return null;

  let rowIndex = -1;

  return (
    <div
      className="overflow-auto max-h-[calc(100vh-340px)] outline-none"
      tabIndex={0}
      onKeyDown={onGridKeyDown}
      role="grid"
      aria-label="Attribute comparison grid"
    >
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-[240px] border-b border-r border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-gray-500">
              Attribute
            </th>
            {skus.map(sku => (
              <th
                key={sku.id}
                className="sticky top-0 z-20 min-w-[150px] border-b border-r border-gray-200 bg-gray-50 px-2 py-2 align-top text-left"
              >
                <SkuHeader
                  skuNumber={sku.skuNumber}
                  skuTitle={sku.skuTitle}
                  projectName={sku.projectName}
                  isFinal={sku.isFinal}
                  reopenReason={sku.reopenReason}
                  duplicateCount={(duplicateCounts.get(sku.skuNumber) ?? 1) - 1}
                  counts={
                    columnCounts.get(sku.id) ?? { filled: 0, total: 0, invalid: 0, flags: 0 }
                  }
                  selected={selected.has(sku.id)}
                  onToggleSelected={() => onToggleSelected(sku.id)}
                  onOpenSku={() => onOpenSku(sku.id)}
                />
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {bands.map(band => {
            const isCollapsed = collapsed.has(band.group);
            return (
              <React.Fragment key={band.group}>
                {/* A real section heading, not a label: the whole band collapses. */}
                <tr>
                  <th
                    colSpan={skus.length + 1}
                    className="sticky left-0 z-10 border-y border-gray-200 bg-gray-100 px-3 py-1.5 text-left"
                  >
                    <button
                      onClick={() => toggleBand(band.group)}
                      className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-600 hover:text-gray-900"
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      {band.group}
                      <span className="font-normal normal-case text-gray-400">
                        {band.attributes.length} attribute
                        {band.attributes.length === 1 ? '' : 's'}
                      </span>
                    </button>
                  </th>
                </tr>

                {!isCollapsed &&
                  band.attributes.map(attr => {
                    rowIndex += 1;
                    const thisRow = rowIndex;
                    const cov = rowCoverage.get(attr.id);
                    const sorted = sort?.attributeId === attr.id;
                    return (
                      <tr key={attr.id} className="hover:bg-indigo-50/20">
                        <th
                          className={`sticky left-0 z-10 min-w-[240px] border-b border-r border-gray-200 px-3 py-2 text-left align-top text-xs font-medium ${
                            sorted ? 'bg-indigo-50 text-indigo-800' : 'bg-white text-gray-700'
                          }`}
                        >
                          {/* Clicking the row orders the SKU columns by it — the fastest way to
                              see the spread of one spec across a category. */}
                          <button
                            onClick={() => onToggleSort(attr.id)}
                            className="flex w-full items-baseline justify-between gap-2 text-left"
                            title={`Order SKU columns by ${attr.name}`}
                          >
                            <span className="min-w-0">
                              <span className="break-words">{attr.name}</span>
                              {attr.validationRules?.unit && (
                                <span className="font-normal text-gray-400">
                                  {' '}
                                  ({attr.validationRules.unit})
                                </span>
                              )}
                              {attr.validationRules?.required && (
                                <span className="font-normal text-rose-500" title="Required">
                                  {' '}
                                  *
                                </span>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              {sorted &&
                                (sort!.direction === 'asc' ? (
                                  <ArrowUp size={11} className="text-indigo-600" />
                                ) : (
                                  <ArrowDown size={11} className="text-indigo-600" />
                                ))}
                              <span
                                className="text-[10px] font-normal tabular-nums text-gray-400"
                                title="SKUs with a value for this attribute"
                              >
                                {cov?.filled ?? 0}/{cov?.total ?? 0}
                              </span>
                            </span>
                          </button>

                          {/* What the attribute is and what to watch for, where the person
                              answering it is looking. */}
                          {attr.wizardHint && (
                            <div
                              className="mt-1 flex items-start gap-1 text-[10px] font-normal italic text-gray-400"
                              title={attr.wizardHint}
                            >
                              <MessageSquare size={9} className="mt-0.5 shrink-0" />
                              <span className="line-clamp-2">{attr.wizardHint}</span>
                            </div>
                          )}
                        </th>

                        {skus.map((sku, col) => {
                          const record = byCell.get(cellKey(sku.id, attr.id));
                          const state = classifyCell(record, attr);
                          const presentation = CELL_STATES[state];
                          const flag = flagMap[cellKey(sku.id, attr.id)];
                          const isActive = active?.row === thisRow && active?.col === col;
                          const isEditing = editing?.row === thisRow && editing?.col === col;
                          const value = record?.value ?? '';
                          const eprel = eprelByCell?.get(cellKey(sku.id, attr.id));
                          const eprelStyle =
                            eprel?.verdict === 'differs'
                              ? EPREL_PRESENTATION.differs
                              : eprel?.verdict === 'only-eprel'
                                ? EPREL_PRESENTATION.onlyEprel
                                : null;

                          return (
                            <td
                              key={sku.id}
                              role="gridcell"
                              aria-selected={isActive}
                              onClick={() => setActive({ row: thisRow, col })}
                              onDoubleClick={() => startEdit({ row: thisRow, col })}
                              // An open flag outranks the EPREL ring: somebody has explicitly
                              // asked for this cell to be looked at, which is louder than an
                              // automated second opinion. Both still appear in the tooltip.
                              className={`relative cursor-pointer border-b border-r border-gray-100 px-3 py-2 align-top ${presentation.cell} ${
                                flag?.status === 'open'
                                  ? 'ring-1 ring-inset ring-amber-400'
                                  : (eprelStyle?.cell ?? '')
                              } ${isActive ? 'outline outline-2 -outline-offset-2 outline-indigo-500' : ''}`}
                              title={
                                flag
                                  ? flag.comment
                                  : eprelStyle
                                    ? `${eprelStyle.description} Registry: ${eprel?.eprelValue ?? '—'}`
                                    : presentation.description
                              }
                            >
                              {isEditing ? (
                                <input
                                  ref={inputRef}
                                  value={draft}
                                  onChange={e => setDraft(e.target.value)}
                                  onBlur={() => void commitAndMove(null)}
                                  className="w-full rounded border border-indigo-400 bg-white px-1 py-0.5 text-sm text-gray-900 outline-none"
                                  aria-label={`${attr.name} for ${sku.skuNumber}`}
                                />
                              ) : (
                                <>
                                  {/* The unit sits ABOVE the value in small grey type, so what
                                      you edit is the value alone. The unit belongs to the
                                      stored value and travels with it. */}
                                  {record?.unit && (
                                    <div className="text-[9px] uppercase tracking-wide text-gray-400">
                                      {record.unit}
                                    </div>
                                  )}
                                  {attr.dataType === 'image' && value ? (
                                    <img
                                      src={value}
                                      alt={attr.name}
                                      className="h-12 w-12 rounded border border-gray-200 bg-gray-50 object-cover"
                                    />
                                  ) : state === 'cleared' ? (
                                    <span className="text-[11px] font-medium uppercase tracking-wide">
                                      none
                                    </span>
                                  ) : (
                                    <span className="break-words">
                                      {value || <span className="text-gray-300">—</span>}
                                    </span>
                                  )}
                                </>
                              )}

                              {/* The registry's own figure, under ours in small type — the
                                  comparison is only useful if both numbers are visible at once.
                                  Rendered only when there is something to say. */}
                              {!isEditing && eprelStyle && (
                                <div className={`mt-0.5 text-[9px] leading-tight ${eprelStyle.text}`}>
                                  EPREL: {eprel?.eprelValue ?? '—'}
                                </div>
                              )}

                              {flag && (
                                <Flag
                                  size={11}
                                  onClick={e => {
                                    e.stopPropagation();
                                    onOpenCell(sku.id, attr.id);
                                  }}
                                  className={`absolute right-1 top-1 ${
                                    flag.status === 'open' ? 'text-amber-500' : 'text-emerald-500'
                                  }`}
                                  fill="currentColor"
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default AttributeGrid;
