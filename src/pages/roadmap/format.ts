/**
 * Roadmap Creator — value formatting.
 *
 * Pure, no React. Ported from the prototype so the cards read identically. The thresholds and the
 * YoY definition are PRODUCT RULES, not cosmetics — changing 25%/15% changes which SKUs a planner
 * treats as healthy, so they belong here with a name rather than inline in a component.
 */
import type { RoadmapSku } from '../../types';

/** Traffic-light bucket. Rendered as a token, never as a raw hex, so styles.css owns the hues. */
export type Tone = 'good' | 'warn' | 'bad' | 'none';

export const fmtInt = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString('en-US');

export const fmtPct = (n: number | null | undefined): string =>
  n == null ? '—' : `${(n * 100).toFixed(1)}%`;

export const fmtFp = (n: number | null | undefined): string =>
  n == null ? '—' : `$${n.toFixed(2)}`;

/** Forecast fill factor renders as a whole percentage. */
export const fmtFcff = (n: number | null | undefined): string =>
  n == null ? '—' : `${(n * 100).toFixed(0)}%`;

/** Compact volume for the dense card table: 42.0k / 1.2M. */
export function fmtK(n: number | null | undefined): string {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return Math.round(n).toString();
}

/** Steering-margin traffic light: >=25% healthy, 15-25% watch, <15% problem. */
export function smTone(v: number | null | undefined): Tone {
  if (v == null) return 'none';
  if (v >= 0.25) return 'good';
  if (v >= 0.15) return 'warn';
  return 'bad';
}

/**
 * Year-on-year growth: (2026 forecast - 2025 actual) / 2025 actual.
 *
 * Null when 2025 is zero or missing. A percentage against a zero base is noise, not information —
 * every SKU launched this year would otherwise wear a meaningless ▲∞ badge.
 */
export function yoyOf(r: Pick<RoadmapSku, 'nov25' | 'novfc26'> | null | undefined): number | null {
  if (r == null) return null;
  if (r.nov25 == null || !r.nov25 || r.novfc26 == null) return null;
  return (r.novfc26 - r.nov25) / r.nov25;
}

export const yoyTone = (g: number | null | undefined): Tone =>
  g == null ? 'none' : g >= 0 ? 'good' : 'bad';

/** Human-friendly axis tick values across a price range. */
export function niceTicks(lo: number, hi: number, target: number): number[] {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** A filename-safe slug for exports. */
export const slugify = (s: string | null | undefined, max = 60): string =>
  String(s || '')
    .replace(/[^a-z0-9]+/gi, '_')
    .slice(0, max) || 'category';
