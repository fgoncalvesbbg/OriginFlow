-- 159: SOP & Documents — a registry for internal SOPs and supplier-facing specs.
--
-- WHAT THIS MODULE IS: a registry and a distributor. The editable source of every
-- document stays in SharePoint; OriginFlow records that a version exists, stores an
-- IMMUTABLE copy of the released PDF, and decides who may download it. It is not an
-- authoring tool — there is no in-app editing, no redlines, no approval routing and no
-- version diffing here, deliberately.
--
-- THE SECURITY SHAPE, AND WHY IT DIFFERS FROM EVERY OTHER TABLE IN THIS DATABASE
-- ------------------------------------------------------------------------------
-- Everywhere else in OriginFlow the browser talks to PostgREST directly and RLS is the
-- authorization boundary (see 81, 144). That model leaks here for two reasons:
--
--   1. doc_versions.sharepoint_link points at a live, editable, INTERNAL file. RLS can
--      restrict rows; it cannot restrict COLUMNS on a row a caller is otherwise allowed
--      to see. A supplier who may read a final supplier-facing version must not learn
--      that link, and `select *` from a browser would hand it over.
--   2. Suppliers in OriginFlow are not authenticated users. They are `anon` holding a
--      portal token (projects.supplier_link_token, or suppliers.portal_token +
--      access_code). A policy can only see that such a caller is `anon`, so any policy
--      permissive enough to serve a supplier is permissive enough to serve the whole
--      internet — the anon key is public (netlify.toml SECRETS_SCAN_OMIT_KEYS).
--
-- So doc_* is SERVER-ONLY. Every read and every write goes through a Netlify Function
-- (netlify/functions/doc-*.ts) that authenticates the caller, runs an explicit
-- entitlement check and returns a whitelisted DTO. RLS below is a BACKSTOP, not the
-- boundary: RLS is enabled on every table with NO policies at all, and the PostgREST
-- grants are revoked from anon and authenticated on top. Default deny, twice over. If
-- someone points the browser client at doc_versions tomorrow, they get nothing.
--
-- The one thing that is NOT belt-and-braces: service_role bypasses both. That key lives
-- only in the Netlify server environment and must never be VITE_-prefixed.

-- ===========================================================================
-- user_roles — the authoritative role table for this module
-- ===========================================================================
--
-- Roles must never be read from the JWT: user_metadata / raw_user_meta_data are writable
-- by the user themselves through supabase.auth.updateUser(), so a role read from there is
-- a role the caller can grant themselves. This table is the source of truth the doc_*
-- routes consult, and it is writable ONLY by service_role.
--
-- WHY A SEPARATE TABLE WHEN public.profiles.role ALREADY EXISTS: profiles carries an
-- "Update own profile" policy (auth.uid() = id), i.e. every user may write their own
-- row — including role. That is tolerable for the ~30 existing policies only because
-- they are what they are; it is not a foundation to build a new document-access system
-- on. user_roles has no UPDATE path reachable from a browser at all.
--
-- Drift between the two is prevented by the trigger below rather than by discipline:
-- an admin changing someone's role in the Admin Panel writes profiles, and the trigger
-- mirrors it here. profiles stays the UI's source of truth; user_roles stays the
-- security decision's source of truth, and they cannot disagree.

create table if not exists public.user_roles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null,
  updated_at timestamptz not null default now(),

  constraint user_roles_role_check check (role in ('admin', 'internal', 'supplier'))
);

comment on table public.user_roles is
  'Authoritative role for the SOP & Documents module. Writable ONLY by service_role — never read a role from JWT user_metadata. Mirrored from public.profiles.role by trg_profiles_sync_user_roles.';

