-- 162: generalize the supplier review layer so it is not IM-only.
--
-- WHY. The Design Specs module (docs/originflow-design-specs-module.md) needs exactly the
-- round that migrations 130/131/132 built for the Instruction Manual: an unguessable link
-- with a label, a TTL and a revoke; anonymous notes written through SECURITY DEFINER RPCs
-- that re-resolve the token themselves; image attachments; a submit that closes the round;
-- and PM-side triage. The requirement is explicit that the two modules share ONE
-- implementation, so a fix to submit, attachments or triage lands in both. That means the
-- tables stop being named after the IM.
--
--   im_shares          -> review_shares
--   im_review_comments -> review_comments
--   template_type      -> subject_type      ('im' | 'warning_leaflet' | 'design_spec')
--   manual_version     -> subject_version
--   (new) subject_id    the design_spec_versions row a round belongs to; NULL for the IM,
--                       which is keyed (project_id, subject_type) as it always has been.
--
-- WHY A RENAME IS SAFE HERE, WHEN IT NORMALLY WOULD NOT BE. Verified live 2026-09-09:
-- im_shares holds 6 rows, im_review_comments 5, and 'im' is the only subject value present
-- in either. There is no data migration to get wrong. `ALTER TABLE ... RENAME` also carries
-- indexes, constraints, FKs and RLS policies across, so the live "Scoped all" policy
-- (can_see_project(project_id)) survives untouched — note that this is NOT the "Auth all"
-- policy migrations 84 and 131 describe, so do not "restore" that from the repo.
--
-- ANCHORING IS NOW A UNION, AND THAT IS THE ONE THING THAT COULD NOT BE SHARED. An IM note
-- anchors to a chapter plus the wording the reviewer selected (see 131 for why not a block).
-- A design spec is a PDF: no chapters, and no text this app controls. So a note carries
-- EITHER the text anchor OR a page plus normalised 0..1 coordinates, enforced by
-- review_comments_one_anchor below. Normalised rather than absolute so a pin survives zoom
-- and any page size; anchor_w/h are here but nullable so a rectangle selection can arrive
-- later without another migration.
--
-- THE DEPLOY WINDOW. Applying this before the new bundle ships leaves the LIVE bundle
-- calling the old names. That is handled, with one known cosmetic exception:
--
--  * The six im_review_* / get_im_share_by_token functions keep their names and their exact
--    signatures forever-until-retired; their bodies are re-pointed at the renamed tables
--    below. They are CREATE OR REPLACE'd, never dropped — migration 130 records that
--    dropping a live function, even for an instant, takes the public review page down
--    mid-deploy.
--  * Compat VIEWS public.im_shares and public.im_review_comments reproject the old column
--    names for the old bundle's direct PostgREST reads (db.select('im_shares') etc.).
--  * KNOWN, ACCEPTED: im_review_add_comment and im_review_list_comments return the table's
--    composite type, which follows the rename. A CREATE OR REPLACE cannot change a return
--    type, so the old bundle receives rows carrying `subject_type`/`subject_version` instead
--    of `template_type`/`manual_version`. Its mapper reads `row.template_type ?? 'im'` and
--    `row.manual_version ?? null`, so a note added during the window renders with
--    templateType 'im' and manualVersion null until the page reloads. Nothing is lost or
--    miswritten — the server derives both columns from the token, not from the client.
--
-- House style, followed here: no Postgres enums (TEXT, and CHECK only where a wrong value
-- would corrupt meaning), no updated_at triggers, and comments that say why.

-- ===========================================================================
-- 1. Rename
-- ===========================================================================

alter table public.im_shares rename to review_shares;
alter table public.review_shares rename column template_type  to subject_type;
alter table public.review_shares rename column manual_version to subject_version;

alter table public.im_review_comments rename to review_comments;
alter table public.review_comments rename column template_type  to subject_type;
alter table public.review_comments rename column manual_version to subject_version;

