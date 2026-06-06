-- Migration 61: version stamp for published instruction manuals.
-- Each project IM tracks a monotonically increasing `version`. Saving a draft
-- leaves it untouched; every publish (status = 'generated') increments it by one
-- (handled in saveProjectIM). The current version is stamped in the generated
-- PDF's page footer so a printed/exported manual is traceable to a publish.
ALTER TABLE project_ims
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;
