-- 173: one TCF requirement, many categories — LINK it or COPY it.
--
-- THE PROBLEM. `compliance_requirements.category_id` offered exactly two scopes: one
-- category, or NULL for "every category". Nothing in between. But the real unit of work is a
-- family: every Hood needs the same LVD report, the same EMC report, the same exploded view.
-- With only those two scopes an operator had to re-type the set into each of a dozen leaves,
-- and from then on there was no way to change them together — the twelve copies drifted, and
-- nothing in the schema even recorded that they were meant to be the same thing.
--
-- THE SHAPE, borrowed rather than invented. `category_attributes` solved this exact problem
-- years ago with `assigned_category_ids`, and `getAttributesForCategory` resolves it as
-- "owned by me, OR global, OR assigned to me". Requirements now carry the same column and
-- resolve by the same rule. Reusing the shape means the operator's mental model, the
-- vocabulary in the UI ("shared"), and the stale-id behaviour are all already established —
-- and it is one column rather than a junction table plus its RLS, its grants and its joins.
--
-- SO THERE ARE TWO WAYS TO PUT ONE REQUIREMENT ON MANY CATEGORIES, and they mean different
-- things:
--
--   LINK  one row, listed against several categories. Edit it once and every category sees
--         the change. This is what "all Hoods have the same requirements" actually means, and
--         it is the option that keeps them the same a year from now.
--
--   COPY  independent rows, one per category, made by the application (there is no SQL here
--         for it — a copy is just N inserts). Diverges freely afterwards. Right when the
--         categories merely START from the same place.
--
-- THE CONSEQUENCE FOR THE FINAL LOCK (migration 172), which is the one thing here worth
-- reading twice: a linked requirement is frozen if ANY category it reaches is marked FINAL.
-- Not just its home category — any of them.
--
--   Why it must be that way: the whole point of FINAL is that a locked category's requirement
--   set cannot change. If the guard checked only `category_id`, then editing a requirement
--   homed in Angled Hoods would silently rewrite what Ceiling Hoods requires while Ceiling
--   Hoods was locked — the exact hole 172 exists to close, reopened by the back door.
--
--   What it costs: link one requirement across twelve Hoods and locking any ONE of them
--   freezes that requirement for all twelve. That is a real trade-off and the UI says so out
--   loud. The escapes are the ones you would expect — release the locked category (admin,
--   with a reason), or COPY instead of LINK so the categories were never joined.
--
--   Linking INTO or unlinking FROM a locked category is refused by the same check, because
--   both change what that category requires.
--
-- HISTORY. `compliance_requirement_history` gains `linked_category_ids`: the categories a
-- requirement was shared with at the moment of the change, unioned across before and after so
-- an UNLINK still appears in the history of the category it left. Without it, editing a shared
-- requirement would show up only under its home category, and the other eleven Hoods would
-- have a silent gap exactly where a shared change happened.

-- ===========================================================================
-- 0. Refuse to run out of order
-- ===========================================================================
-- This migration REPLACES two function bodies from 172. Applying it first would leave the
-- lock and the history in place but blind to sharing, which is worse than either alone.

do $guard$
begin
  if to_regprocedure('public.compliance_requirements_lock_guard()') is null
     or to_regclass('public.compliance_requirement_history') is null then
    raise exception
      'Apply 172_tcf_requirement_lock_and_history.sql before this migration: 173 rewrites its lock guard and history trigger to understand shared requirements.';
  end if;
end
$guard$;

-- ===========================================================================
-- 1. The column
-- ===========================================================================
--
-- `text[]`, not `uuid[]`, and no foreign key — deliberately identical to
-- `category_attributes.assigned_category_ids`, whose behaviour every operator and every
-- mapper in the app already expects. A postgres array cannot carry an FK anyway, so a
-- deleted category leaves a stale id in some arrays; resolution simply stops matching it,
-- exactly as it has always done for attributes. NOT NULL DEFAULT '{}' so "shared with
-- nobody" has one representation and no call site has to handle null.

alter table public.compliance_requirements
  add column if not exists assigned_category_ids text[] not null default '{}';

comment on column public.compliance_requirements.assigned_category_ids is
  'Other categories this requirement is LINKED to (migration 173). One row serving several categories: edit it once, every listed category sees the change. Empty for an unshared requirement, and always empty for a global one (category_id null), which already applies everywhere. Resolution: requirementAppliesToCategory() — owned OR global OR listed here.';

