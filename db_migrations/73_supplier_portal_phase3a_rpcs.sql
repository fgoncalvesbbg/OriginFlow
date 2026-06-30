-- Migration 73: Supplier portal — PHASE 3a (APPLIED, additive / non-breaking)
--
-- RPCs that move RFQ + supplier-proposal access off direct anon table reads/writes.
-- Additive: old anon paths keep working until migration 74 revokes them.
-- Also applied here: REVOKE DELETE, TRUNCATE on rfq_entries/rfqs/supplier_proposals
-- from anon (safe immediately — the portal never deletes these).
--
-- Token model: rfq_entries.token (text) is the per-entry capability token used by
-- SupplierRFQPortal; suppliers.portal_token + access_code gate the dashboard lists.

REVOKE DELETE, TRUNCATE ON public.rfq_entries        FROM anon;
REVOKE DELETE, TRUNCATE ON public.rfqs               FROM anon;
REVOKE DELETE, TRUNCATE ON public.supplier_proposals FROM anon;

-- ---- RFQ portal: entry + parent RFQ by the entry token ----
CREATE OR REPLACE FUNCTION public.get_rfq_entry_by_token(p_token text)
RETURNS SETOF public.rfq_entries
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.rfq_entries WHERE token = p_token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_rfq_by_entry_token(p_token text)
RETURNS SETOF public.rfqs
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM public.rfqs r
  JOIN public.rfq_entries e ON e.rfq_id = r.id
  WHERE e.token = p_token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.submit_rfq_entry_secure(p_token text, p_payload jsonb)
RETURNS public.rfq_entries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rfq_entries;
BEGIN
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid RFQ entry token'; END IF;
  RETURN r;
END $$;

-- ---- Dashboard: open RFQ entries for a supplier (token + code) ----
CREATE OR REPLACE FUNCTION public.get_rfqs_for_supplier(p_supplier_token text, p_code text)
RETURNS TABLE (
  id uuid, rfq_id uuid, supplier_id uuid, token text, status text,
  unit_price numeric, moq integer, lead_time_weeks integer, tooling_cost numeric,
  currency text, supplier_notes text, submitted_at timestamptz, created_at timestamptz,
  quote_file_url text, attribute_responses jsonb, attachments jsonb,
  rfq_title text, rfq_identifier text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.rfq_id, e.supplier_id, e.token, e.status,
         e.unit_price, e.moq, e.lead_time_weeks, e.tooling_cost,
         e.currency, e.supplier_notes, e.submitted_at, e.created_at,
         e.quote_file_url, e.attribute_responses, e.attachments,
         r.title, r.rfq_id
  FROM public.rfq_entries e
  JOIN public.rfqs r ON r.id = e.rfq_id
  JOIN public.suppliers s ON s.id = e.supplier_id
  WHERE s.portal_token = p_supplier_token AND s.access_code = p_code
    AND r.status = 'open';
$$;

-- ---- Dashboard: proposals for a supplier (token + code) + create ----
CREATE OR REPLACE FUNCTION public.get_supplier_proposals(p_supplier_token text, p_code text)
RETURNS SETOF public.supplier_proposals
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT sp.* FROM public.supplier_proposals sp
  JOIN public.suppliers s ON s.id = sp.supplier_id
  WHERE s.portal_token = p_supplier_token AND s.access_code = p_code
  ORDER BY sp.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.create_supplier_proposal_secure(
  p_supplier_token text, p_code text, p_title text, p_description text,
  p_category_id text, p_attributes jsonb, p_thumbnail_url text, p_attachments jsonb
) RETURNS public.supplier_proposals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_supplier_id uuid; r public.supplier_proposals;
BEGIN
  SELECT s.id INTO v_supplier_id FROM public.suppliers s
   WHERE s.portal_token = p_supplier_token AND s.access_code = p_code;
  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'Not authorized'; END IF;
  INSERT INTO public.supplier_proposals
    (supplier_id, title, description, category_id, attributes, thumbnail_url, attachments, status, created_at)
  VALUES
    (v_supplier_id, p_title, p_description, NULLIF(p_category_id,''), COALESCE(p_attributes, '[]'::jsonb),
     p_thumbnail_url, COALESCE(p_attachments, '[]'::jsonb), 'new', now())
  RETURNING * INTO r;
  RETURN r;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN
    SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'get_rfq_entry_by_token','get_rfq_by_entry_token','submit_rfq_entry_secure',
        'get_rfqs_for_supplier','get_supplier_proposals','create_supplier_proposal_secure'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated;', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
