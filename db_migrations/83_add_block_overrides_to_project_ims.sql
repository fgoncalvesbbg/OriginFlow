-- Migration 83: per-project overrides of individual inline template blocks.
-- Lets a PM edit a template table's rows/columns (or other inline block content) for a
-- single project without touching the shared template. `block_overrides` maps a section id
-- to a map of block index (its position among the section's block_refs, same convention as
-- the per-ref `refvis_` visibility keys) → the replacement inline block. An empty object /
-- missing key means the template block is used unchanged — backward compatible for rows
-- created before this column. Only inline blocks are overridable; shared (approval-gated)
-- blocks and sku_slot refs are never replaced.
ALTER TABLE project_ims
  ADD COLUMN IF NOT EXISTS block_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;
