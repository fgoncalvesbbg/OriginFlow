/**
 * Pure decision logic for stored SKU attribute values.
 *
 * Everything here is a plain function over plain data — no React, no `db`, no fetch — so
 * "why is this cell amber?", "why was this SKU skipped by the bulk fill?" and "what will
 * this import actually write?" are each answerable by reading one function and are unit
 * tested against fixtures. The service layer does the I/O and calls these to decide.
 *
 * Phase 1 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import type {
  CategoryAttribute,
  SkuAttributeValue,
  SkuAttributeValueRecord,
  SkuCellState,
} from '../types';
import { validateAttributeValue } from './attribute-validation.utils';

/** Shared "nothing here" array. One frozen identity, so memos over it never recompute. */
export const NO_VALUES: readonly SkuAttributeValueRecord[] = Object.freeze([]);

/** Cache key for a cell. The pair is the identity of a value everywhere in the module. */
export const cellKey = (projectSkuId: string, attributeId: string): string =>
  `${projectSkuId}::${attributeId}`;

/** Index records by cell, for O(1) grid lookups over thousands of cells. */
export const indexByCell = (
  records: readonly SkuAttributeValueRecord[],
): Map<string, SkuAttributeValueRecord> => {
  const map = new Map<string, SkuAttributeValueRecord>();
  for (const r of records) map.set(cellKey(r.projectSkuId, r.attributeId), r);
  return map;
};

/**
 * Which validation mode a stored value should be judged in.
 *
 * `validateAttributeValue` in `'text'` mode runs a numeric field's value through
 * `Number()`, so a legitimately stored range — "100-200" on a numeric attribute with
 * `allowRange` — comes back as "Must be a number" and the cell would render as a solid
 * red invalid. The rule below is deliberately the same one
 * `SkuAttributeCellDrawer` uses to decide whether to open in range mode, so the grid and
 * the editor can never disagree about whether a value is valid.
 */
export const validationModeFor = (
  attribute: CategoryAttribute,
  value: string,
): 'range' | 'text' => {
  const numeric = attribute.dataType === 'integer' || attribute.dataType === 'decimal';
  const looksLikeRange = /^-?\d/.test(value) && value.includes('-') && value[0] !== '-';
  return numeric && attribute.validationRules?.allowRange && looksLikeRange ? 'range' : 'text';
};

/** The stored value fails its own attribute's rules. One definition, used by every path. */
export const isInvalidValue = (attribute: CategoryAttribute, value: string): boolean =>
  validateAttributeValue(attribute, value, validationModeFor(attribute, value)) !== null;

/**
 * What this cell is. `undefined` record means no row — nobody has touched it — which is
 * deliberately NOT the same as a row holding null.
 *
 * Validity is judged with the same `validateAttributeValue` every other write path uses,
 * so a cell can never render valid while the editor refuses to save it (or the reverse).
 * A cleared cell is not validated: "this product has none" cannot be invalid, even for a
 * required attribute — that is a required GAP, which the gap filter reports separately.
 */
export const classifyCell = (
  record: SkuAttributeValueRecord | undefined,
  attribute: CategoryAttribute,
): SkuCellState => {
  if (!record) return 'empty';
  if (record.value === null) return 'cleared';
  // A stored empty string is legacy shape from the JSONB era, where '' was the only way
  // to say "no value". Read it as never-touched rather than inventing a fifth state.
  if (record.value.trim() === '') return 'empty';
  return isInvalidValue(attribute, record.value) ? 'invalid' : 'filled';
};

/** True when the cell holds something a person can read — the coverage numerator. */
export const isFilled = (
  record: SkuAttributeValueRecord | undefined,
  attribute: CategoryAttribute,
): boolean => {
  const state = classifyCell(record, attribute);
  // `invalid` counts as filled: somebody put a value there. It is wrong, not missing, and
  // reporting it as a gap would send a person to type a value that is already present.
  return state === 'filled' || state === 'invalid';
};

