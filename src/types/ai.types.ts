/**
 * AI prompt types — prompts used for Anthropic/Claude calls, stored in the
 * `ai_prompts` table so they can be viewed/edited from the Admin panel.
 */

export interface AIPrompt {
  id: string;
  key: string;
  name: string;
  description?: string;
  systemPrompt: string;
  model: string;
  maxTokens: number;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

/**
 * A saved entry in the shared prompt library (`prompt_library` table). Unlike
 * AIPrompt these are never sent to the API by the app — users keep them here to
 * copy (or open via claude.ai) and use directly in Claude chat outside the app.
 */
export interface PromptLibraryEntry {
  id: string;
  title: string;
  description?: string;
  promptText: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A regulation phrase with OFFICIAL per-language wording (`translation_verbatims`
 * table). `phrase` is the English text matched in the source; `translations`
 * maps language code → the approved wording used in that language's output.
 * During translation the match is frozen into an opaque {{FRZ_n}} token and
 * restored as the stored translation — the model never touches it. Languages
 * with no stored translation keep the source phrase unchanged (correct for
 * identifiers like "(EU) 2019/2016"). Users grow this list from the Admin panel.
 */
export interface TranslationVerbatim {
  id: string;
  phrase: string;
  note?: string;
  /** Language code → officially approved wording for that language. */
  translations: Record<string, string>;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}
