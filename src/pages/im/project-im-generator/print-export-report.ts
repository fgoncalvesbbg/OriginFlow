/**
 * Page-budget and preflight decisions for a finished print render.
 *
 * Kept separate from PrintExportReport.tsx because the judgement calls here are the part worth
 * testing: which earlier render is a fair comparison, and how far per-language page counts may
 * drift before it stops being translation length and starts being a layout accident.
 */

import type { PrintPdfResult, PrintRender, PrintLeafletLayout } from '../../../services';

/**
 * How far apart per-language page counts may sit before it is worth a look.
 *
 * Translations legitimately differ in length — German, French and Spanish commonly run 10-20%
 * longer than English — so a one-page spread on a ~28-page booklet is the expected outcome, not
 * a defect. Reporting that as a problem would train operators to ignore the panel. Only a
 * spread beyond this is more likely a layout accident than translation.
 */
export const PAGE_SPREAD_TOLERANCE_RATIO = 0.08;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Largest tolerable min-to-max gap, in pages, for a set of per-language counts. */
export const spreadTolerance = (counts: number[]): number =>
  Math.max(1, Math.round(median(counts) * PAGE_SPREAD_TOLERANCE_RATIO));

export const sameLanguageSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export interface LanguagePages {
  language: string;
  pages: number;
  /** Change against the previous comparable render; null when there is nothing to compare. */
  delta: number | null;
}

export interface PageBudget {
  total: number | null;
  perLanguage: LanguagePages[];
  /** Total page change against the previous comparable render. */
  delta: number | null;
  /** The render `delta` was measured against. */
  previous: PrintRender | null;
  /** Min-to-max gap across languages, in pages. */
  spread: number;
  spreadSuspicious: boolean;
}

/**
 * The previous render worth diffing against: same page size and same set of languages, and not
 * the row just written for this result.
 *
 * Both constraints matter — comparing a 5-language A5 booklet against a 1-language A4 proof
 * would report a page delta that says nothing about the template or the content. `renders` is
 * newest-first, so the first match is the most recent one.
 */
export const findComparableRender = (
  renders: readonly PrintRender[],
  languages: readonly string[],
  pageSize: 'a4' | 'a5',
  excludeId?: string,
  layout: PrintLeafletLayout = 'classic',
): PrintRender | null =>
  renders.find(
    (r) =>
      r.id !== excludeId &&
      r.pageSize === pageSize &&
      // Layout has to match for the same reason page size does: the two-column compact
      // leaflet and the classic single-column one are different artefacts from the same
      // content, so diffing one against the other reports a page delta that says nothing
      // about the template or the content — which is what this number is read for.
      r.layout === layout &&
      r.pages != null &&
      sameLanguageSet(r.languages, languages),
  ) ?? null;

export const summarisePageBudget = (
  result: Pick<PrintPdfResult, 'pages' | 'pagesByLanguage' | 'render'>,
  renders: readonly PrintRender[],
  pageSize: 'a4' | 'a5',
): PageBudget => {
  const entries = Object.entries(result.pagesByLanguage ?? {});
  const counts = entries.map(([, n]) => n);
  const previous = findComparableRender(
    renders,
    entries.map(([lang]) => lang),
    pageSize,
    result.render?.id,
    // Read off the row just written rather than passed in from the dialog, so the comparison
    // can never disagree with the artefact it is describing.
    result.render?.layout ?? 'classic',
  );

  return {
    total: result.pages ?? null,
    perLanguage: entries.map(([language, pages]) => {
      const before = previous?.pagesByLanguage?.[language];
      return { language, pages, delta: before == null ? null : pages - before };
    }),
    delta: result.pages != null && previous?.pages != null ? result.pages - previous.pages : null,
    previous,
    spread: counts.length > 1 ? Math.max(...counts) - Math.min(...counts) : 0,
    spreadSuspicious:
      counts.length > 1 && Math.max(...counts) - Math.min(...counts) > spreadTolerance(counts),
  };
};

export interface PreflightSummary {
  fontCount: number;
  nonEmbedded: string[];
  /** Stamped ink sits closer to the trimmed edge than the guard allows. */
  inkTooClose: boolean;
  bottomMarginTooThin: boolean;
  unsupported: string[];
  /** Nothing here needs the operator's attention. */
  clean: boolean;
}

export const summarisePreflight = (
  preflight: PrintPdfResult['preflight'],
): PreflightSummary | null => {
  if (!preflight) return null;
  const nonEmbedded = preflight.nonEmbeddedFonts ?? [];
  const unsupported = preflight.unsupportedStampCharacters ?? [];
  const inkTooClose =
    preflight.footerInkClearanceMm != null &&
    preflight.footerInkClearanceMm < preflight.minInkClearanceMm;
  return {
    fontCount: preflight.fonts?.length ?? 0,
    nonEmbedded,
    inkTooClose,
    bottomMarginTooThin: !!preflight.bottomMarginTooThin,
    unsupported,
    clean: !nonEmbedded.length && !inkTooClose && !unsupported.length && !preflight.bottomMarginTooThin,
  };
};
