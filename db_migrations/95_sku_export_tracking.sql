-- 95_sku_export_tracking.sql
-- Track which SKUs have changed since the last Akeneo export so we can export only the deltas
-- and "mark as done" after each export.
--   * pending_export: true when the SKU has data changes not yet exported (default true so all
--     existing SKUs count as pending until first exported). Set true on any data write, cleared
--     when exported. Lock/unlock does NOT touch it (not a product-data change).
--   * last_exported_at: timestamp of the most recent export (for reference/audit).
-- Applied to the live DB via Supabase MCP on 2026-07-20.

ALTER TABLE project_skus ADD COLUMN IF NOT EXISTS pending_export BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE project_skus ADD COLUMN IF NOT EXISTS last_exported_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_project_skus_pending_export ON project_skus(pending_export) WHERE pending_export;

-- Allow an 'export' entry in the change log.
ALTER TABLE sku_change_log DROP CONSTRAINT IF EXISTS sku_change_log_action_check;
ALTER TABLE sku_change_log ADD CONSTRAINT sku_change_log_action_check
    CHECK (action IN ('finalize','unlock','update','create','delete','export'));

NOTIFY pgrst, 'reload schema';
