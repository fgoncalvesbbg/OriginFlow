-- Migration 69: Secure the standalone supplier compliance portal list
--
-- The /compliance/supplier-portal page previously listed a supplier's compliance
-- requests (including each request's access code) given only a typed supplier ID —
-- no secret, no authentication — and the direct table read was also blocked by RLS
-- for the anonymous portal client.
--
-- This adds a SECURITY DEFINER RPC that requires the supplier's code AND their portal
-- access code. Only someone who already holds the supplier's 6-digit access code can
-- list that supplier's compliance requests, matching how the supplier dashboard gates
-- the same data.

CREATE OR REPLACE FUNCTION public.get_compliance_requests_by_supplier_code(
  p_code text,
  p_access_code text
)
RETURNS SETOF public.compliance_requests
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT cr.*
  FROM public.compliance_requests cr
  JOIN public.suppliers s ON s.id = cr.supplier_id
  WHERE s.code = p_code
    AND s.access_code IS NOT NULL
    AND s.access_code = p_access_code;
$$;

COMMENT ON FUNCTION public.get_compliance_requests_by_supplier_code(text, text)
  IS 'Lists a supplier''s compliance requests for the standalone supplier compliance portal, authenticated by supplier code + portal access code.';

-- anon: unauthenticated supplier portal users; authenticated: internal/API use
GRANT EXECUTE ON FUNCTION public.get_compliance_requests_by_supplier_code(text, text) TO anon, authenticated;

-- Notify PostgREST to reload the schema cache so the RPC is immediately callable
NOTIFY pgrst, 'reload schema';
