-- 148 — PM project inbox: per-user dismissals, and notifications that are actually private.
--
-- Two separate problems, one migration, because the inbox panel depends on both.
--
-- 1. DISMISSALS. The inbox aggregates rows the PM does not own and must not mutate
--    (a submitted compliance request, a new supplier proposal, an open review note).
--    "Dismiss" therefore cannot be a column on the source row — it is a per-user
--    acknowledgement, stored here, keyed by an opaque item key.
--
--    The key deliberately encodes the item's STATE (`attribute_request:<id>:pending`).
--    Dismissing "waiting on supplier" acknowledges only that wait; when the supplier
--    submits, the item's key becomes `…:submitted`, no dismissal matches, and it
--    reappears under "Needs your review". Dismissing can never lose a follow-up.
--
-- 2. NOTIFICATION PRIVACY. The policy this replaces was
--       for all using (auth.role() = 'authenticated')
--    i.e. every signed-in user could read every notification row. Every row in the
--    table is in fact supplier-directed (user_id null, supplier_id set) and carries a
--    `/compliance/supplier/<token>` link, so the staff notification bell was rendering
--    the suppliers' mail — and offering staff a click straight into a supplier's
--    unauthenticated portal using that supplier's bearer token. Read is now own-rows-only.

-- --- 1. Dismissals -------------------------------------------------------------

create table if not exists public.pm_inbox_dismissals (
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  item_key     text        not null,
  dismissed_at timestamptz not null default timezone('utc'::text, now()),
  primary key (user_id, item_key)
);

comment on column public.pm_inbox_dismissals.item_key is
  'Opaque `<kind>:<id>:<state>` key from src/services/shared/pm-inbox.service.ts. State is part of the key so a status change resurfaces the item.';

alter table public.pm_inbox_dismissals enable row level security;

drop policy if exists "pm_inbox_dismissals_own" on public.pm_inbox_dismissals;
create policy "pm_inbox_dismissals_own" on public.pm_inbox_dismissals
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- --- 2. Notifications ----------------------------------------------------------

-- The idempotency in upsertSupplierNotification was read-then-write and raced: the live
-- table holds two rows for the same (supplier_id, link) created 73ms apart, one saying
-- "overdue by 112 day(s)" and one "overdue by 153 day(s)". Collapse to the newest, then
-- let the database hold the invariant instead of the application.
-- Scoped to link is not null on purpose: that is exactly what the partial unique index
-- below can enforce (a null link is distinct from every other null in a unique index),
-- so null-link rows are left alone rather than silently collapsed.
delete from public.notifications n
using public.notifications keep
where n.supplier_id is not null
  and n.link is not null
  and keep.supplier_id = n.supplier_id
  and keep.link = n.link
  and (keep.created_at, keep.id) > (n.created_at, n.id);

create unique index if not exists notifications_supplier_link_uidx
  on public.notifications (supplier_id, link)
  where supplier_id is not null;

-- Dismissal is not the same event as "I have seen this", and the inbox needs to tell them
-- apart: read = the badge stops counting it, dismissed = it leaves the list.
alter table public.notifications
  add column if not exists dismissed_at timestamptz;

drop policy if exists "Enable all for notifications" on public.notifications;

-- Read: your own mail, and only yours. Supplier-directed rows (user_id null) are now
-- invisible to every staff client; the supplier portal reads them through its own
-- SECURITY DEFINER routines, never through this table.
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- Write: staff may address a notification to themselves or to a supplier. Nothing may
-- write mail into another staff member's inbox from the client.
drop policy if exists "notifications_insert_self_or_supplier" on public.notifications;
create policy "notifications_insert_self_or_supplier" on public.notifications
  for insert to authenticated
  with check (user_id = auth.uid() or (user_id is null and supplier_id is not null));

-- Update covers both marking your own row read/dismissed and the supplier-reminder
-- upsert's ON CONFLICT path. That path uses Prefer: return=minimal (DatabasePort.upsert
-- returns void), so it needs no select policy on the supplier row.
drop policy if exists "notifications_update_own_or_supplier" on public.notifications;
create policy "notifications_update_own_or_supplier" on public.notifications
  for update to authenticated
  using (user_id = auth.uid() or (user_id is null and supplier_id is not null))
  with check (user_id = auth.uid() or (user_id is null and supplier_id is not null));

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());
