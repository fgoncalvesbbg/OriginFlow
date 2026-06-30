-- Migration 69: Supplier portal security hardening — PHASE 1 (non-breaking)
--
-- Context: a security audit found the supplier portal relies entirely on the
-- public anon key + RLS, but anon had full DELETE/INSERT/UPDATE/TRUNCATE grants
-- on every portal table (migration 36's REVOKEs were never applied), the
-- `suppliers` SELECT policy exposed `access_code`, and supplier "login" was a
-- client-side string compare.
--
-- This phase is SAFE TO APPLY IMMEDIATELY: it only removes anon privileges that
-- the portal never exercises (deletes, and writes to suppliers/projects/
-- compliance_requests, which already go through SECURITY DEFINER RPCs), and adds
-- two additive RPCs. It does NOT change any read path the live portal depends on.
--
-- Migrations 69b/70 are also non-breaking (applied). Phase 2b (migration 71)
-- performs the breaking lockdown and MUST be applied only AFTER the updated
-- frontend is deployed.

-- =====================================================
-- 1. Revoke destructive / unused anon privileges
-- =====================================================

-- anon never deletes or truncates any portal table.
REVOKE DELETE, TRUNCATE ON public.suppliers                 FROM anon;
REVOKE DELETE, TRUNCATE ON public.projects                  FROM anon;
REVOKE DELETE, TRUNCATE ON public.project_documents         FROM anon;
REVOKE DELETE, TRUNCATE ON public.document_comments         FROM anon;
REVOKE DELETE, TRUNCATE ON public.project_attribute_requests FROM anon;
REVOKE DELETE, TRUNCATE ON public.compliance_requests       FROM anon;

-- anon never writes these tables directly: supplier/project mutations are done by
-- authenticated PMs, and compliance submissions go through
-- submit_compliance_response_secure() (SECURITY DEFINER). These writes are
-- already blocked by RLS today; revoking the grants is defense-in-depth.
REVOKE INSERT, UPDATE ON public.suppliers           FROM anon;
REVOKE INSERT, UPDATE ON public.projects            FROM anon;
REVOKE INSERT, UPDATE ON public.compliance_requests FROM anon;

-- =====================================================
-- 2. Remove duplicate public SELECT policy on compliance_requests
-- =====================================================
-- Two identical USING(true) SELECT policies exist; keep one.
DROP POLICY IF EXISTS "Allow public access to compliance_requests via token" ON public.compliance_requests;

-- =====================================================
-- 3. Secure supplier-auth RPCs (additive, used by the new frontend)
-- =====================================================

-- Returns non-secret supplier fields for a portal token WITHOUT exposing
-- access_code. Lets the portal render the supplier name / "enter code" screen
-- without shipping the secret to the browser.
CREATE OR REPLACE FUNCTION public.get_supplier_by_token_safe(p_token text)
RETURNS TABLE (
  id uuid,
  name text,
  code text,
  email text,
  portal_token text,
  has_access_code boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.code, s.email, s.portal_token,
         (s.access_code IS NOT NULL AND s.access_code <> '') AS has_access_code
  FROM public.suppliers s
  WHERE s.portal_token = p_token
  LIMIT 1;
$$;

-- Server-side verification of the 6-digit access code. Returns the supplier's
-- safe fields ONLY when token + code match; returns zero rows otherwise. The
-- secret never leaves the database.
CREATE OR REPLACE FUNCTION public.verify_supplier_access(p_token text, p_code text)
RETURNS TABLE (
  id uuid,
  name text,
  code text,
  email text,
  portal_token text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.code, s.email, s.portal_token
  FROM public.suppliers s
  WHERE s.portal_token = p_token
    AND s.access_code IS NOT NULL
    AND s.access_code = p_code
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_supplier_by_token_safe(text)       FROM public;
REVOKE ALL ON FUNCTION public.verify_supplier_access(text, text)      FROM public;
GRANT EXECUTE ON FUNCTION public.get_supplier_by_token_safe(text)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_supplier_access(text, text)   TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
