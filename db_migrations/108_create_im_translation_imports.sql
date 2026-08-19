-- 108: Durable record of XLIFF translation imports.
--
-- The import run-report (what was applied, what failed, which languages) previously
-- survived only in the importing user's localStorage — clearing the browser or
-- switching machines erased the record of what a translation vendor's file did to a
-- live shared template. One row per committed import; the report JSONB is the same
-- shape the UI modal shows.

CREATE TABLE IF NOT EXISTS public.im_translation_imports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID        NOT NULL REFERENCES public.im_templates(id) ON DELETE CASCADE,
  file_name   TEXT,
  imported_by TEXT,
  report      JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_im_translation_imports_template
  ON public.im_translation_imports(template_id, created_at DESC);

ALTER TABLE public.im_translation_imports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_translation_imports' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON public.im_translation_imports FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
