-- 181: a due date per PHASE, which documents inherit unless they override it.
--
-- WHAT THIS IS. Deadlines were per-document only, so "everything in Business Case &
-- Development is due on the 15th" meant editing every row by hand and re-editing all of them
-- when the date moved. A phase now carries a date and its documents inherit it; setting a
-- date on one document is an explicit override that the phase no longer touches.
--
-- ============================================================================
-- WHY THE INHERITANCE IS RESOLVED BY A TRIGGER AND NOT AT READ TIME
-- ============================================================================
--
-- The obvious design is `coalesce(document.deadline, step.deadline)` wherever a deadline is
-- displayed. It was rejected, because a deadline is read in far more places than the two
-- screens that show a checklist:
--
--   src/pages/ProjectDetail.tsx          the phase checklist
--   src/pages/SupplierPortal.tsx         what the supplier is chased for
--   src/pages/SupplierDashboard.tsx      the same across their projects
--   src/pages/PMDashboard.tsx            overdue counts
--   src/pages/TimelineDashboard.tsx      the schedule view
--   src/components/inbox/…               the PM inbox
--   src/services/shared/dashboard.service.ts    } these two query project_documents
--   src/services/shared/pm-inbox.service.ts     } WITHOUT ever loading project_steps
--
-- The last two are the problem. They count overdue documents straight off the table, so a
-- read-time rule would have to be threaded through them as well — and the day one of them is
-- missed, the PM dashboard says a project has nothing overdue while the project page says it
-- has three. Two screens disagreeing about when something is due is precisely the failure
-- this codebase works hardest to avoid (see src/pages/im/im-manual-status.ts).
--
-- So the phase date is CASCADED INTO `project_documents.deadline` on write. The stored column
-- stays the effective date, every existing reader keeps working untouched and unmodified, and
-- there is no resolution rule for a future caller to forget. The cost is one denormalised
-- copy, and the trigger below is what keeps it honest: it fires on any update of the phase
-- date, so the copy cannot drift.
--
-- `deadline_is_custom` is what makes "inherit" and "override" distinguishable. Without it a
-- cascade could not tell a date somebody chose from one it had written itself, and the first
-- phase-date change would silently flatten every individually-agreed date on the project.

-- ===========================================================================
-- 1. The phase date
-- ===========================================================================

alter table public.project_steps
  add column if not exists deadline date;

comment on column public.project_steps.deadline is
  'Due date for the whole phase. Cascades into project_documents.deadline and im_draft_requests.due_date for every row in the phase that has not overridden it (see trg_project_steps_cascade_deadline).';

-- ===========================================================================
-- 2. The override marker
-- ===========================================================================

alter table public.project_documents
  add column if not exists deadline_is_custom boolean not null default false;

alter table public.im_draft_requests
  add column if not exists due_date_is_custom boolean not null default false;

comment on column public.project_documents.deadline_is_custom is
  'True when this document''s deadline was set on its own and must survive a phase-date change. False means the date is the phase''s and moves with it.';

-- EVERY EXISTING DATE IS TREATED AS AN OVERRIDE. Those dates were agreed one document at a
-- time — there was no other way to set them — so the first phase deadline anyone saves must
-- not wipe them. A PM who wants a row back on the phase date clears the override explicitly.
update public.project_documents
   set deadline_is_custom = true
 where deadline is not null
   and deadline_is_custom = false;

update public.im_draft_requests
   set due_date_is_custom = true
 where due_date is not null
   and due_date_is_custom = false;

-- ===========================================================================
-- 3. The cascade
-- ===========================================================================

create or replace function public.project_steps_cascade_deadline()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- Only when the phase date actually moved. A rename or a status change must not disturb
  -- dates, and `is distinct from` covers the NULL transitions that `<>` would miss.
  if new.deadline is not distinct from old.deadline then
    return new;
  end if;

  update public.project_documents d
     set deadline = new.deadline
   where d.project_id = new.project_id
     and d.step_number = new.step_number
     and d.deadline_is_custom = false;

  -- The supplier's draft manual is a document of that phase like any other (migration 180),
  -- so it follows the same date. Keyed on the request's own step_number rather than assuming
  -- 2, because that column exists precisely so a differently-numbered template still works.
  update public.im_draft_requests r
     set due_date = new.deadline
   where r.project_id = new.project_id
     and r.step_number = new.step_number
     and r.due_date_is_custom = false;

  return new;
end;
$fn$;

drop trigger if exists trg_project_steps_cascade_deadline on public.project_steps;
create trigger trg_project_steps_cascade_deadline
  after update on public.project_steps
  for each row execute function public.project_steps_cascade_deadline();

-- A document added to a phase later inherits the date already on it. Without this, an ad-hoc
-- document or a newly seeded checklist row would be the one thing in the phase with no date,
-- and nobody would think to look.
create or replace function public.project_documents_inherit_deadline()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare v_deadline date;
begin
  if new.deadline is not null or new.project_id is null or new.step_number is null then
    return new;
  end if;

  select s.deadline into v_deadline
    from public.project_steps s
   where s.project_id = new.project_id
     and s.step_number = new.step_number;

  if v_deadline is not null then
    new.deadline := v_deadline;
    new.deadline_is_custom := false;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_project_documents_inherit_deadline on public.project_documents;
create trigger trg_project_documents_inherit_deadline
  before insert on public.project_documents
  for each row execute function public.project_documents_inherit_deadline();

notify pgrst, 'reload schema';

-- ===========================================================================
-- Verification (run after applying)
-- ===========================================================================
--
-- 1. Every pre-existing date is marked as an override (expect 0 rows):
--      select count(*) from public.project_documents
--      where deadline is not null and deadline_is_custom = false;
--
-- 2. The cascade moves inherited dates and leaves overrides alone. On a scratch project:
--      update public.project_steps set deadline = '2026-10-15'
--       where project_id = :p and step_number = 2;
--      select title, deadline, deadline_is_custom from public.project_documents
--       where project_id = :p and step_number = 2;
--    every deadline_is_custom = false row should now read 2026-10-15; the true ones unchanged.
--
-- 3. A rename does NOT touch dates:
--      update public.project_steps set name = name || ' ' where project_id = :p;
--    -- no deadline changes.
--
-- 4. A document inserted into a phase that has a date picks it up:
--      insert into public.project_documents (project_id, step_number, title)
--      values (:p, 2, 'Late addition') returning deadline, deadline_is_custom;
--    -- expect the phase date, and false.
