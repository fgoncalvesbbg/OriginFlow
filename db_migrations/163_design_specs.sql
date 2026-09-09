-- 163: Design Specs — the registry, the versions, and the DESIGNER role.
--
-- WHAT THIS MODULE IS. A design spec is a PDF the design team authors elsewhere (Illustrator,
-- SharePoint), sends to a supplier for markup, and then reissues as a final. OriginFlow
-- records that the spec exists, stores every version, runs the supplier round on the shared
-- review layer from migration 162, and decides who may download what. It is NOT an authoring
-- tool: no in-app PDF editing, no redlining, deliberately. See
-- docs/originflow-design-specs-module.md for the decisions behind every choice here.
--
-- ONE SPEC PER PROJECT. `project_id` is UNIQUE, not just indexed. The alternative (many specs
-- per project, typed by kind) was considered and declined, so the constraint records the
-- decision rather than leaving it to convention.
--
-- WHAT IS STORED AND WHAT IS DERIVED. The five statuses the business uses are
-- Backlog / In Progress / In Review / Final / Cancelled. Only the two ENDS are stored, in
-- `state`:
--
--   backlog    stored   nothing uploaded yet
--   cancelled  stored   overrides everything; nothing in the data can imply it
--   ---------  ------   -----------------------------------------------------------
--   final      DERIVED  final_version_id is not null
--   in_review  DERIVED  a live, unsubmitted review_shares row for the current version
--   in_progress DERIVED everything else — a version exists, no live round
--
-- This is the same discipline as src/pages/im/im-manual-status.ts: a step that is derived
-- from facts that already had to be true can never disagree with the files behind it, and
-- nobody can drag a card into a state the data does not support. `state` is deliberately
-- NOT called "status", so a reader does not mistake it for the thing on screen.
--
-- THE ROLE, AND THE TWO TRAPS IT WALKS INTO. Both were found by introspecting the live
-- database on 2026-09-09, and neither is visible from the repo:
--
--  1. `lib/doc-access.ts` resolves any user_roles.role that is not 'admin'/'internal' to
--     kind:'supplier'. Adding 'designer' without also widening those two branches would hand
--     designers the SUPPLIER-audience view of SOP documents. This migration widens the CHECK
--     and the mapper; the TypeScript half is changed in the same commit.
--  2. `can_see_project()` is *ADMIN, or projects.pm_id = auth.uid()*. A designer is neither,
--     so out of the box a DESIGNER sees zero projects — and, because the review layer from
--     162 is policed by that same function, could not read their own spec's review links or
--     supplier notes either. Fixed below by two SURGICAL policies rather than by widening
--     can_see_project, which 16 policies across 7 tables call and which are all FOR ALL:
--     widening it would have handed designers write access to seven tables of project data
--     as a side effect.
--
-- WHY THE GUARDS ARE COMPOSITE FOREIGN KEYS AND NOT TRIGGERS. Three cross-row rules matter
-- here — a spec's final version must be one of ITS OWN versions, and a linked SKU must belong
-- to the spec's OWN project. Both are expressible as composite FKs against a unique key,
-- which means the database enforces them on every path (including a hand-written UPDATE in
-- the SQL editor) at no runtime cost and with no trigger to forget. Only the two rules that
-- genuinely cannot be declarative — the lock, and "the final version must be of kind
-- 'final'" — are triggers.

-- ===========================================================================
-- 1. The DESIGNER role
-- ===========================================================================

alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles
  add constraint user_roles_role_check
  check (role in ('admin', 'internal', 'supplier', 'designer'));

comment on table public.user_roles is
  'Authoritative role for the SOP & Documents and Design Specs modules. Writable ONLY by service_role — never read a role from JWT user_metadata. Mirrored from public.profiles.role by trg_profiles_sync_user_roles.';

