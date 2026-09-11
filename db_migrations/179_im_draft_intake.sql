-- 179: Supplier IM draft intake — the three steps before a writer starts.
--
-- WHAT THIS IS. The supplier writes the first draft of an instruction manual. Quality knows
-- what is wrong with it. Neither fact reached OriginFlow: the PDF travelled by email, the
-- notes travelled by email, and the Technical Writer started from nothing with no brief.
--
--   Supplier Draft Upload -> Draft Review -> Draft Ready -> Backlog -> In Progress -> ...
--      (supplier uploads)    (QM marks up)    (approved)    <-- today's board, unchanged
--
-- The supplier uploads from the portal they already have (projects.supplier_link_token).
-- That mints a review link for Quality on the SHARED review layer from migration 162. QM
-- pins comments onto the pages and submits. The project then reads Draft Ready and the
-- writer opens the PDF plus those notes as their brief.
--
-- THE DRAFT NEVER BLOCKS AUTHORING, and that decision is what makes the rest of this safe.
-- A writer may start any project at any time. So the three new steps only ever describe a
-- project with NO MANUAL YET: the moment a project_ims row exists, manualStatusOf takes over
-- and the card moves to In Progress exactly as before. The new steps are therefore
-- refinements of the synthesised Backlog (src/pages/im/im-manual-status.ts — manualStatusOf
-- has never returned 'backlog'; the dashboard synthesises those cards from
-- getBacklogProjects). Nothing in the existing seven-step vocabulary changes meaning.
--
-- WHY THERE IS A REQUEST TABLE AND NOT JUST AN UPLOAD TABLE. A project enters Supplier Draft
-- Upload only if a draft was actually REQUESTED. Without that, every in-house product, every
-- draft that arrives by email and every legacy project would sit forever in a column
-- asserting "waiting on the supplier" — a state nothing could clear, because the upload that
-- would clear it is never coming. No request and no upload means plain Backlog, as today.
-- The request row is also the thing the supplier sees in their portal.
--
-- NO STATUS COLUMN ANYWHERE. Same discipline as design_specs.state and im-manual-status.ts:
-- every step is derived from facts that already had to be true, so a step can never disagree
-- with the files behind it and nobody can drag a card into a state the data does not support.
--
--   no live request, no upload                            -> backlog
--   live request, no upload                               -> draft_requested  (Supplier Draft Upload)
--   upload exists, its review_shares row not submitted    -> draft_qm_review  (Draft Review)
--   review_shares row for the latest upload is submitted  -> draft_ready      (Draft Ready)
--
-- THE REVIEW LAYER IS NOT TOUCHED. Migration 162 generalised im_shares/im_review_comments
-- onto subject_type + subject_id precisely so a third document kind could plug in, and
-- subject_type carries NO check constraint — 'im_draft' is a TypeScript change, not a schema
-- change. Verified against the live database before writing this file:
--   * review_resolve / review_add_comment / review_submit are subject-agnostic SQL. No new
--     anon RPC is needed for the markup portal.
--   * review_comments already carries the PDF pin anchor (page + anchor_x/y/w/h as 0-1 page
--     fractions) and review_comments_one_anchor already enforces section-XOR-page.
--   * review_shares_internal_stage_guard early-returns unless subject_type = 'design_spec',
--     so an im_draft share cannot trip it.
-- The "Scoped all" policies on review_shares/review_comments/review_replies are LEFT ALONE.
-- They are can_see_project(project_id) OR the design-spec escape; an im_draft subject falls
-- under the can_see_project half unchanged. Widening can_see_project stays ruled out — 16
-- policies across 7 tables call it, all FOR ALL, so widening it would hand out write access
-- to seven tables of project data as a side effect.

-- ===========================================================================
-- 1. im_draft_requests — the slot
-- ===========================================================================
--
-- UNIQUE on (project_id, template_type), not merely indexed: a project has at most one open
-- draft slot per document kind, and the constraint records that decision rather than leaving
-- it to convention. Re-requesting after a cancel reuses the row (clear cancelled_at).

create table if not exists public.im_draft_requests (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  template_type  text not null default 'im'
                   check (template_type in ('im', 'warning_leaflet')),
  requested_at   timestamptz not null default now(),
  requested_by   text,
  due_date       date,
  note           text,
  cancelled_at   timestamptz,
  unique (project_id, template_type)
);

create index if not exists im_draft_requests_project_idx
  on public.im_draft_requests (project_id);

comment on table public.im_draft_requests is
  'One open IM draft slot per project and document kind. Its EXISTENCE is what puts a project in the Supplier Draft Upload step; without it a project with no draft would park there forever.';
