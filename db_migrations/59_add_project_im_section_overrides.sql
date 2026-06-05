-- Migration 59: project-level overrides for placeholder IM sections
-- Placeholder sections (im_sections.is_placeholder = true) are intentionally left
-- empty/generic in the template so they get authored per project. This column
-- holds the project's full inline-block content for such sections:
--   section_overrides: { [templateSectionId]: InlineBlockRef[] }
-- When a key is present it fully replaces the template content for that section
-- at resolve time (see im-resolver.ts). Absent key = untouched (template wins).
-- The template (im_sections) is never modified.

ALTER TABLE project_ims
  ADD COLUMN IF NOT EXISTS section_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
