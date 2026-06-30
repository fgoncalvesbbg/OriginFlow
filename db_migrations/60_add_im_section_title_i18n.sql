-- Migration 60: translatable IM section titles
-- Section titles were a single `title` text column, so they never localized even
-- though section content already does. This adds per-language titles:
--   title_i18n: { [langCode]: translated title }
-- `title` remains the base/default title and the fallback when a language is
-- missing (see localizedSectionTitle / im-resolver.ts).

ALTER TABLE im_sections
  ADD COLUMN IF NOT EXISTS title_i18n jsonb NOT NULL DEFAULT '{}'::jsonb;
