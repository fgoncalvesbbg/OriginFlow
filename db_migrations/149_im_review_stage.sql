-- 149 — IM workflow: which of the TWO review steps a review link belongs to.
--
-- The IM workflow is
--
--   To Do → In Progress → Draft Review → Adjust IM → Final Review → Done → Republish Needed
--
-- and both review steps are entered the same way: a PM mints a supplier review link. Nothing
-- in the schema could tell the two apart, so every round derived to one undifferentiated
-- "In Review" and the board could not show where a manual actually stood.
--
-- `review_stage` is that missing fact, stored in two places on purpose:
--
--  * `im_shares.review_stage`   — the stage the LINK was minted for. Immutable history: a link
--                                 sent as a draft review stays a draft review forever, even
--                                 after the manual moves on. This is what an audit reads.
--  * `project_ims.review_stage` — the stage of the manual's CURRENT round, mirrored next to
--                                 review_requested_at / review_version so the dashboard can
--                                 derive the column for every manual in one query instead of
--                                 loading each manual's share links (the same reason those
--                                 two columns are mirrored there already).
--
-- Nullable, and no default. Null means "a round that predates this migration, or a manual
-- that has never been reviewed" — the deriver reads null as 'draft', so a legacy round lands
-- in Draft Review rather than falsely claiming a final sign-off happened.
--
-- Additive only: no column is dropped, no policy changes, and the backfill touches only rows
-- that already carry a review round.

-- --- im_shares -----------------------------------------------------------------

alter table public.im_shares
  add column if not exists review_stage text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'im_shares_review_stage_chk'
  ) then
    alter table public.im_shares
      add constraint im_shares_review_stage_chk
      check (review_stage is null or review_stage in ('draft', 'final'));
  end if;
end $$;

comment on column public.im_shares.review_stage is
  'Which IM workflow review step this link was minted for: draft = Draft Review, final = Final Review. Null on view-mode links and on rounds created before migration 149. Never rewritten — the link keeps the stage it was sent as.';

-- Every review link that exists today was the first supplier pass on a manual (checked
-- against the live table: three links, all first rounds), so 'draft' is the truthful
-- backfill rather than a guess.
update public.im_shares
   set review_stage = 'draft'
 where mode = 'review'
   and review_stage is null;

-- --- project_ims ---------------------------------------------------------------

alter table public.project_ims
  add column if not exists review_stage text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_ims_review_stage_chk'
  ) then
    alter table public.project_ims
      add constraint project_ims_review_stage_chk
      check (review_stage is null or review_stage in ('draft', 'final'));
  end if;
end $$;

comment on column public.project_ims.review_stage is
  'Stage of the manual''s current review round, mirroring im_shares.review_stage for the round stamped in review_requested_at / review_version. Read with those two columns by src/pages/im/im-manual-status.ts to place the manual in Draft Review or Final Review. Null = never reviewed, or a pre-149 round (read as draft).';

update public.project_ims
   set review_stage = 'draft'
 where review_requested_at is not null
   and review_stage is null;