-- ===========================================================================
-- 2. Subject identity
-- ===========================================================================
--
-- No FK on subject_id. It points at design_spec_versions for a spec round and at nothing at
-- all for an IM round, and migration 119 already established that (project_id, subject_type)
-- — not an FK to project_ims — is how this module addresses a manual. A polymorphic column
-- cannot carry a single FK; the CHECK below is what keeps it honest.

alter table public.review_shares   add column if not exists subject_id uuid;
alter table public.review_comments add column if not exists subject_id uuid;

comment on column public.review_shares.subject_type is
  'What is under review: ''im'' | ''warning_leaflet'' | ''design_spec''. Was template_type.';
comment on column public.review_shares.subject_id is
  'The reviewed row for subjects that have one — design_spec_versions.id. NULL for IM/leaflet rounds, which are addressed by (project_id, subject_type) as they always have been.';
comment on column public.review_shares.subject_version is
  'Version the link was minted against — project_ims.version, or design_spec_versions.version. Lets a later republish/re-upload be spotted as "reviewed against v2, now on v3". Was manual_version.';

alter table public.review_shares
  drop constraint if exists review_shares_subject_id_required;
alter table public.review_shares
  add constraint review_shares_subject_id_required
  check (subject_type <> 'design_spec' or subject_id is not null);

create index if not exists review_shares_subject_idx
  on public.review_shares (subject_type, subject_id)
  where subject_id is not null;
create index if not exists review_comments_subject_idx
  on public.review_comments (subject_type, subject_id)
  where subject_id is not null;

-- ===========================================================================
-- 3. The PDF anchor
-- ===========================================================================

alter table public.review_comments
  add column if not exists page     integer,
  add column if not exists anchor_x numeric(6,5),
  add column if not exists anchor_y numeric(6,5),
  add column if not exists anchor_w numeric(6,5),
  add column if not exists anchor_h numeric(6,5);

-- A PDF note has no chapter. The column was NOT NULL because until now every note had one.
alter table public.review_comments alter column section_id drop not null;

comment on column public.review_comments.page is
  '1-based PDF page the pin sits on. NULL for a text-anchored (IM) note.';
comment on column public.review_comments.anchor_x is
  'Pin position as a 0..1 fraction of page width, NOT points — a normalised pin survives zoom, re-render and a different page size. anchor_y is the same on height.';
comment on column public.review_comments.anchor_w is
  'Optional 0..1 width of a dragged region. NULL means the note is a point pin. Present now so a rectangle selection needs no migration later.';

alter table public.review_comments
  drop constraint if exists review_comments_one_anchor;
alter table public.review_comments
  add constraint review_comments_one_anchor check (
    -- text anchor (IM): a chapter, and no page
    (section_id is not null and page is null)
    -- pdf anchor (design spec): a page and a point, and no chapter
    or (section_id is null and page is not null
        and anchor_x is not null and anchor_y is not null)
  );

-- Coordinates are fractions. A value outside 0..1 is a unit mix-up (points leaking in), and
-- it would put the pin somewhere the reviewer never clicked.
alter table public.review_comments
  drop constraint if exists review_comments_anchor_bounds;
alter table public.review_comments
  add constraint review_comments_anchor_bounds check (
    (anchor_x is null or (anchor_x >= 0 and anchor_x <= 1))
    and (anchor_y is null or (anchor_y >= 0 and anchor_y <= 1))
    and (anchor_w is null or (anchor_w > 0 and anchor_w <= 1))
    and (anchor_h is null or (anchor_h > 0 and anchor_h <= 1))
    and (page is null or page >= 1)
  );

-- ===========================================================================
-- 4. Replies
-- ===========================================================================
--
-- A SEPARATE TABLE, not a parent_id on review_comments, for two reasons: the anchor CHECK
-- above stays true of every row in that table, and a reply can never be triaged as if it
-- were a note (open/done/wont_fix is a property of the note, and a reply has no status of
-- its own). author_user_id is set for an internal reply and NULL for a supplier one —
-- suppliers are not authenticated users anywhere in OriginFlow.

