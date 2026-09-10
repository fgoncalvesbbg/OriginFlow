-- 176: a global requirement can be marked NOT APPLICABLE for specific categories.
--
-- THE GAP. A requirement had three scopes and no exceptions: owned by one category, shared
-- with several (migration 173), or global — applying to all ~135. "Global" was therefore an
-- all-or-nothing bet, and the real library is not all-or-nothing: an electrical safety report
-- belongs in the global set because almost everything needs it, and a purely mechanical
-- product needs it not at all. Before this the only ways out were both wrong:
--
--   Demote it out of the global set and hand-maintain a share list of 130-odd categories,
--   which nobody remembers to extend when a category is added — the exact failure the global
--   scope exists to prevent.
--
--   Leave it global and ask suppliers of non-electronic products for an LVD report, teaching
--   them that the list is approximate. A compliance request that includes things it should not
--   is a request people learn to argue with.
--
-- So the global scope gains a subtractive half: `excluded_category_ids`.
--
-- WHY THIS IS NOT THE SAME AS A CONDITION, and both exist on purpose:
--
--   AN EXCLUSION is structural and per CATEGORY. "Cast iron pans have no electronics" is true
--   of the category, decided once in the library, and true of every product in it.
--
--   A CONDITION (migration 174) is per PRODUCT and answered per request. "Does THIS product
--   transmit radio?" is asked by the wizard when a request is created, because two products
--   in one category can differ.
--
--   Using a condition for a whole-category fact would make somebody answer the same question
--   for every request forever; using an exclusion for a per-product fact would silently drop
--   the requirement for products that do need it. The library UI says which is which.
--
-- SCOPE IS DELIBERATELY NARROW: exclusions are for GLOBAL requirements only. A shared
-- requirement already has a precise way to not apply somewhere — unlink it from that category
-- — and offering both would leave "why is this not here?" with two possible answers. The
-- canonicalise trigger enforces the split, mirroring what it already does in the other
-- direction:
--
--   global (category_id null)   assigned_category_ids MUST be empty (it already applies
--                               everywhere); excluded_category_ids is where exceptions live.
--   category-owned             assigned_category_ids carries its shares;
--                               excluded_category_ids MUST be empty.

-- ===========================================================================
-- 0. Refuse to run out of order
-- ===========================================================================

do $guard$
begin
  if to_regprocedure('public.compliance_requirements_canonicalise()') is null then
    raise exception
      'Apply 173_tcf_requirements_shared_across_categories.sql before this migration: 176 extends its canonicalise trigger and lock guard.';
  end if;
end
$guard$;

-- ===========================================================================
-- 1. The column
-- ===========================================================================
-- `text[]` with no foreign key, exactly like `assigned_category_ids` — same reasoning, same
-- behaviour when a category is deleted (the stale id simply stops matching anything).

alter table public.compliance_requirements
  add column if not exists excluded_category_ids text[] not null default '{}';

comment on column public.compliance_requirements.excluded_category_ids is
  'Categories a GLOBAL requirement does NOT apply to (migration 176) — "this category never needs this". Always empty for a category-owned requirement, where unlinking is the precise tool instead. An exclusion is a structural fact about the category; for a per-PRODUCT exception use a condition and a TCF question (migration 174).';

create index if not exists compliance_requirements_excluded_idx
  on public.compliance_requirements using gin (excluded_category_ids);

-- ===========================================================================
-- 2. One canonical representation, both directions
-- ===========================================================================
-- Replaces the migration-173 body. Same trigger, same name, same position before the lock
-- guard; it now tidies the exclusion list too and enforces which of the two lists a row is
-- allowed to carry.

create or replace function public.compliance_requirements_canonicalise()
returns trigger
language plpgsql
as $$
begin
  new.assigned_category_ids := coalesce(new.assigned_category_ids, '{}');
  new.excluded_category_ids := coalesce(new.excluded_category_ids, '{}');

  if new.category_id is null then
    -- GLOBAL. It already applies to every category, so a share list on top is at best
    -- redundant and at worst reads as a narrowing it is not. Exceptions go in the exclusion
    -- list, which is tidied but kept.
    new.assigned_category_ids := '{}';

    select coalesce(array_agg(distinct e order by e), '{}')
      into new.excluded_category_ids
    from unnest(new.excluded_category_ids) as e
    where nullif(btrim(e), '') is not null;

    return new;
  end if;

  -- CATEGORY-OWNED. Shares are meaningful; exclusions are not — a requirement that should
  -- not apply somewhere simply is not shared there, and having two mechanisms would make
  -- "why is this missing?" ambiguous.
  new.excluded_category_ids := '{}';

  select coalesce(array_agg(distinct e order by e), '{}')
    into new.assigned_category_ids
  from unnest(new.assigned_category_ids) as e
  where nullif(btrim(e), '') is not null
    and e <> new.category_id::text;

  return new;
end;
$$;

-- ===========================================================================
-- 3. The FINAL lock, precisely
-- ===========================================================================
-- Replaces the migration-173 body. The existing rules are unchanged; ONE is added, and the
-- shape of the addition is the whole point.
--
-- Migration 172 decided that a global requirement is NOT frozen by any category's lock:
-- honouring one lock would freeze the global set for all ~135 categories, which is not a
-- lock, it is a deadlock. That decision has to survive exclusions — so this canNOT simply
-- add `excluded_category_ids` to the set of categories checked. A global requirement excluded
-- from one FINAL category would then be uneditable everywhere, re-creating exactly the
-- problem 172 avoided, by the back door.
--
-- So the two lists are checked differently, and the difference is deliberate:
--
--   category_id + assigned_category_ids   the WHOLE set, old and new. Any edit to a row that
--                                         reaches a locked category is refused. That is
--                                         "the lock follows the link" (173).
--
--   excluded_category_ids                 only what CHANGED — the symmetric difference. A
--                                         locked category's frozen set changes when it is
--                                         added to or removed from the exclusion list, and
--                                         not when the requirement's title is edited.
--
-- INSERT and DELETE need no exclusion check at all: a category in the exclusion list of a
-- requirement being created or deleted never had it and still does not, so its set is
-- unchanged either way.

