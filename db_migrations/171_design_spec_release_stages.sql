-- 171: Design Specs — three RELEASE STAGES, each with its own revisions.
--
-- WHAT CHANGED AND WHY. Migration 163 gave a version two possible kinds, `draft` and
-- `final`, which cannot express the step the design team actually works to:
--
--   1. Internal Review   ours only. The pass we make BEFORE the supplier has ever seen it.
--   2. Initial Release   the first version the supplier sees. Their comments land here.
--   3. Final Release     the version that applies those comments. This is what gets issued.
--
-- `draft` conflated (1) and (2), and those two differ on the one thing that matters — whether
-- the file is allowed to reach a supplier. So `kind` is replaced by `stage`, and each stage
-- carries its own REVISION counter, because "Final Release v.02" is a correction to the final,
-- not a fourth release stage.
--
-- WHAT IS *NOT* CHANGED, DELIBERATELY:
--
--   `version` stays.  It is the spec-wide monotonic upload counter, and it is load-bearing far
--                     outside this table: review_comments.subject_version and
--                     .checked_subject_version pin every note and every triage verdict to it,
--                     the compare view orders panes by it, and ghost pins are matched on it.
--                     Renumbering per stage would rewrite the meaning of rows already written.
--                     So `version` is the IDENTITY (v1, v2, v3 … forever) and
--                     (stage, revision) is the NAME the business reads. Both are true at once
--                     and neither can drift, because the trigger assigns both in one insert.
--
--   the lock.         `design_specs.final_version_id` is still the lock, and issuing still
--                     refuses further versions. A Final Release v.02 therefore requires an
--                     explicit Unlock — which is the point: correcting an issued spec is a
--                     decision someone takes, not a file someone drops in.
--
-- THE ONE NEW RULE THAT IS A SECURITY RULE. An Internal Review version may not be published
-- to a supplier's portal. That is enforced by a trigger on `review_shares` rather than by the
-- UI, because the portal is the one place a supplier reaches a spec without anyone deciding
-- to send it to them. A plain review LINK on an internal version is still allowed — that is
-- how an internal colleague marks one up in the same tool — and the panel says out loud that
-- whoever holds a token is the reviewer.
--
-- ORDER. This migration REPLACES the two round RPCs from 170, which still select `v.kind`.
-- 170 must be applied first; the guard below refuses to run otherwise rather than leaving the
-- supplier portal half-built.

-- ===========================================================================
-- 0. Refuse to run out of order
-- ===========================================================================

do $guard$
begin
  if to_regprocedure('public.get_design_spec_rounds_by_project_token(text)') is null then
    raise exception
      'Apply 170_supplier_portal_design_specs.sql before this migration: it defines the two round RPCs that 171 rewrites, and re-applying it afterwards would fail on the changed return type.';
  end if;
end
$guard$;

-- ===========================================================================
-- 1. The stage vocabulary, once, in the database
-- ===========================================================================
--
-- Two immutable helpers so the order and the wording exist in ONE place. Every message a
-- designer reads out of a trigger below is built from them, and
-- src/pages/design/design-spec-release.ts is the same two facts on the client.

create or replace function public.design_spec_stage_rank(p_stage text)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case p_stage
           when 'internal' then 1
           when 'initial'  then 2
           when 'final'    then 3
         end;
$fn$;

comment on function public.design_spec_stage_rank(text) is
  'Position of a design spec release stage in the workflow. NULL for an unknown stage, which the CHECK constraint on design_spec_versions.stage already makes unreachable.';

