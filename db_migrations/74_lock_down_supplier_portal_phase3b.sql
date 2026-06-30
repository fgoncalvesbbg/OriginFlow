-- Migration 74: Supplier portal — PHASE 3b (BREAKING — NOT YET APPLIED)
--
-- ⚠️  Apply ONLY after the hardened frontend (migration 73 RPCs) is deployed,
--     together with / after migration 71. Removes the permissive anon table
--     access for RFQs and supplier proposals.
--
-- After this, anon reaches RFQ/proposal data only through the migration-73 RPCs.

-- ===== RFQ ENTRIES: reads/writes via RPC only =====
DROP POLICY IF EXISTS "Allow public read rfq entries via token"   ON public.rfq_entries;
DROP POLICY IF EXISTS "Allow public update rfq entries via token" ON public.rfq_entries;
REVOKE SELECT, INSERT, UPDATE ON public.rfq_entries FROM anon;

-- ===== RFQS: read via RPC only =====
DROP POLICY IF EXISTS "Allow public read rfqs" ON public.rfqs;
REVOKE SELECT, INSERT, UPDATE ON public.rfqs FROM anon;

-- ===== SUPPLIER PROPOSALS: read/create via RPC only =====
DROP POLICY IF EXISTS "Allow public insert proposals"      ON public.supplier_proposals;
DROP POLICY IF EXISTS "Allow public select own proposals"  ON public.supplier_proposals;
REVOKE SELECT, INSERT, UPDATE ON public.supplier_proposals FROM anon;

NOTIFY pgrst, 'reload schema';

-- =====================================================
-- REMAINING (not yet addressed):
--   * Storage buckets still PUBLIC (documents, im-assets, im-print, im-published,
--     launchflow-docs). Make private + signed URLs via a service-role endpoint.
--   * notifications: no anon policy today (portal list is effectively empty); if
--     supplier notifications are wanted on the portal, add a token+code RPC.
--   * SupplierCompliancePortalList.getComplianceRequestsBySupplierId still does an
--     anon select by a manually entered supplier id — migrate or gate it.
--   * Re-apply migration 36's PM-scoped RLS (never applied): projects/suppliers/
--     docs use "Enable all for authenticated", so any PM can see ALL projects.
-- =====================================================
