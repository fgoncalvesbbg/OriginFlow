-- Migration 86: Drop the legacy single-column unique constraint on project_ims.project_id
--
-- Migration 53 introduced the (project_id, template_type) discriminator + a composite unique
-- index (project_ims_project_type_uniq) so a project can hold one generated instance PER type
-- (an 'im' AND a 'warning_leaflet'). But it never removed the ORIGINAL "one project_im per
-- project" unique on project_id alone (project_ims_project_id_key). That legacy constraint is
-- still live, so generating a Warning Leaflet for a project that already has an IM fails with:
--   duplicate key value violates unique constraint "project_ims_project_id_key"
--
-- This drops the over-restrictive single-column unique. Integrity is still enforced by the
-- composite project_ims_project_type_uniq (one row per project+type). Purely constraint-relaxing
-- and reversible; safe with the currently deployed frontend (which already keys on
-- (project_id, template_type)). Idempotent.

-- The constraint may exist either as a table CONSTRAINT or as a bare UNIQUE INDEX depending on how
-- it was originally created — drop whichever form is present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_ims_project_id_key') THEN
    EXECUTE 'ALTER TABLE public.project_ims DROP CONSTRAINT project_ims_project_id_key';
  END IF;
END $$;

DROP INDEX IF EXISTS public.project_ims_project_id_key;
