-- 175: a defined, stable order for TCF sections and for the requirements inside them.
--
-- THE COMPLAINT, restated precisely: the same requirement list came out in a different order
-- depending on which screen you looked at, and there was no way to say what the order should
-- be. Both halves were true.
--
-- WHERE THE ORDER CAME FROM BEFORE:
--
--   SECTIONS. Three screens (the supplier portal, the internal request detail, and its PDF
--   export) each carried a verbatim copy of the same comparator: built-ins in the order of the
--   `COMPLIANCE_SECTIONS` constant, then everything else ALPHABETICALLY. The library used a
--   fourth rule — built-ins, then custom sections in CREATION order. So a custom section
--   genuinely appeared in a different place in the library than in the supplier's portal, and
--   `compliance_sections.sort_order` existed the whole time with no UI to set it and every
--   custom row sitting at 0.
--
--   REQUIREMENTS. Nothing read it. `compliance_requirements.sort_order` has existed since the
--   table was created and `getComplianceRequirements` did a bare `select` with no ORDER BY, so
--   the order inside a section was whatever Postgres returned — stable enough day to day to
--   look deliberate, and free to change after any update. That is the worst kind of ordering:
--   it looks like a decision and isn't one.
--
--   It is NOT, however, an empty column. Checked before writing this: one category
--   (afe42b9b, "Electrical Test Reports and Certificates" / "Chemical Reports and
--   Declarations" / "Additional Documents.") carries a deliberate sparse scheme — 1001-1005,
--   2000-2003, 4000-4001 — that somebody set by hand or by import and that nothing has ever
--   displayed. That work is real and the backfill below is written to preserve it.
--
-- WHAT THIS MIGRATION DOES:
--
--   1. Makes the six built-in sections real ROWS, so every section — standard or custom — is
--      ordered by the same column and the whole list is arrangeable. They were a TypeScript
--      constant, which is why they could not be moved.
--
--   2. Numbers the existing custom sections after them, by creation date, so the first render
--      after this migration matches what the library showed before rather than reshuffling.
--
--   3. Backfills `compliance_requirements.sort_order` per (category, section), alphabetically
--      by title. Alphabetical is not the right long-term order — the operator defines that —
--      but it is a DEFINED starting point, which is the thing that did not exist.
--
--   4. Stops the audit trail recording a reorder. See section 4 for why that one exception
--      is deliberate.
--
-- One ordering rule now lives in `src/services/compliance/requirement-order.ts` and every
-- surface calls it. The four copies of the comparator are gone.

-- ===========================================================================
-- 0. Refuse to run out of order
-- ===========================================================================

do $guard$
begin
  if to_regprocedure('public.compliance_requirements_history_log()') is null then
    raise exception
      'Apply 172_tcf_requirement_lock_and_history.sql (and 173) before this migration: 175 rewrites the history trigger it defines.';
  end if;
end
$guard$;

-- ===========================================================================
-- 1. Sections: the built-ins become rows
-- ===========================================================================
--
-- `is_builtin` is INFORMATIONAL, not a permission. It lets the library label the six standard
-- sections and withhold a delete button from them — which is exactly what it did before, when
-- they were a constant and deleting one was simply not expressible. It does NOT restrict
-- reordering: being able to move "Packaging & Labeling" above "Safety & Electrical" is the
-- whole point of this migration.

alter table public.compliance_sections
  add column if not exists is_builtin boolean not null default false;

comment on column public.compliance_sections.is_builtin is
  'One of the six sections the app has always shipped with (migration 175). Informational: the library shows them as standard and offers no delete, but they reorder like any other. Not a permission — nothing in the database enforces it.';

comment on column public.compliance_sections.sort_order is
  'The operator-defined position of this section. Set by reorderComplianceSections(); 0-based and contiguous after any reorder. Ties break on created_at. Every surface that groups requirements by section reads this through orderSectionNames() — see src/services/compliance/requirement-order.ts.';

-- Seed the six. `on conflict (name)` rather than a plain insert because a user may already
-- have created one of these names as a custom section: in that case it is ADOPTED — same row,
-- now numbered and labelled as standard — instead of raising or silently doing nothing.
insert into public.compliance_sections (name, sort_order, is_builtin) values
  ('General Requirements',   0, true),
  ('Safety & Electrical',    1, true),
  ('Chemical & Material',    2, true),
  ('Mechanical & Physical',  3, true),
  ('Packaging & Labeling',   4, true),
  ('Performance & Testing',  5, true)
on conflict (name) do update
  set sort_order = excluded.sort_order,
      is_builtin = true;

-- Number the existing custom sections after the built-ins, in creation order — the order the
-- library was already showing them in. Anything else would reshuffle a list on deploy for no
-- reason the operator asked for.
with ranked as (
  select id, 6 + (row_number() over (order by created_at, name)) - 1 as new_order
  from public.compliance_sections
  where not is_builtin
)
update public.compliance_sections s
set sort_order = ranked.new_order
from ranked
where ranked.id = s.id;

-- ===========================================================================
-- 2. Requirements: a defined starting order
-- ===========================================================================
--
-- Per (category, section), because that is the list a person actually looks at and reorders.
-- Alphabetical by title is the seed: it is arbitrary but STABLE and inspectable, where the
-- previous unordered select was arbitrary and free to change.
--
-- Global requirements (category_id null) are numbered as their own group — they appear inside
-- every category's section list, so their order has to come from somewhere, and it cannot
-- come from any one category.
--
-- ONLY GROUPS WITH NO ORDERING AT ALL ARE TOUCHED — every row in the group sitting at 0.
--
--   The narrower guard "skip rows that are non-zero" was wrong, and the live data is why: one
--   category carries a deliberate sparse scheme (1001-1005, 2000-2003, 4000-4001). Under a
--   per-ROW guard, a group of [0, 5, 7] would have its single unset row renumbered to its
--   alphabetical index and interleaved into somebody else's arrangement. Skipping the whole
--   group instead means a section anyone has ever ordered is left exactly as they left it,
--   and only genuinely unordered sections get a starting point.
--
--   This also makes the migration idempotent for the right reason rather than by luck: after
--   it runs, a seeded group is no longer all-zero, so a re-run skips it.

with ranked as (
  select
    id,
    category_id,
    coalesce(nullif(btrim(section), ''), 'General Requirements') as sec,
    (row_number() over (
      partition by category_id, coalesce(nullif(btrim(section), ''), 'General Requirements')
      order by title, id
    )) - 1 as new_order
  from public.compliance_requirements
),
unordered_groups as (
  select category_id, coalesce(nullif(btrim(section), ''), 'General Requirements') as sec
  from public.compliance_requirements
  group by 1, 2
  having bool_and(coalesce(sort_order, 0) = 0)
)
update public.compliance_requirements r
set sort_order = ranked.new_order
from ranked
join unordered_groups g
  on g.category_id is not distinct from ranked.category_id
 and g.sec = ranked.sec
where ranked.id = r.id
  and ranked.new_order <> 0;

comment on column public.compliance_requirements.sort_order is
  'The operator-defined position of this requirement within its section (migration 175). Assigned by reorderRequirements() as 0-based and contiguous over the list being reordered. One number per requirement, so a global or shared requirement holds the same position in every category it appears in — which is what makes the order the same everywhere.';

-- ===========================================================================
-- 3. Order the read
-- ===========================================================================
-- Not strictly required — `groupRequirementsBySection` sorts in the client, because it needs
-- the sections list to do it — but a deterministic base order means anything that reads this
-- table WITHOUT going through that helper still gets a sensible list rather than a random one.

create index if not exists compliance_requirements_order_idx
  on public.compliance_requirements (category_id, section, sort_order);

-- ===========================================================================
-- 4. A reorder is not an audit event
-- ===========================================================================
--
-- Replaces the migration-173 body of `compliance_requirements_history_log`. ONE new rule: an
-- update whose only changed column is `sort_order` writes no history row.
--
-- This is a deliberate exception to the rule stated in 172 ("never hide a change"), and it is
-- worth being explicit about why it does not weaken the audit trail:
--
--   The history answers "what did we require, and who changed it". Display order is not part
--   of that — reordering ten requirements changes nothing about what any supplier must
--   provide. And it would cost ten history rows per drag, burying the changes that ARE
--   compliance facts under noise. Migration 172 already refuses to log a no-op update for the
--   same reason: a history that stops being read has stopped working.
--
--   The exception is narrow on purpose. It is `sort_order` and NOTHING else: an update that
--   changes sort_order AND anything else is logged in full, including the sort_order change.

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
  -- `NEW`/`OLD` are only bound for the operations that have them; read each in its own branch.
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

  -- Union of before and after, so an unlink still shows in the history of the category it left.
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

    -- A pure reorder. See the section header above.
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
