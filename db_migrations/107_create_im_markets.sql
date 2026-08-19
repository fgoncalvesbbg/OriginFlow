-- 107: Markets — admin-configured market → language mapping, and a market stamp on
-- print renders.
--
-- "Publish an IM for a market set" previously had no market anywhere in the data
-- model: which languages a market needs, and which market a printed booklet was
-- produced for, lived in the operator's head. Markets are maintained by admins
-- (Admin panel → Markets); the print-export dialog offers them as one-click
-- language presets and stamps the chosen market onto the render history row, so
-- "which file went to which market" becomes answerable from im_print_renders.

CREATE TABLE IF NOT EXISTS public.im_markets (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT        NOT NULL UNIQUE,           -- short stable key, e.g. "DACH", "FR", "BENELUX"
  name       TEXT        NOT NULL,                  -- display name, e.g. "Germany / Austria / Switzerland"
  languages  TEXT[]      NOT NULL DEFAULT '{}',     -- ISO 639-1 codes this market's manuals must include
  sort       INTEGER     NOT NULL DEFAULT 0,        -- display order in pickers
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.im_markets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_markets' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON public.im_markets FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Which market a print render was produced for (nullable — ad-hoc renders have none).
ALTER TABLE public.im_print_renders
  ADD COLUMN IF NOT EXISTS market TEXT;

COMMENT ON COLUMN public.im_print_renders.market IS
  'im_markets.code the booklet was produced for (from the print dialog''s market preset). Null for ad-hoc language selections.';
