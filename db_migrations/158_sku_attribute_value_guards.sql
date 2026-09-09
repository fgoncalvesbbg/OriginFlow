-- 158: The two rules that must not live in the browser — the Final lock, and the audit.
--
-- OriginFlow has no application server: the browser talks to PostgREST directly. So
-- ProductToolkit's equivalents — an Express `requirePermission` barrier and a route that
-- refuses a write on a signed-off SKU — have nothing to port to. A check in the React
-- client is a suggestion: a second tab, a stale bundle, a script with the anon key, or a
-- future write path that forgets the check all walk straight past it.
--
-- Both rules therefore live here:
--   1. A signed-off SKU cannot have its values changed. Unlock it first.
--   2. Every value write lands in sku_change_log, written by the database rather than by
--      the caller, so a new write path CANNOT forget to log.
--
-- Modelled on 87_im_finalized_lock.sql, which does the same job for IM templates.

-- ── 1. Stamp the actor and the clock, then enforce the Final lock ───────────────────
--
-- The actor is taken from the SESSION, not from what the caller sent, so it cannot be
-- forged by a hand-rolled request. When there is no JWT (service_role, a migration, the
-- SQL console) whatever the caller supplied is kept — that is the importer path.

create or replace function public.sku_attribute_values_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_final boolean;
  v_sku_id   uuid;
  v_actor    uuid := auth.uid();
  v_name     text;
begin
  -- NEW is unassigned on DELETE — reading a field off it raises rather than returning
  -- null — so the branch comes before the lookup.
  if tg_op = 'DELETE' then
    v_sku_id := old.project_sku_id;
  else
    v_sku_id := new.project_sku_id;
  end if;

  -- DELETE reaching here as part of `on delete cascade` from project_skus: the parent
  -- row is already gone, so there is nothing left to protect and blocking it would make
  -- a Final SKU undeletable. A direct DELETE of a value row on a live Final SKU still
  -- hits the barrier below.
  select s.is_final into v_is_final
  from public.project_skus s
  where s.id = v_sku_id;

  if not found then
    -- Returned per branch rather than as coalesce(new, old): NEW is not a usable record
    -- on DELETE, and this early return is reachable from exactly that path.
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if v_is_final then
    raise exception
      'SKU is signed off (Final) — unlock it before changing its attribute values'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  new.updated_at := now();

  if v_actor is not null then
    select p.name into v_name from public.profiles p where p.id = v_actor;
    new.updated_by      := v_actor;
    new.updated_by_name := coalesce(nullif(v_name, ''), new.updated_by_name, '');
  end if;

  return new;
end;
$$;

revoke execute on function public.sku_attribute_values_before_write() from public;

drop trigger if exists trg_sku_attribute_values_before_write on public.sku_attribute_values;
create trigger trg_sku_attribute_values_before_write
  before insert or update or delete on public.sku_attribute_values
  for each row execute function public.sku_attribute_values_before_write();

-- ── 2. The audit, written by the database ──────────────────────────────────────────
--
-- 'clear' when the cell ends up NULL (explicitly emptied), 'value' otherwise. The
-- attribute's NAME goes into `field` as it reads right now, so the entry survives the
-- attribute being deleted later — see the note in migration 156.
--
-- DELETE is deliberately not logged. The app never deletes a value row (clearing writes
-- NULL and keeps the row), so the only DELETEs are cascades from a SKU deletion, which
-- logSkuDeleted already records once. Logging each cascaded row would also mean
-- inserting a log row pointing at a project_sku that the same transaction is deleting.
--
-- A write that changes nothing is not an event: an UPDATE landing the same value and the
-- same unit produces no entry, so the history stays a list of actual changes.

create or replace function public.sku_attribute_values_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sku_number text;
  v_field      text;
begin
  if tg_op = 'UPDATE'
     and new.value is not distinct from old.value
     and new.unit  is not distinct from old.unit then
    return new;
  end if;

  select s.sku_number into v_sku_number
  from public.project_skus s where s.id = new.project_sku_id;

  select a.name into v_field
  from public.category_attributes a where a.id = new.attribute_id;

  insert into public.sku_change_log (
    project_sku_id, sku_number, action, field, attribute_id,
    old_value, new_value, source, note, changed_by, changed_by_name
  ) values (
    new.project_sku_id,
    coalesce(v_sku_number, ''),
    case when new.value is null then 'clear' else 'value' end,
    coalesce(v_field, new.attribute_id::text),
    new.attribute_id,
    case when tg_op = 'UPDATE' then old.value end,
    new.value,
    new.source,
    '',
    new.updated_by,
    new.updated_by_name
  );

  return new;
end;
$$;

revoke execute on function public.sku_attribute_values_after_write() from public;

drop trigger if exists trg_sku_attribute_values_after_write on public.sku_attribute_values;
create trigger trg_sku_attribute_values_after_write
  after insert or update on public.sku_attribute_values
  for each row execute function public.sku_attribute_values_after_write();

-- ── 3. Keep the review-status columns honest ───────────────────────────────────────
--
-- finalized_at / finalized_by / reopen_reason (migration 157) are only useful if they
-- cannot drift from is_final. Setting them in the service layer means every future call
-- site has to remember three columns; a trigger means none of them do.

create or replace function public.project_skus_stamp_finalization()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_final and not old.is_final then
    new.finalized_at   := now();
    new.finalized_by   := coalesce(auth.uid(), new.finalized_by);
    new.reopen_reason  := null;   -- signed off again; the old reason no longer applies
  elsif old.is_final and not new.is_final then
    new.finalized_at   := null;
    new.finalized_by   := null;
    -- reopen_reason is left to the caller: it is the one fact only a person can supply.
  end if;
  return new;
end;
$$;

revoke execute on function public.project_skus_stamp_finalization() from public;

drop trigger if exists trg_project_skus_stamp_finalization on public.project_skus;
create trigger trg_project_skus_stamp_finalization
  before update on public.project_skus
  for each row
  when (old.is_final is distinct from new.is_final)
  execute function public.project_skus_stamp_finalization();
