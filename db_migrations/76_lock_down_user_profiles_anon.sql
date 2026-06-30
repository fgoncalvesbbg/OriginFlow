-- Migration 76: Lock down legacy user_profiles table (APPLIED, non-breaking)
--
-- `user_profiles` is a legacy table NOT referenced anywhere in the app (the app
-- uses `profiles`). It exposed public USING(true) SELECT + INSERT policies, so
-- anon could read every row (email/role harvest) and insert arbitrary rows —
-- including role='admin', a latent privilege-escalation surface. Remove anon
-- access; keep the jwt/admin-scoped authenticated policies. SECURITY DEFINER
-- trigger writes (e.g. handle_new_user) are unaffected.

DROP POLICY IF EXISTS "Enable insert for all users"      ON public.user_profiles;
DROP POLICY IF EXISTS "Allow insert during bootstrap"    ON public.user_profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.user_profiles;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.user_profiles FROM anon;

NOTIFY pgrst, 'reload schema';