/**
 * A cell a fill may write into. Both bulk fill and copy-from default to empty cells only,
 * and this is the single definition of "empty" they share.
 *
 * `cleared` does NOT count as fillable. Somebody decided this product has none of that
 * attribute; a bulk fill overwriting that decision would silently undo a judgement, and
 * the operator who wants it overwritten can say so with `includeFilled`.
 */
export const isFillTarget = (
  record: SkuAttributeValueRecord | undefined,
  attribute: CategoryAttribute,
  includeFilled = false,
): boolean => (includeFilled ? true : classifyCell(record, attribute) === 'empty');

/** Per-attribute coverage across a set of SKUs — the `87/138` on an attribute row. */
export interface AttributeCoverage {
  attributeId: string;
  filled: number;
  total: number;
}

export const coverageFor = (
  attribute: CategoryAttribute,
  projectSkuIds: readonly string[],
  byCell: Map<string, SkuAttributeValueRecord>,
): AttributeCoverage => {
  let filled = 0;
  for (const skuId of projectSkuIds) {
    if (isFilled(byCell.get(cellKey(skuId, attribute.id)), attribute)) filled += 1;
  }
  return { attributeId: attribute.id, filled, total: projectSkuIds.length };
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Bulk fill / copy-from planning
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Why one SKU was or was not written. Reported back per SKU rather than as a total,
 * because "it set 12 of 40" without saying which twelve is not an answer anybody can act
 * on — and because a signed-off skip is a different problem from an already-filled skip.
 */
export type BulkOutcome = 'set' | 'skipped-filled' | 'skipped-final' | 'skipped-invalid';

export interface BulkTarget {
  projectSkuId: string;
  outcome: BulkOutcome;
  /** The value that will be written. Only present when `outcome === 'set'`. */
  value?: string;
  unit?: string | null;
}

/** Just enough of a SKU for the planners to decide. Keeps them free of the full row type. */
export interface FillableSku {
  id: string;
  isFinal: boolean;
}

/**
 * Plan setting one attribute to one value across many SKUs.
 *
 * Nothing is written by this function — it returns what WOULD happen, so the panel can
 * show it and the caller can write exactly what was shown. The order of the checks is
 * the order of the reasons: a signed-off SKU is refused before anything looks at whether
 * the cell is empty, because the sign-off is the answer regardless.
 */
export const planBulkFill = (
  skus: readonly FillableSku[],
  attribute: CategoryAttribute,
  value: string,
  byCell: Map<string, SkuAttributeValueRecord>,
  options: { includeFilled?: boolean; unit?: string | null } = {},
): BulkTarget[] => {
  const invalid = isInvalidValue(attribute, value);
  return skus.map<BulkTarget>(sku => {
    if (sku.isFinal) return { projectSkuId: sku.id, outcome: 'skipped-final' };
    // Judged once for the whole run: one bad value is a bad value for every SKU, and the
    // panel should say so once rather than forty times.
    if (invalid) return { projectSkuId: sku.id, outcome: 'skipped-invalid' };
    const record = byCell.get(cellKey(sku.id, attribute.id));
    if (!isFillTarget(record, attribute, options.includeFilled)) {
      return { projectSkuId: sku.id, outcome: 'skipped-filled' };
    }
    return { projectSkuId: sku.id, outcome: 'set', value, unit: options.unit ?? null };
  });
};

/** One attribute's worth of a copy-from plan: which SKUs get it, and why the rest don't. */
export interface CopyPlanEntry {
  attributeId: string;
  targets: BulkTarget[];
}

/**
 * Plan copying a reference SKU's values onto other SKUs, attribute by attribute.
 *
 * Only attributes the SOURCE actually holds are copied. An attribute the source has
 * cleared, or has never had, proposes nothing — copying "none" onto forty products would
 * be a mass clear wearing the clothes of a copy, and nothing in this module ever
 * proposes to empty a field the operator did not ask to empty.
 */
export const planCopyFrom = (
  sourceSkuId: string,
  targets: readonly FillableSku[],
  attributes: readonly CategoryAttribute[],
  byCell: Map<string, SkuAttributeValueRecord>,
  options: { includeFilled?: boolean } = {},
): CopyPlanEntry[] => {
  const plan: CopyPlanEntry[] = [];
  for (const attribute of attributes) {
    const source = byCell.get(cellKey(sourceSkuId, attribute.id));
    if (!source || source.value === null || source.value.trim() === '') continue;
    plan.push({
      attributeId: attribute.id,
      targets: planBulkFill(
        targets.filter(t => t.id !== sourceSkuId),
        attribute,
        source.value,
        byCell,
        { includeFilled: options.includeFilled, unit: source.unit },
      ),
    });
  }
  return plan;
};

// ─────────────────────────────────────────────────────────────────────────────────────
// JSONB mirror
// ─────────────────────────────────────────────────────────────────────────────────────

/** One row to write, and one cell to clear, as the sync decided them. */
export interface JsonbSyncPlan {
  upserts: { attributeId: string; value: string }[];
  /** Attribute ids whose cell should become an explicit clear (null), not a deletion. */
  clears: string[];
}

/**
 * Reconcile a whole `project_skus.attribute_values` array into row writes.
 *
 * This is the bridge that keeps the SKU Catalog's array-at-a-time grid save from drifting
 * away from the row table while both exist. The rule that matters is what a blank means:
 *
 *  - blank in the array, and a record already exists  → an explicit CLEAR. Somebody
 *    emptied a field that had something in it, and that is a decision worth recording.
 *  - blank in the array, and no record exists         → NOTHING. This is scaffolding, not
 *    an act. All 141 entries live today are exactly this, which is why migration 155's
 *    backfill writes no rows.
 *
 * Getting that backwards in either direction is the whole bug class this function exists
 * to prevent: one way invents thousands of "cleared" cells out of empty placeholders, the
 * other silently loses a deliberate clear.
 */
export const planJsonbSync = (
  values: readonly SkuAttributeValue[],
  existing: readonly SkuAttributeValueRecord[],
): JsonbSyncPlan => {
  const have = new Map(existing.map(r => [r.attributeId, r]));
  const plan: JsonbSyncPlan = { upserts: [], clears: [] };

  for (const v of values) {
    if (!v.attributeId) continue;
    const trimmed = (v.value ?? '').trim();
    const record = have.get(v.attributeId);

    if (trimmed !== '') {
      // Unchanged values are not written. Otherwise every grid save would stamp a new
      // updated_at and a new audit row on all 67 attributes of every SKU it touched.
      if (!record || record.value !== v.value) {
        plan.upserts.push({ attributeId: v.attributeId, value: v.value });
      }
      continue;
    }

    if (record && record.value !== null) plan.clears.push(v.attributeId);
  }

  return plan;
};

/**
 * Project the row table back into the array shape `project_skus.attribute_values` holds,
 * so the mirror stays readable by everything still reading it (the ProductToolkit
 * readback API, the IM placeholder wizard, and the request-prefill paths in ProjectDetail
 * and CreateComplianceRequest).
 *
 * A cleared cell mirrors as `''`, because the array has no way to say "cleared" — that
 * fidelity is exactly what the row table was added to keep, and the mirror is lossy by
 * design rather than by accident.
 */
export const toJsonbMirror = (
  records: readonly SkuAttributeValueRecord[],
  attributes: readonly CategoryAttribute[],
): SkuAttributeValue[] => {
  const byId = new Map(attributes.map(a => [a.id, a]));
  return records.map(r => {
    const attribute = byId.get(r.attributeId);
    return {
      attributeId: r.attributeId,
      name: attribute?.name ?? '',
      value: r.value ?? '',
      ...(attribute?.dataType ? { type: attribute.dataType } : {}),
    };
  });
};
