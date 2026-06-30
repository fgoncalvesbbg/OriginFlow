-- Migration 68: im_print_renders — history of generated print PDFs per project IM.
--
-- Each successful render (see netlify/functions/render-print-pdf.ts) inserts one row here, recording
-- the IM version it was built from, the languages + page size, and the stored PDF URL. Rows are
-- never overwritten and PDFs use unique storage paths, so the full history is preserved. The export
-- dialog reads this to: show that a PDF already exists (which version + when), detect whether the IM
-- has changed since (im_version vs the IM's current version), and guard against spending render
-- credits on an unchanged duplicate.
--
-- The render function writes with the service role (bypasses RLS); the app reads with the
-- authenticated client. Mirrors the project_skus policy (migration 56).

CREATE TABLE IF NOT EXISTS im_print_renders (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_type  TEXT        NOT NULL DEFAULT 'im',
  im_version     INTEGER,                       -- ProjectIM.version this PDF was built from (may be null for legacy)
  languages      TEXT[]      NOT NULL DEFAULT '{}',
  page_size      TEXT        NOT NULL DEFAULT 'a4',
  storage_path   TEXT        NOT NULL,
  url            TEXT        NOT NULL,
  bytes          INTEGER,
  created_by     TEXT,                          -- email/id of the user who generated it
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_im_print_renders_project
  ON im_print_renders(project_id, template_type, created_at DESC);

ALTER TABLE im_print_renders ENABLE ROW LEVEL SECURITY;

-- Authenticated PMs get full read access; inserts come from the service role (bypasses RLS) but we
-- also allow authenticated insert for parity/local use.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_print_renders' AND policyname='Auth select') THEN
    CREATE POLICY "Auth select" ON im_print_renders FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_print_renders' AND policyname='Auth insert') THEN
    CREATE POLICY "Auth insert" ON im_print_renders FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_print_renders' AND policyname='Auth delete') THEN
    CREATE POLICY "Auth delete" ON im_print_renders FOR DELETE TO authenticated USING (true);
  END IF;
END $$;