-- profiles.role uses OriginFlow's vocabulary (ADMIN / PM / SUPPLIER / DESIGNER); this table
-- uses the modules' (admin / internal / supplier / designer). One function owns the mapping
-- so it cannot be spelled two ways.
create or replace function public.doc_role_from_profile(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(coalesce(p_role, ''))
           when 'ADMIN'    then 'admin'
           when 'SUPPLIER' then 'supplier'
           when 'DESIGNER' then 'designer'
           else 'internal'          -- PM, and anything unrecognised, is an internal user
         end;
$$;

comment on function public.doc_role_from_profile(text) is
  'Maps public.profiles.role (ADMIN/PM/SUPPLIER/DESIGNER) onto a user_roles.role value. Unrecognised values fall back to the least-privileged internal role. NOTE: lib/doc-access.ts treats any role that is not admin/internal as a supplier, so every value added here must be handled there too.';

-- Re-sync, so a profile already carrying DESIGNER is mirrored correctly rather than waiting
-- for its next write. Idempotent.
insert into public.user_roles (user_id, role)
select p.id, public.doc_role_from_profile(p.role)
from public.profiles p
where exists (select 1 from auth.users u where u.id = p.id)
on conflict (user_id) do update
  set role = excluded.role,
      updated_at = now();

-- Who may create, upload to, send out and issue a design spec: the design team, and admins.
-- Reads user_roles, never the JWT — profiles.role is writable by its own user, so a role read
-- from a token is a role the caller can grant themselves.
create or replace function public.is_design_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid()
      and r.role in ('admin', 'designer')
  );
$$;

comment on function public.is_design_editor() is
  'True for an admin or a designer. The write gate for every design_spec* table. SECURITY DEFINER because user_roles denies ordinary users all access.';

revoke all on function public.is_design_editor() from public;
grant execute on function public.is_design_editor() to authenticated;

-- ===========================================================================
-- 2. Project visibility for designers — the surgical half
-- ===========================================================================
--
-- SELECT ONLY, and additive: RLS policies are OR-ed, so this grants designers read access to
-- the project list without touching the ADMIN and own-PM policies that already exist and
-- without granting a single write. A designer needs project names on the board and the
-- project behind a spec; they have no business editing one.

drop policy if exists "design_editors_read_projects" on public.projects;
create policy "design_editors_read_projects" on public.projects
  for select to authenticated
  using (public.is_design_editor());

-- ===========================================================================
-- 3. The shared review layer must be visible to designers
-- ===========================================================================
--
-- Migration 162's "Scoped all" policies are can_see_project(project_id), i.e. ADMIN or the
-- project's own PM. Without this, the module that OWNS design specs could not read its own
-- review links or the supplier notes on them.
--
-- The escape is SUBJECT-SCOPED on purpose. `is_design_editor()` is not project-scoped, so a
-- bare `or is_design_editor()` would also expose every project's Instruction Manual review
-- notes to the design team. Restricting it to subject_type = 'design_spec' gives designers
-- exactly their own module and nothing else.

drop policy if exists "Scoped all" on public.review_shares;
create policy "Scoped all" on public.review_shares for all to authenticated
  using (
    public.can_see_project(project_id)
    or (subject_type = 'design_spec' and public.is_design_editor())
  )
  with check (
    public.can_see_project(project_id)
    or (subject_type = 'design_spec' and public.is_design_editor())
  );

drop policy if exists "Scoped all" on public.review_comments;
create policy "Scoped all" on public.review_comments for all to authenticated
  using (
    public.can_see_project(project_id)
    or (subject_type = 'design_spec' and public.is_design_editor())
  )
  with check (
    public.can_see_project(project_id)
    or (subject_type = 'design_spec' and public.is_design_editor())
  );

