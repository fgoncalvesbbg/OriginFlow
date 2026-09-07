/**
 * Display-formatting helpers (bytes, dates). NOT the place for date calendar-day COMPARISON
 * logic — that stays in `src/utils/date.utils.ts` (`todayLocalISO`, `toDateOnly`, etc.); this
 * module only turns a value into a string for display.
 */

export interface FormatBytesOptions {
  /**
   * Whether a large size may switch to "X.X MB". Default true. Set false to reproduce a call
   * site that only ever rendered "N KB" (e.g. small regulation/template attachments, where an
   * MB-scale file was never expected) — with `allowMB` off, a byte count is still rendered in KB
   * however large it is, it just never switches units.
   */
  allowMB?: boolean;
}

/**
 * Human-readable byte size: "512 KB", or "2.3 MB" once `allowMB` lets it cross the 1 MB
 * threshold. KB is always at least 1 (never "0 KB" for a tiny-but-nonzero size).
 */
export const formatBytes = (bytes: number, opts: FormatBytesOptions = {}): string => {
  const allowMB = opts.allowMB ?? true;
  if (allowMB && bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

export interface FormatDateOptions extends Intl.DateTimeFormatOptions {
  /** Shown for a missing or unparseable date. Defaults to ''. */
  empty?: string;
  /** BCP-47 locale passed to `toLocaleDateString`. Defaults to the viewer's own (undefined). */
  locale?: string;
}

/**
 * Format a date-ish string for display, guarding both an absent value and one `Date` can't
 * parse (previously several call sites let an invalid date reach `toLocaleDateString` and print
 * the literal string "Invalid Date").
 *
 * Deliberately takes the exact `Intl.DateTimeFormatOptions` (day/month/year/timeZone/…) and
 * locale a call site already used, rather than imposing one fixed format: the screens this
 * consolidates disagree on whether the year is shown and on timezone handling, and this is a
 * de-duplication of the repeated implementation, not a visual change to any one of them.
 */
export const formatDate = (
  value: string | null | undefined,
  opts: FormatDateOptions = {},
): string => {
  const { empty = '', locale, ...dtfOpts } = opts;
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return date.toLocaleDateString(locale, dtfOpts);
};