create or replace function public.compliance_requirements_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids       text[] := '{}';
  v_excl_diff text[] := '{}';
  v_name      text;
begin
  -- Service role / SQL console: no JWT, already outside RLS. Consistent with migration 110.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- `NEW`/`OLD` are only bound for the operations that have them; read each in its own branch.
  if tg_op <> 'DELETE' then
    v_ids := v_ids || coalesce(new.category_id::text, '') || coalesce(new.assigned_category_ids, '{}');
  end if;
  if tg_op <> 'INSERT' then
    v_ids := v_ids || coalesce(old.category_id::text, '') || coalesce(old.assigned_category_ids, '{}');
  end if;

  select c.name into v_name
  from public.categories_l3 c
  where c.is_finalized
    and c.id::text = any(v_ids)
  limit 1;

  if v_name is not null then
    raise exception
      'The TCF requirements for "%" are marked FINAL. An administrator must release the category — stating why — before anything here can change. (A requirement shared with several categories is frozen if any one of them is FINAL.)', v_name
      using errcode = 'check_violation';
  end if;

  -- The exclusion list: only a category entering or leaving it is affected.
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(e), '{}') into v_excl_diff
    from (
      (select unnest(coalesce(new.excluded_category_ids, '{}'))
       except
       select unnest(coalesce(old.excluded_category_ids, '{}')))
      union
      (select unnest(coalesce(old.excluded_category_ids, '{}'))
       except
       select unnest(coalesce(new.excluded_category_ids, '{}')))
    ) d(e);

    if array_length(v_excl_diff, 1) is not null then
      select c.name into v_name
      from public.categories_l3 c
      where c.is_finalized
        and c.id::text = any(v_excl_diff)
      limit 1;

      if v_name is not null then
        raise exception
          'The TCF requirements for "%" are marked FINAL, so this requirement cannot be marked applicable or not applicable there. An administrator must release the category — stating why — first.', v_name
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- ===========================================================================
-- 4. History that reaches the excluded category too
-- ===========================================================================
-- Replaces the migration-175 body. `linked_category_ids` now carries the exclusion list as
-- well, so marking a global requirement not-applicable for a category shows up in THAT
-- category's history — which is where somebody looks to answer "why did this stop being
-- asked for?". Without it the change would only appear under the global set, and the affected
-- category's history would have a silent gap exactly where its requirements changed.

comment on column public.compliance_requirement_history.linked_category_ids is
  'Every category, other than the requirement''s own, that this change reached: its shares (migration 173) and its exclusions (migration 176), unioned across before and after so an unlink or a re-apply still shows in the history of the category it affected. Null for lock/release rows, which are category events.';

create or replace function public.compliance_requirements_history_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before  jsonb;
  v_after   jsonb;
  v_changed text[];
  v_linked  text[] := '{}';
  v_action  text := lower(tg_op);
  v_cat     uuid;
  v_req     uuid;
  v_title   text;
  v_section text;
begin
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old);
    v_cat := old.category_id; v_req := old.id; v_title := old.title; v_section := old.section;
    v_linked := v_linked || coalesce(old.assigned_category_ids, '{}')
                         || coalesce(old.excluded_category_ids, '{}');
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new);
    v_cat := new.category_id; v_req := new.id; v_title := new.title; v_section := new.section;
    v_linked := v_linked || coalesce(new.assigned_category_ids, '{}')
                         || coalesce(new.excluded_category_ids, '{}');
  end if;

  -- Union of before and after, so an unlink or a re-apply still shows in the history of the
  -- category it affected — precisely the one absent from the `after` list.
  select coalesce(array_agg(distinct e order by e), '{}') into v_linked
  from unnest(v_linked) as e;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from (
      select key as k from jsonb_each(v_after) where v_before -> key is distinct from value
      union
      select key      from jsonb_each(v_before) where v_after  -> key is distinct from value
    ) d
    where k <> 'id';

    -- An upsert that rewrites a row with identical values is not a change.
    if v_changed is null then
      return null;
    end if;

    -- A pure reorder is not an audit event (migration 175).
    if v_changed = array['sort_order']::text[] then
      return null;
    end if;
  end if;

  insert into public.compliance_requirement_history (
    category_id, requirement_id, action, title, section, before_json, after_json,
    changed_fields, linked_category_ids, changed_by
  ) values (
    v_cat,
    v_req,
    case v_action when 'insert' then 'create' else v_action end,
    v_title,
    v_section,
    v_before,
    v_after,
    v_changed,
    v_linked,
    public.compliance_actor()
  );

  return null;
end;
$$;

-- ===========================================================================
-- 5. Nothing to backfill
-- ===========================================================================
-- No requirement has an exclusion yet, which the column default already says. This asserts
-- the canonical form for rows written before the trigger knew about the column.

update public.compliance_requirements
set excluded_category_ids = '{}'
where category_id is not null
  and excluded_category_ids <> '{}';
