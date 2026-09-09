-- 168 — make the notifications supplier+link conflict target reachable from PostgREST.
--
-- Migration 148 created the uniqueness that upsertSupplierNotification relies on, but
-- created it as a PARTIAL index:
--
--   create unique index notifications_supplier_link_uidx
--     on public.notifications (supplier_id, link)
--     where supplier_id is not null;
--
-- PostgREST sends `?on_conflict=supplier_id,link` and nothing else — there is no way to
-- attach an index predicate to it. Postgres will only infer a partial index as the
-- arbiter when the statement carries a matching `ON CONFLICT ... WHERE` predicate, so the
-- upsert failed at plan time on every app mount with
--
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- and the reminder was swallowed by the best-effort catch in upsertSupplierNotification.
-- This is the same trap already documented in im-placeholder-answer.service.ts.
--
-- The predicate was redundant to begin with. A unique index is NULLS DISTINCT by default,
-- so a row with a null supplier_id never collides with anything regardless of the WHERE
-- clause: uniqueness is only ever enforced across rows where both columns are non-null.
-- Dropping the predicate therefore changes no invariant, it only makes the index
-- inferrable. Verified before writing: 4 rows live, none with a null supplier_id or link,
-- and no (supplier_id, link) duplicates, so the non-partial index builds without error.

create unique index if not exists notifications_supplier_link_key
  on public.notifications (supplier_id, link);

drop index if exists public.notifications_supplier_link_uidx;
