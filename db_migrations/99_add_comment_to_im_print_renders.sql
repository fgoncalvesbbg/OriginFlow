-- Migration 99: im_print_renders.comment — required change note per generated print PDF.
--
-- Every time a new print PDF is generated (see netlify/functions/render-print-merge.ts), the
-- export dialog now requires the user to describe what changed in this version. That note is
-- stored here and shown in the export history ("Previous exports") so the render log reads as a
-- changelog. Existing rows predate the field, so the column is nullable with a '' default rather
-- than NOT NULL — only NEW renders enforce the requirement (client-side, in PrintExportDialog).

ALTER TABLE im_print_renders
  ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '';
