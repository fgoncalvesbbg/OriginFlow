-- Migration 135: let a supplier copy shared attribute values across a batch of SKUs
--
-- Several SKU attribute-data requests are often created together for the same project +
-- category + step (see ProjectDetail.tsx's bulk request creation and siblingPrefill). Today
-- each is its own token/page (SupplierAttributePortal), and a supplier retypes identical
-- specs on every one. This adds:
--
--   1. get_sibling_attribute_requests_by_token — read-only: given one request's token,
--      returns the OTHER requests in the same batch (same project_id, category_id, step),
--      so the portal can tell the supplier "this is 1 of N" before they fill anything in.
--
--   2. submit_attribute_request_secure gains an optional p_shared_attribute_ids param.
--      Values for those attribute ids, taken only from what was just submitted (p_data —
--      never a separate unchecked payload), are merged into every sibling request that is
--      still 'pending', and that sibling's copied_from_sku is set so the existing
--      "Copied from SKU X, please check each value" banner explains where it came from.
--      A submitted (locked) sibling is never touched. Existing two-argument callers are
--      unaffected: the new parameter defaults to empty, which is a no-op.
--
-- Batch scope is derived from the SUBMITTING request's own row (via its token), not from
-- client-supplied ids — a caller can only fan a value out to peers of the request they
-- already hold a valid token for, matching the trust model the other portal RPCs use.

CREATE OR REPLACE FUNCTION public.get_sibling_attribute_requests_by_token(p_token uuid)
RETURNS TABLE (token uuid, sku_number text, sku_title text, status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.token, s.sku_number, s.sku_title, s.status
  FROM public.project_attribute_requests s
  JOIN public.project_attribute_requests self ON self.token = p_token
  WHERE s.project_id = self.project_id
    AND s.category_id IS NOT DISTINCT FROM self.category_id
    AND s.step = self.step
    AND s.token <> p_token
  ORDER BY s.sku_number;
$$;

-- A third parameter is a different signature, not a replacement — CREATE OR REPLACE alone
-- would leave the old 2-arg function in place alongside this one, and PostgREST would then
-- see two functions matching a 2-argument RPC call ("function is not unique"). Drop it first
-- so this single 3-arg version (default lets 2-arg calls keep working) is the only match.
DROP FUNCTION IF EXISTS public.submit_attribute_request_secure(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.submit_attribute_request_secure(
  p_token uuid,
  p_data jsonb,
  p_shared_attribute_ids text[] DEFAULT '{}'
) RETURNS public.project_attribute_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.project_attribute_requests;
  v_shared_data jsonb;
  v_sib record;
  v_kept jsonb;
BEGIN
  UPDATE public.project_attribute_requests
     SET status = 'submitted', submitted_data = p_data, submitted_at = now()
   WHERE token = p_token
  RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid attribute request token'; END IF;

  IF p_shared_attribute_ids IS NULL OR array_length(p_shared_attribute_ids, 1) IS NULL THEN
    RETURN r;
  END IF;

  -- Only the marked entries, and only what was actually just submitted for THIS request.
  SELECT coalesce(jsonb_agg(elem), '[]'::jsonb) INTO v_shared_data
  FROM jsonb_array_elements(p_data) elem
  WHERE (elem->>'attributeId') = ANY(p_shared_attribute_ids);

  IF v_shared_data = '[]'::jsonb THEN
    RETURN r;
  END IF;

  FOR v_sib IN
    SELECT id, submitted_data FROM public.project_attribute_requests
    WHERE project_id = r.project_id
      AND category_id IS NOT DISTINCT FROM r.category_id
      AND step = r.step
      AND status = 'pending'
      AND token <> p_token
  LOOP
    -- Merge by attributeId: drop the sibling's own entry for a shared id (if any), then
    -- append the shared entries. Everything else the sibling already had is left as-is.
    SELECT coalesce(jsonb_agg(elem), '[]'::jsonb) INTO v_kept
    FROM jsonb_array_elements(coalesce(v_sib.submitted_data, '[]'::jsonb)) elem
    WHERE NOT ((elem->>'attributeId') = ANY(p_shared_attribute_ids));

    UPDATE public.project_attribute_requests
       SET submitted_data = v_kept || v_shared_data,
           copied_from_sku = r.sku_number
     WHERE id = v_sib.id;
  END LOOP;

  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.get_sibling_attribute_requests_by_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_sibling_attribute_requests_by_token(uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.submit_attribute_request_secure(uuid, jsonb, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_attribute_request_secure(uuid, jsonb, text[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
