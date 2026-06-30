-- Migration 78: Lock down production_updates anon access — Phase 5b (BREAKING — NOT YET APPLIED)
--
-- ⚠️  Apply ONLY after the hardened frontend (migration 77 RPCs; production.service
--     split into supplier-RPC vs authenticated-PM paths) is deployed.
--
-- After this: anon cannot read or write production_updates directly, and the
-- ungated submit_production_update RPC is no longer callable by anon (PMs call it
-- with their authenticated session; suppliers use submit_supplier_production_update).

-- Remove anon direct table access (duplicate public policies).
DROP POLICY IF EXISTS "Allow public insert"                 ON public.production_updates;
DROP POLICY IF EXISTS "Allow public insert production_updates" ON public.production_updates;
DROP POLICY IF EXISTS "Allow public select"                 ON public.production_updates;
DROP POLICY IF EXISTS "Allow public select production_updates" ON public.production_updates;
REVOKE SELECT, INSERT, UPDATE ON public.production_updates FROM anon;

-- Close the ungated anon path into the project-mutating RPC (PMs keep authenticated execute).
REVOKE EXECUTE ON FUNCTION public.submit_production_update(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, boolean, text, text, text, boolean
) FROM anon, public;

NOTIFY pgrst, 'reload schema';
