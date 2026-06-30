-- Migration 70: Supplier portal — PHASE 2a (APPLIED, additive / non-breaking)
--
-- Adds the SECURITY DEFINER RPCs the hardened frontend uses for supplier writes
-- and token+code-scoped reads. These are additive: the old anon table paths keep
-- working until migration 71 revokes them. Apply order: 69 -> 69b -> 70 -> deploy
-- frontend -> 71.
--
-- Token model:
--   * projects.supplier_link_token  — project portal token (SupplierPortal)
--   * suppliers.portal_token         — supplier dashboard token (SupplierDashboard)
--   * project_attribute_requests.token (uuid) — per-request capability token

-- ---- Documents: writes scoped to the project portal token ----
CREATE OR REPLACE FUNCTION public.supplier_set_document_file(
  p_project_token text, p_doc_id uuid, p_file_url text
) RETURNS public.project_documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.project_documents;
BEGIN
  UPDATE public.project_documents d
     SET file_url = p_file_url, status = 'uploaded', uploaded_at = now(), uploaded_by_supplier = true
   WHERE d.id = p_doc_id
     AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = d.project_id AND p.supplier_link_token = p_project_token)
  RETURNING d.* INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found for this portal token'; END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.supplier_add_adhoc_document(
  p_project_token text, p_step_number int, p_title text, p_file_url text
) RETURNS public.project_documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_project_id uuid; r public.project_documents;
BEGIN
  SELECT p.id INTO v_project_id FROM public.projects p WHERE p.supplier_link_token = p_project_token;
  IF v_project_id IS NULL THEN RAISE EXCEPTION 'Invalid portal token'; END IF;
  INSERT INTO public.project_documents
    (project_id, step_number, title, description, responsible_party, is_visible_to_supplier, is_required, status, file_url, uploaded_at, uploaded_by_supplier)
  VALUES
    (v_project_id, p_step_number, p_title, 'ad-hoc', 'supplier', true, false, 'uploaded', p_file_url, now(), true)
  RETURNING * INTO r;
  RETURN r;
END $$;

-- ---- Comments: write scoped to supplier portal token + access code (2-factor) ----
CREATE OR REPLACE FUNCTION public.supplier_add_document_comment(
  p_supplier_token text, p_code text, p_doc_id uuid, p_content text, p_author_name text
) RETURNS public.document_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.document_comments;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.project_documents d
    JOIN public.projects p ON p.id = d.project_id
    JOIN public.suppliers s ON s.id = p.supplier_id
    WHERE d.id = p_doc_id AND s.portal_token = p_supplier_token AND s.access_code = p_code
  ) THEN RAISE EXCEPTION 'Not authorized to comment on this document'; END IF;
  INSERT INTO public.document_comments (document_id, content, author_name, author_role, created_at)
  VALUES (p_doc_id, p_content, p_author_name, 'supplier', now())
  RETURNING * INTO r;
  RETURN r;
END $$;

-- ---- Attribute requests: reads/writes by capability/project/supplier token ----
CREATE OR REPLACE FUNCTION public.get_attribute_request_by_token(p_token uuid)
RETURNS SETOF public.project_attribute_requests
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.project_attribute_requests WHERE token = p_token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_attribute_requests_by_project_token(p_project_token text)
RETURNS SETOF public.project_attribute_requests
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT ar.* FROM public.project_attribute_requests ar
  JOIN public.projects p ON p.id = ar.project_id
  WHERE p.supplier_link_token = p_project_token
  ORDER BY ar.step, ar.created_at;
$$;

CREATE OR REPLACE FUNCTION public.get_attribute_requests_by_supplier(p_supplier_token text, p_code text)
RETURNS SETOF public.project_attribute_requests
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT ar.* FROM public.project_attribute_requests ar
  JOIN public.projects p ON p.id = ar.project_id
  JOIN public.suppliers s ON s.id = p.supplier_id
  WHERE s.portal_token = p_supplier_token AND s.access_code = p_code
  ORDER BY ar.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.submit_attribute_request_secure(p_token uuid, p_data jsonb)
RETURNS public.project_attribute_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.project_attribute_requests;
BEGIN
  UPDATE public.project_attribute_requests
     SET status = 'submitted', submitted_data = p_data, submitted_at = now()
   WHERE token = p_token
  RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid attribute request token'; END IF;
  RETURN r;
END $$;

-- ---- Compliance: dashboard list scoped to supplier token + access code ----
CREATE OR REPLACE FUNCTION public.get_compliance_requests_by_supplier(p_supplier_token text, p_code text)
RETURNS SETOF public.compliance_requests
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT cr.* FROM public.compliance_requests cr
  JOIN public.suppliers s ON s.id = cr.supplier_id
  WHERE s.portal_token = p_supplier_token AND s.access_code = p_code;
$$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN
    SELECT format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'supplier_set_document_file','supplier_add_adhoc_document','supplier_add_document_comment',
        'get_attribute_request_by_token','get_attribute_requests_by_project_token',
        'get_attribute_requests_by_supplier','submit_attribute_request_secure','get_compliance_requests_by_supplier'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated;', fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
