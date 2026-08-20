-- 115: Global regulation library + per-IM-template regulation assignment +
--      AI regulatory-check run reports.
--
-- WHY THIS EXISTS
--
-- Today a template author's knowledge of which regulations a manual must satisfy
-- lives in their head and in scattered `im_blocks.regulation_refs` free-text
-- arrays. There is no list of the regulations themselves, no record of which
-- regulations a given template is supposed to satisfy, and no artefact saying
-- "this template was audited against (EU) 2019/2016 on this date and here is what
-- was wrong". This migration adds all three, in that order of dependency.
--
-- Data-model decisions worth stating, because each has a cheaper-looking
-- alternative that is expensive to unwind later:
--
--   * ASSIGNMENT IS PER TEMPLATE, not per category. A category holds an IM
--     template AND a warning-leaflet template, and they carry different
--     obligations -- the leaflet is exactly the document a "must appear in the
--     printed matter accompanying the appliance" clause lands on. A category-level
--     list would force both documents to answer for both sets.
--
--   * THE MARKDOWN SUMMARY IS A TEXT COLUMN, NOT A STORAGE OBJECT. It is read by
--     a server-side model call on every check, so a bucket round-trip plus a
--     signed URL buys nothing, and a TEXT column keeps the summary inside the same
--     RLS and backup story as the row that describes it. It is uploaded in the
--     browser with `await file.text()` (see src/pages/im/ImImportDialog.tsx for the
--     established read-in-the-tab pattern) -- the file never leaves the tab as a
--     file, and no bucket needed a new text/markdown MIME allow-list entry.
--     summary_bytes is maintained by the service so the library list can be read
--     WITHOUT transferring the summaries.
--
--   * regulations.applicable_categories is TEXT[] with no foreign key, mirroring
--     im_blocks.applicable_categories. im_templates.category_id is itself TEXT
--     (verified against the live database) while categories_l3.id is UUID, so any
--     column holding a category id in this feature must mirror
--     im_templates.category_id byte-for-byte -- same reasoning as
--     im_tm_segments.domain_category_id (migration 113). This column is a PICKER
--     HINT ONLY: it filters the assignment dialog's suggestions and is never used
--     to decide what gets checked.
--
--   * DELETING AN ASSIGNED REGULATION IS REFUSED (ON DELETE RESTRICT), not
--     cascaded. Same rule as an in-use im_block. The normal way to retire a
--     regulation is status='superseded', which hides it from the assignment picker
--     while leaving every existing assignment and past report intact.
--
--   * THE RUN REPORT IS IMMUTABLE. No UPDATE policy exists. A finding's
--     "registered as a verbatim" state is DERIVED at read time by matching the
--     phrase against translation_verbatims (whose `phrase` column is UNIQUE), so
--     no mutable per-finding state has to exist anywhere.
--
--   * NO Postgres enums and NO updated_at trigger, per house style: CHECK
--     constraints for closed value sets, and the service supplies updated_at in
--     its payload. The report table is append-only and carries created_at only.

-- --- 1. The global library ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.regulations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 TEXT        NOT NULL,
  reference_code        TEXT        NOT NULL,
  jurisdiction          TEXT,
  notes                 TEXT,
  summary_md            TEXT,
  summary_file_name     TEXT,
  summary_bytes         INTEGER     NOT NULL DEFAULT 0,
  summary_uploaded_at   TIMESTAMPTZ,
  summary_uploaded_by   TEXT,
  applicable_categories TEXT[]      NOT NULL DEFAULT '{}',
  status                TEXT        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active','superseded')),
  superseded_by_id      UUID        REFERENCES public.regulations(id) ON DELETE SET NULL,
  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT regulations_summary_size CHECK (
    summary_md IS NULL OR octet_length(summary_md) <= 400000
  )
);

COMMENT ON COLUMN public.regulations.reference_code IS
  'Official identifier as it is cited in a manual, e.g. "(EU) 2019/2016" or "EN 60335-2-24". Kept byte-identical to the citation because translation must never alter it (see translation_verbatims). Editions/amendments belong in title or notes -- see uq_regulations_reference_code.';
COMMENT ON COLUMN public.regulations.summary_md IS
  'Operator-uploaded Markdown summary of the regulation, read in the browser with file.text() and stored as text -- never a storage object. This is the ONLY thing the AI check is told about the regulation, so its quality is the ceiling on the quality of the check. Capped at 400 kB by regulations_summary_size; a summary near that size is also close to the practical prompt budget of one check call.';
COMMENT ON COLUMN public.regulations.summary_bytes IS
  'octet_length(summary_md) at write time, MAINTAINED BY THE SERVICE (not a trigger, per house style). Exists so the library list can show "42 kB summary" while selecting an explicit column list that EXCLUDES summary_md -- otherwise opening the library downloads every summary.';
COMMENT ON COLUMN public.regulations.applicable_categories IS
  'categories_l3 ids AS TEXT, mirroring im_blocks.applicable_categories and im_templates.category_id byte-for-byte (that column is TEXT while categories_l3.id is UUID). PICKER HINT ONLY -- never used to decide what is checked.';
