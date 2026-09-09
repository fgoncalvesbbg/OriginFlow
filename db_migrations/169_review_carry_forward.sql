-- 169_review_carry_forward.sql
--
-- Carrying a review round forward onto the next version of a document.
--
-- THE PROBLEM. A design spec goes out for review, the supplier marks it up, the design team
-- fixes the artwork and uploads v2. Every note the supplier wrote is still in the database,
-- correctly stamped with the version it was written against — but nothing records whether
-- anyone LOOKED at it again against v2. The team was left doing that from memory, which is
-- the exact complaint the module was built to end.
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT.
--
-- 1. `review_comments.checked_subject_id/_version` — the version a note was last triaged
--    against. This is what separates "nobody has looked at this since v1" from "we checked
--    it against v2 and it is still wrong", which the `status` column alone cannot express:
--    an open note looks identical in both cases.
--
--    NOT a copy of the note onto the new version. The first design here was to duplicate a
--    still-unfixed note onto v2 so it would carry a v2 anchor. That was dropped: it would
--    have needed `review_comments.share_id` to become nullable — every note in the system
--    belongs to a supplier's review link, and that invariant is worth more than the
--    convenience — and it would have put words in a supplier's mouth on a round they never
--    saw. The original note is the record; where it sits on the new version is a rendering
--    question, answered by the fractional page anchors that are already stored.
--
-- 2. `review_shares.supersedes_id` — a round that succeeds an earlier one, so a supplier
--    coming back for round two can be shown what THEY said in round one.
--
--    NOT "every note on this document". Several suppliers review the same version through
--    separate labelled links, and a per-document read would hand Factory A everything
--    Factory B wrote. Access follows the chain of links each recipient was given, and a
--    trigger keeps a chain inside one project and one document type.
--
-- 3. `review_list_prior_comments(token)` — a NEW rpc, deliberately not a widening of
--    `review_list_comments`. That function feeds the portal's live note rail, whose pins are
--    drawn on the version currently on screen; returning an earlier version's notes through
--    it would scatter pins from another document across this one and offer the reviewer
--    Delete and Reply on notes from a closed round. Prior rounds are a separate, read-only
--    list precisely so they cannot be mistaken for the live one.
--
-- Applied to project ecueltibpmpnhnaxlskx. See docs/originflow-design-spec-version-review.md.

-- ---------------------------------------------------------------------------
-- 1. Which version a note was last triaged against
-- ---------------------------------------------------------------------------

alter table public.review_comments
  add column if not exists checked_subject_id      uuid,
  add column if not exists checked_subject_version integer;

comment on column public.review_comments.checked_subject_id is
  'The reviewed subject (for a design spec, the design_spec_versions.id) this note was last '
  'triaged against. Null means nobody has re-checked it since it was written. Deliberately '
  'not a foreign key, matching subject_id: this table serves the IM as well, which has no '
  'row to point at.';

comment on column public.review_comments.checked_subject_version is
  'Version number matching checked_subject_id, so a display can say "still open against v3" '
  'without a second lookup.';

-- ---------------------------------------------------------------------------
-- 2. A round that succeeds an earlier one
-- ---------------------------------------------------------------------------

alter table public.review_shares
  add column if not exists supersedes_id uuid
    references public.review_shares(id) on delete set null;

comment on column public.review_shares.supersedes_id is
  'The link this one is the next round of — same recipient, later version. Null for a first '
  'round. Read by review_list_prior_comments so a returning reviewer sees their own earlier '
  'notes, and by nothing else: it grants no access on its own.';

alter table public.review_shares
  drop constraint if exists review_shares_supersedes_not_self;
alter table public.review_shares
  add constraint review_shares_supersedes_not_self
    check (supersedes_id is null or supersedes_id <> id);

create index if not exists review_shares_supersedes_idx
  on public.review_shares (supersedes_id)
  where supersedes_id is not null;

/*
 * A chain must stay inside one project and one document type, and must not loop.
 *
 * The project/type check is the security half: without it, pointing a new link at any share
 * in the system would expose that share's notes to this link's holder. The cycle check is
 * the availability half — a loop would make the recursive walk in
 * review_list_prior_comments run until its depth cap on every reviewer page load.
 */
create or replace function public.review_shares_check_supersedes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.supersedes_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.review_shares prev
    where prev.id = new.supersedes_id
      and prev.project_id = new.project_id
      and prev.subject_type = new.subject_type
  ) then
    raise exception
      'A review link can only supersede another link on the same project and document type.';
  end if;

  if exists (
    with recursive chain (id, next_id, depth) as (
      select prev.id, prev.supersedes_id, 1
      from public.review_shares prev
      where prev.id = new.supersedes_id
      union all
      select prev.id, prev.supersedes_id, c.depth + 1
      from chain c
      join public.review_shares prev on prev.id = c.next_id
      where c.depth < 50
    )
    select 1 from chain where id = new.id
  ) then
    raise exception 'That would make a review link supersede itself through its own chain.';
  end if;

  return new;
end;
$$;

drop trigger if exists review_shares_check_supersedes on public.review_shares;
create trigger review_shares_check_supersedes
  before insert or update of supersedes_id, project_id, subject_type
  on public.review_shares
  for each row
  execute function public.review_shares_check_supersedes();

-- ---------------------------------------------------------------------------
-- 3. The reviewer's own earlier rounds, read-only
-- ---------------------------------------------------------------------------

/*
 * Notes this token's holder wrote in EARLIER rounds of the same chain. Never this round's —
 * those are review_list_comments' job, and keeping the two apart is what stops an old note
 * appearing in the live rail with Delete beside it.
 *
 * The live gate is the anchor link only: the current token must be a review link, unrevoked
 * and unexpired. Ancestors are deliberately NOT re-checked for revocation — a finished round
 * always has a revoked or expired link, and that is what "finished" looks like. Revoking the
 * CURRENT link still cuts the whole history off, because the walk starts there.
 */
create or replace function public.review_list_prior_comments(p_token text)
returns setof public.review_comments
language sql
security definer
set search_path to 'public'
as $$
  with recursive anchor as (
    select s.id, s.supersedes_id, s.project_id, s.subject_type
    from public.review_shares s
    where s.token = p_token
      and s.mode = 'review'
      and s.revoked_at is null
      and (s.expires_at is null or s.expires_at > now())
  ),
  chain (id, depth) as (
    select a.supersedes_id, 1
    from anchor a
    where a.supersedes_id is not null
    union all
    select prev.supersedes_id, c.depth + 1
    from chain c
    join public.review_shares prev on prev.id = c.id
    where prev.supersedes_id is not null
      and c.depth < 50
  )
  select c.*
  from public.review_comments c
  join chain ch on ch.id = c.share_id
  join public.review_shares prev on prev.id = ch.id
  join anchor a on true
  -- Belt and braces: the trigger already refuses a cross-project chain, but this function is
  -- SECURITY DEFINER and a row written before the trigger existed must not slip through.
  where prev.project_id = a.project_id
    and prev.subject_type = a.subject_type
  order by c.subject_version, c.created_at;
$$;

revoke execute on function public.review_list_prior_comments(text) from public;
grant execute on function public.review_list_prior_comments(text)
  to anon, authenticated, service_role;
