-- Migration 69b: Restrict anon document reads to supplier-visible only (APPLIED, non-breaking)
--
-- The live policy on project_documents was a single "ALL USING(true)" policy for
-- the public role, so anon could read EVERY document row — including internal
-- documents (is_visible_to_supplier = false) — and also insert/update/delete any
-- row. This splits it: anon SELECT is limited to visible documents; writes are
-- kept on TEMPORARY anon policies until migration 71 moves them behind RPCs.

DROP POLICY IF EXISTS "Allow public access to docs via token" ON public.project_documents;

CREATE POLICY "anon_select_visible_docs" ON public.project_documents
  FOR SELECT TO anon
  USING (is_visible_to_supplier = true);

-- TEMPORARY: removed in migration 71 once supplier uploads go through RPCs.
CREATE POLICY "anon_temp_insert_docs" ON public.project_documents
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_temp_update_docs" ON public.project_documents
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
