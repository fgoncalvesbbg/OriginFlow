-- Migration 153: project-level IM "Attachments" section
-- Holds image-only assembly-step sequences that are identical for every language
-- (e.g. "attach the legs" diagrams). Unlike section_additions/extra_sections, this
-- content is never walked per-language: the print pipeline renders it exactly once,
-- appended near the end of the merged booklet, the same way the shared cover/back
-- pages are (see im-print-html.ts buildPrintPartsHtml). Body prose elsewhere in the
-- manual may cite an entry as "see Attachment 03"; the array's 1-indexed order is
-- the displayed number.
--
-- attachments: ProjectAttachmentEntry[]
--   each = { id, order, steps: [{ asset_id?, image?: { url, width, height } }] }
--   — no per-language text field, by design: these steps carry no translatable content.

ALTER TABLE project_ims
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
