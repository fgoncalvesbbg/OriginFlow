/**
 * Calendar-date helpers for DATE-ONLY values (`YYYY-MM-DD`).
 *
 * The bug these exist to kill: `new Date('2026-09-05') < new Date()`. A date-only string is
 * parsed by JS as UTC MIDNIGHT, while `new Date()` is the current instant. In any timezone
 * east of UTC (CET, where this app is operated) that comparison flips a full day early — a
 * deadline dated today reads as overdue from 00:00 local, and a review due today shows as
 * overdue before anyone starts work. Comparing the two as CALENDAR DATES in local time is
 * the only correct thing: a deadline of "the 5th" means the whole of the 5th, locally.
 *
 * Use these for `compliance_requests.deadline`, `regulations.review_due`, and anything else
 * stored as a bare date. Do NOT use them for true timestamps (`created_at` etc.) — those are
 * instants and compare correctly with plain Date arithmetic.
 */

/** Today as `YYYY-MM-DD` in the viewer's LOCAL timezone (not UTC). */
export const todayLocalISO = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Normalise a stored value to its `YYYY-MM-DD` calendar part, or null when absent/unparseable.
 * Accepts a bare date, or a full ISO timestamp (whose date part is taken verbatim — a
 * timestamp already carries its own offset, so no conversion is applied here).
 */
export const toDateOnly = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1] : null;
};

/**
 * True when `value`'s calendar date is strictly BEFORE today (local). A value dated today is
 * NOT past due — that is the whole point.
 */
export const isDateOnlyPast = (value: string | null | undefined): boolean => {
  const d = toDateOnly(value);
  return d !== null && d < todayLocalISO();
};

/** True when `value`'s calendar date is today or earlier (local) — i.e. "due now". */
export const isDateOnlyDue = (value: string | null | undefined): boolean => {
  const d = toDateOnly(value);
  return d !== null && d <= todayLocalISO();
};

/**
 * Whole days from today (local) until `value`. Negative when past, 0 when today.
 * Computed on calendar dates, so DST transitions cannot produce a fractional day.
 */
export const daysUntilDateOnly = (value: string | null | undefined): number | null => {
  const d = toDateOnly(value);
  if (d === null) return null;
  const [ty, tm, td] = todayLocalISO().split('-').map(Number);
  const [vy, vm, vd] = d.split('-').map(Number);
  const MS_PER_DAY = 86_400_000;
  return Math.round((Date.UTC(vy, vm - 1, vd) - Date.UTC(ty, tm - 1, td)) / MS_PER_DAY);
};
