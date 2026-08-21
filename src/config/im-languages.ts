/**
 * Canonical language list for IM (instruction manual) templates.
 *
 * Single source of truth for every place that offers a language: the template
 * Languages modal, the block-library per-language tabs, and the preview language
 * switcher. Covers the official EU languages relevant to our markets (manuals
 * must ship in the language of every market they're sold in).
 *
 * English is the source/default and always first. Keep codes as ISO 639-1 so they
 * match the JSONB content keys stored in im_sections / im_blocks.
 */
export interface IMLanguage {
  code: string;
  name: string;
  /** True for official languages of the European Union. */
  eu: boolean;
}

export const IM_LANGUAGES: IMLanguage[] = [
  { code: 'en', name: 'English', eu: true }, // source / default
  // --- EU official languages (alphabetical by English name) ---
  { code: 'bg', name: 'Bulgarian', eu: true },
  { code: 'hr', name: 'Croatian', eu: true },
  { code: 'cs', name: 'Czech', eu: true },
  { code: 'da', name: 'Danish', eu: true },
  { code: 'nl', name: 'Dutch', eu: true },
  { code: 'et', name: 'Estonian', eu: true },
  { code: 'fi', name: 'Finnish', eu: true },
  { code: 'fr', name: 'French', eu: true },
  { code: 'de', name: 'German', eu: true },
  { code: 'el', name: 'Greek', eu: true },
  { code: 'hu', name: 'Hungarian', eu: true },
  { code: 'it', name: 'Italian', eu: true },
  { code: 'lv', name: 'Latvian', eu: true },
  { code: 'lt', name: 'Lithuanian', eu: true },
  { code: 'pl', name: 'Polish', eu: true },
  { code: 'pt', name: 'Portuguese', eu: true },
  { code: 'ro', name: 'Romanian', eu: true },
  { code: 'sk', name: 'Slovak', eu: true },
  { code: 'sl', name: 'Slovenian', eu: true },
  { code: 'es', name: 'Spanish', eu: true },
  { code: 'sv', name: 'Swedish', eu: true },
];

/** Options for the template Languages modal: "German (DE)", English marked default. */
export const IM_TEMPLATE_LANGUAGE_OPTIONS = IM_LANGUAGES.map(l => ({
  code: l.code,
  label: l.code === 'en' ? 'English (Default)' : `${l.name} (${l.code.toUpperCase()})`,
}));

/** Options for the preview language switcher: plain English names. */
export const IM_PREVIEW_LANGUAGE_OPTIONS = IM_LANGUAGES.map(l => ({ code: l.code, label: l.name }));

/** Compact per-language tabs (block library): uppercase code "DE" + full name for tooltips. */
export const IM_LANGUAGE_TABS = IM_LANGUAGES.map(l => ({ code: l.code, label: l.code.toUpperCase(), name: l.name }));

/** code → English name, for building translation prompts. */
export const IM_LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(
  IM_LANGUAGES.map(l => [l.code, l.name]),
);

/** Every language code a manual may be authored in, in canonical order (English first). */
export const IM_LANGUAGE_CODES: string[] = IM_LANGUAGES.map(l => l.code);

/**
 * Normalize a language selection to the canonical list: IM_LANGUAGES order, duplicates
 * and unknown codes dropped, English always included (it is the source/fallback).
 *
 * THE one rule for turning a set of picked languages into a stored language list — the
 * template Languages modal, the post-translate "enable new languages" tails and the
 * per-project required-language picker all go through here, so a template's and a
 * project's list can never disagree on membership or order. Unknown codes are dropped
 * rather than passed through: a code outside IM_LANGUAGES has no print-header entry
 * (see im-print-html.ts) and would publish a manual nothing can label.
 *
 * `pool` narrows the result to a subset — a project bound to a CATEGORY template may
 * only pick from the languages that template declares, because template section content
 * exists in no others.
 */
export const orderIMLanguages = (codes: string[], pool: string[] = IM_LANGUAGE_CODES): string[] => {
  const allowed = new Set(pool);
  return IM_LANGUAGE_CODES.filter(c => c === 'en' || (allowed.has(c) && codes.includes(c)));
};