drop policy if exists "Scoped all" on public.review_replies;
create policy "Scoped all" on public.review_replies for all to authenticated
  using (exists (
    select 1 from public.review_comments c
    where c.id = review_replies.comment_id
      and (
        public.can_see_project(c.project_id)
        or (c.subject_type = 'design_spec' and public.is_design_editor())
      )
  ))
  with check (exists (
    select 1 from public.review_comments c
    where c.id = review_replies.comment_id
      and (
        public.can_see_project(c.project_id)
        or (c.subject_type = 'design_spec' and public.is_design_editor())
      )
  ));

-- ===========================================================================
-- 4. design_specs
-- ===========================================================================

create sequence if not exists public.design_spec_code_seq;

create table if not exists public.design_specs (
  id               uuid        primary key default gen_random_uuid(),
  -- UNIQUE, not indexed: one spec per project is a decision, not a coincidence.
  project_id       uuid        not null unique references public.projects(id) on delete cascade,
  spec_code        text        not null unique
                     default 'DS-' || lpad(nextval('public.design_spec_code_seq')::text, 4, '0'),
  title            text        not null,
  owner_id         uuid        references auth.users(id) on delete set null,
  state            text        not null default 'backlog'
                     check (state in ('backlog', 'active', 'cancelled')),
  final_version_id uuid,
  issued_at        timestamptz,
  issued_by        text,
  cancelled_at     timestamptz,
  cancelled_by     text,
  created_at       timestamptz not null default now(),
  created_by       text,
  updated_at       timestamptz,
  updated_by       text,

  -- Lets the composite FK on design_spec_skus prove a linked SKU shares this spec's project.
  constraint design_specs_id_project_key unique (id, project_id),

  -- An issued spec must say when it was issued. Stated as an implication rather than as an
  -- equivalence because issued_at is cleared on unlock in the same statement as
  -- final_version_id, and a moment where one is set without the other is a spec that claims
  -- to be final with nothing to point at.
  constraint design_specs_issued_stamp check (
    final_version_id is null or issued_at is not null
  ),
  constraint design_specs_cancelled_stamp check (
    (state = 'cancelled') = (cancelled_at is not null)
  )
);

comment on table public.design_specs is
  'One design spec per project. Registry only — the PDF versions live in design_spec_versions and the bytes in the private design-specs bucket. See docs/originflow-design-specs-module.md.';
comment on column public.design_specs.state is
  'Only the two ENDS of the workflow are stored: backlog and cancelled (plus active for everything between). In Progress / In Review / Final are DERIVED — see the module header and src/pages/design/design-spec-status.ts.';
comment on column public.design_specs.final_version_id is
  'The issued final version. Non-null IS the lock: no further versions may be added while it is set. Constrained by a composite FK to be one of THIS spec''s own versions.';
comment on column public.design_specs.spec_code is
  'Human-readable identifier (DS-0001) from design_spec_code_seq, so a spec can be named in an email or on a factory floor.';

create index if not exists design_specs_state_idx on public.design_specs (state);
create index if not exists design_specs_owner_idx on public.design_specs (owner_id);

-- ===========================================================================
-- 5. design_spec_versions
-- ===========================================================================

create table if not exists public.design_spec_versions (
  id           uuid        primary key default gen_random_uuid(),
  spec_id      uuid        not null references public.design_specs(id) on delete cascade,
  version      integer     not null,
  kind         text        not null check (kind in ('draft', 'final')),
  storage_path text        not null,
  stamped_path text,
  page_count   integer,
  byte_size    integer,
  note         text,
  uploaded_at  timestamptz not null default now(),
  uploaded_by  text,

  constraint design_spec_versions_seq unique (spec_id, version),
  -- Referenced by design_specs' composite FK, which is what proves an issued final belongs
  -- to the spec that claims it.
  constraint design_spec_versions_spec_id_key unique (spec_id, id),
  constraint design_spec_versions_version_positive check (version >= 1)
);

comment on table public.design_spec_versions is
  'Every uploaded PDF, never overwritten. A review note pins to the version it was written against (review_shares.subject_version), so notes made on v1 still read as v1 after v2 lands.';
