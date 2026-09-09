/**
 * Bulk fill and copy-from — the two ways to set values across many ticked SKUs at once.
 *
 * Both are **preview-then-apply**, and both show the plan per SKU rather than a total. "It set
 * 12 of 40" is not an answer anybody can act on, and a skip because a SKU is signed off is a
 * different problem from a skip because the cell already had a value.
 *
 * Both default to **empty cells only**. Overwriting is available but has to be asked for,
 * because the common case is filling gaps and the destructive case should not be the default.
 * A *cleared* cell is never a fill target unless overwriting is on: somebody decided that
 * product has none, and a bulk fill quietly undoing a judgement is the worst outcome here.
 *
 * The plan comes from `planBulkFill` / `planCopyFrom` (pure, unit tested), and the service
 * writes exactly what the plan said — so what the operator was shown and what happened are the
 * same list.
 *
 * Phase 5 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import React, { useMemo, useState } from 'react';
import type { CategoryAttribute, SkuAttributeValueRecord } from '../../types';
import type { CategorySku } from '../../services';
import {
  planBulkFill,
  planCopyFrom,
  indexByCell,
  type BulkOutcome,
  type BulkTarget,
} from '../../utils/sku-attribute-value.utils';
import { groupsInOrder } from '../../config/compliance.constants';
import AttributeInput from '../common/AttributeInput';
import { Button } from '../common/Button';
import { X, Wand2, Copy, AlertTriangle } from 'lucide-react';

/** How each outcome reads. Named, so a skip explains itself rather than just not happening. */
const OUTCOME_LABELS: Record<BulkOutcome, { label: string; className: string }> = {
  set: { label: 'will be set', className: 'text-emerald-700' },
  'skipped-filled': { label: 'already has a value', className: 'text-gray-500' },
  'skipped-final': { label: 'signed off — unlock it first', className: 'text-amber-700' },
  'skipped-invalid': { label: 'value is not valid for this attribute', className: 'text-red-600' },
};

const Shell: React.FC<{
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, subtitle, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
    <div className="animate-scaleIn relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-primary">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </div>
  </div>
);

/** The per-SKU breakdown, grouped by what will happen to each. */
const Plan: React.FC<{
  targets: readonly BulkTarget[];
  skuLabel: (id: string) => string;
}> = ({ targets, skuLabel }) => {
  const grouped = useMemo(() => {
    const map = new Map<BulkOutcome, BulkTarget[]>();
    for (const t of targets) {
      const list = map.get(t.outcome) ?? [];
      list.push(t);
      map.set(t.outcome, list);
    }
    return map;
  }, [targets]);

  if (targets.length === 0) return null;

  return (
    <div className="space-y-2">
      {(Object.keys(OUTCOME_LABELS) as BulkOutcome[]).map(outcome => {
        const list = grouped.get(outcome);
        if (!list || list.length === 0) return null;
        const style = OUTCOME_LABELS[outcome];
        return (
          <div key={outcome} className="rounded border border-gray-200 p-2">
            <p className={`text-xs font-semibold ${style.className}`}>
              {list.length} SKU{list.length === 1 ? '' : 's'} — {style.label}
            </p>
            <p className="mt-1 break-words text-[11px] text-gray-500">
              {list.slice(0, 20).map(t => skuLabel(t.projectSkuId)).join(', ')}
              {list.length > 20 && ` …and ${list.length - 20} more`}
            </p>
          </div>
        );
      })}
    </div>
  );
};

const OverwriteToggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({
  value,
  onChange,
}) => (
  <label className="flex items-start gap-2 rounded border border-gray-200 p-2 text-xs text-gray-700">
    <input
      type="checkbox"
      checked={value}
      onChange={e => onChange(e.target.checked)}
      className="mt-0.5 accent-indigo-600"
    />
    <span>
      Also overwrite cells that already have a value
      <span className="mt-0.5 block text-[11px] text-gray-500">
        Off by default. This also overwrites cells somebody deliberately emptied, which records a
        decision that this product has none.
      </span>
    </span>
  </label>
);

