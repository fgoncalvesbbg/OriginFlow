/**
 * Public (VITE_-prefixed) feature-flag reading.
 *
 * Server secrets can't be seen by the browser, so features that depend on them
 * (print export → PDFSHIFT_API_KEY, Markup.io review → MARKUPIO_API_KEY) are
 * gated on a public flag set alongside the secret. When the flag is off the UI
 * hides the feature rather than offering a button that can only fail.
 *
 * Why this helper exists: the checks used to be a strict `=== 'true'`, so a
 * perfectly reasonable `VITE_MARKUP_REVIEW_ENABLED=TRUE` in a .env or a Netlify
 * build environment silently disabled the entire feature with no error anywhere
 * — the UI simply rendered nothing. Env values are hand-typed in several places
 * (.env, Netlify UI, CI), so they are normalised here instead.
 */

/** True for "true" in any casing, ignoring surrounding whitespace. */
export const flagEnabled = (value: string | undefined): boolean =>
  (value ?? '').trim().toLowerCase() === 'true';
