-- 146: stop storing plaintext supplier access codes in supplier_access_logs.
--
-- *** SUPERSEDED 2026-09-07 BY 150_audit_remediation.sql PART B — DO NOT RUN THIS FILE. ***
-- ***
-- *** Running it now fails with:
-- ***     ERROR: 42703: column "access_code" does not exist
-- *** and that error is the proof the problem is already fixed, not a sign of trouble.
-- ***
-- *** 150 Part B went further than this migration intended: instead of NULLing the column
-- *** and adding a trigger guard, it hashed each value into a new `code_fingerprint`
-- *** column (101 rows written) and then DROPPED `access_code` outright. A dropped column
-- *** cannot regress, so the strip_access_code_from_log() trigger below is unnecessary.
-- *** 150 also dropped the anon INSERT policy this file's header complains about.
-- ***
-- *** Verified live 2026-09-07: supplier_access_logs is now
-- ***   id, supplier_id, ip_address, success, attempt_count, created_at, code_fingerprint
-- *** with exactly one policy ("Allow authenticated users to read access logs", SELECT).
-- ***
-- *** STILL OUTSTANDING: the 3 supplier access codes that were exposed in this log were
-- *** never rotated. Dropping the column removed the copy; it did not invalidate the
-- *** credential. See SUPABASE_AUDIT_2026-09-07.md D4.
-- ***
-- *** Kept for history only. Original header follows.
--
-- *** NOT YET APPLIED — this migration was blocked by the local permission classifier on
-- *** 2026-09-05 and needs to be run manually (Supabase SQL editor) or re-approved.
-- *** Until it runs, 101 rows in supplier_access_logs still hold plaintext codes
-- *** (9 distinct values = effectively the live supplier access codes).
--
-- supplier_access_logs.access_code held the code the visitor TYPED, in plaintext, for
-- every attempt. The table is INSERTable by anon (WITH CHECK true) and SELECTable by
-- every authenticated user, and nothing in the application ever reads it. Real attempt
-- tracking already happens server-side in portal_access_attempts via portal_rl_guard().
--
-- The client half IS already done: logAccessCodeAttempt() in
-- src/services/supplier/supplier.service.ts no longer sends the code (and
-- SupplierDashboard.tsx no longer passes it), so no NEW plaintext codes are written.
-- This migration scrubs the existing history and makes a regression impossible.
--
-- The trigger nulls the value rather than rejecting the insert, so a still-deployed old
-- bundle keeps logging supplier_id/success/timestamp instead of erroring. The column
-- itself can be dropped once no deployed client sends it.

update public.supplier_access_logs
   set access_code = null
 where access_code is not null;

create or replace function public.strip_access_code_from_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.access_code := null;
  return new;
end;
$$;

revoke execute on function public.strip_access_code_from_log() from public, anon, authenticated;

comment on function public.strip_access_code_from_log() is
  'Trigger guard (migration 146): forces supplier_access_logs.access_code to NULL so an attempted portal code is never persisted in plaintext.';

drop trigger if exists strip_access_code_from_log_trg on public.supplier_access_logs;
create trigger strip_access_code_from_log_trg
  before insert or update on public.supplier_access_logs
  for each row execute function public.strip_access_code_from_log();

comment on column public.supplier_access_logs.access_code is
  'DEPRECATED, always NULL (migration 146). Never store the attempted code. Drop this column once no deployed client sends it.';
