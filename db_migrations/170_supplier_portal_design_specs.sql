-- 170_supplier_portal_design_specs.sql
--
-- Design specs reach the supplier through their own project portal, instead of only through
-- a URL a PM pastes into an email.
--
-- THE PROBLEM. `sendDesignSpecForReview` mints a link and the send dialog says, in as many
-- words, "OriginFlow sends no email. Copy the link and send it to the reviewer yourself."
-- So a review round exists in this database while the supplier's own project page — the one
-- surface they check on their own initiative — shows no sign of it. The same is true of the
-- issued final: the version the factory is meant to build to lives in a private bucket that
-- their portal has no path into.
--
-- WHAT THIS ADDS.
--
-- 1. `review_shares.supplier_id` — the recipient this link was minted FOR, when that
--    recipient is a supplier the portal can authenticate.
--
--    THIS IS AN ACCESS DECISION, NOT A LABEL. `label` already says who a link is for, but it
--    is free text a human types ("Factory A", "packaging vendor", "Wei"), and publishing a
--    link in a portal on the strength of it would be guesswork. It matters because opening a
--    review token IS the reviewer's identity: through `supersedes_id` the holder sees that
--    recipient's own earlier notes and writes new ones in their name. Publishing Factory B's
--    link on Factory A's portal page would therefore hand A B's markup, which is precisely
--    what migration 169 went to trouble to prevent. So a link appears in a supplier's portal
--    only when someone explicitly said it was for that supplier.
--
--    Nullable, and null for every existing row: a link minted before this migration was
--    delivered by hand and stays that way. Nothing here changes who may RESOLVE a token —
--    that is still the token itself, and this column grants nothing on its own.
--
-- 2. Four SECURITY DEFINER readers, keyed by the two portal credentials that already exist
--    (a project's `supplier_link_token`, and a supplier's `portal_token` + `access_code`).
--    `review_shares`, `design_specs` and `design_spec_versions` are all unreadable to `anon`,
--    which is the correct default and is not being widened; these routines are the whole of
--    the exception, and each one re-derives the supplier from the credential rather than
--    trusting an id from the caller.
--
-- WHY ROUNDS AND FINALS ARE SEPARATE READS. They answer to different rules. A round is
-- visible because someone marked that link for this supplier (1 above). An issued final is
-- visible because the project's supplier is the party who has to build to it — no marking,
-- and no review link needs ever to have existed. Folding them into one query would have made
-- the looser of those two rules govern both.
--
-- The file PDF itself is NOT served from here. Storage stays behind
-- netlify/functions/design-spec-file.ts, which re-derives entitlement per request with the
-- service role and hands back a 5-minute signed URL; these functions return metadata and
-- version ids only.
--
-- Applied to project ecueltibpmpnhnaxlskx.

-- ---------------------------------------------------------------------------
-- 1. Which supplier a review link was minted for
-- ---------------------------------------------------------------------------

alter table public.review_shares
  add column if not exists supplier_id uuid
    references public.suppliers(id) on delete set null;

comment on column public.review_shares.supplier_id is
  'The supplier this link was minted for, set when the sender ticked "publish in the '
  'supplier portal". It is what lets a portal LIST a link it was not handed: label is free '
  'text and cannot carry that decision. Null means hand-delivered — the link still works, it '
  'is just not published anywhere. Grants no access by itself; the token remains the only '
  'thing that resolves a round.';

create index if not exists review_shares_supplier_idx
  on public.review_shares (supplier_id)
  where supplier_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Review rounds published to a supplier
-- ---------------------------------------------------------------------------

/*
 * Every design spec round marked for the supplier who owns this project token.
 *
 * Returns dead rounds too — revoked, expired, already submitted. That is deliberate: the
 * portal shows them greyed out as the record of what was reviewed and when, which is the
 * question a supplier asks months later. The columns needed to tell live from dead are all
 * here (`revoked_at`, `expires_at`, `submitted_at`), and the token of a dead round buys its
 * holder nothing — every resolver re-checks those same three.
 *
 * `supplier_id is not null` on both sides of the join is what stops a project with no
 * supplier from matching a share with no supplier.
 */
create or replace function public.get_design_spec_rounds_by_project_token(p_project_token text)
returns table (
  share_id       uuid,
  token          text,
  label          text,
  sent_at        timestamptz,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  submitted_at   timestamptz,
  submitted_by   text,
  spec_id        uuid,
  spec_code      text,
  spec_title     text,
  version_id     uuid,
  version_number integer,
  version_kind   text,
  version_note   text,
  page_count     integer,
  project_id     uuid,
  project_name   text
)
language sql
security definer
set search_path to 'public'
as $$
  select
    s.id, s.token, s.label, s.created_at, s.expires_at, s.revoked_at,
    s.submitted_at, s.submitted_by,
    ds.id, ds.spec_code, ds.title,
    v.id, v.version, v.kind, v.note, v.page_count,
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
$$;

