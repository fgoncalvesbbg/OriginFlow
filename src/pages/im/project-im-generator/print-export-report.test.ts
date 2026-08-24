/**
 * Page-budget and preflight judgement calls.
 *
 * The two that matter: picking a *fair* earlier render to diff against (a 5-language A5 booklet
 * compared to a 1-language A4 proof would report a meaningless page delta), and not crying wolf
 * over per-language page differences that translation length fully explains.
 */
import { describe, it, expect } from 'vitest';
import type { PrintRender, PrintPdfResult } from '../../../services';
import {
  summarisePageBudget,
  summarisePreflight,
  findComparableRender,
  spreadTolerance,
  sameLanguageSet,
} from './print-export-report';

const render = (over: Partial<PrintRender>): PrintRender => ({
  id: 'r1',
  projectId: 'p',
  templateType: 'im',
  imVersion: 1,
  languages: ['en', 'de', 'fr', 'it', 'es'],
  pageSize: 'a5',
  storagePath: 's',
  url: 'u',
  bytes: 1,
  pages: 141,
  pagesByLanguage: { en: 27, de: 28, fr: 28, it: 28, es: 28 },
  createdBy: null,
  createdAt: '2026-08-24T00:00:00Z',
  comment: '',
  market: null,
  markupUrl: null,
  markupId: null,
  ...over,
});

const result = (over: Partial<PrintPdfResult> = {}): PrintPdfResult => ({
  url: 'u',
  storagePath: 's',
  pages: 141,
  pagesByLanguage: { en: 27, de: 28, fr: 28, it: 28, es: 28 },
  ...over,
});

describe('sameLanguageSet', () => {
  it('ignores order, since the same booklet can be requested in any language order', () => {
    expect(sameLanguageSet(['en', 'de'], ['de', 'en'])).toBe(true);
    expect(sameLanguageSet(['en', 'de'], ['en', 'fr'])).toBe(false);
    expect(sameLanguageSet(['en'], ['en', 'de'])).toBe(false);
  });
});

describe('findComparableRender', () => {
  const langs = ['en', 'de'];

  it('skips the row just written for this render', () => {
    const fresh = render({ id: 'fresh', languages: langs });
    expect(findComparableRender([fresh], langs, 'a5', 'fresh')).toBeNull();
  });

  it('will not compare across page sizes', () => {
    const a4 = render({ id: 'a', languages: langs, pageSize: 'a4' });
    expect(findComparableRender([a4], langs, 'a5')).toBeNull();
  });

  it('will not compare across different language sets', () => {
    const other = render({ id: 'a', languages: ['en', 'fr'] });
    expect(findComparableRender([other], langs, 'a5')).toBeNull();
  });

  it('skips rows from before pages were recorded rather than treating them as zero', () => {
    const legacy = render({ id: 'old', languages: langs, pages: null });
    expect(findComparableRender([legacy], langs, 'a5')).toBeNull();
  });

  it('takes the most recent match — renders arrive newest first', () => {
    const newer = render({ id: 'newer', languages: langs, pages: 60 });
    const older = render({ id: 'older', languages: langs, pages: 50 });
    expect(findComparableRender([newer, older], langs, 'a5')?.id).toBe('newer');
  });
});

describe('spreadTolerance', () => {
  it('allows at least one page, so a short booklet is not permanently flagged', () => {
    expect(spreadTolerance([4, 5])).toBe(1);
  });

  it('scales with booklet length', () => {
    // median 28 -> round(2.24) = 2
    expect(spreadTolerance([27, 28, 28, 28, 28])).toBe(2);
  });
});

describe('summarisePageBudget', () => {
  it('does not flag the real MDA26003 spread — EN 27 against 28 elsewhere is translation length', () => {
    const budget = summarisePageBudget(result(), [], 'a5');
    expect(budget.spread).toBe(1);
    expect(budget.spreadSuspicious).toBe(false);
  });

  it('flags a spread translation length cannot explain', () => {
    const budget = summarisePageBudget(
      result({ pagesByLanguage: { en: 27, de: 28, fr: 41, it: 28, es: 28 } }),
      [],
      'a5',
    );
    expect(budget.spread).toBe(14);
    expect(budget.spreadSuspicious).toBe(true);
  });

  it('reports no spread for a single-language booklet', () => {
    const budget = summarisePageBudget(result({ pagesByLanguage: { en: 27 } }), [], 'a5');
    expect(budget.spread).toBe(0);
    expect(budget.spreadSuspicious).toBe(false);
  });

  it('diffs the total and every language against the previous comparable render', () => {
    const previous = render({
      id: 'prev',
      pages: 129,
      pagesByLanguage: { en: 25, de: 26, fr: 26, it: 26, es: 26 },
    });
    const budget = summarisePageBudget(result({ render: { id: 'fresh' } as PrintRender }), [previous], 'a5');
    expect(budget.previous?.id).toBe('prev');
    expect(budget.delta).toBe(12);
    expect(budget.perLanguage.find((l) => l.language === 'en')?.delta).toBe(2);
    expect(budget.perLanguage.find((l) => l.language === 'de')?.delta).toBe(2);
  });

  it('leaves deltas null when there is nothing fair to compare against', () => {
    const budget = summarisePageBudget(result(), [render({ id: 'x', pageSize: 'a4' })], 'a5');
    expect(budget.previous).toBeNull();
    expect(budget.delta).toBeNull();
    expect(budget.perLanguage.every((l) => l.delta === null)).toBe(true);
  });

  it('survives a server that never sent page counts', () => {
    const budget = summarisePageBudget({ pages: undefined, pagesByLanguage: undefined }, [], 'a5');
    expect(budget.total).toBeNull();
    expect(budget.perLanguage).toEqual([]);
    expect(budget.delta).toBeNull();
  });
});

describe('summarisePreflight', () => {
  const base = {
    fonts: [{ name: 'Inter-Regular-9742', embedded: true }],
    nonEmbeddedFonts: [],
    footerInkClearanceMm: 8,
    minInkClearanceMm: 8,
    bottomMarginTooThin: false,
    unsupportedStampCharacters: [],
  };

  it('returns null when the server sent no report', () => {
    expect(summarisePreflight(undefined)).toBeNull();
  });

  it('passes a fully embedded document with ink exactly on the guard', () => {
    expect(summarisePreflight(base)?.clean).toBe(true);
  });

  it('fails a non-embedded font — the defect that fails a vendor outright', () => {
    const out = summarisePreflight({ ...base, nonEmbeddedFonts: ['Helvetica'] });
    expect(out?.clean).toBe(false);
    expect(out?.nonEmbedded).toEqual(['Helvetica']);
  });

  it('fails ink inside the trim guard', () => {
    // The pre-fix geometry: bottomMargin/2 at a 15mm margin put ink here.
    const out = summarisePreflight({ ...base, footerInkClearanceMm: 6.91 });
    expect(out?.inkTooClose).toBe(true);
    expect(out?.clean).toBe(false);
  });

  it('does not judge trim clearance for leaflets, which stamp no footer', () => {
    const out = summarisePreflight({ ...base, footerInkClearanceMm: null });
    expect(out?.inkTooClose).toBe(false);
    expect(out?.clean).toBe(true);
  });

  it('fails when stamped characters had no covering font', () => {
    const out = summarisePreflight({ ...base, unsupportedStampCharacters: ['取', '扱'] });
    expect(out?.clean).toBe(false);
    expect(out?.unsupported).toEqual(['取', '扱']);
  });
});