COMMENT ON COLUMN public.regulations.status IS
  'The value ''superseded'' hides the row from the assignment picker without deleting it, which is the supported way to retire a regulation: existing assignments and past reports stay readable and citable.';

-- One row per regulation. A duplicate reference code is essentially always an
-- accident (two people adding "EN 60335-2-24" a week apart), and being refused is
-- the feedback that prevents a template from being checked against the emptier of
-- two half-filled rows. Case- and whitespace-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_regulations_reference_code
  ON public.regulations (lower(btrim(reference_code)));

CREATE INDEX IF NOT EXISTS idx_regulations_status
  ON public.regulations (status, reference_code);
CREATE INDEX IF NOT EXISTS idx_regulations_categories
  ON public.regulations USING GIN (applicable_categories);

ALTER TABLE public.regulations ENABLE ROW LEVEL SECURITY;

-- Read open / write admin-only, following migration 110's explicit reasoning for
-- im_markets: a market -> language mapping is a compliance decision, so writes are
-- admin-only while reads stay open. A regulation summary is a stronger case of the
-- same thing -- it is the input to an automated compliance judgement, so a careless
-- edit silently degrades every future check for every template that cites it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='regulations' AND policyname='Auth read') THEN
    CREATE POLICY "Auth read" ON public.regulations FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='regulations' AND policyname='Admin write') THEN
    CREATE POLICY "Admin write" ON public.regulations FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
  END IF;
END $$;

-- --- 2. Per-template assignment ----------------------------------------------

CREATE TABLE IF NOT EXISTS public.im_template_regulations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    UUID        NOT NULL REFERENCES public.im_templates(id) ON DELETE CASCADE,
  regulation_id  UUID        NOT NULL REFERENCES public.regulations(id) ON DELETE RESTRICT,
  notes          TEXT,
  assigned_by    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN public.im_template_regulations.notes IS
  'Scope note for THIS template only, e.g. "only Annex IV applies -- this family is not free-standing". FUNCTIONAL, not decorative: it is interpolated into the regulatory-check system prompt, so it narrows what the model reports.';
COMMENT ON COLUMN public.im_template_regulations.regulation_id IS
  'ON DELETE RESTRICT on purpose -- deleting a regulation that templates still cite is refused, exactly like deleting an in-use im_block. Retire with regulations.status = ''superseded'' instead.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_im_template_regulations_pair
  ON public.im_template_regulations (template_id, regulation_id);
CREATE INDEX IF NOT EXISTS idx_im_template_regulations_template
  ON public.im_template_regulations (template_id);
-- Needed for the RESTRICT check and for the library's "used by N templates" count.
CREATE INDEX IF NOT EXISTS idx_im_template_regulations_regulation
  ON public.im_template_regulations (regulation_id);

ALTER TABLE public.im_template_regulations ENABLE ROW LEVEL SECURITY;

-- Blanket, unlike the library above: choosing which of the existing regulations a
-- template answers for is routine authoring work (the same grain as migration 110
-- leaving "mark FINAL" open while making "unlock" admin-only). An assignment cannot
-- change any regulation's content, and the check it feeds is advisory and
-- read-only, so a wrong assignment costs one wasted run, not a compliance defect.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_template_regulations' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON public.im_template_regulations FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- --- 3. Run reports (append-only) --------------------------------------------

CREATE TABLE IF NOT EXISTS public.im_regulatory_checks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       UUID        NOT NULL REFERENCES public.im_templates(id) ON DELETE CASCADE,
  status            TEXT        NOT NULL CHECK (status IN ('complete','partial','failed')),
  report            JSONB       NOT NULL,
  regulation_count  INTEGER     NOT NULL DEFAULT 0,
  section_count     INTEGER     NOT NULL DEFAULT 0,
  finding_count     INTEGER     NOT NULL DEFAULT 0,
  verbatim_count    INTEGER     NOT NULL DEFAULT 0,
  model             TEXT,
  prompt_key        TEXT,
  run_by            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.im_regulatory_checks IS
  'APPEND-ONLY. No UPDATE policy exists. The "already registered" state of a verbatim finding is derived at read time from translation_verbatims.phrase (UNIQUE), never written back here.';
COMMENT ON COLUMN public.im_regulatory_checks.report IS
  'The whole run report, the same shape the UI modal renders (see RegulatoryCheckReport in src/types/regulatory.types.ts). Same rationale as im_translation_imports.report (migration 108): the report would otherwise survive only in the running tab.';
COMMENT ON COLUMN public.im_regulatory_checks.status IS
  'The value ''partial'' means at least one (regulation, chunk) call failed and its findings are absent -- the failures[] array in the report says which. A partial run is still stored: "we checked and two of three regulations came back" is more useful than silence.';
