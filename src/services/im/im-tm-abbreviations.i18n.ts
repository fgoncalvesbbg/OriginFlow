/**
 * Per-language sentence-boundary exceptions for translation-memory segmentation.
 *
 * Naive splitting on sentence-final punctuation is the single most common reason a
 * translation memory "doesn't work": technical documentation is dense with
 * `max.`, `approx.`, `Fig. 4`, `No.`, `2.5 l`, ordinals and decimal separators,
 * and every false cut produces a half-sentence that is stored forever, matched
 * against forever, and eventually printed in a manual.
 *
 * Entries are LOWERCASED, WHITESPACE-COLLAPSED SUFFIXES including the trailing
 * full stop. They are tested against the collapsed, lowercased tail of the text
 * preceding a candidate boundary, and only count when the character before the
 * match is not a letter or digit — so `no.` matches "See no." but not "casino.".
 * Multi-word entries such as German `z. b.` work despite the internal space
 * precisely because the tail is whitespace-collapsed first.
 *
 * Follows the same shape as callout-titles.i18n.ts: a plain data module keyed by
 * ISO 639-1 code with an `en`-shaped universal fallback, no i18n library.
 *
 * SCOPE, stated honestly: `en` is the only source language the IM module ever
 * exports from (`collectTranslationFragments(sections, 'en')`), so English is the
 * only list that needs to be exhaustive. German, French, Spanish, Italian, Dutch
 * and Polish are covered decently because they are the highest-volume targets and
 * because target-side segmentation is wanted for alignment and QA. The remaining
 * EU languages fall back to the universal list only — that is a deliberate gap,
 * not an oversight, and it should not be described as full coverage.
 */

export interface SegmentationExceptions {
  /** Lowercased, whitespace-collapsed suffixes (dot included) that must not end a sentence. */
  noBreakAfter: string[];
}

/**
 * Language-neutral abbreviations and unit-ish forms that appear in every European
 * technical manual regardless of the prose language, because they come from
 * standards, drawings and part lists rather than from the language itself.
 */
export const UNIVERSAL_NO_BREAK_AFTER: string[] = [
  'fig.', 'figs.', 'abb.', 'no.', 'nos.', 'nr.', 'art.', 'pos.', 'ref.', 'tab.', 'tbl.',
  'chap.', 'sec.', 'sect.', 'std.', 'approx.', 'ca.', 'max.', 'min.', 'temp.', 'vol.',
  'incl.', 'excl.', 'etc.', 'e.g.', 'i.e.', 'vs.', 'cf.', 'ed.', 'p.', 'pp.',
  'mm.', 'cm.', 'kg.', 'ltd.', 'co.', 'inc.', 'gmbh.', 'dwg.', 'rev.', 'ser.',
];

