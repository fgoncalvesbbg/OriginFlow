-- Migration 136: one shareable link for a whole batch of SKU attribute requests
--
-- Today every SKU attribute request is its own token/page (project_attribute_requests.token,
-- SupplierAttributePortal). When a PM sends several SKUs together (handleSendAllSkusForReview /
-- handleSendAllProductionRequests in ProjectDetail.tsx), the supplier gets N separate links and
-- fills N separate forms one at a time, even though the attribute SET is identical across them
-- (same category). Migration 135 let a supplier mark a field "same for all" from inside one of
-- those pages, but that's still N page loads.
--
-- This adds a batch_token shared by every request created in one bulk-send action. A single
-- link built from it opens a side-by-side grid (SKUs as columns, attributes as rows, like the
-- internal AttributeViewer) and submits every SKU in one action.
--
-- Additive and backward compatible:
--   * batch_token is nullable. Existing rows and single-SKU sends keep batch_token = NULL and
--     keep working exactly as before, on their existing per-row link.
--   * The per-row RPCs from migration 135 (get_sibling_attribute_requests_by_token /
--     submit_attribute_request_secure's shared-id fan-out) are untouched, so an already-sent
--     batch of individual links (created before this shipped) still gets that behaviour.
--   * project_attribute_requests.token remains each row's own capability token; batch_token is
--     a second, coarser one that addresses the whole set.

ALTER TABLE public.project_attribute_requests
  ADD COLUMN IF NOT EXISTS batch_token uuid;

CREATE INDEX IF NOT EXISTS idx_project_attribute_requests_batch_token
  ON public.project_attribute_requests (batch_token) WHERE batch_token IS NOT NULL;

COMMENT ON COLUMN public.project_attribute_requests.batch_token IS
  'Shared by every request created in one bulk-send action. NULL for a single-SKU send. See get_attribute_requests_by_batch_token / submit_attribute_batch_secure.';

-- Read: every request in a batch, for the grid page. Same trust model as
-- get_attribute_request_by_token — holding the token is the credential.
CREATE OR REPLACE FUNCTION public.get_attribute_requests_by_batch_token(p_batch_token uuid)
RETURNS SETOF public.project_attribute_requests
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.project_attribute_requests
  WHERE batch_token = p_batch_token
  ORDER BY sku_number;
$$;

-- Write: submit some or all rows of a batch in one call.
--
-- p_rows: [{"token": "<row token uuid>", "data": [{"attributeId","name","value","type"}, ...]}, ...]
--
-- Each entry is applied ONLY if its token both belongs to THIS batch_token and is still
-- 'pending' — a row already submitted (individually, or by a concurrent/duplicate call) is
-- left untouched rather than overwritten. Unknown or foreign tokens in p_rows are silently
-- ignored rather than erroring the whole batch, so a stale client can't fail an otherwise
-- valid submit. Returns the batch's current state so the confirmation screen can render
-- straight from the result with no extra round trip.
CREATE OR REPLACE FUNCTION public.submit_attribute_batch_secure(p_batch_token uuid, p_rows jsonb)
RETURNS SETOF public.project_attribute_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb;
BEGIN
  FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  LOOP
    UPDATE public.project_attribute_requests
       SET status = 'submitted',
           submitted_data = coalesce(v_row->'data', '[]'::jsonb),
           submitted_at = now()
     WHERE token = (v_row->>'token')::uuid
       AND batch_token = p_batch_token
       AND status = 'pending';
  END LOOP;

  RETURN QUERY
    SELECT * FROM public.project_attribute_requests
    WHERE batch_token = p_batch_token
    ORDER BY sku_number;
END $$;

REVOKE ALL ON FUNCTION public.get_attribute_requests_by_batch_token(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_attribute_requests_by_batch_token(uuid) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.submit_attribute_batch_secure(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_attribute_batch_secure(uuid, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
