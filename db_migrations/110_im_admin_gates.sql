-- 110: DB-level admin gates for markets and the FINAL unlock.
--
-- Two places where the UI gated an action but the database did not:
--
--   1. im_markets (migration 107) shipped with an "Auth all" policy — the Admin
--      panel is the only UI that edits markets, but any signed-in user could write
--      the table straight through the API. Market → language mappings are a
--      compliance decision, so writes become ADMIN-only (reads stay open: the
--      print-export dialog offers markets as presets to everyone).
--
--   2. Unlocking a FINAL manual (is_finalized true → false) was allowed to any
--      authenticated user, which defeats the point of a sign-off lock: anyone
--      could unlock, edit, and re-lock. Locking stays open to everyone (signing
--      off is normal PM work); UNLOCKING a signed-off manual becomes ADMIN-only.
--
-- Role checks follow the migration-81 pattern: profiles.role, case-insensitive.
-- auth.uid() IS NULL (service role, SQL console) is always allowed — those
-- contexts bypass RLS anyway and must not be bricked by the trigger.

-- --- 1. im_markets: read for all authenticated, write admin-only -------------

DROP POLICY IF EXISTS "Auth all" ON public.im_markets;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_markets' AND policyname='Auth read') THEN
    CREATE POLICY "Auth read" ON public.im_markets FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_markets' AND policyname='Admin write') THEN
    CREATE POLICY "Admin write" ON public.im_markets FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
  END IF;
END $$;

-- --- 2. project_ims: FINAL unlock is admin-only -------------------------------
-- Extends the migration-102 guard (same function/trigger names — this REPLACES the
-- function body; the trigger itself is unchanged). New rule is the unlock check;
-- everything else is 102 verbatim.

create or replace function public.project_ims_finalized_guard()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_finalized then
      raise exception 'Project manual is marked FINAL — unlock it before deleting';
    end if;
    return old;
  end if;
  -- UNLOCK (true -> false): admin-only. auth.uid() null = service/SQL context, allowed.
  if old.is_finalized and not new.is_finalized then
    if auth.uid() is not null and not exists (
      select 1 from public.profiles p where p.id = auth.uid() and upper(p.role) = 'ADMIN'
    ) then
      raise exception 'Only an administrator can unlock a FINAL manual';
    end if;
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
