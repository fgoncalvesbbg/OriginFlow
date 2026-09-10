-- 177: FINAL freezes a category's LIST of requirements, not the wording of each one.
--
-- WHAT WAS TOO STRICT. Migrations 172/173 made the lock follow the link: any write to a
-- requirement that reached a FINAL category was refused. That is right for membership and
-- wrong for wording, and the cost showed up as soon as sharing was used in earnest — one
-- FINAL hood froze the LVD requirement for the other eleven, so a typo in its description
-- could not be corrected anywhere without an administrator releasing a category that had
-- nothing to do with the typo. Migration 173's own header called that trade-off out; this is
-- the other side of it being taken.
--
-- THE LINE, and it is the whole migration:
--
--   MEMBERSHIP is frozen.  While a category is FINAL, no requirement may start applying to
--                          it or stop applying to it. Nothing appears in its list, nothing
--                          disappears from it. That is what somebody signing off a category
--                          is signing off.
--
--   DEFINITION is not.     Title, description, section, order, timing, evidence rules, the
--                          regulation it cites, its condition — all editable, whatever is
--                          FINAL. The UI warns and names the FINAL categories affected, so
--                          the edit is deliberate rather than accidental.
--
-- So the guard stops asking "does this requirement touch a FINAL category?" and starts asking
-- "does this write change whether a FINAL category requires it?". Concretely:
--
--   INSERT   refused if the new row lands in, or links to, a FINAL category — the list grows.
--   DELETE   refused if the row reaches a FINAL category — the list shrinks.
--   UPDATE   refused only for the categories ENTERING OR LEAVING one of the three membership
--            columns (`category_id`, `assigned_category_ids`, `excluded_category_ids`).
--            A write that touches none of them is content, and is allowed.
--
-- The symmetric-difference treatment is not new: migration 176 already used it for
-- `excluded_category_ids`, and for exactly this reason — a global requirement excluded from
-- one FINAL category must not become uneditable everywhere. This generalises that from one
-- column to all three, which is what it should have been.
--
-- WHAT THIS DOES NOT WEAKEN. Releasing a FINAL category is still ADMIN-only and still needs a
-- written reason (migration 172, `categories_l3_final_guard`), the history still records every
-- change (172/173/175/176), and a released category still cannot be deleted while FINAL. None
-- of that is touched.
--
-- WORTH KNOWING, because it is the sharp edge of the new rule: a request already sent to a
-- supplier freezes WHICH requirements it asked for (`compliance_requests.requirement_ids`,
-- migration 174) but reads their text live. So editing a description changes what an open
-- request displays. That was already true; it matters more now that more edits are possible.

-- ===========================================================================
-- 0. Refuse to run out of order
-- ===========================================================================

do $guard$
begin
  if to_regprocedure('public.compliance_requirements_lock_guard()') is null then
    raise exception
      'Apply 172, 173 and 176 before this migration: 177 rewrites the lock guard they built up.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'compliance_requirements'
      and column_name = 'excluded_category_ids'
  ) then
    raise exception
      'Apply 176_global_requirement_exclusions.sql before this migration: 177 gates that column too.';
  end if;
end
$guard$;

-- ===========================================================================
-- 1. The guard
-- ===========================================================================

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
    -- The requirement appears where it was not before: every category it lands in gains it.
    v_gated := v_gated || coalesce(new.category_id::text, '') || coalesce(new.assigned_category_ids, '{}');
    v_what  := 'add a requirement to';

  elsif tg_op = 'DELETE' then
    -- The requirement disappears: every category that had it loses it. Note the EXCLUSION
    -- list is deliberately absent — a category excluded from a global requirement never had
    -- it, so deleting that requirement does not change what the category requires.
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

    -- Shares: the symmetric difference, i.e. categories linked or unlinked by this write.
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

    -- Exclusions: same treatment, unchanged from migration 176.
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
  'Enforces the FINAL lock on compliance_requirements (migration 177). Freezes a locked category''s MEMBERSHIP — nothing may start or stop applying to it — but never the DEFINITION of a requirement, which stays editable however many FINAL categories hold it. Gates only the categories entering or leaving category_id / assigned_category_ids / excluded_category_ids.';

comment on column public.categories_l3.is_finalized is
  'FINAL: this category''s LIST of TCF requirements is frozen — nothing can be added to it or removed from it (migration 177). The wording, timing and evidence rules of the individual requirements stay editable, with a warning naming the FINAL categories affected. Enforced by compliance_requirements_lock_guard(). Clear it only through release_compliance_category(), which requires an ADMIN and a written reason.';
