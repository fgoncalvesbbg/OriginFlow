-- 98_add_finalization_to_project_ims.sql
-- Let a project instruction manual be marked "final" (locked): while final its content
-- cannot be edited/saved/translated/imported without first unlocking it. Mirrors the
-- finalize flag already on im_templates (is_finalized / finalized_at). Purely additive
-- and backward compatible — existing rows default to not-final.

ALTER TABLE project_ims
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