comment on column public.design_spec_versions.storage_path is
  'The design team''s original bytes in the private design-specs bucket. NEVER mutated — the DRAFT stamp is written to a separate object so the original is always recoverable.';
comment on column public.design_spec_versions.stamped_path is
  'The DRAFT-stamped copy served to reviewers. NULL on a final version, which is served byte-for-byte as the design team made it.';

create index if not exists design_spec_versions_spec_idx
  on public.design_spec_versions (spec_id, version desc);

-- The lock, and the "one of its own versions" guarantee. MATCH SIMPLE means the constraint
-- is satisfied whenever final_version_id is null, which is exactly the unissued case.
alter table public.design_specs
  drop constraint if exists design_specs_final_version_fk;
alter table public.design_specs
  add constraint design_specs_final_version_fk
  foreign key (id, final_version_id)
  references public.design_spec_versions (spec_id, id)
  on delete restrict;

-- ===========================================================================
-- 6. The two rules that cannot be declarative
-- ===========================================================================

-- (a) Nothing may be added to a spec that is issued or cancelled. The lock has to mean
--     something; without this, "Final" is a label rather than a state.
create or replace function public.design_spec_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v public.design_specs%rowtype;
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

  -- Version numbering server-side, so two uploads cannot both decide they are v3. The
  -- unique(spec_id, version) constraint is the backstop if they race.
  if new.version is null then
    select coalesce(max(x.version), 0) + 1 into new.version
    from public.design_spec_versions x where x.spec_id = new.spec_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_design_spec_versions_guard on public.design_spec_versions;
create trigger trg_design_spec_versions_guard
  before insert on public.design_spec_versions
  for each row execute function public.design_spec_versions_guard();

-- (b) An issued final must actually be a final. The composite FK proves the version belongs
--     to this spec; only a trigger can read the referenced row's `kind`.
create or replace function public.design_specs_final_is_final()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_kind text;
begin
  if new.final_version_id is null then
    return new;
  end if;
  select kind into v_kind
  from public.design_spec_versions
  where id = new.final_version_id;

  if v_kind is distinct from 'final' then
    raise exception 'Version % is a % — only a version uploaded as the final may be issued.',
      new.final_version_id, coalesce(v_kind, 'missing version');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_design_specs_final_is_final on public.design_specs;
create trigger trg_design_specs_final_is_final
  before insert or update of final_version_id on public.design_specs
  for each row execute function public.design_specs_final_is_final();

-- ===========================================================================
-- 7. design_spec_skus
-- ===========================================================================
--
-- Which SKUs of the project this spec governs. `project_id` is carried NOT for convenience
-- but to make the cross-project guard declarative: the two composite FKs below make it
-- impossible to link a SKU from a different project than the spec's, which no single-column
-- FK pair could express.

create unique index if not exists project_skus_project_id_key
  on public.project_skus (project_id, id);

create table if not exists public.design_spec_skus (
  spec_id    uuid not null,
  sku_id     uuid not null,
  project_id uuid not null,

  primary key (spec_id, sku_id),

  constraint design_spec_skus_spec_fk
    foreign key (spec_id, project_id) references public.design_specs (id, project_id)
    on delete cascade,
  constraint design_spec_skus_sku_fk
    foreign key (project_id, sku_id) references public.project_skus (project_id, id)
    on delete cascade
);

comment on table public.design_spec_skus is
  'SKUs a design spec covers. The two composite FKs make a cross-project link impossible: the SKU and the spec must agree on project_id.';

create index if not exists design_spec_skus_sku_idx on public.design_spec_skus (sku_id);

-- ===========================================================================
-- 8. RLS
-- ===========================================================================
--
-- Read for anyone who can see the project, plus every design editor (a central design team
-- works across projects). Write for design editors only — which makes PMs read-only, as
-- decided. Suppliers reach a spec through a portal token and a Netlify Function, never
-- through PostgREST, so there is no anon policy anywhere here.

