/**
 * Locale handling for the translation memory — the one place a language code is
 * allowed to be split.
 *
 * THE PROBLEM THIS HEDGES
 * ----------------------
 * Everything in the IM module today speaks 2-letter ISO 639-1 (see im-languages.ts),
 * because those codes are the JSONB keys in im_sections.content and im_blocks.content.
 * That is fine for storage and must not change. But a translation memory is the one
 * component where collapsing regional variants is extremely expensive to unwind:
 * Austrian and German manuals differ in terminology, units and legal wording, and once
 * a corpus has volume there is no safe way to split a shared 'de' pile in two.
 *
 * So: the TM stores FULL LOCALE CODES, the content keys stay 2-letter, and this module
 * is the seam between them. Today the mapping is the identity — a market's languages
 * come back verbatim — and the day per-market variants are wanted, only this file and
 * the market admin screen change.
 *
 * THE RULE THAT MATTERS
 * -------------------
 * A bare code means "language-neutral, valid for every regional variant", NOT "the
 * majority market". Never backfill 'de' to 'de-DE'. Doing so asserts a region nobody
 * chose, and it would silently turn every existing row into a fallback miss for Austria
 * and a false exact match for Germany.
 *
 * Retrieval consequence: a hit whose `localeDistance` is greater than zero came from a
 * parent or sibling locale and must never be auto-applied — it is a suggestion.
 */

/**
 * Reduce a locale to the content key it is stored under in im_sections / im_blocks.
 *
 * THE ONLY sanctioned `split('-')` on a language code in the codebase. Anything else
 * doing its own splitting will eventually disagree with this and produce content
 * written under a key nothing reads.
 */
export const contentKeyForLocale = (locale: string): string =>
  (locale || 'en').trim().toLowerCase().split('-')[0];

/** Normalize a locale to `ll` or `ll-RR` form: lowercase language, uppercase region. */
export const normalizeLocale = (locale: string): string => {
  const [lang, region] = (locale || 'en').trim().split('-');
  const base = (lang || 'en').toLowerCase();
  return region ? base + '-' + region.toUpperCase() : base;
};

/**
 * Lookup order for a requested locale, most specific first.
 *
 * `de-AT` -> `['de-AT', 'de']`; `de` -> `['de']`.
 *
 * A miss on the parent is a MISS, not a guess at a sibling: falling back from `de-AT`
 * to `de-CH` would substitute one country's legal wording for another's, which is
 * exactly the class of error this module exists to prevent.
 */
export const localeFallbackChain = (locale: string): string[] => {
  const normalized = normalizeLocale(locale);
  const base = contentKeyForLocale(normalized);
  return normalized === base ? [base] : [normalized, base];
};

/**
 * How far a stored locale is from the requested one.
 *
 * 0 = the same locale, safe to auto-apply. 1 = the stored row is the language-neutral
 * parent, usable but a suggestion only. 2 = a different regional variant of the same
 * language, which must never be applied automatically. -1 = unrelated.
 */
export const localeDistance = (requested: string, stored: string): number => {
  const req = normalizeLocale(requested);
  const sto = normalizeLocale(stored);
  if (req === sto) return 0;
  const reqBase = contentKeyForLocale(req);
  const stoBase = contentKeyForLocale(sto);
  if (reqBase !== stoBase) return -1;
  if (sto === stoBase) return 1;
  return 2;
};

/** True when a stored locale may be applied without a human looking at it. */
export const isAutoApplicableLocale = (requested: string, stored: string): boolean =>
  localeDistance(requested, stored) === 0;

/**
 * The locales a market's manuals must cover.
 *
 * Today `im_markets.languages` holds 2-letter codes and this is the identity function —
 * DACH means `['de','en']`, so an Austrian and a German manual are byte-identical. That
 * is a real current limitation, not a bug: the market table models a territory to
 * language SET mapping and carries no per-variant wording. This function is the seam
 * where per-market variants land later without touching a single caller.
 */
export const localesForMarket = (market: { languages: string[] }): string[] =>
  (market.languages ?? []).map(normalizeLocale);

/** The source locale every IM template authors in today. */
export const DEFAULT_SOURCE_LOCALE = 'en';
