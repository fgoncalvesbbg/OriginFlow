-- 145: retire dead authentication/authorisation surfaces found in the 2026-09 audit.
-- APPLIED to production 2026-09-05.
--
-- 1. public.user_profiles - 5 rows, carries a `role` column and an UPDATE policy with a
--    NULL WITH CHECK (so a row could be updated into a state the USING clause forbids).
--    Referenced by ZERO application code: the app reads roles from public.profiles, which
--    is guarded by enforce_profile_role_guard(). Archived rather than deleted.
-- 2. public.get_project_by_token(text) - legacy anon-callable SECURITY DEFINER RPC
--    returning SETOF projects (the FULL project row, including supplier_link_token).
--    The app exclusively calls get_project_by_token_secure(p_token).
-- 3. attribute_usage(uuid[]) - SECURITY DEFINER, anon-executable, runs five
--    LIKE '%uuid%' scans across project_ims/im_blocks/im_templates per id. Cheap DoS and
--    an existence oracle for attribute ids. Only ever called by signed-in staff.
--
-- ROLLBACK:
--   create table public.user_profiles as
--     select email, role, allowed_modules, created_at, last_login
--     from private_archive.user_profiles_145;   -- then re-add RLS/policies
--   create function public.get_project_by_token(token_input text) returns setof projects
--     language sql security definer set search_path to 'public'
--     as $rb$ select * from projects where supplier_link_token = token_input; $rb$;
--   grant execute on function public.attribute_usage(uuid[]) to anon;

create schema if not exists private_archive;
revoke all on schema private_archive from public, anon, authenticated;

create table if not exists private_archive.user_profiles_145 as
  select *, now() as archived_at from public.user_profiles;

comment on table private_archive.user_profiles_145 is
  'Archive of public.user_profiles taken 2026-09-05 before dropping it (audit finding: dead table with a role column and a WITH CHECK-less UPDATE policy). Restore from here if anything turns out to have depended on it.';

drop table if exists public.user_profiles;

drop function if exists public.get_project_by_token(text);

revoke execute on function public.attribute_usage(uuid[]) from anon, public;
grant execute on function public.attribute_usage(uuid[]) to authenticated;
