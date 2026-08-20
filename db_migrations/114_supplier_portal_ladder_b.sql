-- 114 — Supplier portal: Ladder B fixes from docs/ux-audit/2026-08-20-supplier-portal.md
--
-- B2  Deadlines on RFQs and attribute requests. Compliance requests already carry
--     `deadline`; these two did not, so a supplier had no way to know what was due
--     when and every request turned into a PM chase cycle.
-- B4  `submit_rfq_entry_secure` accepted quotes into closed and awarded RFQs, and
--     would flip an already-awarded entry back to 'submitted'. Both are now refused.
-- B6  `copied_from_sku` records that a request was prefilled from a sibling regional
--     variant, so the portal can say where the values came from instead of presenting
--     another supplier-facing form full of unexplained pre-filled data.
--
-- All column additions are nullable and additive: existing rows and existing readers
-- are unaffected.

-- ---- B2: deadlines -------------------------------------------------------------

ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS deadline timestamptz;

ALTER TABLE public.project_attribute_requests
  ADD COLUMN IF NOT EXISTS deadline timestamptz;

COMMENT ON COLUMN public.rfqs.deadline IS
  'When the quote is due back from the supplier. Shown in the supplier RFQ portal.';
COMMENT ON COLUMN public.project_attribute_requests.deadline IS
  'When the attribute data is due back from the supplier. Shown in the supplier portal.';

-- ---- B6: provenance of prefilled attribute data --------------------------------

ALTER TABLE public.project_attribute_requests
  ADD COLUMN IF NOT EXISTS copied_from_sku text;

COMMENT ON COLUMN public.project_attribute_requests.copied_from_sku IS
  'SKU whose submitted values were copied into submitted_data as a starting point '
  '(regional variants share most attributes). NULL when the prefill came from the '
  'same SKU''s earlier stage or from the PM''s own spec.';

-- ---- B2: expose the RFQ deadline to the supplier dashboard ---------------------
-- The return signature changes, so this needs DROP + CREATE rather than REPLACE.

DROP FUNCTION IF EXISTS public.get_rfqs_for_supplier(text, text);

CREATE FUNCTION public.get_rfqs_for_supplier(p_supplier_token text, p_code text)
RETURNS TABLE (
  id uuid, rfq_id uuid, supplier_id uuid, token text, status text,
  unit_price numeric, moq integer, lead_time_weeks integer, tooling_cost numeric,
  currency text, supplier_notes text, submitted_at timestamptz, created_at timestamptz,
  quote_file_url text, attribute_responses jsonb, attachments jsonb,
  rfq_title text, rfq_identifier text, rfq_deadline timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.rfq_id, e.supplier_id, e.token, e.status,
         e.unit_price, e.moq, e.lead_time_weeks, e.tooling_cost,
         e.currency, e.supplier_notes, e.submitted_at, e.created_at,
         e.quote_file_url, e.attribute_responses, e.attachments,
         r.title, r.rfq_id, r.deadline
  FROM public.rfq_entries e
  JOIN public.rfqs r ON r.id = e.rfq_id
  JOIN public.suppliers s ON s.id = e.supplier_id
  WHERE s.portal_token = p_supplier_token AND s.access_code = p_code
    AND r.status = 'open';
$$;

-- ---- B4: refuse quotes into closed / awarded RFQs ------------------------------

CREATE OR REPLACE FUNCTION public.submit_rfq_entry_secure(p_token text, p_payload jsonb)
RETURNS public.rfq_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.rfq_entries;
  v_entry public.rfq_entries;
  v_rfq_status text;
BEGIN
  SELECT e.* INTO v_entry FROM public.rfq_entries e WHERE e.token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid RFQ entry token';
  END IF;

  SELECT rq.status INTO v_rfq_status FROM public.rfqs rq WHERE rq.id = v_entry.rfq_id;

  -- The sourcing round is over: a late quote must not land silently after the
  -- comparison was made. The portal renders a "closed" state for the same reason.
  IF v_rfq_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'This RFQ is no longer open for quotes.';
  END IF;

  -- An awarded entry is the commercial record of the decision. Reopening it is a
  -- PM action (status back to 'pending'), never a supplier one.
  IF v_entry.status = 'awarded' THEN
    RAISE EXCEPTION 'This quote has been awarded and can no longer be changed.';
  END IF;

  UPDATE public.rfq_entries SET
    status = 'submitted',
    submitted_at = now(),
    unit_price = NULLIF(p_payload->>'unit_price','')::numeric,
    moq = NULLIF(p_payload->>'moq','')::int,
    lead_time_weeks = NULLIF(p_payload->>'lead_time_weeks','')::int,
    tooling_cost = NULLIF(p_payload->>'tooling_cost','')::numeric,
    currency = p_payload->>'currency',
    supplier_notes = p_payload->>'supplier_notes',
    quote_file_url = p_payload->>'quote_file_url',
    attachments = COALESCE(p_payload->'attachments', '[]'::jsonb),
    attribute_responses = COALESCE(p_payload->'attribute_responses', '[]'::jsonb)
  WHERE token = p_token
  RETURNING * INTO r;

  RETURN r;
END $$;

-- Re-apply the portal grants (DROP above removed them for get_rfqs_for_supplier).
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN
    SELECT format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('get_rfqs_for_supplier', 'submit_rfq_entry_secure')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated;', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
