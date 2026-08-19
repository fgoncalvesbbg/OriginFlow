/**
 * Stale-translation markers.
 *
 * When a target-language fragment is produced by AI translation from the English
 * source, a hash of that EN source is stored as an HTML comment at the very start
 * of the target HTML: `<!--im-en-src:HASH-->`. The language tabs compare the stored
 * hash against the CURRENT English content — a mismatch means "English changed after
 * this translation was made" and is shown as an amber (stale) dot.
 *
 * Deliberate semantics of the comment carrier:
 *  - HTML comments never render (viewer, print, editor preview all ignore them).
 *  - The rich editor's parser drops comments, so the first HUMAN edit of a
 *    translated fragment removes the marker — a human-maintained translation is
 *    never flagged as stale (we no longer know better than the human).
 *  - XLIFF export only encodes the EN source (targets are emitted empty), so the
 *    marker never reaches an external translator.
 *  - Only machine-translation writers add the marker; XLIFF imports and manual
 *    authoring stay unmarked and therefore unflagged.
 */

export const EN_SRC_MARK_RE = /^<!--im-en-src:([a-z0-9]+)-->/;

/** Cheap, deterministic content hash (djb2, base36) of the EN source at translate time. */
export const enSourceHash = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** Prefix a machine-translated fragment with the hash of the EN source it came from. */
export const markTranslatedFromEn = (translatedHtml: string, enSource: string): string =>
  `<!--im-en-src:${enSourceHash(enSource)}-->${translatedHtml}`;

/**
 * True when `targetHtml` carries a marker whose hash no longer matches the current
 * EN source — i.e. English was edited after this translation was produced.
 * Unmarked content (human-written/imported) always returns false.
 */
export const translationStaleAgainstEn = (enSource: string | undefined, targetHtml: string | undefined): boolean => {
  const m = targetHtml?.match(EN_SRC_MARK_RE);
  if (!m) return false;
  return m[1] !== enSourceHash(enSource ?? '');
};