-- profiles.role uses OriginFlow's vocabulary (ADMIN / PM / SUPPLIER); this table uses the
-- module's (admin / internal / supplier). One function owns the mapping so it cannot be
-- spelled two ways.
create or replace function public.doc_role_from_profile(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(coalesce(p_role, ''))
           when 'ADMIN'    then 'admin'
           when 'SUPPLIER' then 'supplier'
           else 'internal'          -- PM, and anything unrecognised, is an internal user
         end;
$$;

comment on function public.doc_role_from_profile(text) is
  'Maps public.profiles.role (ADMIN/PM/SUPPLIER) onto a user_roles.role value (admin/internal/supplier). Unrecognised values fall back to the least-privileged internal role.';

-- Seed from the existing profiles. Idempotent: re-running re-syncs rather than erroring.
insert into public.user_roles (user_id, role)
select p.id, public.doc_role_from_profile(p.role)
from public.profiles p
where exists (select 1 from auth.users u where u.id = p.id)
on conflict (user_id) do update
  set role = excluded.role,
      updated_at = now();

-- Keep it in sync. SECURITY DEFINER because the trigger fires inside a profiles write
-- made by an ordinary authenticated user, and user_roles denies that user everything —
-- an INVOKER trigger would abort the profile update. search_path is pinned to '' per
-- this module's rule, so every reference below is schema-qualified.
create or replace function public.profiles_sync_user_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.user_roles where user_id = old.id;
    return old;
  end if;

  insert into public.user_roles (user_id, role, updated_at)
  values (new.id, public.doc_role_from_profile(new.role), now())
  on conflict (user_id) do update
    set role = excluded.role,
        updated_at = now();
  return new;
end;
$$;

revoke execute on function public.profiles_sync_user_roles() from public, anon, authenticated;

drop trigger if exists trg_profiles_sync_user_roles on public.profiles;
create trigger trg_profiles_sync_user_roles
  after insert or update of role or delete on public.profiles
  for each row
  execute function public.profiles_sync_user_roles();

-- ===========================================================================
-- doc_documents — the registry entry. One row per document, not per version.
-- ===========================================================================

create table if not exists public.doc_documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,

  -- What kind of thing this is. Constrained rather than free text because the admin
  -- list filters on it and a typo would silently create a category of one.
  doc_type      text not null,

  -- WHO IT IS FOR, and the single most load-bearing column in the module. 'internal'
  -- means no supplier may ever see any version of it, final or not, bound or not.
  audience      text not null,

  owner_user_id uuid not null,
  tags          text[] not null default '{}'::text[],
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint doc_documents_doc_type_check
    check (doc_type in ('sop', 'guideline', 'spec', 'template', 'form', 'checklist')),
  constraint doc_documents_audience_check
    check (audience in ('internal', 'supplier')),
  constraint doc_documents_title_check
    check (length(btrim(title)) > 0)
);

comment on table public.doc_documents is
  'A registered document. Editable source lives in SharePoint; this row plus doc_versions is the registry. Server-only: see the header of migration 159.';
comment on column public.doc_documents.audience is
  'internal | supplier. A supplier can never see any version of an internal document, regardless of bindings or is_final.';

-- The admin list is "filter by type, by audience, by tag", so those three carry the
-- read pattern. tags is an array, so it needs GIN rather than btree.
create index if not exists doc_documents_doc_type_idx  on public.doc_documents (doc_type);
create index if not exists doc_documents_audience_idx  on public.doc_documents (audience);
create index if not exists doc_documents_tags_idx      on public.doc_documents using gin (tags);
create index if not exists doc_documents_owner_idx     on public.doc_documents (owner_user_id);

-- ===========================================================================
-- doc_versions — one registered version of a document
-- ===========================================================================

create table if not exists public.doc_versions (
  id                uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT, not CASCADE. A released PDF that suppliers have downloaded is a
  -- record of what they were told; deleting the parent must not silently take the
  -- evidence with it. Retire the document instead of deleting it.
  document_id       uuid not null references public.doc_documents(id) on delete restrict,

  -- Free text on purpose: teams label versions "v4", "2026-03", "Rev C". Imposing a
  -- scheme here would just push people into the title.
  label             text not null,

  is_final          boolean not null default false,
  finalized_by      uuid,
  finalized_at      timestamptz,

  -- THE EDITABLE ORIGINAL. Internal only, always — every supplier-facing DTO whitelists
  -- its fields and this one is not on any of those lists. Handing a supplier this link
  -- would hand them the live file, not the release.
  sharepoint_link   text,

  -- The immutable released copy, in the private sop-documents bucket. Always
  -- docs/{document_id}/{version_id}/{random uuid}.pdf — never derived from the title or
  -- the label, so an object key can neither be guessed from the registry listing nor
  -- collide when two versions share a label.
  pdf_storage_path  text,
  pdf_sha256        text,
  pdf_bytes         bigint,

  -- Set on the version being REPLACED, pointing at the one that replaced it. Written by
  -- doc_finalize_version in the same transaction that moves the final flag.
  superseded_by     uuid references public.doc_versions(id),

  uploaded_by       uuid not null,
  created_at        timestamptz not null default now(),

  constraint doc_versions_label_check
    check (length(btrim(label)) > 0),

  -- A version cannot be final without the released PDF it is the release OF, nor without
  -- the record of who released it. This is what makes is_final mean something a download
  -- route can rely on rather than a flag somebody ticked early.
  constraint doc_versions_final_requires_pdf
    check (not is_final or (pdf_storage_path is not null and finalized_by is not null and finalized_at is not null)),

  constraint doc_versions_not_self_superseded
    check (superseded_by is null or superseded_by <> id)
);