-- GIN, because every read of this column is a containment test ("which requirements reach
-- this category"), and a btree cannot answer that.
create index if not exists compliance_requirements_assigned_idx
  on public.compliance_requirements using gin (assigned_category_ids);

alter table public.compliance_requirement_history
  add column if not exists linked_category_ids text[];

comment on column public.compliance_requirement_history.linked_category_ids is
  'The categories the requirement was shared with when this change happened, unioned across before and after (migration 173) — so an unlink still shows in the history of the category it left. Null for lock/release rows, which are category events.';

create index if not exists compliance_requirement_history_linked_idx
  on public.compliance_requirement_history using gin (linked_category_ids);

-- ===========================================================================
-- 2. One canonical representation of "shared with"
-- ===========================================================================
--
-- Runs BEFORE the lock guard: the trigger name starts with `canonical`, and Postgres fires
-- BEFORE row triggers in name order, so `..._canonical` precedes `..._lock`. That ordering is
-- load-bearing — the guard must see the tidied array, not whatever the client sent.
--
-- It normalises rather than validates. A blank entry is noise and gets dropped; a duplicate
-- is noise and gets dropped; the home category listed among its own shares is contradictory
-- and gets dropped. What it does NOT do is check that each id names a live category: that
-- would silently discard an assignment on a slow replica or during a category rename, and a
-- stale id is harmless (nothing resolves against it) where a silently dropped live one is not.

create or replace function public.compliance_requirements_canonicalise()
returns trigger
language plpgsql
as $$
begin
  new.assigned_category_ids := coalesce(new.assigned_category_ids, '{}');

  if new.category_id is null then
    -- A global requirement already applies to every category. An assignment list on top of
    -- that is at best redundant and at worst reads as a narrowing it is not.
    new.assigned_category_ids := '{}';
    return new;
  end if;

  select coalesce(array_agg(distinct e order by e), '{}')
    into new.assigned_category_ids
  from unnest(new.assigned_category_ids) as e
  where nullif(btrim(e), '') is not null
    and e <> new.category_id::text;

  return new;
end;
$$;

drop trigger if exists compliance_requirements_canonical on public.compliance_requirements;
create trigger compliance_requirements_canonical
before insert or update on public.compliance_requirements
for each row execute function public.compliance_requirements_canonicalise();

-- ===========================================================================
-- 3. The lock now follows the link
-- ===========================================================================
-- Replaces the 172 body. The only change: the set of categories checked is no longer
-- {category_id} but {category_id} ∪ assigned_category_ids, on both sides of the write.

create or replace function public.compliance_requirements_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids  text[] := '{}';
  v_name text;
begin
  -- Service role / SQL console: no JWT, already outside RLS. Consistent with migration 110.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- `NEW` and `OLD` are only bound for the operations that have them — reading the other one
  -- raises "record not assigned", so each is read inside its own branch.
  --
  -- BOTH sides go in. Checking only the new set would let a requirement be unlinked from a
  -- FINAL category (removing one of its requirements), and checking only the old set would
  -- let one be linked into a FINAL category (adding one). Both are changes to a frozen set.
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

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- ===========================================================================
-- 4. History that reaches every category the change touched
-- ===========================================================================
-- Replaces the 172 body. The only change: `linked_category_ids` is populated, so a shared
-- requirement's edit appears in the history of every category it reaches, not just its home.
--
-- `assigned_category_ids` is an ordinary column of the row, so linking and unlinking already
-- record themselves as an `update` whose changed_fields is {assigned_category_ids}. Nothing
-- extra is needed to log a link — only to make it findable from the other side.

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
  -- Same rule as the guard: read each record only in the branch where it is bound.
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old);
    v_cat := old.category_id; v_req := old.id; v_title := old.title; v_section := old.section;
    v_linked := v_linked || coalesce(old.assigned_category_ids, '{}');
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new);
    v_cat := new.category_id; v_req := new.id; v_title := new.title; v_section := new.section;
    v_linked := v_linked || coalesce(new.assigned_category_ids, '{}');
  end if;

  -- Union of before and after: an unlink has to stay visible in the history of the category
  -- it was removed from, which is precisely the category no longer in the `after` list.
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

    -- An upsert that rewrites a row with identical values is not a change and must not
    -- appear as one, or the history fills with noise and stops being read.
    if v_changed is null then
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
-- 5. Backfill the shape, not the data
-- ===========================================================================
-- Nothing to migrate: every existing requirement is unshared, which the column default
-- already says. This block exists only to make the canonical form true for rows written
-- before the trigger existed (a global requirement carrying stray assignments cannot occur
-- yet, but asserting it now means the invariant holds from row one).

update public.compliance_requirements
set assigned_category_ids = '{}'
where category_id is null
  and assigned_category_ids <> '{}';
