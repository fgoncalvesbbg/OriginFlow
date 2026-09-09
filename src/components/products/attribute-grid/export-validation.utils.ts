/**
 * Export validation — the all-or-nothing rule.
 *
 * *A partial file handed over with a list of warnings is one somebody imports anyway, landing
 * half the work and silently dropping the rest.* So either every value in the export is
 * something the target can receive, or there is **no file at all** — only a list naming the
 * SKU, the attribute and the remedy.
 *
 * That reasoning is about **any** import target, not about one particular PIM: a downstream
 * system that receives a column it cannot interpret, or misses a column entirely, is broken by
 * it either way.
 *
 * Two of the four blockers below exist because the export builder fails SILENTLY today:
 *  - two attributes resolving to the same column code make `buildAkeneoRows` skip the second
 *    (`if (seen.has(code)) continue`), so an entire attribute's values vanish from the file
 *    with nothing said;
 *  - two SKU records sharing an item number produce two rows the consumer cannot tell apart,
 *    and it will keep whichever it reads last.
 *
 * Phase 8 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import type { CategoryAttribute, SkuAttributeValueRecord } from '../../../types';
import { cellKey, isInvalidValue } from '../../../utils/sku-attribute-value.utils';
import { akeneoColumnCode } from '../../../utils/akeneo-export.utils';
import { neutralizeCsvFormula } from '../../../utils/csv-escape.utils';

export type ExportBlockerKind =
  | 'invalid-value'
  | 'unit-conflict'
  | 'duplicate-sku-number'
  | 'column-collision';

export interface ExportBlocker {
  kind: ExportBlockerKind;
  /** The SKU this is about, where it is about one. */
  skuNumber?: string;
  /** The attribute this is about, where it is about one. */
  attributeName?: string;
  /** What is wrong, in the words a person needs to recognise it. */
  detail: string;
  /** What to do about it. Every blocker has to be actionable or it is just an obstacle. */
  remedy: string;
}

/** Just enough of a SKU to validate. */
export interface ExportableSku {
  id: string;
  skuNumber: string;
}

const normUnit = (u: string | null | undefined) => (u ?? '').trim().toLowerCase();

/**
 * Everything that would make this export wrong. Empty array = the file is safe to build.
 *
 * Ordered by kind so the dialog can group them, and every entry carries its own remedy: a
 * refusal that does not say what to do is just an obstacle.
 */
export const validateExport = (
  skus: readonly ExportableSku[],
  attributes: readonly CategoryAttribute[],
  byCell: Map<string, SkuAttributeValueRecord>,
): ExportBlocker[] => {
  const blockers: ExportBlocker[] = [];

  // ── 1. Two attributes competing for one column ───────────────────────────
  // The builder keeps the first and skips the rest, so the loser's values are absent from the
  // file with no complaint. That is data loss disguised as a successful export.
  const byColumn = new Map<string, CategoryAttribute[]>();
  for (const attr of attributes) {
    const code = akeneoColumnCode(attr);
    const list = byColumn.get(code) ?? [];
    list.push(attr);
    byColumn.set(code, list);
  }
  for (const [code, list] of byColumn) {
    if (list.length < 2) continue;
    blockers.push({
      kind: 'column-collision',
      attributeName: list.map(a => a.name).join(' + '),
      detail: `${list.length} attributes both export to the column “${code}”.`,
      remedy:
        'Give each one its own external code. Without that the export silently keeps the ' +
        'first and drops the others entirely.',
    });
  }

  // ── 2. Two SKU records sharing an item number ────────────────────────────
  // The consumer keys on the number, so it receives two rows it cannot tell apart and keeps
  // whichever it reads last. Which one wins is not something this file gets to decide.
  const numberCounts = new Map<string, number>();
  for (const sku of skus) {
    numberCounts.set(sku.skuNumber, (numberCounts.get(sku.skuNumber) ?? 0) + 1);
  }
  for (const [number, count] of numberCounts) {
    if (count < 2) continue;
    blockers.push({
      kind: 'duplicate-sku-number',
      skuNumber: number,
      detail: `${count} separate SKU records share this item number, and both are in this export.`,
      remedy:
        'Export only one of them, or correct the numbers first. Nothing here will pick which ' +
        'record the consumer should believe.',
    });
  }

  // ── 3 & 4. Per-attribute value checks ────────────────────────────────────
  for (const attr of attributes) {
    const declared = normUnit(attr.validationRules?.unit);
    const unitsSeen = new Map<string, string[]>(); // normalised unit -> SKU numbers

    for (const sku of skus) {
      const record = byCell.get(cellKey(sku.id, attr.id));
      if (!record || record.value === null || record.value.trim() === '') continue;

      // A value the attribute itself cannot hold. Usually a definition that changed under
      // stored values — an option dropped from an enum, a tightened min/max.
      if (isInvalidValue(attr, record.value)) {
        blockers.push({
          kind: 'invalid-value',
          skuNumber: sku.skuNumber,
          attributeName: attr.name,
          detail: `“${record.value}” is not a value this attribute can hold.`,
          remedy:
            attr.dataType === 'enum'
              ? `Set it to one of: ${(attr.validationRules?.enumOptions ?? []).join(', ') || '(no options defined)'} — or add the option to the definition.`
              : 'Correct the value, or relax the attribute definition if the value is right.',
        });
      }

      const unit = normUnit(record.unit);
      if (unit !== '') {
        const list = unitsSeen.get(unit) ?? [];
        list.push(sku.skuNumber);
        unitsSeen.set(unit, list);
      }
    }

    // One column cannot carry two units. This is the lesson that earns its keep: the same
    // cable-length attribute held some products in centimetres and others in metres, and
    // exporting both under one header rescaled half of them by a hundred — in a file that
    // imported without a single complaint.
    if (unitsSeen.size > 1) {
      blockers.push({
        kind: 'unit-conflict',
        attributeName: attr.name,
        detail:
          `Values are stored in ${unitsSeen.size} different units (` +
          [...unitsSeen.entries()]
            .map(([u, nums]) => `${u}: ${nums.length} SKU${nums.length === 1 ? '' : 's'}`)
            .join(', ') +
          ').',
        remedy:
          'Convert them to one unit before exporting. A single column carries a single unit, ' +
          'so mixed units are rescaled silently by whatever reads the file.',
      });
    } else if (unitsSeen.size === 1 && declared !== '') {
      const [only] = [...unitsSeen.keys()];
      if (only !== declared) {
        blockers.push({
          kind: 'unit-conflict',
          attributeName: attr.name,
          detail: `Values are stored in “${only}” but the attribute declares “${attr.validationRules?.unit}”.`,
          remedy:
            'Convert the values, or change the declared unit to match what was captured. The ' +
            'export header carries the declared unit, so the two disagreeing means the file ' +
            'mislabels its own numbers.',
        });
      }
    }
  }

  return blockers;
};

