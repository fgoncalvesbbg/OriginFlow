-- Migration 41: Add step and project_id_code columns to project_attribute_requests
-- Allows step 2 (Business Case) and step 3 (Production) to be tracked independently
-- Stores the human-readable project ID so suppliers can see it on the portal

ALTER TABLE project_attribute_requests
  ADD COLUMN IF NOT EXISTS step INTEGER NOT NULL DEFAULT 2;

ALTER TABLE project_attribute_requests
  ADD COLUMN IF NOT EXISTS project_id_code TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_par_project_step ON project_attribute_requests(project_id, step);
