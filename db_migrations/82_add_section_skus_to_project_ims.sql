-- Migration 82: per-chapter SKU scope for project IMs.
-- Enables SKU-specific chapter variants (e.g. a duplicated "Setting the temperature"
-- chapter authored per SKU). `section_skus` maps a section id (a template im_sections
-- id or a project-only "proj-…" extra-section id) to the project_skus.id values that
-- chapter applies to. An empty object / missing key means the chapter applies to all
-- bound SKUs (no "Applies to: …" header is rendered) — backward compatible for rows
-- created before this column. A chapter whose scoped ids don't intersect the IM's
-- bound SKUs is hidden at resolve time.
ALTER TABLE project_ims
  ADD COLUMN IF NOT EXISTS section_skus jsonb NOT NULL DEFAULT '{}'::jsonb;
