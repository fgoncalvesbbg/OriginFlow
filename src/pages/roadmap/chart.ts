/**
 * Roadmap Creator — the step-up chart model.
 *
 * Pure layout maths for the price ladder: which lane a SKU sits in, where its card lands on the
 * price axis, and how cards stack when they would otherwise overlap. No React, no DOM — the
 * component paints what this returns and decides nothing.
 *
 * Deliberately hand-rolled rather than a charting library: the marks are the same SKU cards the
 * board draws, absolutely positioned on a shared scale. No chart library models that, and
 * `recharts` is not a dependency of this project.
 */
import type { RoadmapSku } from '../../types';
import { niceTicks } from './format';

export const CARD_W = 118;
export const CARD_GAP = 6;
export const CARD_H = 208;
export const ROW_GAP = 8;
export const TOP_PAD = 12;
export const LABEL_W = 168;

/**
 * A card in presentation mode has lost its ASP/FP/SM% rows and its NOV table, so it is about 70px
 * shorter. Lane stacking is absolute-positioned off these numbers — leaving CARD_H alone would
 * open a band of dead space under every row.
 */
export const CARD_H_COMPACT = 140;
export const cardHeight = (hideMetrics: boolean): number =>
  hideMetrics ? CARD_H_COMPACT : CARD_H;

/** Which price the ladder is drawn against. */
export type PriceMode = 'asp' | 'fp';

export const priceOf = (r: RoadmapSku, mode: PriceMode): number | null =>
  mode === 'fp' ? r.price : r.asp26;

export const priceLabel = (mode: PriceMode): string =>
  mode === 'fp' ? 'Est. Factory Price' : '2026 Net ASP';

export interface ChartFilters {
  families?: ReadonlySet<string>;
  suppliers?: ReadonlySet<string>;
  segField?: string;
  segVals?: ReadonlySet<string>;
  title?: string;
}

/**
 * Apply the chart's filter chips. Kept separate from layout so filtering is testable on its own
 * and the layout never has to know why a SKU is absent.
 */
export function applyFilters(skus: RoadmapSku[], filters: ChartFilters = {}): RoadmapSku[] {
  const { families, suppliers, segField, segVals, title } = filters;
  // Returns the input array BY IDENTITY when nothing narrows it. The callers feed this straight
  // into useMemo dependencies, so handing back a fresh array for an unfiltered board would
  // re-layout the whole ladder on every render.
  let out = skus;
  if (families?.size) out = out.filter(r => families.has(r.family || '—'));
  if (suppliers?.size) out = out.filter(r => suppliers.has(r.supplier || '—'));
  if (segField && segVals?.size) out = out.filter(r => segVals.has(r.attrs?.[segField] || '—'));
  if (title?.trim()) {
    const q = title.trim().toLowerCase();
    out = out.filter(r => (r.description || '').toLowerCase().includes(q));
  }
  return out;
}

export interface PlacedCard {
  r: RoadmapSku;
  x: number;
  level: number;
}

/**
 * Cards are centred on their price; when two would collide horizontally the later one drops to
 * the next level rather than overlapping. Returns the level assignment and the lane height.
 */
export function layoutLane(
  items: readonly RoadmapSku[],
  xOf: (p: number) => number,
  priceMode: PriceMode,
  cardH: number = CARD_H,
): { placed: PlacedCard[]; laneH: number } {
  const placed: PlacedCard[] = [];
  const levelRightEdge: number[] = [];
  for (const r of items) {
    const left = xOf(priceOf(r, priceMode) as number) - CARD_W / 2;
    let level = 0;
    while (level < levelRightEdge.length && left < levelRightEdge[level] + CARD_GAP) level++;
    levelRightEdge[level] = left + CARD_W;
    placed.push({ r, x: left, level });
  }
  const maxLevel = Math.max(levelRightEdge.length, 1);
  const laneH = TOP_PAD * 2 + maxLevel * cardH + (maxLevel - 1) * ROW_GAP;
  return { placed, laneH: Math.max(cardH + TOP_PAD * 2, laneH) };
}

export interface LaneStats {
  n: number;
  avgPrice: number;
  avgSm: number | null;
  min: number;
  max: number;
}

