-- 146: stop storing plaintext supplier access codes in supplier_access_logs.
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