create table if not exists public.review_replies (
  id             uuid        primary key default gen_random_uuid(),
  comment_id     uuid        not null references public.review_comments(id) on delete cascade,
  body           text        not null,
  author_name    text        not null,
  author_user_id uuid        references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

comment on table public.review_replies is
  'In-thread answers to a review note. The design team replies so the supplier sees the answer on their next visit; the supplier can reply back. author_user_id NULL = written by an unauthenticated reviewer through review_add_reply.';

create index if not exists review_replies_comment_idx
  on public.review_replies (comment_id, created_at);

alter table public.review_replies enable row level security;

-- Mirrors the live "Scoped all" policy on review_comments, reached through the note. No anon
-- policy: a supplier writes replies only through review_add_reply below.
drop policy if exists "Scoped all" on public.review_replies;
create policy "Scoped all" on public.review_replies for all to authenticated
  using (exists (
    select 1 from public.review_comments c
    where c.id = review_replies.comment_id and public.can_see_project(c.project_id)
  ))
  with check (exists (
    select 1 from public.review_comments c
    where c.id = review_replies.comment_id and public.can_see_project(c.project_id)
  ));

-- ===========================================================================
-- 5. The neutral RPCs
-- ===========================================================================
--
-- Identical containment to migration 131: the token is re-resolved inside every function, so
-- the client never gets to name the share, project, subject or version a note lands on;
-- lengths are capped; and the per-link ceiling bounds an anonymous insert path. Resolution
-- here does NOT bump use_count — that counter means "portal opened".

create or replace function public.review_resolve(p_token text)
returns table(share_id uuid, project_id uuid, subject_type text, subject_id uuid,
              label text, submitted_at timestamptz, submitted_by text,
              subject_version integer, expires_at timestamptz)
language sql security definer set search_path to 'public' as $function$
  update public.review_shares s
  set last_used_at = now(),
      use_count    = s.use_count + 1
  where s.token = p_token
    and s.mode = 'review'
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  returning s.id, s.project_id, s.subject_type, s.subject_id, s.label,
            s.submitted_at, s.submitted_by, s.subject_version, s.expires_at;
$function$;

comment on function public.review_resolve(text) is
  'Resolve a review token to its subject and stamp last_used_at/use_count. Returns no row for a token that is unknown, revoked, expired or a plain view share — the portal shows one screen for all of them so a probe cannot tell the cases apart.';

create or replace function public.review_add_comment(
  p_token         text,
  p_author_name   text,
  p_body          text,
  p_section_id    text    default null,
  p_section_title text    default null,
  p_quote         text    default null,
  p_quote_before  text    default null,
  p_quote_after   text    default null,
  p_page          integer default null,
  p_anchor_x      numeric default null,
  p_anchor_y      numeric default null,
  p_anchor_w      numeric default null,
  p_anchor_h      numeric default null,
  p_attachments   jsonb   default '[]'::jsonb
)
returns public.review_comments
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_share   public.review_shares%rowtype;
  v_count   integer;
  v_row     public.review_comments%rowtype;
  v_section text := nullif(btrim(coalesce(p_section_id, '')), '');
begin
  select * into v_share
  from public.review_shares s
  where s.token = p_token
    and s.mode = 'review'
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now());

  if not found then
    raise exception 'This review link is invalid, expired or has been revoked.';
  end if;

  if coalesce(btrim(p_body), '') = '' then
    raise exception 'A comment cannot be empty.';
  end if;
  if coalesce(btrim(p_author_name), '') = '' then
    raise exception 'A reviewer name is required.';
  end if;
  if length(p_body) > 4000 then
    raise exception 'Comment is too long (max 4000 characters).';
  end if;
  if length(p_author_name) > 120 then
    raise exception 'Reviewer name is too long (max 120 characters).';
  end if;
  if length(coalesce(p_quote, '')) > 2000 then
    raise exception 'Selected text is too long (max 2000 characters).';
  end if;

  -- Exactly one anchor. The table CHECK enforces this too; failing here first turns a
  -- constraint violation into a sentence the reviewer can act on.
  if v_section is not null and p_page is not null then
    raise exception 'A comment cannot be anchored to both a chapter and a page.';
  end if;
  if v_section is null and p_page is null then
    raise exception 'A comment must be anchored to a chapter or to a page.';
  end if;
  if p_page is not null and (p_anchor_x is null or p_anchor_y is null) then
    raise exception 'A page comment must carry a position on that page.';
  end if;

  select count(*) into v_count
  from public.review_comments c where c.share_id = v_share.id;
  if v_count >= 500 then
    raise exception 'This review link has reached its comment limit.';
  end if;

  insert into public.review_comments (
    share_id, project_id, subject_type, subject_id, subject_version,
    section_id, section_title, quote, quote_before, quote_after,
    page, anchor_x, anchor_y, anchor_w, anchor_h,
    body, author_name, attachments
  ) values (
    v_share.id, v_share.project_id, v_share.subject_type, v_share.subject_id,
    v_share.subject_version,
    v_section,
    nullif(btrim(coalesce(p_section_title, '')), ''),
    nullif(btrim(coalesce(p_quote, '')), ''),
    left(coalesce(p_quote_before, ''), 200),
    left(coalesce(p_quote_after, ''), 200),
    p_page, p_anchor_x, p_anchor_y, p_anchor_w, p_anchor_h,
    btrim(p_body), btrim(p_author_name),
    coalesce(p_attachments, '[]'::jsonb)
  )
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.review_list_comments(p_token text)
returns setof public.review_comments
language sql security definer set search_path to 'public' as $function$
  select c.*
  from public.review_comments c
  join public.review_shares s on s.id = c.share_id
  where s.token = p_token
    and s.mode = 'review'
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  order by c.created_at;
$function$;

