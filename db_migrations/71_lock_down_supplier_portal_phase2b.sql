-- Migration 71: Supplier portal — PHASE 2b (BREAKING — NOT YET APPLIED)
--
-- ⚠️  Apply ONLY after the hardened frontend (migrations 69/69b/70 RPCs) is
--     deployed. This removes the permissive anon table access the current live
--     portal still uses, so applying it early breaks the live portal.
--
-- Deploy order:  69 ✅  ->  69b ✅  ->  70 ✅  ->  DEPLOY FRONTEND  ->  71 (this).
--
-- After this migration, anon reaches portal data ONLY through the SECURITY
-- DEFINER RPCs from migrations 69/70 — never the tables directly.

-- ===== SUPPLIERS: close the access_code leak (reads via RPC only) =====
DROP POLICY IF EXISTS "Allow public access to suppliers via token" ON public.suppliers;
REVOKE SELECT ON public.suppliers FROM anon;

-- ===== PROJECT DOCUMENTS: writes via RPC; anon keeps visible-only SELECT =====
DROP POLICY IF EXISTS "anon_temp_insert_docs" ON public.project_documents;
DROP POLICY IF EXISTS "anon_temp_update_docs" ON public.project_documents;
REVOKE INSERT, UPDATE ON public.project_documents FROM anon;

-- ===== DOCUMENT COMMENTS: writes via RPC; reads remain public (low sensitivity) =====
DROP POLICY IF EXISTS "Allow public access to doc comments via token" ON public.document_comments;
REVOKE INSERT, UPDATE ON public.document_comments FROM anon;
CREATE POLICY "anon_select_doc_comments" ON public.document_comments
  FOR SELECT TO anon USING (true);

-- ===== PROJECT ATTRIBUTE REQUESTS: all access via RPC =====
DROP POLICY IF EXISTS "Anon read by token"   ON public.project_attribute_requests;
DROP POLICY IF EXISTS "Anon submit by token" ON public.project_attribute_requests;
REVOKE SELECT, INSERT, UPDATE ON public.project_attribute_requests FROM anon;

-- ===== COMPLIANCE REQUESTS: no anon SELECT; list via token+code RPC =====
-- (single-request portal read/submit already use *_secure RPCs)
DROP POLICY IF EXISTS "public_access_compliance_requests_via_token" ON public.compliance_requests;
REVOKE SELECT ON public.compliance_requests FROM anon;

NOTIFY pgrst, 'reload schema';

-- =====================================================
-- STILL TODO (Phase 3 — same RPC pattern, scoped by token + access code):
--   * rfq_entries        (rfq.service / rfq-entry.service: anon select/update)
--   * supplier_proposals (supplier-proposal.service: anon select/insert)
--   * notifications      (notification.service: anon select by supplier_id)
--   * getMissingDocumentsForSupplier (currently relies on authenticated projects read)
--   * SupplierCompliancePortalList.getComplianceRequestsBySupplierId (still anon select)
--   * Make storage buckets PRIVATE (documents, im-assets, im-print, im-published,
--     launchflow-docs are all public) and serve files via short-TTL signed URLs
--     from a service-role endpoint that validates portal token + access code.
--   * NOTE (separate from the portal): migration 36's PM-scoped RLS was never
--     applied — projects/suppliers/docs use "Enable all for authenticated", so any
--     authenticated PM can read/write ALL projects. Re-apply PM isolation.
-- =====================================================