revoke execute on function public.get_design_spec_rounds_by_project_token(text) from public;
grant execute on function public.get_design_spec_rounds_by_project_token(text)
  to anon, authenticated, service_role;

/*
 * The same rounds across every project a supplier is on, for the access-code-gated
 * dashboard. `portal_rl_guard` is the shared brute-force limiter every supplier-token
 * routine goes through, and it is called BEFORE the early return so a wrong code is counted.
 */
create or replace function public.get_design_spec_rounds_by_supplier(
  p_supplier_token text,
  p_code text
)
returns table (
  share_id       uuid,
  token          text,
  label          text,
  sent_at        timestamptz,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  submitted_at   timestamptz,
  submitted_by   text,
  spec_id        uuid,
  spec_code      text,
  spec_title     text,
  version_id     uuid,
  version_number integer,
  version_kind   text,
  version_note   text,
  page_count     integer,
  project_id     uuid,
  project_name   text
)
language plpgsql
security definer
set search_path to 'public'
as $$
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
      v.id, v.version, v.kind, v.note, v.page_count,
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
$$;

revoke execute on function public.get_design_spec_rounds_by_supplier(text, text) from public;
grant execute on function public.get_design_spec_rounds_by_supplier(text, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The issued final
-- ---------------------------------------------------------------------------

/*
 * The project's design spec and its final version, if one has been issued.
 *
 * A row comes back for a spec that is NOT yet issued as well (`final_version_id` null), so
 * the portal can hold a "not yet issued" placeholder in the Production phase rather than
 * having the spec appear from nowhere on the day it is signed off. A project with no spec at
 * all returns nothing, because there is nothing to promise.
 *
 * Cancelled specs are excluded outright: a cancelled spec is not going to be issued, and a
 * placeholder for one would be a promise this database has already broken.
 *
 * No `supplier_id` marking is involved. The rule here is simply that a project's supplier is
 * the party that builds to the issued spec.
 */
create or replace function public.get_design_spec_finals_by_project_token(p_project_token text)
returns table (
  spec_id          uuid,
  spec_code        text,
  spec_title       text,
  state            text,
  final_version_id uuid,
  version_number   integer,
  page_count       integer,
  byte_size        integer,
  issued_at        timestamptz,
  project_id       uuid,
  project_name     text
)
language sql
security definer
set search_path to 'public'
as $$
  select
    ds.id, ds.spec_code, ds.title, ds.state,
    ds.final_version_id, v.version, v.page_count, v.byte_size, ds.issued_at,
    p.id, p.name
  from public.design_specs ds
  join public.projects p on p.id = ds.project_id
  left join public.design_spec_versions v on v.id = ds.final_version_id
  where p.supplier_link_token = p_project_token
    and ds.state <> 'cancelled'
  order by ds.spec_code;
$$;

revoke execute on function public.get_design_spec_finals_by_project_token(text) from public;
grant execute on function public.get_design_spec_finals_by_project_token(text)
  to anon, authenticated, service_role;

/* The same, across a supplier's projects, for the dashboard. */
create or replace function public.get_design_spec_finals_by_supplier(
  p_supplier_token text,
  p_code text
)
returns table (
  spec_id          uuid,
  spec_code        text,
  spec_title       text,
  state            text,
  final_version_id uuid,
  version_number   integer,
  page_count       integer,
  byte_size        integer,
  issued_at        timestamptz,
  project_id       uuid,
  project_name     text
)
language plpgsql
security definer
set search_path to 'public'
as $$
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
      ds.id, ds.spec_code, ds.title, ds.state,
      ds.final_version_id, v.version, v.page_count, v.byte_size, ds.issued_at,
      p.id, p.name
    from public.design_specs ds
    join public.projects p on p.id = ds.project_id
    join public.suppliers sup on sup.id = p.supplier_id
    left join public.design_spec_versions v on v.id = ds.final_version_id
    where sup.portal_token = p_supplier_token
      and sup.access_code = p_code
      and ds.state <> 'cancelled'
    order by p.name, ds.spec_code;
end;
$$;

revoke execute on function public.get_design_spec_finals_by_supplier(text, text) from public;
grant execute on function public.get_design_spec_finals_by_supplier(text, text)
  to anon, authenticated, service_role;
