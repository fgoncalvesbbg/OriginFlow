-- Migration 52: Add template_type discriminator to im_templates
--
-- Each L3 category can now hold more than one IM template — currently a normal
-- Instruction Manual ('im') and a Warning Leaflet ('warning_leaflet'). All
-- downstream tables (im_sections, im_blocks, project_ims) and the resolver key
-- off template_id and are unaffected.
--
-- Existing rows backfill to 'im' via the default, preserving every current
-- template. Idempotent: safe to re-run.

-- 1. Discriminator column (backfills existing rows to 'im')
ALTER TABLE public.im_templates
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'im';

-- 2. Restrict to the known values (guarded so re-running does nothing)
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'im_templates_template_type_check'
  ) then
    execute 'alter table public.im_templates
      add constraint im_templates_template_type_check
      check (template_type in (''im'', ''warning_leaflet''))';
  end if;
end $$;

-- 3. Enforce one template per (category, type). Replaces the previous implicit
--    one-template-per-category assumption that lived only in application code.
CREATE UNIQUE INDEX IF NOT EXISTS im_templates_category_type_uniq
  ON public.im_templates (category_id, template_type);
