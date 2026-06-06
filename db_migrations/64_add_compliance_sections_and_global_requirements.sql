-- Migration 64: Persistent section groups + global (all-category) requirements
--
-- 1. compliance_sections: section groups were previously a hardcoded list
--    (COMPLIANCE_SECTIONS) plus whatever free-text a requirement happened to use.
--    This table lets a user define a section group once and have it offered for
--    every category's requirements. Built-in sections stay in code; this table
--    holds user-added ones. Readable by all (the library reads via the anon
--    portal client, same as compliance_requirements), writable by authenticated.
CREATE TABLE IF NOT EXISTS public.compliance_sections (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.compliance_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to sections" ON public.compliance_sections
  FOR SELECT USING (true);
CREATE POLICY "Auth insert sections" ON public.compliance_sections
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update sections" ON public.compliance_sections
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth delete sections" ON public.compliance_sections
  FOR DELETE TO authenticated USING (true);

-- 2. Global requirements: a requirement with category_id = NULL applies to every
--    category (mirrors the global category_attributes pattern). It is shown,
--    locked, in every category's library and is always included when building a
--    compliance request regardless of the request's category.
ALTER TABLE public.compliance_requirements
  ALTER COLUMN category_id DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
