-- 102: Server-side FINAL lock + sign-off attribution for project manuals.
--
-- Migration 98 added is_finalized/finalized_at to project_ims but (unlike the template
-- lock in migration 87) no trigger — the lock was enforced in the editor only, so any
-- code path (imports, scripts, a stale tab) could modify or delete a signed-off manual.
-- This migration:
--   1. adds finalized_by, so the sign-off records WHO, not just when;
--   2. enforces the lock server-side, mirroring migration 87's template guard.
--
-- Rules while a project manual is FINAL (is_finalized = true):
--   - DELETE is blocked until unlocked.
--   - UPDATE may not change any CONTENT column (placeholder_data, sku_content,
--     section_additions, extra_sections, section_overrides, section_skus,
--     block_overrides, template_id, bound_sku_ids).
--   - Non-content columns (version, status, updated_at) may still change: publishing a
--     FINAL manual is allowed by design (it re-saves the same locked content with a new
--     version number), and the unlock itself (is_finalized -> false) is always allowed.

ALTER TABLE public.project_ims
  ADD COLUMN IF NOT EXISTS finalized_by text;

COMMENT ON COLUMN public.project_ims.finalized_by IS
  'Email/id of the user who marked the manual FINAL (sign-off attribution). Null when not final.';

create or replace function public.project_ims_finalized_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_finalized then
      raise exception 'Project manual is marked FINAL — unlock it before deleting';
    end if;
    return old;
  end if;
  -- UPDATE: anything goes while unlocked; while locked, content columns are frozen.
  if old.is_finalized and new.is_finalized then
    if new.placeholder_data  is distinct from old.placeholder_data
      or new.sku_content       is distinct from old.sku_content
      or new.section_additions is distinct from old.section_additions
      or new.extra_sections    is distinct from old.extra_sections
      or new.section_overrides is distinct from old.section_overrides
      or new.section_skus      is distinct from old.section_skus
      or new.block_overrides   is distinct from old.block_overrides
      or new.template_id       is distinct from old.template_id
      or new.bound_sku_ids     is distinct from old.bound_sku_ids
    then
      raise exception 'Project manual is marked FINAL — unlock it before editing its content';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists project_ims_finalized_lock on public.project_ims;
create trigger project_ims_finalized_lock
before update or delete on public.project_ims
for each row execute function public.project_ims_finalized_guard();
