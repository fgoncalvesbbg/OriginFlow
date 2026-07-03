/**
 * Canonical language list for IM (instruction manual) templates.
 *
 * Single source of truth for every place that offers a language: the template
 * Languages modal, the block-library per-language tabs, and the preview language
 * switcher. Covers all 24 official EU languages (manuals must ship in the
 * language of every market they're sold in) plus a few common non-EU extras.
 *
 * English is the source/default and always first. Keep codes as ISO 639-1 so they
 * match the JSONB content keys stored in im_sections / im_blocks.
 */
export interface IMLanguage {
  code: string;
  name: string;
  /** True for the 24 official languages of the European Union. */
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
  { code: 'ga', name: 'Irish', eu: true },
  { code: 'it', name: 'Italian', eu: true },
  { code: 'lv', name: 'Latvian', eu: true },
  { code: 'lt', name: 'Lithuanian', eu: true },
  { code: 'mt', name: 'Maltese', eu: true },
  { code: 'pl', name: 'Polish', eu: true },
  { code: 'pt', name: 'Portuguese', eu: true },
  { code: 'ro', name: 'Romanian', eu: true },
  { code: 'sk', name: 'Slovak', eu: true },
  { code: 'sl', name: 'Slovenian', eu: true },
  { code: 'es', name: 'Spanish', eu: true },
  { code: 'sv', name: 'Swedish', eu: true },
  // --- Additional non-EU languages ---
  { code: 'zh', name: 'Chinese (Simplified)', eu: false },
  { code: 'ja', name: 'Japanese', eu: false },
  { code: 'tr', name: 'Turkish', eu: false },
  { code: 'ru', name: 'Russian', eu: false },
];

/** Options for the template Languages modal: "German (DE)", English marked default. */
export const IM_TEMPLATE_LANGUAGE_OPTIONS = IM_LANGUAGES.map(l => ({
  code: l.code,
  label: l.code === 'en' ? 'English (Default)' : `${l.name} (${l.code.toUpperCase()})`,
}));

/** Options for the preview language switcher: plain English names. */
export const IM_PREVIEW_LANGUAGE_OPTIONS = IM_LANGUAGES.map(l => ({ code: l.code, label: l.name }));

/** Compact per-language tabs (block library): uppercase code, e.g. "DE". */
export const IM_LANGUAGE_TABS = IM_LANGUAGES.map(l => ({ code: l.code, label: l.code.toUpperCase() }));

/** code → English name, for building translation prompts. */
export const IM_LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(
  IM_LANGUAGES.map(l => [l.code, l.name]),
);