export const SEGMENTATION_EXCEPTIONS: Record<string, SegmentationExceptions> = {
  en: {
    noBreakAfter: [
      'dept.', 'mfr.', 'assy.', 'qty.', 'lbs.', 'oz.', 'ft.', 'in.', 'cont.',
      'dia.', 'thk.', 'alt.', 'est.', 'avg.', 'incl.', 'mr.', 'mrs.', 'ms.', 'dr.', 'prof.',
      'st.', 'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.',
      'oct.', 'nov.', 'dec.',
    ],
  },
  de: {
    noBreakAfter: [
      'z. b.', 'z.b.', 'd. h.', 'd.h.', 'u. a.', 'u.a.', 'o. ä.', 'o.ä.', 'bzw.', 'usw.',
      'ggf.', 'evtl.', 'inkl.', 'exkl.', 'bspw.', 'bzgl.', 'lt.', 'techn.', 'ggfs.',
      'nr.', 'abb.', 'kap.', 'abs.', 'ca.', 'bzw.', 'siehe.', 'vgl.', 'sog.', 'zzgl.',
      'hrsg.', 'jhrh.', 'str.', 'hr.', 'fr.', 'dr.', 'prof.',
    ],
  },
  fr: {
    noBreakAfter: [
      'p. ex.', 'p.ex.', 'c.-à-d.', 'c.à.d.', 'env.', 'réf.', 'fig.', 'art.', 'cf.',
      'chap.', 'éd.', 'ill.', 'tél.', 'av.', 'boul.', 'm.', 'mm.', 'mme.', 'dr.',
      'sté.', 'ets.', 'qté.', 'max.', 'min.',
    ],
  },
  es: {
    noBreakAfter: [
      'p. ej.', 'p.ej.', 'núm.', 'nro.', 'art.', 'aprox.', 'fig.', 'etc.', 'máx.', 'mín.',
      'ref.', 'cap.', 'pág.', 'págs.', 'sr.', 'sra.', 'srta.', 'dr.', 'dra.', 'ud.',
      'uds.', 'cant.', 'tel.', 'avda.',
    ],
  },
  it: {
    noBreakAfter: [
      'es.', 'ad es.', 'n.', 'nr.', 'art.', 'fig.', 'circa.', 'max.', 'min.', 'rif.',
      'cap.', 'pag.', 'sig.', 'sig.ra', 'dott.', 'ing.', 'tel.', 'ecc.', 'qta.', 'tab.',
    ],
  },
  nl: {
    noBreakAfter: [
      'bijv.', 'bijz.', 'nr.', 'art.', 'afb.', 'o.a.', 'm.b.t.', 'd.w.z.', 'z.o.z.',
      'max.', 'min.', 'ca.', 'incl.', 'excl.', 'blz.', 'hfst.', 'dhr.', 'mevr.', 'dr.',
      'tel.', 'evt.', 'a.u.b.',
    ],
  },
  pl: {
    noBreakAfter: [
      'np.', 'tzn.', 'tj.', 'nr.', 'rys.', 'art.', 'maks.', 'min.', 'ok.', 'itp.', 'itd.',
      'm.in.', 'zob.', 'por.', 'rozdz.', 'str.', 'ul.', 'godz.', 'tab.', 'tzw.', 'ww.',
      'dr.', 'prof.', 'inż.',
    ],
  },
};

/**
 * Longest multi-word exception is about 8 characters (`c.-à-d.`, `p. ex.`); 24
 * gives generous headroom for the collapsed tail slice without scanning the whole
 * segment on every candidate boundary.
 */
const TAIL_WINDOW = 24;

interface CompiledExceptions {
  suffixes: Set<string>;
  window: number;
}

const compiledCache = new Map<string, CompiledExceptions>();

/**
 * Merged, memoized exception set for a language: the universal list plus the
 * language's own. Unknown languages get the universal list alone.
 */
export const exceptionsFor = (lang: string): CompiledExceptions => {
  const key = (lang || 'en').toLowerCase().split('-')[0];
  const cached = compiledCache.get(key);
  if (cached) return cached;

  const own = SEGMENTATION_EXCEPTIONS[key]?.noBreakAfter ?? [];
  const suffixes = new Set<string>([...UNIVERSAL_NO_BREAK_AFTER, ...own].map((s) => s.toLowerCase()));
  let longest = 0;
  for (const s of suffixes) longest = Math.max(longest, s.length);

  const compiled: CompiledExceptions = { suffixes, window: Math.max(TAIL_WINDOW, longest + 2) };
  compiledCache.set(key, compiled);
  return compiled;
};

/** True when a letter or digit — used for the word-boundary check in front of a matched suffix. */
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/**
 * True when the text ending at a candidate sentence boundary ends in a known
 * abbreviation, so the boundary must be rejected.
 *
 * `textUpToTerminator` must already include the terminating full stop.
 */
export const isNoBreakAfter = (textUpToTerminator: string, lang: string): boolean => {
  const { suffixes, window } = exceptionsFor(lang);
  const tail = textUpToTerminator
    .slice(-window)
    .replace(/\s+/g, ' ')
    .toLowerCase();
  for (const suffix of suffixes) {
    if (!tail.endsWith(suffix)) continue;
    if (!isWordChar(tail[tail.length - suffix.length - 1])) return true;
  }
  return false;
};