comment on function public.review_list_comments(text) is
  'This link''s own notes only. A reviewer must never see another reviewer''s round.';

create or replace function public.review_delete_comment(p_token text, p_comment_id uuid)
returns boolean
language plpgsql security definer set search_path to 'public' as $function$
declare v_deleted integer;
begin
  delete from public.review_comments c
  using public.review_shares s
  where c.id = p_comment_id
    and s.id = c.share_id
    and s.token = p_token
    and s.mode = 'review'
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
    and c.status = 'open';
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$function$;

comment on function public.review_delete_comment(text, uuid) is
  'Retract a note: own share only, and only while it is still open — once the team has triaged it, it stays in the record.';

create or replace function public.review_submit(p_token text, p_author_name text)
returns timestamptz
language plpgsql security definer set search_path to 'public' as $function$
declare v_at timestamptz;
begin
  update public.review_shares s
  set submitted_at = coalesce(s.submitted_at, now()),
      submitted_by = coalesce(s.submitted_by, nullif(btrim(coalesce(p_author_name, '')), ''))
  where s.token = p_token
    and s.mode = 'review'
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  returning s.submitted_at into v_at;

  if v_at is null then
    raise exception 'This review link is invalid, expired or has been revoked.';
  end if;
  return v_at;
end;
$function$;

comment on function public.review_submit(text, text) is
  'Close the round. Idempotent: the first submission''s timestamp stands, so a reviewer who keeps commenting afterwards does not keep restarting it.';

-- Reply, from the unauthenticated side. Scoped to notes on the caller's own share, so a
-- reviewer cannot answer into someone else's thread.
create or replace function public.review_add_reply(
  p_token       text,
  p_comment_id  uuid,
  p_body        text,
  p_author_name text
)
returns public.review_replies
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_ok    boolean;
  v_count integer;
  v_row   public.review_replies%rowtype;