comment on table public.doc_versions is
  'One registered version. sharepoint_link is the live editable original and is INTERNAL ONLY — it must never appear in a supplier-facing response.';
comment on column public.doc_versions.pdf_storage_path is
  'Key in the private sop-documents bucket, always docs/{document_id}/{version_id}/{uuid}.pdf. Never derived from user-supplied text.';
comment on column public.doc_versions.superseded_by is
  'On the version that was replaced, the version that replaced it. Written by doc_finalize_version.';

-- EXACTLY ONE FINAL PER DOCUMENT, enforced by the database rather than by the code path
-- that happens to write it. Everything downstream — the supplier's list, the stable
-- "latest template" redirect — is defined in terms of "the final version", and that
-- phrase is only meaningful because this index exists.
create unique index if not exists doc_versions_one_final_per_document
  on public.doc_versions (document_id) where is_final;

create index if not exists doc_versions_document_id_idx on public.doc_versions (document_id, created_at desc);

-- ===========================================================================
-- doc_version_events — append-only finalisation history
-- ===========================================================================
--
-- Un-finalising CLEARS finalized_by/finalized_at on the row (the check constraint above
-- would otherwise let a stale actor sit on a non-final version and read as current).
-- That history is not lost, it moves here — this table, not the version row, is the
-- record of who released what and when.

create table if not exists public.doc_version_events (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.doc_versions(id) on delete restrict,
  event          text not null,
  actor_user_id  uuid,
  at             timestamptz not null default now(),
  note           text,

  constraint doc_version_events_event_check
    check (event in ('finalized', 'unfinalized'))
);

comment on table public.doc_version_events is
  'Append-only. The record of who finalised or un-finalised a version and when; doc_versions.finalized_by/at only describe the CURRENT state.';

create index if not exists doc_version_events_version_id_idx on public.doc_version_events (version_id, at desc);

-- ===========================================================================
-- doc_bindings — which documents apply to which project
-- ===========================================================================
--
-- Deliberately NOT versioned. A binding attaches a DOCUMENT to a project; which version
-- the supplier then sees is always "the current final one". Auto-rebinding a project
-- when a new version lands is explicitly out of scope precisely because there is nothing
-- to rebind: the binding already follows the final.

create table if not exists public.doc_bindings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.doc_documents(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),

  constraint doc_bindings_project_document_key unique (project_id, document_id)
);

comment on table public.doc_bindings is
  'Attaches a document to a project. The supplier on that project then sees the document''s CURRENT final version, if the document is supplier-facing.';

create index if not exists doc_bindings_document_id_idx on public.doc_bindings (document_id);

-- ===========================================================================
-- doc_access_log — who downloaded what
-- ===========================================================================
--
-- version_id has NO ON DELETE action (i.e. NO ACTION): a version that has been
-- downloaded cannot be deleted out from under its own audit trail.
--
-- Two actor columns because there are two kinds of caller and they are not the same kind
-- of thing: user_id is an authenticated internal user; supplier_id is a supplier reached
-- through a portal token, which has no auth.users row at all.

create table if not exists public.doc_access_log (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.doc_versions(id),
  user_id     uuid,
  supplier_id uuid references public.suppliers(id) on delete set null,
  at          timestamptz not null default now(),
  ip          text,

  constraint doc_access_log_actor_check
    check (user_id is not null or supplier_id is not null)
);

comment on table public.doc_access_log is
  'One row per served download. user_id = internal user; supplier_id = supplier reached via a portal token. At least one is always set.';

create index if not exists doc_access_log_version_id_idx on public.doc_access_log (version_id, at desc);
create index if not exists doc_access_log_at_idx         on public.doc_access_log (at desc);