// ─────────────────────────────────────────────────────────────────────────────────────

export const BulkFillDialog: React.FC<{
  skus: readonly CategorySku[];
  attributes: readonly CategoryAttribute[];
  values: readonly SkuAttributeValueRecord[];
  onApply: (
    attribute: CategoryAttribute,
    value: string,
    includeFilled: boolean,
  ) => Promise<void>;
  onClose: () => void;
}> = ({ skus, attributes, values, onApply, onClose }) => {
  const [attributeId, setAttributeId] = useState('');
  const [value, setValue] = useState('');
  const [includeFilled, setIncludeFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attribute = attributes.find(a => a.id === attributeId);
  const byCell = useMemo(() => indexByCell(values), [values]);
  const skuLabel = (id: string) => skus.find(s => s.id === id)?.skuNumber ?? id;

  // The plan is recomputed as you type, so the consequence is visible before the button is
  // pressed rather than reported after it.
  const targets = useMemo(
    () =>
      attribute && value.trim() !== ''
        ? planBulkFill(skus, attribute, value, byCell, { includeFilled })
        : [],
    [attribute, value, skus, byCell, includeFilled],
  );
  const willSet = targets.filter(t => t.outcome === 'set').length;

  const apply = async () => {
    if (!attribute) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(attribute, value, includeFilled);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Bulk fill failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={`Set one attribute across ${skus.length} SKU${skus.length === 1 ? '' : 's'}`}
      subtitle="Fills empty cells only, unless you say otherwise. Nothing is written until you apply."
      onClose={onClose}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">
            Attribute
          </label>
          <select
            value={attributeId}
            onChange={e => {
              setAttributeId(e.target.value);
              setValue('');
            }}
            className="w-full rounded border border-gray-300 p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Choose an attribute…</option>
            {attributes.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {attribute && (
          <>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">
                Value
              </label>
              {/* The same input the cell editor uses, so an enum offers its options and a
                  numeric field is judged the same way here as anywhere else. */}
              <AttributeInput
                attribute={attribute}
                value={value}
                onChange={setValue}
                mode="text"
              />
            </div>

            <OverwriteToggle value={includeFilled} onChange={setIncludeFilled} />

            {targets.length > 0 && (
              <>
                <p className="text-xs font-semibold text-primary">
                  {willSet} of {targets.length} will change
                </p>
                <Plan targets={targets} skuLabel={skuLabel} />
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              onClick={apply}
              loading={busy}
              disabled={busy || willSet === 0}
              leftIcon={<Wand2 size={14} />}
            >
              Set {willSet} cell{willSet === 1 ? '' : 's'}
            </Button>
          </>
        )}
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────────────────────────────────────────────

export const CopyFromDialog: React.FC<{
  /** The ticked SKUs — the targets. */
  skus: readonly CategorySku[];
  /** Every SKU in the category, so the reference can be one that is not ticked. */
  allSkus: readonly CategorySku[];
  attributes: readonly CategoryAttribute[];
  values: readonly SkuAttributeValueRecord[];
  onApply: (
    sourceSkuId: string,
    attributes: CategoryAttribute[],
    includeFilled: boolean,
  ) => Promise<void>;
  onClose: () => void;
}> = ({ skus, allSkus, attributes, values, onApply, onClose }) => {
  const [sourceId, setSourceId] = useState('');
  const [groups, setGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [includeFilled, setIncludeFilled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byCell = useMemo(() => indexByCell(values), [values]);
  const skuLabel = (id: string) => allSkus.find(s => s.id === id)?.skuNumber ?? id;

  // Copying by CLUSTER rather than attribute-by-attribute: "give these the same dimensions as
  // that one" is the actual request, and picking 12 attributes one at a time is not.
  const allGroups = useMemo(() => groupsInOrder([...attributes]), [attributes]);
  const chosenAttributes = useMemo(
    () => attributes.filter(a => groups.has(a.group || 'Category Specific')),
    [attributes, groups],
  );

  const plan = useMemo(
    () =>
      sourceId && chosenAttributes.length > 0
        ? planCopyFrom(sourceId, skus, chosenAttributes, byCell, { includeFilled })
        : [],
    [sourceId, skus, chosenAttributes, byCell, includeFilled],
  );

  const willSet = plan.reduce(
    (n, entry) => n + entry.targets.filter(t => t.outcome === 'set').length,
    0,
  );

  const toggleGroup = (g: string) =>
    setGroups(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const apply = async () => {
    if (!sourceId) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(sourceId, chosenAttributes, includeFilled);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Copy failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={`Copy values onto ${skus.length} SKU${skus.length === 1 ? '' : 's'}`}
      subtitle="Takes a reference SKU's values, cluster by cluster. Only attributes the reference actually holds are copied."
      onClose={onClose}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">
            Copy from
          </label>
          <select
            value={sourceId}
            onChange={e => setSourceId(e.target.value)}
            className="w-full rounded border border-gray-300 p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Choose a reference SKU…</option>
            {allSkus.map(s => (
              <option key={s.id} value={s.id}>
                {s.skuNumber}
                {s.skuTitle ? ` — ${s.skuTitle}` : ''}
                {s.projectName ? ` (${s.projectName})` : ''}
              </option>
            ))}
          </select>
        </div>

        {sourceId && (
          <>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">
                Which clusters
              </label>
              <div className="flex flex-wrap gap-1.5">
                {allGroups.map(g => (
                  <button
                    key={g}
                    onClick={() => toggleGroup(g)}
                    aria-pressed={groups.has(g)}
                    className={`rounded-full border px-2 py-1 text-[11px] font-medium ${
                      groups.has(g)
                        ? 'border-indigo-400 bg-indigo-600 text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <OverwriteToggle value={includeFilled} onChange={setIncludeFilled} />

            {/* A cleared or absent source cell copies NOTHING. Copying "none" across forty
                products would be a mass clear wearing the clothes of a copy. */}
            {chosenAttributes.length > 0 && plan.length === 0 && (
              <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                The reference SKU holds no values in{' '}
                {chosenAttributes.length === 1 ? 'that cluster' : 'those clusters'}, so there is
                nothing to copy. An empty or deliberately-cleared cell is never copied — that
                would be a mass clear rather than a copy.
              </p>
            )}

            {plan.length > 0 && (
              <>
                <p className="text-xs font-semibold text-primary">
                  {willSet} cell{willSet === 1 ? '' : 's'} across {plan.length} attribute
                  {plan.length === 1 ? '' : 's'} will change
                </p>
                <div className="space-y-2">
                  {plan.map(entry => {
                    const attribute = attributes.find(a => a.id === entry.attributeId);
                    const setCount = entry.targets.filter(t => t.outcome === 'set').length;
                    return (
                      <details key={entry.attributeId} className="rounded border border-gray-200 p-2">
                        <summary className="cursor-pointer text-xs font-medium text-gray-700">
                          {attribute?.name ?? entry.attributeId}
                          <span className="ml-1 font-normal text-gray-400">
                            {setCount} of {entry.targets.length}
                          </span>
                        </summary>
                        <div className="mt-2">
                          <Plan targets={entry.targets} skuLabel={skuLabel} />
                        </div>
                      </details>
                    );
                  })}
                </div>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              onClick={apply}
              loading={busy}
              disabled={busy || willSet === 0}
              leftIcon={<Copy size={14} />}
            >
              Copy {willSet} value{willSet === 1 ? '' : 's'}
            </Button>
          </>
        )}
      </div>
    </Shell>
  );
};
