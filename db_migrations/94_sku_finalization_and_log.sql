-- 94_sku_finalization_and_log.sql
-- Let a SKU be marked "final" (locked): while final its data cannot be edited/overwritten/
-- deleted without unlocking. Unlocking and edits are recorded in an append-only change log.

BEGIN;

-- 1. Lock flag on the SKU.
ALTER TABLE project_skus ADD COLUMN IF NOT EXISTS is_final BOOLEAN NOT NULL DEFAULT false;

-- 2. Append-only audit log of finalize / unlock / value changes.
--    ON DELETE SET NULL (not CASCADE) so the trail survives a SKU deletion; sku_number is
--    snapshotted so a deleted SKU's history still reads sensibly.
CREATE TABLE IF NOT EXISTS sku_change_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_sku_id UUID REFERENCES project_skus(id) ON DELETE SET NULL,
    sku_number TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL CHECK (action IN ('finalize','unlock','update','create','delete')),
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    note TEXT NOT NULL DEFAULT '',
    changed_by UUID,
    changed_by_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sku_change_log_sku ON sku_change_log(project_sku_id);
CREATE INDEX IF NOT EXISTS idx_sku_change_log_created ON sku_change_log(created_at DESC);

ALTER TABLE sku_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth insert" ON sku_change_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth select" ON sku_change_log FOR SELECT TO authenticated USING (true);
-- Append-only: no update/delete policies (log entries are immutable).

COMMIT;

NOTIFY pgrst, 'reload schema';