-- ===========================================================================
-- doc_download_tickets — how a BROWSER performs an authenticated download
-- ===========================================================================
--
-- The download route is a 302 to a signed URL, and the friendly filename only actually
-- reaches the user if the browser NAVIGATES to it (a Content-Disposition on a redirect is
-- ignored; the header that counts is the one Storage emits on the response carrying the
-- bytes). A top-level navigation cannot carry an Authorization or x-portal-token header.
--
-- And `fetch()`-ing it instead does not work either: following a cross-origin redirect
-- with a non-safelisted request header is not something a CORS-mode fetch can do, so the
-- leg from our origin to Storage fails.
--
-- So the credential moves into the URL — but only as a ticket that is worth nothing the
-- moment it is used:
--   * 32 bytes of randomness, so it cannot be guessed;
--   * single-use, claimed atomically by doc_claim_download_ticket;
--   * 60 seconds;
--   * bound to ONE version and ONE actor.
--
-- Critically, the ticket only says WHO is asking. The download route re-runs the full
-- entitlement check against the live registry before it signs anything, so a version
-- un-finalised in the seconds after a ticket was minted is refused with the ticket in
-- hand. The ticket is authentication; authorization is never delegated to it.

create table if not exists public.doc_download_tickets (
  token       text primary key,
  version_id  uuid not null references public.doc_versions(id) on delete cascade,
  user_id     uuid,
  supplier_id uuid references public.suppliers(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),

  constraint doc_download_tickets_actor_check
    check (user_id is not null or supplier_id is not null),
  constraint doc_download_tickets_token_check
    check (length(token) between 32 and 128)
);

comment on table public.doc_download_tickets is
  'Single-use, 60-second, one-version, one-actor tickets that let a browser NAVIGATE to the download route. Authentication only — the route re-checks entitlement on every use.';

create index if not exists doc_download_tickets_expires_idx on public.doc_download_tickets (expires_at);

-- Claim a ticket: returns it exactly once, and only while it is unused and unexpired.
-- Written as a single UPDATE ... RETURNING so two simultaneous uses cannot both succeed —
-- the second one matches no row because the first already stamped used_at.
create or replace function public.doc_claim_download_ticket(p_token text)
returns public.doc_download_tickets
language plpgsql
set search_path = ''
as $$
declare
  v_row public.doc_download_tickets;
begin
  update public.doc_download_tickets
     set used_at = now()
   where token = p_token
     and used_at is null
     and expires_at > now()
  returning * into v_row;

  -- Opportunistic cleanup, on the cheapest possible schedule: whoever uses a ticket pays
  -- for sweeping the dead ones. No cron job to forget about.
  delete from public.doc_download_tickets
   where expires_at < now() - interval '1 hour';

  return v_row;
end;
$$;

comment on function public.doc_claim_download_ticket(text) is
  'Atomically consumes a download ticket, returning it only if unused and unexpired. Service-role only.';

-- ===========================================================================
-- doc_rate_limits — cross-instance rate limiting for the download and list routes
-- ===========================================================================
--
-- Netlify Functions are stateless and horizontally scaled, so an in-memory counter in the
-- handler limits one warm container and nothing else — which is to say it does not limit
-- an attacker, who gets a fresh container as easily as a fresh request. The counter has
-- to live somewhere shared, and the database is the only shared thing these functions
-- have.

create table if not exists public.doc_rate_limits (
  bucket_key   text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);

comment on table public.doc_rate_limits is
  'Fixed-window rate-limit counters for the doc_* routes. Keyed by route + caller identity. See public.doc_rate_limit_hit.';

