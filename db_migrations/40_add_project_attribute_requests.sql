-- Migration 40: Add project attribute requests table
-- Allows PM to send attribute data collection requests to suppliers

CREATE TABLE IF NOT EXISTS project_attribute_requests (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id     TEXT,
  project_name    TEXT        NOT NULL DEFAULT '',
  category_name   TEXT        NOT NULL DEFAULT '',
  token           UUID        NOT NULL UNIQUE,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'submitted')),
  submitted_data  JSONB,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_par_project_id ON project_attribute_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_par_token      ON project_attribute_requests(token);

-- Allow anon/supplier reads via token (RLS must be enabled on the table)
-- Enable RLS: ALTER TABLE project_attribute_requests ENABLE ROW LEVEL SECURITY;
-- Allow anon select by token:
-- CREATE POLICY "Public read by token" ON project_attribute_requests
--   FOR SELECT USING (true);
-- Allow anon update (submit) by token:
-- CREATE POLICY "Public submit by token" ON project_attribute_requests
--   FOR UPDATE USING (true) WITH CHECK (true);
-- Allow authenticated insert (PM):
-- CREATE POLICY "Auth insert" ON project_attribute_requests
--   FOR INSERT WITH CHECK (auth.role() = 'authenticated');
