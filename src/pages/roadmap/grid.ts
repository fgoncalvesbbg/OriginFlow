/**
 * Roadmap Creator — the grid model.
 *
 * Pure functions, no React and no I/O. The board's whole layout is derived here and rendered
 * dumbly, so the tricky parts — which rows exist, which cell an annotation belongs to — are
 * unit-testable against hand-built fixtures instead of a rendered DOM.
 */
import type { RoadmapAxisValue, RoadmapItemFlag, RoadmapPlacer, RoadmapSku } from '../../types';

/**
 * Cells are addressed case-insensitively: a SKU carrying "Black" and a hand-added row typed
 * "black" must land in the same cell, or the planner gets two rows that look identical.
 */
export const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** U+241F (SYMBOL FOR UNIT SEPARATOR) — a character no axis value will ever contain. */
const SEP = '␟';

export const cellId = (yValue: unknown, xValue: unknown): string =>
  `${norm(yValue)}${SEP}${norm(xValue)}`;

/** Distinct values, case-insensitive, keeping the first spelling seen. */
export function distinctCI(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    if (!v) continue;
    const k = norm(v);
    if (!seen.has(k)) seen.set(k, v);
  }
  return [...seen.values()];
}

/**
 * Sort numerically when EVERY value carries a number ("122cm" before "132cm"), otherwise leave
 * source order alone. Mixed lists keep the export's order rather than being alphabetised into a
 * different, equally arbitrary one.
 */
export function smartSort(values: readonly string[]): string[] {
  const numOf = (s: string): number | null => {
    const m = String(s).match(/(\d+(?:[.,]\d+)?)/);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  };
  const arr = values.map((v, i) => ({ v, i, n: numOf(v) }));
  if (arr.length && arr.every(x => x.n !== null)) {
    arr.sort((a, b) => (a.n as number) - (b.n as number) || a.i - b.i);
  }
  return arr.map(x => x.v);
}

const hasCI = (arr: readonly string[], v: string): boolean => arr.some(x => norm(x) === norm(v));

export interface BuildGridInput {
  skus?: readonly RoadmapSku[];
  yField: string;
  xField: string;
  placers?: readonly RoadmapPlacer[];
  axisValues?: readonly RoadmapAxisValue[];
  flags?: readonly RoadmapItemFlag[];
}

export interface GridModel {
  yField: string;
  xField: string;
  yValues: string[];
  xValues: string[];
  families: string[];
  /** SKUs dropped for want of a value on one of the two axes — surfaced as an honesty note. */
  skipped: number;
  usableCount: number;
  /** SKUs in one cell of one family band. */
  itemsAt: (family: string, yValue: string, xValue: string) => RoadmapSku[];
  /** Placeholder cards in one cell of one family band. */
  placersAt: (family: string, yValue: string, xValue: string) => RoadmapPlacer[];
  flagFor: (sku: string) => RoadmapItemFlag | null;
  /** True when this value exists only because it was added by hand — it gets a remove ✕. */
  isAddedRow: (v: string) => boolean;
  isAddedCol: (v: string) => boolean;
  isAddedFamily: (f: string) => boolean;
  axisValueId: (kind: 'family' | 'row' | 'col', value: string) => number | null;
}

/**
 * Build everything the board renders.
 *
 * THE UNION RULE — the reason this function exists rather than being inlined in the component.
 * An annotation is addressed by VALUE (family name, axis value), not by id. A refreshed export
 * can rename a family, change a SKU's Segment 01, or remove the last SKU that gave a row its
 * existence — and a placer pinned to that cell would then have nowhere to render. The row would
 * survive in the database but silently vanish from the screen, which is the exact data loss this
 * module was built to prevent.
 *
 * So the axis lists are a UNION OF THREE SOURCES, not just the SKUs:
 *   1. values present on the category's SKUs,
 *   2. values added by hand (`roadmap_axis_value`) — which the prototype already did,
 *   3. values referenced by an existing placer — which it did not.
 *
 * (3) is what guarantees every stored annotation has a cell to live in. The History tab's orphan
 * report (`findOrphans` below) is the other half: it names the annotations that ONLY (3) is
 * keeping visible, so "this is being kept alive artificially" is visible rather than silent.
 */
