-- Migration 53: Add template_type discriminator to project_ims
--
-- Mirrors migration 52 (which added template_type to im_templates). A project can
-- now hold one generated instance PER template type — a normal Instruction Manual
-- ('im') and a Warning Leaflet ('warning_leaflet') — instead of a single instance.
--
-- The previous "one project_im per project" assumption lived only in application
-- code (saveProjectIM/getProjectIM matched on project_id alone). We make the type
-- explicit here and enforce uniqueness on (project_id, template_type).
--
-- Existing rows backfill to 'im' via the default. Idempotent: safe to re-run.

-- 1. Discriminator column (backfills existing rows to 'im')
ALTER TABLE public.project_ims
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'im';

-- 2. Restrict to the known values (guarded so re-running does nothing)
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_ims_template_type_check'
  ) then
    execute 'alter table public.project_ims
      add constraint project_ims_template_type_check
      check (template_type in (''im'', ''warning_leaflet''))';
  end if;
end $$;

-- 3. One instance per (project, type).
CREATE UNIQUE INDEX IF NOT EXISTS project_ims_project_type_uniq
  ON public.project_ims (project_id, template_type);