alter table public.design_specs         enable row level security;
alter table public.design_spec_versions enable row level security;
alter table public.design_spec_skus     enable row level security;

drop policy if exists "design_specs_read"  on public.design_specs;
create policy "design_specs_read" on public.design_specs
  for select to authenticated
  using (public.can_see_project(project_id) or public.is_design_editor());

drop policy if exists "design_specs_write" on public.design_specs;
create policy "design_specs_write" on public.design_specs
  for all to authenticated
  using (public.is_design_editor())
  with check (public.is_design_editor());

drop policy if exists "design_spec_versions_read" on public.design_spec_versions;
create policy "design_spec_versions_read" on public.design_spec_versions
  for select to authenticated
  using (exists (
    select 1 from public.design_specs s
    where s.id = design_spec_versions.spec_id
      and (public.can_see_project(s.project_id) or public.is_design_editor())
  ));

drop policy if exists "design_spec_versions_write" on public.design_spec_versions;
create policy "design_spec_versions_write" on public.design_spec_versions
  for all to authenticated
  using (public.is_design_editor())
  with check (public.is_design_editor());

drop policy if exists "design_spec_skus_read" on public.design_spec_skus;
create policy "design_spec_skus_read" on public.design_spec_skus
  for select to authenticated
  using (public.can_see_project(project_id) or public.is_design_editor());

drop policy if exists "design_spec_skus_write" on public.design_spec_skus;
create policy "design_spec_skus_write" on public.design_spec_skus
  for all to authenticated
  using (public.is_design_editor())
  with check (public.is_design_editor());

-- Blanket table grants with RLS as the boundary, matching every other table in this schema.
grant select, insert, update, delete on public.design_specs         to authenticated;
grant select, insert, update, delete on public.design_spec_versions to authenticated;
grant select, insert, update, delete on public.design_spec_skus     to authenticated;
grant usage on sequence public.design_spec_code_seq to authenticated;

-- Nothing here is reachable by anon. Revoked explicitly rather than left to the absence of a
-- policy, so a future "enable read for all" default cannot open it by accident.
revoke all on public.design_specs         from anon;
revoke all on public.design_spec_versions from anon;
revoke all on public.design_spec_skus     from anon;

-- ===========================================================================
-- 9. Storage
-- ===========================================================================
--
-- PRIVATE, and with no storage policies at all: every read is a short-lived signed URL minted
-- by netlify/functions/design-spec-file.ts after it has validated a review token or a session,
-- which is what makes revoking a link genuinely revoke the PDF. Same shape as sop-documents
-- (migration 159). A public bucket was considered and declined: its URL keeps working forever
-- once seen, so a revoked review link would still serve the draft.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-specs', 'design-specs', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = 52428800,
      allowed_mime_types = array['application/pdf'];

notify pgrst, 'reload schema';

-- ===========================================================================
-- Verification (run after applying)
-- ===========================================================================
--
-- 1. The role vocabulary accepts designer and the mapper knows it:
--      select public.doc_role_from_profile('DESIGNER');            -- 'designer'
--      select pg_get_constraintdef(oid) from pg_constraint
--       where conname = 'user_roles_role_check';                   -- includes 'designer'
--
-- 2. A designer can see projects and their own review rounds, and NOT the IM's:
--      select policyname from pg_policies
--       where tablename = 'projects' and policyname = 'design_editors_read_projects';
--      select qual from pg_policies
--       where tablename = 'review_comments';                       -- has the design_spec escape
--
-- 3. The cross-row guards actually refuse:
--      -- linking a SKU from another project must raise (design_spec_skus_sku_fk)
--      -- issuing a draft as the final must raise (design_specs_final_is_final)
--      -- adding a version to an issued spec must raise (design_spec_versions_guard)
--
-- 4. The bucket is private:
--      select id, public, allowed_mime_types from storage.buckets where id = 'design-specs';
