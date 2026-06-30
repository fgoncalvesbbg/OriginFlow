-- Migration 56: project-defined SKUs (canonical per-project SKU list, max 10)
-- SKUs were previously implicit (free-text sku_number/sku_title on each
-- project_attribute_requests row). This table makes them first-class: the PM
-- defines up to 10 SKUs per project, each holding attribute values entered
-- directly (same { attributeId, name, value, type } shape as
-- project_attribute_requests.submitted_data). The 10-SKU cap is enforced in the
-- service/UI layer. Supplier portal never reads this table (no anon policy).

CREATE TABLE IF NOT EXISTS project_skus (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sku_number        TEXT        NOT NULL,
  sku_title         TEXT        NOT NULL DEFAULT '',
  attribute_values  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  sort_order        INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_skus_project_id ON project_skus(project_id);

ALTER TABLE project_skus ENABLE ROW LEVEL SECURITY;

-- Authenticated PMs get full access (matches the project_attribute_requests pattern, migration 55).
CREATE POLICY "Auth insert" ON project_skus FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth select" ON project_skus FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth update" ON project_skus FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete" ON project_skus FOR DELETE TO authenticated USING (true);
