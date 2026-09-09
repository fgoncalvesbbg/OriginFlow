/**
 * Every attribute of ONE SKU, by cluster — the surface for filling a product in from empty.
 *
 * WHY THIS EXISTS ALONGSIDE THE GRID. The grid is for comparing one question across many
 * products: read along a row. Filling in one product is the transposed job — ~70 answers about
 * the same thing — and in the grid that means tabbing down a single column with the attribute
 * names scrolled off to the left. Here the questions are stacked with their labels, their units,
 * their guidance and their current state, which is what somebody working through a new product
 * actually needs.
 *
 * Editing writes immediately, one cell at a time, exactly as the grid does — same service, same
 * validation, same audit trigger. There is deliberately no "save all" here: a draft-then-commit
 * form over 70 fields is the model this module replaced in Phase 3, and reintroducing it in one
 * panel would give the same SKU two different editing contracts.
 *
 * Phase 4 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import React, { useMemo, useState } from 'react';
import type {
  CategoryAttribute,
  SkuAttributeFlag,
  SkuAttributeValueRecord,
} from '../../types';
import type { CategorySku } from '../../services';
import { cellKey, classifyCell } from '../../utils/sku-attribute-value.utils';
import { buildClusterBands } from './attribute-grid/grid.utils';
import { CELL_STATES, EPREL_PRESENTATION } from './attribute-grid/cell-state';
import type { EprelComparison } from './attribute-grid/eprel-compare.utils';
import AttributeInput from '../common/AttributeInput';
import {
  ChevronDown,
  ChevronRight,
  Eraser,
  Flag,
  Loader2,
  Lock,
  MessageSquare,
} from 'lucide-react';

interface Props {
  sku: CategorySku;
  attributes: readonly CategoryAttribute[];
  byCell: Map<string, SkuAttributeValueRecord>;
  flagMap: Record<string, SkuAttributeFlag>;
  eprelByCell?: Map<string, EprelComparison>;
  onSaveValue: (attribute: CategoryAttribute, value: string) => Promise<void>;
  onClearValue: (attribute: CategoryAttribute) => Promise<void>;
  /** Open the per-cell drawer, which owns the flag UI. */
  onOpenCell: (attributeId: string) => void;
}

const isNumeric = (attr: CategoryAttribute) =>
  attr.dataType === 'integer' || attr.dataType === 'decimal';

