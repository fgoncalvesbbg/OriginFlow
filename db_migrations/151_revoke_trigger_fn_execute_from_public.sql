-- 151: finish the job 150's A5 started — revoke trigger-function EXECUTE from PUBLIC.
--
-- 150 A5 wrote `revoke execute on function ... from anon, authenticated`. That was a NO-OP.
-- Postgres grants EXECUTE on every new function to PUBLIC by default, and `anon` inherits it
-- through PUBLIC rather than through a direct grant — so revoking from `anon` removes a grant
-- that was never there. Verified after 150 ran: the ACL on all seven is still
--
--     {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--          ^-- the empty grantee IS "PUBLIC"
--
-- and has_function_privilege('anon', oid, 'EXECUTE') still returns true.
--
-- Revoking from PUBLIC is safe for trigger functions: Postgres checks EXECUTE on the
-- function when the TRIGGER IS CREATED, not each time it fires. Existing triggers keep
-- working. service_role keeps its explicit grant either way.
--
-- Impact is low — PostgREST refuses to invoke a function returning `trigger` over RPC, so
-- this was never directly exploitable. It clears 7 of the Supabase advisor's
-- anon_security_definer_function_executable warnings so the remaining ones (the real portal
-- RPCs) stay legible.

revoke execute on function public.enforce_profile_role_guard()      from public;
revoke execute on function public.ensure_access_code()              from public;
revoke execute on function public.handle_new_user()                 from public;
revoke execute on function public.im_sections_finalized_guard()     from public;
revoke execute on function public.im_templates_finalized_guard()    from public;
revoke execute on function public.im_tm_segments_governance_guard() from public;
revoke execute on function public.project_ims_finalized_guard()     from public;

-- VERIFY — expect 0 rows.
--   select p.proname, p.proacl::text
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.prorettype = 'trigger'::regtype
--      and has_function_privilege('anon', p.oid, 'EXECUTE');
--
-- And confirm the guards still fire (finalized IM should reject an edit):
--   update im_sections set title = title where project_im_id in
--     (select id from project_ims where finalized_at is not null) limit 1;