comment on column public.im_draft_requests.cancelled_at is
  'Set when the draft is no longer wanted. A cancelled request reads as no request at all, so the project falls back to plain Backlog and the writer is never blocked.';

-- ===========================================================================
-- 2. im_draft_uploads — every uploaded PDF, never overwritten
-- ===========================================================================
--
-- Versioned like design_spec_versions: a QM note pins to the version it was written against
-- (review_shares.subject_version), so v1 notes still read as v1 after v2 lands.
--
-- `source` exists now so that QM uploading a draft herself, or an internal PM doing it, is a
-- new credential branch in the Netlify function rather than a schema change later.

create table if not exists public.im_draft_uploads (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references public.im_draft_requests(id) on delete cascade,
  version           int  not null,
  source            text not null check (source in ('supplier', 'quality', 'internal')),
  storage_path      text not null,
  original_filename text,
  page_count        int,
  byte_size         int,
  uploaded_by_name  text not null,
  uploaded_at       timestamptz not null default now(),
  withdrawn_at      timestamptz,
  unique (request_id, version)
);

create index if not exists im_draft_uploads_request_idx
  on public.im_draft_uploads (request_id, version desc);

comment on table public.im_draft_uploads is
  'Every uploaded draft PDF, never overwritten. A QM note pins to the version it was written against (review_shares.subject_version), so v1 notes still read as v1 after v2 lands.';
comment on column public.im_draft_uploads.uploaded_by_name is
  'Typed by hand. Neither portal has an account behind it, so there is no auth.uid() to record.';

-- Version numbering server-side, so two uploads cannot both decide they are v3. The
-- unique(request_id, version) constraint is the backstop if they race. Same shape as
-- design_spec_versions_guard.
create or replace function public.im_draft_uploads_assign_version()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if not exists (select 1 from public.im_draft_requests r where r.id = new.request_id) then
    raise exception 'No such IM draft request.';
  end if;

  if new.version is null then
    select coalesce(max(x.version), 0) + 1 into new.version
    from public.im_draft_uploads x where x.request_id = new.request_id;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_im_draft_uploads_assign_version on public.im_draft_uploads;
create trigger trg_im_draft_uploads_assign_version
  before insert on public.im_draft_uploads
  for each row execute function public.im_draft_uploads_assign_version();

-- ===========================================================================
-- 3. im_draft_portal_config — the shared QM access code
-- ===========================================================================
--
-- Quality does not work in OriginFlow and will not log in for this, so the QM queue is a
-- fixed bookmarkable link behind one shared code — the /compliance/supplier-portal pattern.
--
-- The code is stored as a pgcrypto HASH, never plaintext: this table is readable by the
-- service role, and the service role is reachable from every Netlify function, so a
-- plaintext code would be one logging mistake away from being leaked.
--
-- Single row, enforced by a constant primary key rather than by convention.
--
-- Brute-force throttling reuses doc_rate_limit_hit(key, limit, window_s) from migration 159.
-- Despite the name it is a generic keyed counter with nothing document-specific in it, and a
-- second copy of the same five lines would be worse than borrowing this one.

