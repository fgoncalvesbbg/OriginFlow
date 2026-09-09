-- 160: Close the other half of the signed-off lock.
--
-- Migration 158 stopped a Final SKU's values being changed in `sku_attribute_values`. It did
-- NOT stop them being changed in `project_skus.attribute_values`, and that column is still
-- written directly by the project SKU editor (ProjectDetail's handleSaveSku → updateProjectSku).
--
-- So today a signed-off SKU can still be edited there, and the failure is INVISIBLE:
--   1. the JSONB write succeeds — nothing guards it;
--   2. the row-store sync that follows hits 158's trigger and raises;
--   3. that raise is caught and logged, because a secondary sync must not fail a SKU save.
-- The result is a signed-off product whose two stores disagree, with only a console line to
-- say so. The Attribute Viewer shows the old values, the project screen shows the new ones,
-- and neither is marked as suspect.
--
-- A lock that holds on one of two tables is not a lock. This makes the barrier symmetric, at
-- the same level as 158 — the browser talks to PostgREST directly, so anything enforced only
-- in React is a suggestion.

create or replace function public.project_skus_final_value_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_final then
    raise exception
      'SKU is signed off (Final) — unlock it before changing its attribute values'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.project_skus_final_value_guard() from public;

-- Scoped to attribute_values ONLY, via the WHEN clause. Everything else about a Final SKU must
-- still be writable:
--   * markSkusExported stamps pending_export / last_exported_at on Final SKUs — that is the
--     whole export flow, and only Final SKUs are exportable;
--   * setSkuFinal itself writes is_final and reopen_reason;
--   * the unlock path has to be able to run at all.
-- A trigger on the whole row would break every one of those.
drop trigger if exists trg_project_skus_final_value_guard on public.project_skus;
create trigger trg_project_skus_final_value_guard
  before update on public.project_skus
  for each row
  when (old.attribute_values is distinct from new.attribute_values)
  execute function public.project_skus_final_value_guard();

comment on function public.project_skus_final_value_guard() is
  'Refuses a change to project_skus.attribute_values while the SKU is Final. The mirror half of the lock in migration 158; without it a signed-off SKU could be edited through the project screen and the two value stores would silently disagree.';