COMMENT ON COLUMN public.im_regulatory_checks.model IS
  'The model that actually produced this report, echoed back by the function. Pinned server-side from ai_prompts and therefore changeable by an admin -- so a report must record which model it came from to stay interpretable a year later.';

CREATE INDEX IF NOT EXISTS idx_im_regulatory_checks_template
  ON public.im_regulatory_checks (template_id, created_at DESC);

ALTER TABLE public.im_regulatory_checks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_regulatory_checks' AND policyname='Auth read') THEN
    CREATE POLICY "Auth read" ON public.im_regulatory_checks FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_regulatory_checks' AND policyname='Auth insert') THEN
    CREATE POLICY "Auth insert" ON public.im_regulatory_checks FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  -- Deliberately no UPDATE policy. DELETE is admin-only so a junk run can be
  -- pruned without making reports editable.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_regulatory_checks' AND policyname='Admin delete') THEN
    CREATE POLICY "Admin delete" ON public.im_regulatory_checks FOR DELETE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
  END IF;
END $$;

-- --- 4. The prompt ------------------------------------------------------------
-- Seeded here, not hardcoded in the function, so an admin can tune it from the
-- AdminDashboard "prompts" tab without a deploy -- the same contract as
-- 'im_translation' (migration 88). The {{...}} placeholders are filled by
-- netlify/functions/regulatory-check.ts; removing one does not break the call but
-- blinds the model to that input. The RESPONSE SHAPE is enforced by a JSON schema
-- in the function (output_config.format), so do NOT add formatting instructions
-- here -- reword the JUDGEMENT rules only.
--
-- Model: claude-opus-5. This is reasoning over a legal text where a false negative
-- is a compliance defect, and it runs a handful of times per template rather than
-- thousands of times per translate run. max_tokens is sized by the ~26 s Netlify
-- ceiling, not by model limits.
INSERT INTO public.ai_prompts (key, name, description, system_prompt, model, max_tokens)
VALUES (
  'im_regulatory_check',
  'IM Regulatory Check',
  'System prompt used by netlify/functions/regulatory-check.ts to audit ONE English IM template (or one chunk of it) against ONE assigned regulation. Placeholders filled per call: {{regulationReference}}, {{regulationTitle}}, {{jurisdiction}}, {{regulationNotes}}, {{assignmentNotes}}, {{templateName}}, {{templateType}}, {{chunkInfo}}. The response shape is enforced by a JSON schema in the function, so do not add formatting instructions here -- reword the judgement rules only.',
  E'You are a regulatory compliance reviewer for consumer-appliance instruction manuals.\nYou are auditing ONE English-language manual template against ONE regulation.\n\nREGULATION\n  Reference:    {{regulationReference}}\n  Title:        {{regulationTitle}}\n  Jurisdiction: {{jurisdiction}}\n  Library note: {{regulationNotes}}\n  Scope for this template: {{assignmentNotes}}\n\nTEMPLATE\n  {{templateName}} ({{templateType}}) -- {{chunkInfo}}\n\nThe first message contains the Markdown summary of the regulation. The second contains the template as JSON: sections with `sectionId`, `path`, `title`, and blocks with `refId` and `text`.\n\nRules:\n1. Judge ONLY against the regulation summary supplied. Do not invoke other regulations, house style, or general good practice. If the summary does not state a requirement, it is not a finding.\n2. {{like_this}} in template text is a placeholder filled per product at publish time. Treat it as "a value will be present" -- never report one as missing or wrong content.\n3. Blocks marked conditional render only for products with a given feature; blocks marked optional are opted into per product. Never report these as missing. If a requirement depends on one, say so in `issue`.\n4. You are reviewing a TEMPLATE, not a finished manual. Product-specific values, model numbers, and images are absent by design.\n5. {{chunkInfo}} tells you whether you are seeing the whole template or one part of it. When you are seeing a part, do NOT report a requirement as missing merely because it is absent here -- report it only if this part is where it clearly belongs, and say so.\n6. Anchor every finding to the narrowest identifier available: `refId` when the problem is inside one block, otherwise `sectionId`. Use an empty string only when it belongs nowhere in this part.\n7. `quote` must be copied VERBATIM from the template text -- never paraphrased, corrected, or reflowed. Maximum 300 characters.\n8. `verbatims` is ONLY for wording the regulation requires to appear WORD-FOR-WORD (prescribed warnings, mandated statements, mandated label text). Copy `phrase` VERBATIM from the template text. Set `exactness` to "exact" when the template already carries the mandated wording; set it to "near" when the wording in the template is close to but not identical with what the regulation prescribes -- in that case `phrase` is still the CURRENT wording of the template. Never invent, translate, or normalize a phrase. Do not list a phrase merely because it is important; only because the words themselves are mandated.\n9. Severity: "critical" = non-compliant as it stands; "major" = a required element is missing or materially wrong; "minor" = compliant but imprecise or badly placed; "info" = an observation requiring no change.\n10. Report nothing you are not confident about. An empty findings array is a valid and useful answer. Do not pad the list to look thorough.',
  'claude-opus-5',
  8000
)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
