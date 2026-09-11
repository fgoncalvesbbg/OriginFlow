-- 180: the supplier draft request becomes a STANDARD part of every launch.
--
-- WHAT CHANGED AND WHY. Migration 179 made the draft request something a PM opened by hand.
-- In practice that means it is opened late, or not at all, and the supplier never learns it
-- is expected of them. Asking for the draft manual is not a special case — it is part of
-- every launch — so the request is now seeded for every project and shown to the supplier
-- inside the phase it belongs to.
--
-- WHICH PHASE. `step_number`, defaulting to 2 — "Business Case & Development" in the default
-- template, the phase where the product is specified and the manual can first be drafted.
-- It is a COLUMN and not a constant in the code because phases come from an admin-editable
-- template (Admin panel > Project Templates): a template whose development phase is numbered
-- differently needs the request to move with it, and that must not be a deploy.
--
-- THE PARKING PROBLEM, REVISITED. Migration 179 leaned on "a request only exists if someone
-- asked" to stop projects sitting forever in Supplier Draft Upload. Seeding a request for
-- everything removes that guard, so it is replaced by a better one: a project appears in
-- Supplier Draft Upload only once it has REACHED the request's step. A launch still in RFQ
-- is not waiting on a draft manual, and reads as plain Backlog. The rule lives in
-- `draftStepOf` (src/pages/im/im-manual-status.ts), which is the only place it may live.
--
-- Still true, and still what matters most: NONE of this blocks a writer. Every pre-manual
-- column offers "Start IM".

-- ===========================================================================
-- 1. Which phase the request belongs to
-- ===========================================================================

alter table public.im_draft_requests
  add column if not exists step_number int not null default 2;

comment on column public.im_draft_requests.step_number is
  'The project phase this request is shown in (project_steps.step_number). Default 2 = Business Case & Development. A project is only counted as waiting on the draft once current_step reaches this, which is what stops launches still in RFQ parking in the Supplier Draft Upload column.';

-- ===========================================================================
-- 2. Backfill the launches that are already running
-- ===========================================================================
--
-- ACTIVE PROJECTS ONLY. A completed or cancelled launch does not need a draft manual, and
-- seeding one would put a request in front of a supplier for work that is finished — noise
-- that also makes the Supplier Draft Upload column lie about what is outstanding.
--
-- `on conflict do nothing` so this is safe to re-run and cannot disturb a request someone
-- has already made by hand (including one they deliberately cancelled).

insert into public.im_draft_requests (project_id, template_type, step_number, requested_by, note)
select p.id, 'im', 2, 'migration-180',
       'Standard for every launch: your draft of the instruction manual.'
from public.projects p
where p.status = 'in_progress'
on conflict (project_id, template_type) do nothing;

notify pgrst, 'reload schema';

-- ===========================================================================
-- Verification (run after applying)
-- ===========================================================================
--
-- 1. Every active project has a request, and no completed/cancelled one does:
--      select p.status, count(*) filter (where r.id is not null) as with_request, count(*) as projects
--      from public.projects p
--      left join public.im_draft_requests r
--        on r.project_id = p.id and r.template_type = 'im'
--      group by p.status order by 1;
--
-- 2. The column exists with the right default:
--      select column_name, column_default, is_nullable
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'im_draft_requests'
--        and column_name = 'step_number';
--
-- 3. Nothing was cancelled by the backfill (expect 0):
--      select count(*) from public.im_draft_requests where cancelled_at is not null;