begin
  select exists (
    select 1
    from public.review_comments c
    join public.review_shares s on s.id = c.share_id
    where c.id = p_comment_id
      and s.token = p_token
      and s.mode = 'review'
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
  ) into v_ok;

  if not v_ok then
    raise exception 'This review link is invalid, expired or has been revoked.';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'A reply cannot be empty.';
  end if;
  if coalesce(btrim(p_author_name), '') = '' then
    raise exception 'A reviewer name is required.';
  end if;
  if length(p_body) > 4000 then
    raise exception 'Reply is too long (max 4000 characters).';
  end if;

  select count(*) into v_count
  from public.review_replies r where r.comment_id = p_comment_id;
  if v_count >= 100 then
    raise exception 'This thread has reached its reply limit.';
  end if;

  insert into public.review_replies (comment_id, body, author_name, author_user_id)
  values (p_comment_id, btrim(p_body), btrim(p_author_name), null)
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.review_list_replies(p_token text)
returns setof public.review_replies
language sql security definer set search_path to 'public' as $function$
  select r.*
  from public.review_replies r
  join public.review_comments c on c.id = r.comment_id
  join public.review_shares s on s.id = c.share_id
  where s.token = p_token
    and s.mode = 'review'
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  order by r.created_at;
$function$;

comment on function public.review_list_replies(text) is
  'Replies on this link''s own notes, so the reviewer sees the team''s answers on their next visit.';

-- ===========================================================================
-- 6. Re-point the existing functions at the renamed tables
-- ===========================================================================
--
-- Same names, same signatures, same output column names. Only the bodies change. These stay
-- until a follow-up migration retires them, so a browser running the previous bundle keeps
-- working. get_im_share_by_token in particular is load-bearing for the live /share/im/ page
-- and migration 130 deliberately never touched it.

create or replace function public.get_im_share_by_token(p_token text)
returns table(project_id uuid, template_type text)
language sql security definer set search_path to 'public' as $function$
  update public.review_shares s
  set last_used_at = now(),
      use_count = s.use_count + 1
  where s.token = p_token
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  returning s.project_id, s.subject_type;
$function$;

create or replace function public.im_review_resolve(p_token text)
returns table(share_id uuid, project_id uuid, template_type text, label text,
              submitted_at timestamptz, submitted_by text, manual_version integer,
              expires_at timestamptz)
language sql security definer set search_path to 'public' as $function$
  update public.review_shares s
  set last_used_at = now(),
      use_count    = s.use_count + 1
  where s.token = p_token
    and s.mode = 'review'
    and s.revoked_at is null
    and (s.expires_at is null or s.expires_at > now())
  returning s.id, s.project_id, s.subject_type, s.label,
            s.submitted_at, s.submitted_by, s.subject_version, s.expires_at;
$function$;

-- Delegates. The return type followed the table rename (see the deploy-window note in the
-- header); the body is the new function so there is one implementation of the rules.
create or replace function public.im_review_add_comment(
  p_token         text,
  p_author_name   text,
  p_body          text,
  p_section_id    text,
  p_section_title text default null,
  p_quote         text default null,
  p_quote_before  text default null,
  p_quote_after   text default null,
  p_attachments   jsonb default '[]'::jsonb
)
returns public.review_comments
language sql security definer set search_path to 'public' as $function$
  select (public.review_add_comment(
    p_token, p_author_name, p_body,
    p_section_id, p_section_title, p_quote, p_quote_before, p_quote_after,
    null, null, null, null, null,
    p_attachments
  )).*;
$function$;

create or replace function public.im_review_list_comments(p_token text)
returns setof public.review_comments
language sql security definer set search_path to 'public' as $function$
  select * from public.review_list_comments(p_token);
$function$;

create or replace function public.im_review_delete_comment(p_token text, p_comment_id uuid)
returns boolean
language sql security definer set search_path to 'public' as $function$
  select public.review_delete_comment(p_token, p_comment_id);
$function$;

create or replace function public.im_review_submit(p_token text, p_author_name text)
returns timestamptz
language sql security definer set search_path to 'public' as $function$
  select public.review_submit(p_token, p_author_name);
$function$;

-- ===========================================================================
-- 7. Grants
-- ===========================================================================

