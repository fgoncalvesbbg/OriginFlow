-- Migration 91: per-language translations for translation verbatims.
--
-- A verbatim is not merely frozen source text: regulations have OFFICIAL
-- wording per language. `phrase` stays the English text to match in the
-- source; `translations` maps language code -> the approved wording to insert
-- in that language's output (e.g. {"de": "…", "fr": "…"}). During translation
-- the matched phrase is frozen into a {{FRZ_n}} token and thawed back as the
-- stored translation for the target language — the model never touches it.
-- Languages with no stored translation fall back to keeping the source phrase
-- unchanged (correct for identifiers like "(EU) 2019/2016").

ALTER TABLE translation_verbatims
  ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