export function laneStats(items: readonly RoadmapSku[], priceMode: PriceMode): LaneStats {
  const prices = items.map(r => priceOf(r, priceMode) as number);
  const sms = items.map(r => r.sm26).filter((v): v is number => v != null);
  return {
    n: items.length,
    avgPrice: prices.reduce((a, b) => a + b, 0) / (prices.length || 1),
    avgSm: sms.length ? sms.reduce((a, b) => a + b, 0) / sms.length : null,
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

export interface ChartLane {
  label: string;
  items: RoadmapSku[];
  placed?: PlacedCard[];
  height?: number;
  stats?: LaneStats;
}

export interface ChartModel {
  lanes: ChartLane[];
  /** SKUs with no value on the chosen price axis. Counted, never silently dropped. */
  dropped: number;
  usable: RoadmapSku[];
  lo?: number;
  hi?: number;
  plotWidth?: number;
  totalWidth: number;
  ticks: number[];
  xOf: (p: number) => number;
}

/**
 * The whole chart, ready to render. `skus` should already be filtered.
 *
 * SKUs with no value on the chosen price axis are dropped and COUNTED — a card with no position
 * on a price ladder is meaningless, but the count has to stay visible or the chart quietly
 * misrepresents the category.
 */
export function buildChart({
  skus = [],
  laneField = '',
  priceMode = 'asp',
  hideMetrics = false,
}: {
  skus?: readonly RoadmapSku[];
  laneField?: string;
  priceMode?: PriceMode;
  hideMetrics?: boolean;
} = {}): ChartModel {
  const usable = skus.filter(r => Number.isFinite(priceOf(r, priceMode)));
  const dropped = skus.length - usable.length;
  if (!usable.length) return { lanes: [], dropped, totalWidth: 0, ticks: [], xOf: () => 0, usable: [] };

  const lanes: ChartLane[] = [];
  const byLane = new Map<string, ChartLane>();
  for (const r of usable) {
    const label = laneField ? r.attrs?.[laneField] || '—' : 'All SKUs';
    let lane = byLane.get(label);
    if (!lane) {
      lane = { label, items: [] };
      byLane.set(label, lane);
      lanes.push(lane);
    }
    lane.items.push(r);
  }
  for (const lane of lanes) {
    lane.items.sort(
      (a, b) => (priceOf(a, priceMode) as number) - (priceOf(b, priceMode) as number),
    );
  }

  // One price scale shared by every lane, so lanes are comparable at a glance.
  const prices = usable.map(r => priceOf(r, priceMode) as number);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pad = Math.max(1, (maxP - minP) * 0.06) || Math.max(1, maxP * 0.1);
  const lo = Math.max(0, minP - pad);
  const hi = maxP + pad;

  // Wide enough for the busiest lane's cards, and for the price span to stay readable.
  const maxLaneCount = Math.max(...lanes.map(l => l.items.length));
  const byCount = maxLaneCount * (CARD_W + CARD_GAP) * 1.3;
  const bySpan = (maxP - minP) * 14;
  const plotW = Math.max(900, Math.round(Math.max(byCount, bySpan)));
  const xOf = (p: number): number => LABEL_W + ((p - lo) / (hi - lo)) * plotW;

  for (const lane of lanes) {
    const { placed, laneH } = layoutLane(lane.items, xOf, priceMode, cardHeight(hideMetrics));
    lane.placed = placed;
    lane.height = laneH;
    lane.stats = laneStats(lane.items, priceMode);
  }

  return {
    lanes,
    dropped,
    usable: [...usable],
    lo,
    hi,
    plotWidth: plotW,
    totalWidth: LABEL_W + plotW + 160,
    ticks: niceTicks(lo, hi, 8).filter(t => xOf(t) >= LABEL_W - 1),
    xOf,
  };
}

/**
 * Every supplier present in `skus`, for the toolbar's supplier filter and the chart's chips.
 *
 * A SKU with no supplier on file collapses to "—" rather than being dropped, so those rows stay
 * reachable instead of being invisible to every possible selection.
 */
export function supplierOptions(skus: readonly RoadmapSku[] = []): string[] {
  return [...new Set(skus.map(r => r.supplier || '—'))].sort();
}

/**
 * The board narrowed to one supplier. `''` means "every supplier" — the filter is off and the
 * full list comes back untouched.
 *
 * This is a VIEW filter, never a data filter: marks, placeholders and Clear-marks all keep
 * working against the whole category, so narrowing the board can never quietly narrow what an
 * edit applies to.
 */
export function bySupplier(skus: RoadmapSku[] = [], supplier = ''): RoadmapSku[] {
  if (!supplier) return skus; // by identity — see applyFilters
  return skus.filter(r => (r.supplier || '—') === supplier);
}

/** Distinct filter-chip options for the current category. */
export function filterOptions(
  skus: readonly RoadmapSku[],
  segField: string,
): { families: string[]; suppliers: string[]; segValues: string[] } {
  const families = [...new Set(skus.map(r => r.family || '—'))].sort();
  const suppliers = supplierOptions(skus);
  const segValues = segField
    ? [...new Set(skus.map(r => r.attrs?.[segField] || '—'))].filter(Boolean).sort()
    : [];
  return { families, suppliers, segValues };
}