revoke all on function public.review_resolve(text) from public;
revoke all on function public.review_add_comment(text, text, text, text, text, text, text, text, integer, numeric, numeric, numeric, numeric, jsonb) from public;
revoke all on function public.review_list_comments(text) from public;
revoke all on function public.review_delete_comment(text, uuid) from public;
revoke all on function public.review_submit(text, text) from public;
revoke all on function public.review_add_reply(text, uuid, text, text) from public;
revoke all on function public.review_list_replies(text) from public;

grant execute on function public.review_resolve(text) to anon, authenticated;
grant execute on function public.review_add_comment(text, text, text, text, text, text, text, text, integer, numeric, numeric, numeric, numeric, jsonb) to anon, authenticated;
grant execute on function public.review_list_comments(text) to anon, authenticated;
grant execute on function public.review_delete_comment(text, uuid) to anon, authenticated;
grant execute on function public.review_submit(text, text) to anon, authenticated;
grant execute on function public.review_add_reply(text, uuid, text, text) to anon, authenticated;
grant execute on function public.review_list_replies(text) to anon, authenticated;

-- review_replies follows the blanket-grant + RLS-is-the-boundary pattern of the two tables
-- it hangs off (verified live: anon and authenticated both hold full table grants on those,
-- and the policies do the work).
grant select, insert, update, delete on public.review_replies to anon, authenticated;

-- ===========================================================================
-- 8. Compatibility views
-- ===========================================================================
--
-- SECURITY_INVOKER IS NOT OPTIONAL. Without it a view runs with its owner's rights and the
-- base table's RLS is bypassed entirely — these two views would then hand every share token
-- and every supplier note to anon, which holds a blanket SELECT grant. With it, the
-- "Scoped all" policies apply to the caller exactly as they do today.
--
-- Single-table views with renamed columns stay auto-updatable, so an old-bundle write path
-- keeps working too. Retire both in the same follow-up migration that drops the im_review_*
-- functions.

drop view if exists public.im_shares;
create view public.im_shares with (security_invoker = true) as
  select id, token, project_id,
         subject_type    as template_type,
         created_by, created_at, revoked_at, expires_at, revoked_by, label,
         last_used_at, use_count, mode, submitted_at, submitted_by,
         subject_version as manual_version,
         review_stage
  from public.review_shares;

comment on view public.im_shares is
  'DEPRECATED compatibility view over review_shares, reprojecting the pre-162 column names for a browser still running the previous bundle. Write new code against review_shares.';

drop view if exists public.im_review_comments;
create view public.im_review_comments with (security_invoker = true) as
  select id, share_id, project_id,
         subject_type    as template_type,
         language,
         subject_version as manual_version,
         section_id, section_title, quote, quote_before, quote_after,
         body, author_name, status, resolved_at, resolved_by, created_at, attachments
  from public.review_comments;

comment on view public.im_review_comments is
  'DEPRECATED compatibility view over review_comments, reprojecting the pre-162 column names. Note it does NOT expose the PDF anchor columns — a design-spec note read through here looks unanchored. Write new code against review_comments.';

grant select, insert, update, delete on public.im_shares to anon, authenticated;
grant select, insert, update, delete on public.im_review_comments to anon, authenticated;

notify pgrst, 'reload schema';

-- ===========================================================================
-- Verification (run after applying)
-- ===========================================================================
--
-- 1. The rename kept the live policy, not the one the repo describes:
--      select tablename, policyname, qual from pg_policies
--      where tablename in ('review_shares','review_comments','review_replies');
--    Expect "Scoped all" with can_see_project(project_id) on the first two.
--
-- 2. The views do NOT bypass RLS:
--      select relname, reloptions from pg_class
--      where relname in ('im_shares','im_review_comments');
--    Expect {security_invoker=true} on both. If this is empty, DROP the views immediately.
--
-- 3. Nothing was lost:
--      select count(*) from public.review_shares;    -- expect 6
--      select count(*) from public.review_comments;  -- expect 5
--
-- 4. The old entry points still answer (should return the same rows as before):
--      select * from public.get_im_share_by_token('<a live token>');
--      select * from public.im_review_resolve('<a live review token>');
