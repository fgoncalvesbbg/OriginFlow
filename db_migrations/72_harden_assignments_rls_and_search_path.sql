-- Migration 72: Misc hardening surfaced by the security advisor (APPLIED, non-breaking)
--
-- 1. supplier_pm_assignments had RLS DISABLED while anon held full
--    SELECT/INSERT/UPDATE/DELETE/TRUNCATE grants — anon could read and tamper
--    with PM<->supplier assignments. Enable RLS, grant authenticated full access
--    (matches current PM-app behaviour), and revoke all anon DML.
ALTER TABLE public.supplier_pm_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_supplier_pm_assignments" ON public.supplier_pm_assignments;
CREATE POLICY "auth_all_supplier_pm_assignments" ON public.supplier_pm_assignments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.supplier_pm_assignments FROM anon;

-- 2. Pin search_path on the remaining SECURITY DEFINER functions the linter
--    flagged as having a role-mutable search_path (hardening against schema
--    shadowing). New portal RPCs (migrations 69/70) already SET search_path.
DO $$
DECLARE sig text;
BEGIN
  FOR sig IN
    SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('get_project_by_token','generate_access_code','ensure_access_code',
                        'get_compliance_request_secure','submit_compliance_response_secure')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%s SET search_path = public;', sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