export function buildGrid({
  skus = [],
  yField,
  xField,
  placers = [],
  axisValues = [],
  flags = [],
}: BuildGridInput): GridModel {
  const usable = skus.filter(r => r.attrs?.[xField] && r.attrs?.[yField]);
  const skipped = skus.length - usable.length;

  const addedFamilies = axisValues.filter(a => a.kind === 'family').map(a => a.value);
  const addedRows = axisValues
    .filter(a => a.kind === 'row' && a.field === yField)
    .map(a => a.value);
  const addedCols = axisValues
    .filter(a => a.kind === 'col' && a.field === xField)
    .map(a => a.value);

  // Placers are pinned to one axis PAIR; only those drawn on the current pair can contribute
  // values, otherwise switching axes would drag in unrelated rows.
  const livePlacers = placers.filter(p => p.yField === yField && p.xField === xField);

  const yValues = smartSort(distinctCI(usable.map(r => r.attrs[yField])));
  const xValues = smartSort(distinctCI(usable.map(r => r.attrs[xField])));

  for (const v of addedRows) if (!hasCI(yValues, v)) yValues.push(v);
  for (const v of addedCols) if (!hasCI(xValues, v)) xValues.push(v);
  for (const p of livePlacers) {
    if (!hasCI(yValues, p.yValue)) yValues.push(p.yValue);
    if (!hasCI(xValues, p.xValue)) xValues.push(p.xValue);
  }
  if (!yValues.length) yValues.push('—');
  if (!xValues.length) xValues.push('—');

  // Families, in first-seen order from the data, then hand-added ones, then any a placer still
  // points at (a family renamed upstream keeps its planning notes on screen).
  const familyOrder: string[] = [];
  const byFamily = new Map<string, Map<string, RoadmapSku[]>>();
  for (const r of usable) {
    const fam = r.family || '—';
    let cells = byFamily.get(fam);
    if (!cells) {
      cells = new Map<string, RoadmapSku[]>();
      byFamily.set(fam, cells);
      familyOrder.push(fam);
    }
    const key = cellId(r.attrs[yField], r.attrs[xField]);
    const bucket = cells.get(key);
    if (bucket) bucket.push(r);
    else cells.set(key, [r]);
  }
  const dataFamilies = new Set(familyOrder);
  const extraFamilies: string[] = [];
  for (const f of addedFamilies) {
    if (!dataFamilies.has(f) && !hasCI(extraFamilies, f)) extraFamilies.push(f);
  }
  for (const p of livePlacers) {
    if (!dataFamilies.has(p.family) && !hasCI(extraFamilies, p.family)) extraFamilies.push(p.family);
  }
  const families = [...familyOrder, ...extraFamilies];

  // Placers indexed by the cell they occupy, in stable order.
  const placersByCell = new Map<string, RoadmapPlacer[]>();
  for (const p of [...livePlacers].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)) {
    const key = `${p.family}${SEP}${cellId(p.yValue, p.xValue)}`;
    const bucket = placersByCell.get(key);
    if (bucket) bucket.push(p);
    else placersByCell.set(key, [p]);
  }

  const flagBySku = new Map(flags.map(f => [f.sku, f]));

  return {
    yField,
    xField,
    yValues,
    xValues,
    families,
    skipped,
    usableCount: usable.length,
    itemsAt: (family, yValue, xValue) => byFamily.get(family)?.get(cellId(yValue, xValue)) || [],
    placersAt: (family, yValue, xValue) =>
      placersByCell.get(`${family}${SEP}${cellId(yValue, xValue)}`) || [],
    flagFor: sku => flagBySku.get(sku) || null,
    isAddedRow: v => hasCI(addedRows, v) && !usable.some(r => norm(r.attrs[yField]) === norm(v)),
    isAddedCol: v => hasCI(addedCols, v) && !usable.some(r => norm(r.attrs[xField]) === norm(v)),
    isAddedFamily: f => !dataFamilies.has(f) && hasCI(addedFamilies, f),
    axisValueId: (kind, value) => {
      const field = kind === 'family' ? null : kind === 'row' ? yField : xField;
      const hit = axisValues.find(
        a => a.kind === kind && a.field === field && norm(a.value) === norm(value),
      );
      return hit ? hit.id : null;
    },
  };
}

export interface OrphanResult {
  placers: RoadmapPlacer[];
  flags: RoadmapItemFlag[];
}

/**
 * Annotations pointing at a cell no live SKU occupies — the History tab's orphan report.
 *
 * This is the visible half of the union rule: clause (3) keeps these on the board so nothing is
 * lost, and this function is what stops "kept alive artificially" from being invisible. Mirrors
 * the same derivation the board uses, so the count can be shown without a second round trip.
 */
export function findOrphans({
  skus = [],
  placers = [],
  flags = [],
}: {
  skus?: readonly RoadmapSku[];
  placers?: readonly RoadmapPlacer[];
  flags?: readonly RoadmapItemFlag[];
} = {}): OrphanResult {
  const current = skus.filter(s => s.isCurrent !== false);
  const orphanPlacers = placers.filter(
    p =>
      !current.some(
        s =>
          (s.family || '—') === p.family &&
          norm(s.attrs?.[p.yField]) === norm(p.yValue) &&
          norm(s.attrs?.[p.xField]) === norm(p.xValue),
      ),
  );
  const delisted = new Set(skus.filter(s => s.isCurrent === false).map(s => s.sku));
  const orphanFlags = flags.filter(f => delisted.has(f.sku));
  return { placers: orphanPlacers, flags: orphanFlags };
}
