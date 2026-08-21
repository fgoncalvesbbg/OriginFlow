-- 118: Triage status per regulatory-check finding (solved / skipped / wrong).
--
-- WHY A SEPARATE TABLE, RATHER THAN A FIELD ON THE FINDING
--
-- The findings live inside im_regulatory_checks.report (jsonb), and that table has NO
-- UPDATE POLICY on purpose (migration 115): the report is the evidence of what the model
-- said on a given day, and being unable to edit it is what makes it citable afterwards.
-- Writing a mutable "solved" flag into it would destroy exactly that property.
--
-- So the evidence and the opinion about the evidence are stored apart: the report stays
-- immutable, and this table carries the mutable human judgement on top of it.
--
-- KEYED BY CONTENT, NOT BY CHECK ROW. The obvious key would be (check_id, finding_index),
-- which is exact and stable because the report never changes. It is also close to useless
-- in practice: re-running the check produces a new im_regulatory_checks row, so every one
-- of thirty triaged findings would come back untriaged and the operator would have to
-- decide them all again. Since re-running is the normal way to see whether a fix worked,
-- that would make the feature actively annoying.
--
-- finding_key is therefore derived from the finding's CONTENT — regulation, anchor, and the
-- requirement/issue text — by findingKey() in
-- src/services/regulatory/regulation-finding-status.ts. A finding that recurs in a later run
-- keeps the decision already made about it, and a genuinely new finding arrives untriaged.
--
-- The known limit, stated so it is not mistaken for a bug: if the model rewords a
-- requirement between runs, the key changes and that finding reappears as untriaged. There
-- is no fix for that short of fuzzy matching, which would risk silently carrying a
-- "solved" mark onto a DIFFERENT problem — a much worse failure for a compliance tool than
-- re-deciding one finding.
--
-- Scoped to template_id (not to a check run) because that is the thing a decision is about:
-- "this template does not need that warning" stays true across runs of the same template.
--
-- There is no 'open' status. Untriaged is the ABSENCE of a row, so the default costs
-- nothing and clearing a decision means deleting the row.
--
-- NO Postgres enums and NO updated_at trigger, per house style.

CREATE TABLE IF NOT EXISTS public.im_regulatory_finding_status (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID        NOT NULL REFERENCES public.im_templates(id) ON DELETE CASCADE,
  finding_key  TEXT        NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('solved','skipped','wrong')),
  note         TEXT,
  updated_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.im_regulatory_finding_status IS
  'Human triage of regulatory-check findings, kept OUT of im_regulatory_checks.report so that report can stay immutable and citable. One row per (template, finding); untriaged findings simply have no row.';
COMMENT ON COLUMN public.im_regulatory_finding_status.finding_key IS
  'Content-derived key from findingKey() in src/services/regulatory/regulation-finding-status.ts -- regulation id, anchor, and normalized requirement/issue text. Content-keyed rather than keyed to one check run so a decision survives re-running the check; the trade-off is that a reworded finding reappears untriaged, which is preferred over fuzzy matching a "solved" mark onto a different problem.';
COMMENT ON COLUMN public.im_regulatory_finding_status.status IS
  '''solved'' = the template was changed to satisfy it. ''skipped'' = understood and deliberately not acting now. ''wrong'' = the model was mistaken. There is deliberately no ''open'': untriaged is the absence of a row.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_im_regulatory_finding_status_key
  ON public.im_regulatory_finding_status (template_id, finding_key);
CREATE INDEX IF NOT EXISTS idx_im_regulatory_finding_status_template
  ON public.im_regulatory_finding_status (template_id);

ALTER TABLE public.im_regulatory_finding_status ENABLE ROW LEVEL SECURITY;

-- Blanket, like im_template_regulations: triaging a finding is routine authoring work, it
-- cannot alter the report it refers to, and the audit trail of what the model actually said
-- lives in the immutable im_regulatory_checks row regardless of what is decided here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_regulatory_finding_status' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON public.im_regulatory_finding_status FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
