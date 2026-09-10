-- 178: an upsert of an EXISTING requirement is an edit, not an insert.
--
-- THE BUG. Migration 177 gave INSERT and UPDATE different rules — adding a requirement to a
-- FINAL category is refused, rewording one is allowed. That relaxation never reached the
-- application, because of how every save actually arrives:
--
--   `saveRequirement` writes through PostgREST's upsert, which is
--   `INSERT ... ON CONFLICT (id) DO UPDATE`. Postgres fires BEFORE INSERT triggers FIRST, on
--   every such statement, and only then detects the conflict and fires BEFORE UPDATE. So
--   editing an existing requirement runs the guard's INSERT branch, which gates on the row's
--   whole membership set and refuses if any category is FINAL.
--
-- The symptom was an operator changing a requirement's conditional applicability and being
-- told "it is not possible to add a requirement to that category" — the INSERT branch's own
-- wording, on a write that added nothing.
--
-- This mechanic was known and written down. Migration 172's header says: "an upsert of an
-- existing row in a locked category also gets blocked at the insert stage. That's the desired
-- outcome anyway." It WAS the desired outcome while both branches blocked identically. The
-- moment 177 made them differ, that line became the bug.
--
-- THE FIX. In the INSERT branch, if a row with this id already exists, return without
-- gating: the write is an edit, and the BEFORE UPDATE pass that immediately follows is the
-- one that can see the stored row and compare membership properly. A genuine insert — no such
-- id — is gated exactly as before.
--
-- Deliberately fixed in the GUARD rather than by making `saveRequirement` choose between
-- insert and update. The guard is the security boundary; it has to be correct for however the
-- write arrives, including straight from the API. Teaching one service function to route
-- around it would leave the hole open for every other caller.

do $guard$
begin
  if to_regprocedure('public.compliance_requirements_lock_guard()') is null then
    raise exception 'Apply 172-177 before this migration: 178 patches the lock guard they built.';
  end if;
end
$guard$;

create or replace function public.compliance_requirements_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  /** Categories whose MEMBERSHIP of this requirement this write changes. Only these are gated. */
  v_gated text[] := '{}';
  v_name  text;
  v_what  text;
begin
  -- Service role / SQL console: no JWT, already outside RLS. Consistent with migration 110.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- An UPSERT of a row that already exists is an edit. PostgREST writes every save as
    -- `INSERT ... ON CONFLICT DO UPDATE`, so BEFORE INSERT fires for edits too; gating here
    -- would apply the "adding a requirement" rule to a write that adds nothing. The BEFORE
    -- UPDATE pass that follows sees the stored row and makes the real decision.
    if exists (select 1 from public.compliance_requirements where id = new.id) then
      return new;
    end if;

    -- A genuine new requirement: it appears where it was not before, so every category it
    -- lands in gains it.
    v_gated := v_gated || coalesce(new.category_id::text, '') || coalesce(new.assigned_category_ids, '{}');
    v_what  := 'add a requirement to';

  elsif tg_op = 'DELETE' then
    -- The requirement disappears: every category that had it loses it. The EXCLUSION list is
    -- deliberately absent — a category excluded from a global requirement never had it, so
    -- deleting that requirement does not change what the category requires.
    v_gated := v_gated || coalesce(old.category_id::text, '') || coalesce(old.assigned_category_ids, '{}');
    v_what  := 'remove a requirement from';

  else
    -- UPDATE. Only movement in or out of the three membership columns counts. Everything
    -- else — title, description, section, sort_order, timing, evidence, regulation, clause,
    -- condition — is the requirement's DEFINITION and is never gated here.
    v_what := 'change which categories this requirement applies to, because that would change what';

    if new.category_id is distinct from old.category_id then
      v_gated := v_gated || coalesce(old.category_id::text, '') || coalesce(new.category_id::text, '');
    end if;

    select v_gated || coalesce(array_agg(e), '{}') into v_gated
    from (
      (select unnest(coalesce(new.assigned_category_ids, '{}'))
       except
       select unnest(coalesce(old.assigned_category_ids, '{}')))
      union
      (select unnest(coalesce(old.assigned_category_ids, '{}'))
       except
       select unnest(coalesce(new.assigned_category_ids, '{}')))
    ) d(e);

    select v_gated || coalesce(array_agg(e), '{}') into v_gated
    from (
      (select unnest(coalesce(new.excluded_category_ids, '{}'))
       except
       select unnest(coalesce(old.excluded_category_ids, '{}')))
      union
      (select unnest(coalesce(old.excluded_category_ids, '{}'))
       except
       select unnest(coalesce(new.excluded_category_ids, '{}')))
    ) d(e);
  end if;

  if array_length(v_gated, 1) is null then
    -- Nothing about membership moved. A content edit: always allowed, however much is FINAL.
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select c.name into v_name
  from public.categories_l3 c
  where c.is_finalized
    and c.id::text = any(v_gated)
  limit 1;

  if v_name is not null then
    raise exception
      'The TCF requirements for "%" are marked FINAL, so it is not possible to % that category requires. An administrator must release it — stating why — first. (Editing a requirement''s wording, timing or evidence rules is still allowed.)',
      v_name, v_what
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on function public.compliance_requirements_lock_guard() is
  'Enforces the FINAL lock on compliance_requirements (migrations 177, 178). Freezes a locked category''s MEMBERSHIP — nothing may start or stop applying to it — but never the DEFINITION of a requirement, which stays editable however many FINAL categories hold it. Gates only the categories entering or leaving category_id / assigned_category_ids / excluded_category_ids. An upsert of an existing id is treated as an edit, because PostgREST sends every save as INSERT ... ON CONFLICT DO UPDATE and BEFORE INSERT fires first.';