create or replace function public.design_spec_stage_label(p_stage text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case p_stage
           when 'internal' then 'Internal Review'
           when 'initial'  then 'Initial Release'
           when 'final'    then 'Final Release'
           else coalesce(p_stage, 'unknown')
         end;
$fn$;

comment on function public.design_spec_stage_label(text) is
  'The business name of a release stage, for the sentences the triggers raise. Mirrors DESIGN_SPEC_STAGE_META in src/pages/design/design-spec-release.ts.';

-- ===========================================================================
-- 2. stage and revision on design_spec_versions
-- ===========================================================================

alter table public.design_spec_versions add column if not exists stage    text;
alter table public.design_spec_versions add column if not exists revision integer;

-- Backfill. Every pre-171 `draft` becomes an Initial Release: it is a version that was
-- uploadable to a reviewer, which is exactly what an Initial Release is. Reading them as
-- Internal Review would be the unsafe direction — it would retroactively claim that files
-- which HAVE been sent to suppliers were never meant to leave the building.
update public.design_spec_versions
   set stage = case when kind = 'final' then 'final' else 'initial' end
 where stage is null;

-- Revisions run 1..n within each (spec, stage), in upload order, so the existing numbering
-- reads forward rather than being invented.
with numbered as (
  select id, row_number() over (partition by spec_id, stage order by version) as rn
  from public.design_spec_versions
  where revision is null
)
update public.design_spec_versions v
   set revision = n.rn
  from numbered n
 where n.id = v.id;

alter table public.design_spec_versions alter column stage    set not null;
alter table public.design_spec_versions alter column revision set not null;

alter table public.design_spec_versions drop constraint if exists design_spec_versions_stage_check;
alter table public.design_spec_versions
  add constraint design_spec_versions_stage_check
  check (stage in ('internal', 'initial', 'final'));

alter table public.design_spec_versions drop constraint if exists design_spec_versions_revision_positive;
alter table public.design_spec_versions
  add constraint design_spec_versions_revision_positive check (revision >= 1);

-- "Final Release v.02" must name exactly one file, the same way (spec_id, version) does.
alter table public.design_spec_versions drop constraint if exists design_spec_versions_release_key;
alter table public.design_spec_versions
  add constraint design_spec_versions_release_key unique (spec_id, stage, revision);

comment on column public.design_spec_versions.stage is
  'Release stage: internal (ours only, never reaches a supplier portal), initial (the first version the supplier sees and comments on), final (applies those comments; the one that gets issued). Forward-only — see design_spec_versions_guard.';
comment on column public.design_spec_versions.revision is
  'Revision WITHIN the stage, 1-based, assigned server-side. "Final Release v.02" is (stage=final, revision=2). Not the same number as `version`, which counts every upload on the spec.';
comment on column public.design_spec_versions.version is
  'Spec-wide upload counter, 1-based and never reused. The IDENTITY of a version: review_comments.subject_version and .checked_subject_version pin notes and triage verdicts to it, and the compare view orders panes by it. (stage, revision) is the NAME the business reads; this is the number the data is keyed on.';

create index if not exists design_spec_versions_stage_idx
  on public.design_spec_versions (spec_id, stage, revision desc);

-- ===========================================================================
-- 3. The version guard, now assigning a revision and refusing to go backwards
-- ===========================================================================
--
-- FORWARD-ONLY is the rule that makes the three stages mean something. Once a spec has an
-- Initial Release, an "Internal Review v.02" would be a version claiming the supplier has not
-- seen the spec yet, which is false — and it would sit above the released one in the upload
-- order while naming an earlier step. Re-checking work internally is done with a review LINK
-- on the current version, not by walking the stage back.

create or replace function public.design_spec_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v     public.design_specs%rowtype;
  v_max integer;
  v_new integer;
begin
  select * into v from public.design_specs s where s.id = new.spec_id;
  if not found then
    raise exception 'No such design spec.';
  end if;
  if v.final_version_id is not null then
    raise exception 'This design spec is issued as final (%). Unlock it before adding a version.',
      v.spec_code;
  end if;
  if v.state = 'cancelled' then
    raise exception 'Design spec % is cancelled.', v.spec_code;
  end if;

  v_new := public.design_spec_stage_rank(new.stage);
  if v_new is null then
    raise exception 'Unknown release stage "%".', new.stage;
  end if;

  select max(public.design_spec_stage_rank(x.stage)) into v_max
  from public.design_spec_versions x where x.spec_id = new.spec_id;

  if v_max is not null and v_new < v_max then
    raise exception
      'A design spec moves forward: Internal Review -> Initial Release -> Final Release. % is already at %, so it cannot go back to %. To re-check work internally, send a review link on the current version instead.',
      v.spec_code,
      public.design_spec_stage_label(
        (select x.stage from public.design_spec_versions x
          where x.spec_id = new.spec_id
          order by public.design_spec_stage_rank(x.stage) desc limit 1)),
      public.design_spec_stage_label(new.stage);
  end if;

  -- Both counters server-side, so two concurrent uploads cannot both decide they are v3 or
  -- both claim Final Release v.02. The two unique constraints are the backstop if they race.
  if new.version is null then
    select coalesce(max(x.version), 0) + 1 into new.version
    from public.design_spec_versions x where x.spec_id = new.spec_id;
  end if;

  if new.revision is null then
    select coalesce(max(x.revision), 0) + 1 into new.revision
    from public.design_spec_versions x
    where x.spec_id = new.spec_id and x.stage = new.stage;
  end if;

  return new;
end;
$fn$;

-- ===========================================================================
-- 4. Only a Final Release may be issued
-- ===========================================================================

create or replace function public.design_specs_final_is_final()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_stage    text;
  v_revision integer;
begin
  if new.final_version_id is null then
    return new;
  end if;
  select stage, revision into v_stage, v_revision
  from public.design_spec_versions
  where id = new.final_version_id;

  if v_stage is null then
    raise exception 'Version % does not exist.', new.final_version_id;
  end if;
  if v_stage <> 'final' then
    raise exception 'Only a Final Release may be issued. That version is % v.%.',
      public.design_spec_stage_label(v_stage), lpad(v_revision::text, 2, '0');
  end if;
  return new;
end;
$fn$;

-- ===========================================================================
-- 5. An Internal Review never reaches a supplier's portal
-- ===========================================================================
--
-- `supplier_id` on a review_shares row is what publishes a round in that supplier's portal
-- (migration 170): the portal RPCs select on it, and nothing else. So refusing to set it on an
-- internal version is the whole enforcement, and it holds for the SQL editor and the MCP as
-- well as for the app.
--
-- Scoped to subject_type = 'design_spec' and returning immediately otherwise, because this
-- table also carries every Instruction Manual round.

create or replace function public.review_shares_internal_stage_guard()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare v_stage text;
begin
  if new.subject_type is distinct from 'design_spec' or new.supplier_id is null then
    return new;
  end if;

  select stage into v_stage
  from public.design_spec_versions where id = new.subject_id;

  if v_stage = 'internal' then
    raise exception
      'An Internal Review version is ours only and cannot be published to a supplier portal. Upload it as an Initial Release first, or send this link without ticking the portal.';
  end if;
  return new;
end;
$fn$;

comment on function public.review_shares_internal_stage_guard() is
  'Refuses to publish a design spec Internal Review version in a supplier portal. supplier_id IS the publish flag (the 170 RPCs select on it), so this is the enforcement point rather than the UI.';

drop trigger if exists trg_review_shares_internal_stage on public.review_shares;
create trigger trg_review_shares_internal_stage
  before insert or update of supplier_id, subject_id on public.review_shares
  for each row execute function public.review_shares_internal_stage_guard();

-- ===========================================================================
-- 6. kind is gone
-- ===========================================================================
--
-- Dropped rather than kept as a generated column: `draft` cannot say which of Internal Review
-- and Initial Release a file is, and leaving a second vocabulary in place is how two screens
-- end up describing the same version differently — the thing design-spec-status.ts exists to
-- prevent. Every reader is updated in the same commit.

alter table public.design_spec_versions drop column if exists kind;

-- ===========================================================================
-- 7. The supplier portal reports the stage, not "draft"
-- ===========================================================================
--
-- Same rows, same gates, same grants as 170 — only the `version_kind` column becomes
-- `version_stage` + `version_revision`, so the supplier reads "Initial Release v.02" and not
-- "draft". Dropped first because a return type cannot be changed by CREATE OR REPLACE.

drop function if exists public.get_design_spec_rounds_by_project_token(text);
create function public.get_design_spec_rounds_by_project_token(p_project_token text)
returns table (
  share_id         uuid,
  token            text,
  label            text,
  sent_at          timestamptz,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  submitted_at     timestamptz,
  submitted_by     text,
  spec_id          uuid,
  spec_code        text,
  spec_title       text,
  version_id       uuid,
  version_number   integer,
  version_stage    text,
  version_revision integer,
  version_note     text,
  page_count       integer,
  project_id       uuid,
  project_name     text
)
language sql
security definer
set search_path to 'public'
as $fn$
  select
    s.id, s.token, s.label, s.created_at, s.expires_at, s.revoked_at,
    s.submitted_at, s.submitted_by,
    ds.id, ds.spec_code, ds.title,
    v.id, v.version, v.stage, v.revision, v.note, v.page_count,
    p.id, p.name
  from public.review_shares s
  join public.projects p on p.id = s.project_id
  join public.design_spec_versions v on v.id = s.subject_id
  join public.design_specs ds on ds.id = v.spec_id
  where p.supplier_link_token = p_project_token
    and s.subject_type = 'design_spec'
    and s.mode = 'review'
    and s.supplier_id is not null
    and s.supplier_id = p.supplier_id
  order by v.version desc, s.created_at desc;
$fn$;

revoke execute on function public.get_design_spec_rounds_by_project_token(text) from public;
grant execute on function public.get_design_spec_rounds_by_project_token(text)
  to anon, authenticated, service_role;

drop function if exists public.get_design_spec_rounds_by_supplier(text, text);
create function public.get_design_spec_rounds_by_supplier(
  p_supplier_token text,
  p_code text
)
returns table (
  share_id         uuid,
  token            text,
  label            text,
  sent_at          timestamptz,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  submitted_at     timestamptz,
  submitted_by     text,
  spec_id          uuid,
  spec_code        text,
  spec_title       text,
  version_id       uuid,
  version_number   integer,
  version_stage    text,
  version_revision integer,
  version_note     text,
  page_count       integer,
  project_id       uuid,
  project_name     text
)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_ok boolean;
begin
  select exists(
    select 1 from public.suppliers s
    where s.portal_token = p_supplier_token and s.access_code = p_code
  ) into v_ok;
  perform public.portal_rl_guard('supplier', p_supplier_token, v_ok);
  if not v_ok then return; end if;

  return query
    select
      sh.id, sh.token, sh.label, sh.created_at, sh.expires_at, sh.revoked_at,
      sh.submitted_at, sh.submitted_by,
      ds.id, ds.spec_code, ds.title,
      v.id, v.version, v.stage, v.revision, v.note, v.page_count,
      p.id, p.name
    from public.review_shares sh
    join public.projects p on p.id = sh.project_id
    join public.suppliers sup on sup.id = p.supplier_id
    join public.design_spec_versions v on v.id = sh.subject_id
    join public.design_specs ds on ds.id = v.spec_id
    where sup.portal_token = p_supplier_token
      and sup.access_code = p_code
      and sh.subject_type = 'design_spec'
      and sh.mode = 'review'
      and sh.supplier_id = sup.id
    order by p.name, v.version desc, sh.created_at desc;
end;
$fn$;

revoke execute on function public.get_design_spec_rounds_by_supplier(text, text) from public;
grant execute on function public.get_design_spec_rounds_by_supplier(text, text)
  to anon, authenticated, service_role;