/** Group blockers by kind, for a dialog that reads as a list of problems rather than rows. */
export const groupBlockers = (
  blockers: readonly ExportBlocker[],
): { kind: ExportBlockerKind; blockers: ExportBlocker[] }[] => {
  const order: ExportBlockerKind[] = [
    'column-collision',
    'duplicate-sku-number',
    'unit-conflict',
    'invalid-value',
  ];
  return order
    .map(kind => ({ kind, blockers: blockers.filter(b => b.kind === kind) }))
    .filter(g => g.blockers.length > 0);
};

export const BLOCKER_TITLES: Record<ExportBlockerKind, string> = {
  'column-collision': 'Two attributes want the same column',
  'duplicate-sku-number': 'An item number names more than one record',
  'unit-conflict': 'Mixed or mislabelled units',
  'invalid-value': 'A value the attribute cannot hold',
};

// ─────────────────────────────────────────────────────────────────────────────────────

export type ExportRow = Record<string, string>;

/**
 * Build the export from the AUTHORITATIVE row store rather than the JSONB mirror.
 *
 * The mirror is a lossy derived copy — it cannot spell "cleared", and it is refreshed by every
 * write rather than being the write itself. Handing a downstream system second-hand data when
 * the first-hand data is right there is the kind of thing that is fine until the day the mirror
 * is briefly behind, and then ships stale values with no sign anything was wrong.
 *
 * A cleared cell exports as an empty string: the consumer's "this product has none" and "we
 * have nothing for this product" are the same cell in a flat file, and inventing a sentinel
 * would be worse than the loss.
 */
export const buildExportRows = (
  skus: readonly ExportableSku[],
  attributes: readonly CategoryAttribute[],
  byCell: Map<string, SkuAttributeValueRecord>,
  skuTitles: Map<string, string>,
): { headers: string[]; rows: ExportRow[] } => {
  const headers = ['sku', 'sku_title'];
  const columns: { code: string; attr: CategoryAttribute }[] = [];
  for (const attr of attributes) {
    const code = akeneoColumnCode(attr);
    // A collision is a hard blocker above, so reaching here with one already means the caller
    // skipped validation. Keep the first rather than emitting a duplicate header.
    if (headers.includes(code)) continue;
    headers.push(code);
    columns.push({ code, attr });
  }

  const rows = skus.map(sku => {
    const row: ExportRow = {
      sku: neutralizeCsvFormula(sku.skuNumber),
      sku_title: neutralizeCsvFormula(skuTitles.get(sku.id) ?? ''),
    };
    for (const { code, attr } of columns) {
      const record = byCell.get(cellKey(sku.id, attr.id));
      const value = record?.value ?? '';
      if (attr.dataType === 'boolean' && value !== '') {
        // 1/0 rather than true/false: the yes/no shape most importers expect.
        row[code] = value === 'true' ? '1' : value === 'false' ? '0' : value;
        continue;
      }
      // EVERY free-text value is neutralised. A supplier-submitted value reaches this export
      // verbatim once somebody saves it, and the CSV writer quotes commas and quotes for us but
      // does nothing about a leading = + - @ — that still runs as a formula the moment Excel
      // opens the file. Carried over from the export builder this replaced; losing it would be
      // a security regression, not a simplification.
      row[code] = neutralizeCsvFormula(value);
    }
    return row;
  });

  return { headers, rows };
};

/** Attributes that contribute no value at all across the exported SKUs. */
export const emptyColumns = (
  skus: readonly ExportableSku[],
  attributes: readonly CategoryAttribute[],
  byCell: Map<string, SkuAttributeValueRecord>,
): CategoryAttribute[] =>
  attributes.filter(attr =>
    skus.every(sku => {
      const record = byCell.get(cellKey(sku.id, attr.id));
      return !record || record.value === null || record.value.trim() === '';
    }),
  );
