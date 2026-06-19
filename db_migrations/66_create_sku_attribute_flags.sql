-- Migration 66: per-cell attribute review flags for the Attribute Viewer.
-- The Attribute Viewer aggregates project_skus across every project in an L3
-- category and lets internal users review each SKU's attribute values. A reviewer
-- can flag a single (SKU, attribute) cell as wrong and attach a comment; flags are
-- resolved (not deleted) once addressed, leaving an audit trail of who flagged what.
-- One flag per cell (UNIQUE project_sku_id + attribute_id) — re-flagging updates the
-- existing row. attribute_id is TEXT to match the { attributeId } shape stored in
-- project_skus.attribute_values (UUIDs for real attributes, plus synthetic ids).

CREATE TABLE IF NOT EXISTS sku_attribute_flags (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_sku_id  UUID        NOT NULL REFERENCES project_skus(id) ON DELETE CASCADE,
  attribute_id    TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  comment         TEXT        NOT NULL DEFAULT '',
  flagged_by      UUID,
  flagged_by_name TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  UNIQUE (project_sku_id, attribute_id)
);

CREATE INDEX IF NOT EXISTS idx_sku_attribute_flags_sku_id ON sku_attribute_flags(project_sku_id);

ALTER TABLE sku_attribute_flags ENABLE ROW LEVEL SECURITY;

-- Authenticated internal users get full access (matches project_skus, migration 56).
-- The supplier portal never reads this table (no anon policy).
CREATE POLICY "Auth insert" ON sku_attribute_flags FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth select" ON sku_attribute_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth update" ON sku_attribute_flags FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete" ON sku_attribute_flags FOR DELETE TO authenticated USING (true);