const SkuValuePanel: React.FC<Props> = ({
  sku,
  attributes,
  byCell,
  flagMap,
  eprelByCell,
  onSaveValue,
  onClearValue,
  onOpenCell,
}) => {
  const bands = useMemo(() => buildClusterBands(attributes), [attributes]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const record = (attrId: string) => byCell.get(cellKey(sku.id, attrId));

  /** Filled over total, so somebody can see how much of this product is still to do. */
  const filled = useMemo(
    () =>
      attributes.filter(a => {
        const state = classifyCell(record(a.id), a);
        return state === 'filled' || state === 'invalid';
      }).length,
    [attributes, byCell, sku.id],
  );

  const toggle = (group: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const startEdit = (attr: CategoryAttribute) => {
    if (sku.isFinal) return;
    setDraft(record(attr.id)?.value ?? '');
    setEditing(attr.id);
  };

  const commit = async (attr: CategoryAttribute) => {
    const stored = record(attr.id)?.value ?? '';
    setEditing(null);
    // A blank commit is dropped: emptying on purpose is the Clear action beside it, and a blank
    // here cannot say which of the two is meant.
    if (draft.trim() === '' || draft === stored) return;
    setBusy(attr.id);
    try {
      await onSaveValue(attr, draft);
    } finally {
      setBusy(null);
    }
  };

  const clear = async (attr: CategoryAttribute) => {
    setBusy(attr.id);
    try {
      await onClearValue(attr);
    } finally {
      setBusy(null);
    }
  };

  if (attributes.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        This category has no attributes defined yet, so there is nothing to fill in.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500">
        <strong className="tabular-nums">{filled}</strong> of {attributes.length} filled
        {sku.isFinal && (
          <span className="ml-1.5 inline-flex items-center gap-1 text-emerald-700">
            <Lock size={9} /> signed off — unlock to edit
          </span>
        )}
      </p>

      {bands.map(band => {
        const isCollapsed = collapsed.has(band.group);
        const bandFilled = band.attributes.filter(a => {
          const state = classifyCell(record(a.id), a);
          return state === 'filled' || state === 'invalid';
        }).length;

        return (
          <div key={band.group} className="rounded border border-gray-200">
            <button
              onClick={() => toggle(band.group)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-1.5 bg-gray-50 px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-600 hover:bg-gray-100"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {band.group}
              <span className="ml-auto font-normal normal-case tabular-nums text-gray-400">
                {bandFilled}/{band.attributes.length}
              </span>
            </button>

            {!isCollapsed && (
              <ul className="divide-y divide-gray-100">
                {band.attributes.map(attr => {
                  const rec = record(attr.id);
                  const state = classifyCell(rec, attr);
                  const presentation = CELL_STATES[state];
                  const flag = flagMap[cellKey(sku.id, attr.id)];
                  const eprel = eprelByCell?.get(cellKey(sku.id, attr.id));
                  const eprelStyle =
                    eprel?.verdict === 'differs'
                      ? EPREL_PRESENTATION.differs
                      : eprel?.verdict === 'only-eprel'
                        ? EPREL_PRESENTATION.onlyEprel
                        : null;
                  const isEditing = editing === attr.id;

                  return (
                    <li key={attr.id} className="px-2 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 text-xs font-medium text-gray-700">
                          {attr.name}
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
                          {flag && (
                            <button
                              onClick={() => onOpenCell(attr.id)}
                              title={flag.comment || 'Open the flag'}
                              className={
                                flag.status === 'open' ? 'text-amber-500' : 'text-emerald-500'
                              }
                            >
                              <Flag size={10} fill="currentColor" />
                            </button>
                          )}
                          <span
                            className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${presentation.pill}`}
                            title={presentation.description}
                          >
                            {presentation.label}
                          </span>
                        </span>
                      </div>

                      {/* The guidance where the person answering it is looking, not in a tooltip
                          on another screen. */}
                      {attr.wizardHint && (
                        <p className="mt-0.5 flex items-start gap-1 text-[10px] italic text-gray-400">
                          <MessageSquare size={9} className="mt-0.5 shrink-0" />
                          {attr.wizardHint}
                        </p>
                      )}

                      {isEditing ? (
                        <div className="mt-1">
                          <AttributeInput
                            attribute={attr}
                            value={draft}
                            onChange={setDraft}
                            mode={isNumeric(attr) ? 'fixed' : 'text'}
                          />
                          <div className="mt-1 flex items-center gap-2">
                            <button
                              onClick={() => void commit(attr)}
                              className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white hover:bg-accent-hover"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              className="text-[11px] text-gray-500 hover:text-gray-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-0.5 flex items-center gap-2">
                          <button
                            onClick={() => startEdit(attr)}
                            disabled={sku.isFinal}
                            className={`min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm ${
                              sku.isFinal ? 'cursor-default' : 'hover:bg-indigo-50'
                            } ${state === 'invalid' ? 'bg-red-600 text-white' : 'text-gray-800'}`}
                            title={sku.isFinal ? 'Unlock the SKU to edit' : 'Click to edit'}
                          >
                            {rec?.unit && (
                              <span className="mr-1 text-[9px] uppercase text-gray-400">
                                {rec.unit}
                              </span>
                            )}
                            {state === 'cleared' ? (
                              <span className="text-[11px] font-medium uppercase tracking-wide text-rose-700">
                                none
                              </span>
                            ) : (
                              (rec?.value ?? '') || <span className="text-gray-300">—</span>
                            )}
                          </button>

                          {busy === attr.id ? (
                            <Loader2 className="animate-spin text-gray-400" size={12} />
                          ) : (
                            !sku.isFinal &&
                            state !== 'cleared' &&
                            state !== 'empty' && (
                              <button
                                onClick={() => void clear(attr)}
                                title="Record that this product genuinely has none of this attribute"
                                className="shrink-0 text-gray-300 hover:text-rose-500"
                              >
                                <Eraser size={12} />
                              </button>
                            )
                          )}
                        </div>
                      )}

                      {/* The registry's figure, where it has an opinion. */}
                      {eprelStyle && (
                        <p className={`mt-0.5 text-[10px] ${eprelStyle.text}`}>
                          {eprelStyle.label}: {eprel?.eprelValue ?? '—'}
                          {eprel?.suggestion !== undefined && !sku.isFinal && (
                            <button
                              onClick={() => {
                                setDraft(eprel.suggestion as string);
                                setEditing(attr.id);
                              }}
                              className="ml-1.5 underline hover:no-underline"
                            >
                              use “{eprel.suggestion}”
                            </button>
                          )}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SkuValuePanel;
