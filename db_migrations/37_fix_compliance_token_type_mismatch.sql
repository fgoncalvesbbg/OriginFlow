-- Migration 37: Fix compliance token type mismatch and RPC function overload error
-- Resolves "Could not choose best candidate function" error in supplier portal
-- Issue: Database has token as text but RPC functions expect uuid, causing PostgreSQL
--        to be unable to determine which function overload to use
-- Solution: Convert token to uuid type and eliminate all function overloads

-- =====================================================
-- STEP 1: Add missing updated_at column
-- =====================================================
ALTER TABLE public.compliance_requests
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT timezone('utc'::text, now());

COMMENT ON COLUMN public.compliance_requests.updated_at IS 'Last modification timestamp for compliance request';

-- =====================================================
-- STEP 2: Drop conflicting RPC function overloads
-- =====================================================
-- Must drop ALL versions to eliminate overload ambiguity
-- PostgreSQL cannot choose between multiple overloads with same name but different param types
DROP FUNCTION IF EXISTS public.get_compliance_request_secure(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.get_compliance_request_secure(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.submit_compliance_response_secure(text, text, jsonb, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.submit_compliance_response_secure(uuid, text, jsonb, text, text, text) CASCADE;

-- =====================================================
-- STEP 3: Convert token column from text to uuid
-- =====================================================
-- Safe conversion: existing tokens are UUID strings from generateUUID() function
-- PostgreSQL will validate each token as a valid UUID before converting
-- If any token is invalid, the migration will fail (transactional safety)
ALTER TABLE public.compliance_requests
ALTER COLUMN token TYPE uuid USING token::uuid,
ALTER COLUMN token SET NOT NULL,
ALTER COLUMN token SET DEFAULT uuid_generate_v4();

-- =====================================================
-- STEP 4: Create performance index on token + access_code
-- =====================================================
-- This composite index optimizes the portal authentication query:
-- WHERE token = ? AND access_code = ?
-- Reduces lookup from O(n) to O(log n)
CREATE INDEX IF NOT EXISTS idx_compliance_requests_token_access
ON public.compliance_requests(token, access_code);

COMMENT ON INDEX idx_compliance_requests_token_access IS 'Optimizes supplier portal authentication lookup by token + access code';

-- =====================================================
-- STEP 5: Recreate RPC functions with correct signatures
-- =====================================================

-- Function: get_compliance_request_secure
-- Purpose: Securely retrieve compliance request for supplier portal
-- Auth: Uses token + 6-digit access code (no session auth required)
-- Return: Full compliance request with responses and status
-- Security: SECURITY DEFINER - executes as database owner, safe for anon users
CREATE OR REPLACE FUNCTION public.get_compliance_request_secure(
  p_token uuid,
  p_code text
)
RETURNS TABLE(
  id uuid,
  request_id text,
  project_id uuid,
  project_name text,
  supplier_id uuid,
  category_id text,
  features jsonb,
  status text,
  responses jsonb,
  token uuid,
  access_code text,
  created_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz,
  updated_by text,
  deadline timestamptz,
  change_log jsonb,
  respondent_name text,
  respondent_position text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cr.id,
    cr.request_id,
    cr.project_id,
    cr.project_name,
    cr.supplier_id,
    cr.category_id,
    cr.features,
    cr.status,
    cr.responses,
    cr.token,
    cr.access_code,
    cr.created_at,
    cr.submitted_at,
    cr.completed_at,
    cr.updated_at,
    cr.updated_by,
    cr.deadline,
    cr.change_log,
    cr.respondent_name,
    cr.respondent_position
  FROM public.compliance_requests cr
  WHERE cr.token = p_token AND cr.access_code = p_code
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.get_compliance_request_secure(uuid, text) IS 'Securely retrieves compliance request for supplier portal using token + access code authentication';

-- Function: submit_compliance_response_secure
-- Purpose: Securely submit supplier responses to compliance request
-- Auth: Uses token + 6-digit access code (no session auth required)
-- Input: Responses array, status, respondent name and position
-- Return: Success/failure message
-- Security: SECURITY DEFINER - validates auth before allowing update
CREATE OR REPLACE FUNCTION public.submit_compliance_response_secure(
  p_token uuid,
  p_code text,
  p_responses jsonb,
  p_status text,
  p_respondent_name text,
  p_respondent_position text
)
RETURNS TABLE(
  success boolean,
  message text
) AS $$
DECLARE
  v_request_id uuid;
BEGIN
  -- Find the compliance request (validates token + code combination)
  SELECT cr.id INTO v_request_id
  FROM public.compliance_requests cr
  WHERE cr.token = p_token AND cr.access_code = p_code
  LIMIT 1;

  -- If request not found, return error
  IF v_request_id IS NULL THEN
    RETURN QUERY SELECT false, 'Invalid token or access code'::text;
    RETURN;
  END IF;

  -- Update the compliance request with responses
  UPDATE public.compliance_requests
  SET
    responses = p_responses,
    status = p_status,
    respondent_name = p_respondent_name,
    respondent_position = p_respondent_position,
    submitted_at = CASE WHEN p_status = 'submitted' THEN NOW() ELSE submitted_at END,
    updated_at = NOW()
  WHERE id = v_request_id;

  RETURN QUERY SELECT true, 'Response submitted successfully'::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.submit_compliance_response_secure(uuid, text, jsonb, text, text, text) IS 'Securely submits supplier compliance responses via portal using token + access code authentication';

-- =====================================================
-- STEP 6: Grant permissions for portal access
-- =====================================================
-- anon role: Unauthenticated supplier portal users
-- authenticated role: Internal users and future API access
GRANT EXECUTE ON FUNCTION public.get_compliance_request_secure(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_compliance_response_secure(uuid, text, jsonb, text, text, text) TO anon, authenticated;

-- =====================================================
-- STEP 7: Force schema reload (Supabase-specific)
-- =====================================================
-- Notifies PostgREST to reload the schema cache
-- Ensures new functions are immediately available via REST API
NOTIFY pgrst, 'reload schema';
