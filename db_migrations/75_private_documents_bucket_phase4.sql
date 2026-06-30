-- Migration 75: Make the `documents` storage bucket PRIVATE (BREAKING — NOT YET APPLIED)
--
-- ⚠️  Apply ONLY after BOTH are deployed:
--       1. the `supplier-file-url` Netlify function (service-role signed URLs), and
--       2. the frontend that fetches signed URLs (SupplierPortal + ProjectDetail).
--     Applying early breaks every document download (stored public URLs 403).
--
-- Deploy order for this phase: deploy function + frontend  ->  apply this migration.
--
-- Model after this change:
--   * Bucket is private; no object is reachable by a bare URL.
--   * Supplier portal (anon) gets short-lived signed URLs from the Netlify function,
--     which validates the project/supplier token + access code.
--   * PMs (authenticated) create signed URLs client-side via the authenticated policy.
--   * Supplier uploads still work: anon keeps INSERT (write-only) on the bucket;
--     anon SELECT/UPDATE are removed so anon can neither read nor overwrite objects.

-- 1. Flip the bucket to private.
UPDATE storage.buckets SET public = false WHERE id = 'documents';

-- 2. Remove anon read/update on storage objects in the documents bucket.
DROP POLICY IF EXISTS "Anon users can read documents"   ON storage.objects;
DROP POLICY IF EXISTS "Anon users can update documents" ON storage.objects;

-- 3. Keep supplier uploads working (write-only). Replace the broad public-insert
--    policy with an anon INSERT scoped to the documents bucket.
DROP POLICY IF EXISTS "Allow Public Uploads" ON storage.objects;
-- "Anon users can upload documents" (INSERT, anon, bucket_id='documents') is retained.
-- "Authenticated users can read/update/delete/upload documents" are retained (PM signed URLs).

NOTIFY pgrst, 'reload schema';

-- Note: im-assets / im-print / im-published / launchflow-docs remain PUBLIC by
-- design (published instruction-manual content embeds these by direct URL). If any
-- hold sensitive data, give them the same private-bucket + signed-URL treatment.
