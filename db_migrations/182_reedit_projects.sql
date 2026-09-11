-- ===========================================================================
-- 182  Re-Edit projects
-- ===========================================================================
-- A SKU that is already live sometimes needs a new Information Manual -- a warning-text
-- correction, a regulation change, a component swap -- and there is no launch project to
-- hang it on. It can happen several times over one SKU's life.
--
-- Going project-less is not an option: project_ims.project_id is NOT NULL and unique on
-- (project_id, template_type) where template_type is a closed enum, and seven more tables
-- (im_publish_snapshots, im_print_renders, im_draft_requests, im_regulatory_checklist_state,
-- project_im_backups, review_shares, review_comments) are NOT NULL on project_id too.
-- can_see_project() is the RLS spine for all of them. An IM cannot exist without a project.
--
-- So a re-edit IS a project, but a skeletal one: no phases, no documents, no supplier, no
-- supplier portal. The client creation path skips seedChecklist / bindTemplateDocuments /
-- requestSupplierDraft and leaves supplier_link_token NULL so the supplier portal -- which
-- is 100% token-driven and never reads supplier_id -- has nothing to open. Note the column
-- DEFAULTs a random hex, so the caller must pass an explicit NULL, not omit it.
--
-- pm_id is deliberately still populated (with the creator). can_see_project() is
-- "ADMIN OR pm_id = auth.uid()", so pm_id IS the ACL: a NULL there would make the project
-- and all of its children invisible to everyone but admins, and would 403 every
-- authorizeProject() call in the Netlify functions -- including IM print and file URLs.
-- ===========================================================================

alter table public.projects
  add column if not exists kind text not null default 'launch'
    check (kind in ('launch', 'reedit')),
  add column if not exists source_project_id uuid references public.projects(id) on delete set null,
  add column if not exists reedit_requirement text;

comment on column public.projects.kind is
  'launch = a normal project with phases, documents and a supplier. reedit = a skeletal, IM-only project for a SKU that is already live. Launch-facing lists filter on this.';
comment on column public.projects.source_project_id is
  'Optional pointer back to the launch project whose IM this revises, so the previously published version can be found. ON DELETE SET NULL: losing the origin must not delete the re-edit.';
comment on column public.projects.reedit_requirement is
  'What must change and why. This is the re-edit''s brief -- it stands in for the supplier draft that a launch starts from, which is why it is mandatory for kind=reedit.';

-- A re-edit without its reason is a re-edit nobody can action. btrim/nullif so that a
-- whitespace-only string is rejected the same as an empty one.
alter table public.projects
  drop constraint if exists projects_reedit_needs_requirement;
alter table public.projects
  add constraint projects_reedit_needs_requirement
  check (kind <> 'reedit' or nullif(btrim(reedit_requirement), '') is not null);

-- ---------------------------------------------------------------------------
-- Code generation: REYYxxx, restarting each year
-- ---------------------------------------------------------------------------
-- The house pattern for a generated code is a sequence plus a column default
-- (design_specs.spec_code, migration 163), but a plain sequence cannot reset per year.
-- An upsert against a one-row-per-year counter is atomic via the row lock -- no advisory
-- lock, no read-then-write race -- and resets naturally every January.

create table if not exists public.reedit_code_counters (
  yr       text    primary key,
  last_seq integer not null
);

comment on table public.reedit_code_counters is
  'One row per two-digit year holding the last RE sequence issued. Written only by next_reedit_code().';

create or replace function public.next_reedit_code() returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_yr text := to_char(now() at time zone 'UTC', 'YY');
  v_n  integer;
begin
  insert into public.reedit_code_counters (yr, last_seq)
  values (v_yr, 1)
  on conflict (yr) do update set last_seq = reedit_code_counters.last_seq + 1
  returning last_seq into v_n;

  return 'RE' || v_yr || lpad(v_n::text, 3, '0');
end $$;

comment on function public.next_reedit_code() is
  'Issues the next RE<YY><NNN> code, restarting at 001 each calendar year. SECURITY DEFINER so callers need no rights on the counter table.';

-- ---------------------------------------------------------------------------
-- Uniqueness, scoped to re-edits only
-- ---------------------------------------------------------------------------
-- A global unique index on project_id_code is impossible: live data already carries
-- duplicates (MDA26032, MDA26016AU, MDA26038) and one code with a leading space. Enforcing
-- it for re-edits alone gives the guarantee where it is generated without a data cleanup.

create unique index if not exists projects_reedit_code_uniq
  on public.projects (project_id_code) where kind = 'reedit';

create index if not exists projects_kind_idx on public.projects (kind);
create index if not exists projects_source_project_idx on public.projects (source_project_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Supabase default privileges grant anon ALL on every new table, so revoke explicitly
-- rather than trusting the absence of a policy. The counter is reachable only through the
-- SECURITY DEFINER function.

alter table public.reedit_code_counters enable row level security;
revoke all on public.reedit_code_counters from anon, authenticated;

-- REVOKE FROM PUBLIC, not just from anon. Postgres grants EXECUTE on every new function to
-- PUBLIC and `anon` inherits that, so revoking from `anon` alone leaves the ACL reading
-- `=X/postgres` and an unauthenticated caller able to burn RE numbers out of the counter.
-- The roles that need it are granted back explicitly.
revoke execute on function public.next_reedit_code() from public;
revoke execute on function public.next_reedit_code() from anon;
grant  execute on function public.next_reedit_code() to authenticated;
grant  execute on function public.next_reedit_code() to service_role;
