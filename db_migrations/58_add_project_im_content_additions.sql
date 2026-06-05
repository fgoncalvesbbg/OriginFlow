-- Migration 58: project-only IM content additions
-- PMs can layer project-specific content on top of a category template without
-- editing the shared template. Two JSONB columns hold this per-project layer:
--   section_additions: { [templateSectionId]: ProjectBlockAddition[] }
--     each addition = { id, position, block: InlineBlockRef } — an inline block
--     inserted at `position` among the host section's template blockRefs.
--   extra_sections: ProjectExtraSection[]
--     each = { id, parentId, title, order, blocks: InlineBlockRef[] } — a whole
--     new section that exists only for this project.
-- Both are merged into the document at resolve time (see im-resolver.ts). The
-- template (im_sections / im_blocks) is never modified.

ALTER TABLE project_ims
  ADD COLUMN IF NOT EXISTS section_additions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS extra_sections    jsonb NOT NULL DEFAULT '[]'::jsonb;
