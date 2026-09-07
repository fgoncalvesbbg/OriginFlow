/**
 * Shared HTML-escaping helpers, in two safety grades.
 *
 * `escapeHtmlAttr` escapes the full `& < > " '` set — safe to drop into an HTML attribute value
 * (a quote or apostrophe in the source text can otherwise break out of the surrounding `"..."`
 * or `'...'` and inject markup) as well as into a text node.
 *
 * `escapeHtmlText` escapes only `& < >` — the minimum needed for a TEXT node — and leaves quotes
 * untouched. Some existing call sites (im-translation-export.service.ts's XLIFF writer,
 * im-xliff-codec.ts's inline-code encoder) only ever place the result inside XML/HTML text
 * content, never inside an attribute value, so they intentionally use the lighter grade.
 *
 * Do NOT default everything to the stricter `escapeHtmlAttr` "to be safe": a caller that already
 * relies on `escapeHtmlText`'s narrower set for round-tripping (e.g. the XLIFF codec sends the
 * decoded output straight back through an entity-decoder that expects exactly these four
 * replacements) would start emitting `&quot;`/`&#39;` it doesn't decode back.
 */

/** Escape `& < > " '` — safe for both HTML attribute values and text nodes. */
export const escapeHtmlAttr = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Escape `& < >` only — for a plain text node where quotes need no protection. */
export const escapeHtmlText = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