-- Returns TRUE when the call is allowed, FALSE when the window is exhausted.
-- One statement, so two concurrent callers cannot both read 9 and both write 10.
create or replace function public.doc_rate_limit_hit(
  p_key      text,
  p_limit    integer,
  p_window_s integer
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_hits integer;
begin
  insert into public.doc_rate_limits as r (bucket_key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update
    -- Window expired: reset. Otherwise: increment.
    set window_start = case when r.window_start < now() - make_interval(secs => p_window_s)
                            then now() else r.window_start end,
        hits         = case when r.window_start < now() - make_interval(secs => p_window_s)
                            then 1 else r.hits + 1 end
  returning r.hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

comment on function public.doc_rate_limit_hit(text, integer, integer) is
  'Fixed-window rate limiter. Returns true when the call is within p_limit hits per p_window_s seconds for p_key. Not SECURITY DEFINER — only service_role may execute it.';

-- ===========================================================================
-- doc_finalize_version / doc_unfinalize_version
-- ===========================================================================
--
-- Finalising is three writes that must all land or none of them: flip the new version to
-- final, un-final the previous one and point its superseded_by at the new one, and record
-- the event. A function makes that one statement from the handler's point of view, so
-- there is no window in which a crashed Lambda leaves a final with no history.
--
-- Deliberately NOT security definer. service_role already bypasses RLS, and these are
-- revoked from every other role — a DEFINER function here would only add a way for a
-- future permissive grant to become privilege escalation. search_path is pinned to ''
-- regardless, so every reference below is schema-qualified.

create or replace function public.doc_finalize_version(
  p_version_id uuid,
  p_actor      uuid,
  p_note       text default null
)
returns public.doc_versions
language plpgsql
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_has_pdf     boolean;
  v_row         public.doc_versions;
begin
  select v.document_id, v.pdf_storage_path is not null
    into v_document_id, v_has_pdf
    from public.doc_versions v
   where v.id = p_version_id
     for update;

  if v_document_id is null then
    raise exception 'No such version: %', p_version_id using errcode = 'no_data_found';
  end if;
  if not v_has_pdf then
    raise exception 'A version cannot be finalised before its released PDF is uploaded'
      using errcode = 'check_violation';
  end if;

  -- Serialise concurrent finalisations of the SAME document. Without this, two admins
  -- ticking two different versions at the same instant both clear the old final and both
  -- try to set theirs — the unique index turns that into a raw constraint error for one
  -- of them. Taking the parent lock first makes the second one simply wait and then win
  -- cleanly.
  perform 1 from public.doc_documents d where d.id = v_document_id for update;

  -- Demote whatever is final now, and record what replaced it.
  update public.doc_versions
     set is_final      = false,
         finalized_by  = null,
         finalized_at  = null,
         superseded_by = p_version_id
   where document_id = v_document_id
     and is_final
     and id <> p_version_id;

  update public.doc_versions
     set is_final      = true,
         finalized_by  = p_actor,
         finalized_at  = now(),
         -- A version being made final is by definition not superseded any more.
         superseded_by = null
   where id = p_version_id
  returning * into v_row;

  insert into public.doc_version_events (version_id, event, actor_user_id, note)
  values (p_version_id, 'finalized', p_actor, p_note);

  return v_row;
end;
$$;

create or replace function public.doc_unfinalize_version(
  p_version_id uuid,
  p_actor      uuid,
  p_note       text default null
)
returns public.doc_versions
language plpgsql
set search_path = ''
as $$
declare
  v_row public.doc_versions;
begin
  update public.doc_versions
     set is_final     = false,
         -- Cleared so a non-final row can never read as "released by X on Y". The
         -- history moves to doc_version_events, which is where it belongs.
         finalized_by = null,
         finalized_at = null
   where id = p_version_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No such version: %', p_version_id using errcode = 'no_data_found';
  end if;

  insert into public.doc_version_events (version_id, event, actor_user_id, note)
  values (p_version_id, 'unfinalized', p_actor, p_note);

  return v_row;
end;
$$;

comment on function public.doc_finalize_version(uuid, uuid, text) is
  'Atomically: flip a version to final, demote + supersede the previous final, log the event. Service-role only.';
comment on function public.doc_unfinalize_version(uuid, uuid, text) is
  'Atomically: clear is_final (and the finalisation actor/time) and log the event. Removes the version from supplier visibility immediately. Service-role only.';

-- ===========================================================================
-- The private bucket
-- ===========================================================================
--
-- public = false, and NO storage.objects policies are created for it — not for anon, not
-- for authenticated. Every byte in and out is brokered by a Netlify Function using the
-- service role: uploads through a signed upload URL for a key the SERVER chose, downloads
-- through a 120-second signed URL minted only after an entitlement check.
--
-- allowed_mime_types is a convenience, not the control: a client sets its own
-- Content-Type. The real check is the %PDF- magic-byte read the server does on the stored
-- object before it will register the version (netlify/functions/doc-registry.ts).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sop-documents',
  'sop-documents',
  false,
  26214400,                    -- 25 MB, mirrored by MAX_PDF_BYTES in the upload route
  array['application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ===========================================================================
-- RLS: enabled everywhere, policies nowhere. Default deny.
-- ===========================================================================
--
-- There is intentionally not a single `create policy` below. RLS with no policies denies
-- everything to every role that is subject to it, which is exactly the intent: nothing
-- reaches doc_* except service_role, which bypasses RLS entirely.
--
-- The REVOKEs are a second, independent layer. RLS only decides which ROWS a caller may
-- touch after the grant lets them touch the table at all; Supabase grants anon and
-- authenticated broad table privileges by default, and PostgREST exposes anything
-- granted. Removing the grant means a probe gets "permission denied for table" before RLS
-- is ever consulted — and means a future migration that adds a policy by mistake still
-- does not open the table.

alter table public.user_roles          enable row level security;
alter table public.doc_documents       enable row level security;
alter table public.doc_versions        enable row level security;
alter table public.doc_version_events  enable row level security;
alter table public.doc_bindings        enable row level security;
alter table public.doc_access_log      enable row level security;
alter table public.doc_download_tickets enable row level security;
alter table public.doc_rate_limits     enable row level security;

-- Belt and braces: also force RLS for the table owner, so an object owned by a
-- non-superuser role cannot read around its own policies.
alter table public.doc_documents       force row level security;
alter table public.doc_versions        force row level security;
alter table public.doc_version_events  force row level security;
alter table public.doc_bindings        force row level security;
alter table public.doc_access_log      force row level security;
alter table public.doc_download_tickets force row level security;

revoke all on public.user_roles         from anon, authenticated;
revoke all on public.doc_documents      from anon, authenticated;
revoke all on public.doc_versions       from anon, authenticated;
revoke all on public.doc_version_events from anon, authenticated;
revoke all on public.doc_bindings       from anon, authenticated;
revoke all on public.doc_access_log     from anon, authenticated;
revoke all on public.doc_download_tickets from anon, authenticated;
revoke all on public.doc_rate_limits    from anon, authenticated;

-- The helper functions are server-side machinery, not an API. PostgREST publishes
-- anything `authenticated` may execute, so leaving these granted would put finalisation
-- one POST /rpc/doc_finalize_version away from any signed-in PM.
revoke execute on function public.doc_finalize_version(uuid, uuid, text)     from public, anon, authenticated;
revoke execute on function public.doc_unfinalize_version(uuid, uuid, text)   from public, anon, authenticated;
revoke execute on function public.doc_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.doc_claim_download_ticket(text)            from public, anon, authenticated;
revoke execute on function public.doc_role_from_profile(text)                from public, anon, authenticated;

-- ===========================================================================
-- updated_at
-- ===========================================================================

create or replace function public.doc_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.doc_touch_updated_at() from public, anon, authenticated;

drop trigger if exists trg_doc_documents_touch on public.doc_documents;
create trigger trg_doc_documents_touch
  before update on public.doc_documents
  for each row
  execute function public.doc_touch_updated_at();

-- ===========================================================================
-- Verification (run by hand after applying; every one of these should hold)
-- ===========================================================================
--
-- Default deny is real — expect "permission denied for table doc_versions":
--   set local role anon;          select * from public.doc_versions limit 1;
--   set local role authenticated; select * from public.doc_versions limit 1;
--
-- No policies exist on any doc_* table — expect zero rows:
--   select tablename, policyname from pg_policies
--    where schemaname = 'public' and (tablename like 'doc\_%' or tablename = 'user_roles');
--
-- The bucket is private — expect public = false:
--   select id, public, file_size_limit from storage.buckets where id = 'sop-documents';
--
-- No storage policy mentions the bucket — expect zero rows:
--   select policyname from pg_policies
--    where schemaname = 'storage' and tablename = 'objects'
--      and (qual::text like '%sop-documents%' or with_check::text like '%sop-documents%');
--
-- Roles mirrored — expect the same count as profiles:
--   select (select count(*) from public.profiles) as profiles,
--          (select count(*) from public.user_roles) as roles;
--
-- Exactly one final per document, always — expect zero rows:
--   select document_id, count(*) from public.doc_versions
--    where is_final group by document_id having count(*) > 1;
