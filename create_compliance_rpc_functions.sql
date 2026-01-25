-- Create RPC function: get_compliance_request_secure
-- Securely retrieves a compliance request by token and access code
CREATE OR REPLACE FUNCTION get_compliance_request_secure(
  p_token uuid,
  p_code text
)
RETURNS TABLE(
  id uuid,
  request_id text,
  project_id uuid,
  project_name text,
  supplier_id uuid,
  category_id uuid,
  features jsonb,
  status text,
  responses jsonb,
  token uuid,
  access_code text,
  created_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_by text,
  deadline date,
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
    cr.updated_by,
    cr.deadline,
    cr.change_log,
    cr.respondent_name,
    cr.respondent_position
  FROM compliance_requests cr
  WHERE cr.token = p_token AND cr.access_code = p_code
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create RPC function: submit_compliance_response_secure
-- Securely submits compliance responses using token and access code
CREATE OR REPLACE FUNCTION submit_compliance_response_secure(
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
  -- Find the compliance request
  SELECT cr.id INTO v_request_id
  FROM compliance_requests cr
  WHERE cr.token = p_token AND cr.access_code = p_code
  LIMIT 1;

  -- If request not found, return error
  IF v_request_id IS NULL THEN
    RETURN QUERY SELECT false, 'Invalid token or access code'::text;
    RETURN;
  END IF;

  -- Update the compliance request with responses
  UPDATE compliance_requests
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

-- Ensure these functions are accessible via the REST API
GRANT EXECUTE ON FUNCTION get_compliance_request_secure(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_compliance_response_secure(uuid, text, jsonb, text, text, text) TO anon, authenticated;