create table if not exists public.im_draft_portal_config (
  id          boolean primary key default true check (id),
  code_hash   text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

comment on table public.im_draft_portal_config is
  'Single row. The shared access code for the QM draft queue, stored as a pgcrypto hash — never plaintext. Verified only inside netlify/functions/im-draft-portal.ts; there is deliberately no RPC that checks it, so PostgREST offers no second door.';

-- ===========================================================================
-- 4. RLS
-- ===========================================================================
--
-- Blanket table grants with RLS as the boundary, matching every other table in this schema.
-- Reads are can_see_project — ADMIN, or the project's own PM.
--
-- NEITHER PORTAL TOUCHES THESE TABLES. The supplier and the QM queue both go through
-- netlify/functions/im-draft-portal.ts with the service role, which is why there is no anon
-- policy here and why the anon grants below are revoked explicitly.

alter table public.im_draft_requests      enable row level security;
alter table public.im_draft_uploads       enable row level security;
alter table public.im_draft_portal_config enable row level security;

drop policy if exists "Scoped all" on public.im_draft_requests;
create policy "Scoped all" on public.im_draft_requests for all to authenticated
  using      (public.can_see_project(project_id))
  with check (public.can_see_project(project_id));

drop policy if exists "Scoped all" on public.im_draft_uploads;
create policy "Scoped all" on public.im_draft_uploads for all to authenticated
  using (exists (
    select 1 from public.im_draft_requests r
    where r.id = im_draft_uploads.request_id and public.can_see_project(r.project_id)
  ))
  with check (exists (
    select 1 from public.im_draft_requests r
    where r.id = im_draft_uploads.request_id and public.can_see_project(r.project_id)
  ));

-- No policy at all on the config table: default-deny. Only the service role reads it.

grant select, insert, update, delete on public.im_draft_requests to authenticated;
grant select, insert, update, delete on public.im_draft_uploads  to authenticated;

-- Supabase default privileges grant anon ALL on every new table in public. RLS would still
-- refuse these reads, but a missing policy plus a live grant is one careless "for all to
-- public" away from an open table, and the Roadmap Creator port (migration 167) hit exactly
-- this. Revoke explicitly rather than relying on RLS alone.
revoke all on public.im_draft_requests      from anon;
revoke all on public.im_draft_uploads       from anon;
revoke all on public.im_draft_portal_config from anon;
revoke all on public.im_draft_portal_config from authenticated;

-- ===========================================================================
-- 4b. The access code: one function to check it, one to set it
-- ===========================================================================
--
-- pgcrypto lives in the `extensions` schema on Supabase, NOT public, so crypt/gen_salt are
-- fully qualified and search_path stays empty — the house rule for every SECURITY DEFINER
-- function here. An unqualified crypt() fails at CREATE time on this project; that is not a
-- runtime surprise waiting to happen, it simply will not deploy.
--
-- crypt(candidate, stored_hash) re-hashes the candidate using the stored hash as its salt,
-- so the comparison happens in Postgres and the plaintext never has to be held or logged.

create or replace function public.im_draft_check_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.im_draft_portal_config c
    where c.code_hash = extensions.crypt(p_code, c.code_hash)
  );
$fn$;

-- Callable ONLY by the service role, i.e. only from netlify/functions/im-draft-portal.ts.
-- This is what makes "the fixed QM link has exactly one door" true rather than aspirational:
-- PostgREST with the anon key cannot reach this function, so the only way to test a code is
-- through the function, which rate-limits per IP before it asks.
revoke all on function public.im_draft_check_code(text) from public, anon, authenticated;
grant execute on function public.im_draft_check_code(text) to service_role;

create or replace function public.im_draft_set_code(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and upper(p.role) = 'ADMIN'
  ) then
    raise exception 'Only an administrator can change the quality draft access code.';
  end if;

  if p_code is null or length(btrim(p_code)) < 8 then
    raise exception 'The access code must be at least 8 characters.';
  end if;

  insert into public.im_draft_portal_config (id, code_hash, updated_at, updated_by)
  values (true, extensions.crypt(btrim(p_code), extensions.gen_salt('bf')), now(), auth.uid()::text)
  on conflict (id) do update
    set code_hash  = excluded.code_hash,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$fn$;

revoke all on function public.im_draft_set_code(text) from public, anon;
grant execute on function public.im_draft_set_code(text) to authenticated;

-- NOTE: this migration seeds NO code. im_draft_portal_config starts empty, which means
-- im_draft_check_code returns false for every input and the QM queue is closed until an
-- administrator sets one. That is the intended default — a shipped default code is a
-- published code.

-- ===========================================================================
-- 5. Storage
-- ===========================================================================
--
-- Private, PDF-only, ZERO storage policies — service role only, the same shape as
-- design-specs and sop-documents. A public bucket would make the object URL the real access
-- control, and a URL cannot be revoked once seen, so a revoked review link would still serve
-- the draft. Every read is a short-TTL signed URL minted after the entitlement check.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('im-drafts', 'im-drafts', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = 52428800,
      allowed_mime_types = array['application/pdf'];

notify pgrst, 'reload schema';

-- ===========================================================================
-- Verification (run after applying)
-- ===========================================================================
--
-- 1. The three tables exist with their constraints:
--      select conrelid::regclass::text, conname, pg_get_constraintdef(oid)
--      from pg_constraint
--      where conrelid::regclass::text like 'im_draft%' order by 1, 2;
--
-- 2. anon holds NO grant on any of them (expect zero rows):
--      select table_name, privilege_type from information_schema.role_table_grants
--      where grantee = 'anon' and table_name like 'im_draft%';
--
-- 3. The review layer is unchanged — still exactly the design-spec escape, no im_draft
--    clause (expect the two 'Scoped all' policies verbatim as migration 163 left them):
--      select tablename, policyname, qual from pg_policies
--      where tablename in ('review_shares', 'review_comments');
--
-- 4. The bucket is private and PDF-only:
--      select id, public, file_size_limit, allowed_mime_types
--      from storage.buckets where id = 'im-drafts';
--
-- 5. Version numbering is server-side. Insert two uploads against one request with a NULL
--    version and confirm they come out 1 and 2.
