-- Migration 139: one regulation brain, shared by the TCF and the IM.
--
-- WHY THIS EXISTS
--
-- A regulation was being described in two unconnected places, and neither knew about
-- the other:
--
--   * public.regulations (migration 115) -- the IM's view. Carries the Markdown summary
--     the AI check reads, the hand-verified `checklist`, and applicable_categories.
--     13 rows.
--   * public.compliance_requirements -- the TCF's view. Carries what a SUPPLIER must
--     deliver (report vs certificate, timing, third-party vs in-house, the attribute
--     condition that gates applicability) with the regulation named only in a free-text
--     `reference_code` that NOTHING RENDERS. 57 rows, of which ~23 are regulatory.
--
-- So "EMC Directive 2014/30/EU" existed twice: once as a TCF requirement with the
-- evidence rules and no summary, once as a regulation with a 4.7 kB summary and no idea
-- any supplier was ever asked for an EMC report. Editing one never touched the other.
--
-- THE SHAPE AFTER THIS MIGRATION
--
--   regulations                 = the brain. One row per regulation/standard/guideline:
--                                 identity + version + Summary + summary.md +
--                                 tcf_description + checklist (the IM requirements).
--   compliance_requirements     = the TCF's per-category DELIVERABLE, now pointing at
--                                 the regulation that demands it (regulation_id).
--   im_template_regulations     = the IM's per-template assignment. Unchanged.
--
-- A requirement is NOT folded into the regulation, and that is deliberate. One
-- regulation demands several deliverables (LVD wants a test report AND a certificate);
-- 13 live TCF rows are pure document asks with no regulation behind them at all (BOM,
-- circuit diagram, packaging artwork, EU/UK DoC); and timing / test_report_origin /
-- self_declaration / condition are per CATEGORY, not per regulation. Collapsing the
-- two would have needed a join table carrying exactly those columns -- i.e. this table,
-- renamed.
--
-- THE SUPPLIER PORTAL IS STRUCTURALLY UNAFFECTED. It reads compliance_requirements
-- through the ANON PostgREST client ("Allow public read access to requirements"), and
-- public.regulations has no anon policy at all -- only "Auth read". So nothing added to
-- a regulation here can reach a supplier even by accident. The columns the portal
-- renders (title, description, section, is_mandatory, timing_*, test_report_origin,
-- self_declaration_accepted) are untouched.

-- --- 1. Version identity, so a standard can say WHICH edition it is -----------

ALTER TABLE public.regulations
  ADD COLUMN IF NOT EXISTS summary            TEXT,
  ADD COLUMN IF NOT EXISTS tcf_description    TEXT,
  ADD COLUMN IF NOT EXISTS version            TEXT,
  ADD COLUMN IF NOT EXISTS edition_year       INTEGER,
  ADD COLUMN IF NOT EXISTS issued_at          DATE,
  ADD COLUMN IF NOT EXISTS last_amended_at    DATE,
  ADD COLUMN IF NOT EXISTS source_url         TEXT,
  ADD COLUMN IF NOT EXISTS celex_id           TEXT,
  ADD COLUMN IF NOT EXISTS version_state      TEXT,
  ADD COLUMN IF NOT EXISTS version_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version_detail     JSONB,
  ADD COLUMN IF NOT EXISTS review_due_at      DATE;

DO $$ BEGIN
  ALTER TABLE public.regulations
    ADD CONSTRAINT regulations_version_state_check
    CHECK (version_state IS NULL OR version_state IN
      ('current','newer_available','repealed','not_found','error'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- edition_year is a year, not a date, because half these documents are cited by year
-- alone ("EN IEC 60335-1:2021") and inventing a day would make the citation wrong.
DO $$ BEGIN
  ALTER TABLE public.regulations
    ADD CONSTRAINT regulations_edition_year_check
    CHECK (edition_year IS NULL OR edition_year BETWEEN 1900 AND 2200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.regulations.summary IS
  'Short plain-language summary -- what this regulation is for, in a few sentences. Read by PEOPLE scanning the library; distinct from summary_md, which is the long clause-level text the AI check consumes. Never sent to the model (the model gets summary_md), so a good `summary` costs nothing at check time.';
COMMENT ON COLUMN public.regulations.tcf_description IS
  'What this regulation means for the TECHNICAL COMPLIANCE FILE -- the evidence it obliges a supplier to provide. Shown on the internal TCF surfaces and used to prefill a new compliance_requirements.description when a requirement is created from this regulation. NOT read live by the supplier portal: the portal renders the requirement''s own description, so an edit here never silently rewrites a request a supplier is already answering.';
COMMENT ON COLUMN public.regulations.version IS
  'Edition/amendment as it is CITED, e.g. "Ed. 6.1", "A11:2020", "consolidated 2026-05-30". Free text on purpose -- IEC, CENELEC and EUR-Lex each version differently and a single parsed scheme would misrepresent two of the three.';
COMMENT ON COLUMN public.regulations.issued_at IS
  'Date of the document itself. For an EU act this is EUR-Lex cdm:work_date_document; the version check writes it on first successful lookup when it is NULL.';
COMMENT ON COLUMN public.regulations.last_amended_at IS
  'Date of the most recent amendment known to us. This is the value the version check compares against, so a NULL here means "any consolidation newer than issued_at counts as new".';
COMMENT ON COLUMN public.regulations.celex_id IS
  'EUR-Lex CELEX number, e.g. 32014L0035. Present ONLY for EU legal acts; NULL for EN/IEC/ISO standards, which have no free catalogue API. Derivable from reference_code (see src/services/regulatory/celex.ts) but stored, because the derivation is a guess and an operator must be able to correct it.';
COMMENT ON COLUMN public.regulations.version_state IS
  'Result of the last automated check: current | newer_available | repealed | not_found | error. NULL = never checked. Advisory only -- nothing blocks on it, because a stale badge must never stop a manual being published.';
COMMENT ON COLUMN public.regulations.version_detail IS
  'Raw findings from the last check, e.g. {"latestConsolidated":"02014L0035-20260530","latestConsolidatedOn":"2026-05-30","amendments":1,"lastAmendedOn":"2024-10-09","endOfValidity":"9999-12-31","source":"eurlex"}. Kept so the UI can explain WHY it says newer_available without a second round trip.';
COMMENT ON COLUMN public.regulations.review_due_at IS
  'When a HUMAN should re-verify this row against the source. The only version signal available for EN/IEC/ISO standards, which cannot be checked automatically.';

CREATE INDEX IF NOT EXISTS idx_regulations_celex
  ON public.regulations (celex_id) WHERE celex_id IS NOT NULL;

-- --- 2. The TCF requirement points at the regulation that demands it ----------

ALTER TABLE public.compliance_requirements
  ADD COLUMN IF NOT EXISTS regulation_id UUID;

DO $$ BEGIN
  ALTER TABLE public.compliance_requirements
    ADD CONSTRAINT compliance_requirements_regulation_id_fkey
    FOREIGN KEY (regulation_id) REFERENCES public.regulations(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.compliance_requirements.regulation_id IS
  'The regulation this deliverable exists to satisfy, or NULL for a requirement with no regulation behind it (BOM, exploded view, packaging artwork -- real asks, not legal obligations). ON DELETE RESTRICT matches im_template_regulations: a regulation the TCF still cites cannot be deleted, it is retired with status = ''superseded''. reference_code stays as the free-text fallback for unlinked rows and is what this column was backfilled from.';

CREATE INDEX IF NOT EXISTS idx_compliance_requirements_regulation
  ON public.compliance_requirements (regulation_id) WHERE regulation_id IS NOT NULL;

-- --- 3. CELEX + source URL for the 8 EU acts already in the library -----------
--
-- Derived from reference_code and VERIFIED against the EUR-Lex SPARQL endpoint on
-- 2026-09-02 -- every one of these resolved to a real work with a document date, so
-- these are lookups that happened, not a pattern someone hopes holds.

UPDATE public.regulations r SET
  celex_id   = v.celex,
  source_url = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:' || v.celex
FROM (VALUES
  ('Directive 2012/19/EU WEEE',   '32012L0019'),
  ('Directive 2014/30/EU',        '32014L0030'),
  ('Directive 2014/35/EU',        '32014L0035'),
  ('Regulation (EU) 2019/1020',   '32019R1020'),
  ('Regulation (EU) 2023/826',    '32023R0826'),
  ('Regulation (EU) No 66/2014',  '32014R0066')
) AS v(ref, celex)
WHERE lower(btrim(r.reference_code)) = lower(v.ref)
  AND r.celex_id IS NULL;

-- --- 4. Link every regulatory TCF requirement to a regulation -----------------
--
-- The TCF's reference_code was free text, so the same act appears as "LVD",
-- "LVD 2014/35/EU" and "Directive 2014/35/EU". The mapping below is written out in full
-- rather than fuzzy-matched: with ~20 distinct codes an explicit table is auditable, and
-- a wrong automatic match here would attach a supplier's evidence obligation to the
-- wrong law.
--
-- Codes deliberately LEFT UNLINKED, because no single act stands behind them:
--   BOM, Circuit diagram, Constructional drawing, Declaration of product identity,
--   Packaging artwork, Marking on product, EU/UK DoC, Instruction manual,
--   MOAH and MOSH, CEE, Other 1, IM_SECTION.

-- 4a. Regulations the TCF cites that the library did not have yet. Created here so
--     nothing is left pointing at a name only. summary_md is deliberately NULL: an
--     invented summary would be worse than none, because summary_md is what the AI check
--     reads and a check refuses (HTTP 422) rather than reassure against an empty one.
--     created_by = 'migration:139' marks them, so this step is identifiable and
--     reversible: DELETE FROM regulations WHERE created_by = 'migration:139'.
INSERT INTO public.regulations (title, reference_code, jurisdiction, celex_id, source_url, tcf_description, created_by)
VALUES
  ('Directive 2011/65/EU on the restriction of the use of certain hazardous substances in electrical and electronic equipment (RoHS)',
   'Directive 2011/65/EU', 'EU', '32011L0065',
   'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011L0065',
   'RoHS test report for the finished product, covering Directive 2011/65/EU and its amendments.', 'migration:139'),
  ('Regulation (EC) No 1907/2006 concerning the Registration, Evaluation, Authorisation and Restriction of Chemicals (REACH)',
   'Regulation (EC) No 1907/2006', 'EU', '32006R1907',
   'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32006R1907',
   'REACH test report evidencing non-presence of SVHCs, and PAH testing per Annex XVII for skin-contact plastic and coated parts.', 'migration:139'),
  ('Directive 2014/53/EU on the harmonisation of the laws of the Member States relating to the making available on the market of radio equipment (RED)',
   'Directive 2014/53/EU', 'EU', '32014L0053',
   'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0053',
   'RED certificate and test reports covering safety (LVD), EMC and spectrum usage, against the standards matching the product''s frequency.', 'migration:139'),
  ('Regulation (EU) 2017/1369 setting a framework for energy labelling',
   'Regulation (EU) 2017/1369', 'EU', '32017R1369',
   'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32017R1369',
   'Energy labelling test report and the product fiche / EPREL registration for the applicable product regulation.', 'migration:139'),
  ('Directive 2009/125/EC establishing a framework for the setting of ecodesign requirements for energy-related products (ErP)',
   'Directive 2009/125/EC', 'EU', '32009L0125',
   'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32009L0125',
   'Ecodesign test report against the implementing regulation for the product group.', 'migration:139'),
  ('Regulation (EU) 2024/1781 establishing a framework for the setting of ecodesign requirements for sustainable products (ESPR)',
   'Regulation (EU) 2024/1781', 'EU', '32024R1781',
   'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1781',
   'Ecodesign evidence under the ESPR framework for the applicable product group.', 'migration:139'),
  ('EN 60529 — Degrees of protection provided by enclosures (IP Code)',
   'EN 60529', NULL, NULL,
   'https://www.cencenelec.eu/',
   'IP rating test report for the declared degree of protection.', 'migration:139')
ON CONFLICT DO NOTHING;

-- 4b. The link itself.
UPDATE public.compliance_requirements cr
   SET regulation_id = r.id
  FROM (VALUES
    ('lvd',                                                        'directive 2014/35/eu'),
    ('lvd 2014/35/eu',                                             'directive 2014/35/eu'),
    ('emc directive 2014/30/eu',                                   'directive 2014/30/eu'),
    ('2011/65/eu',                                                 'directive 2011/65/eu'),
    ('reach',                                                      'regulation (ec) no 1907/2006'),
    ('ec no 1907/2006',                                            'regulation (ec) no 1907/2006'),
    ('red directive 2014/53/eu',                                   'directive 2014/53/eu'),
    -- "RED Directive 2015/53" is a typo for 2014/53 -- there is no 2015/53. Mapped
    -- rather than left dangling, because the requirement text underneath it quotes
    -- 2014/53/EU verbatim.
    ('red directive 2015/53',                                      'directive 2014/53/eu'),
    ('(eu) 2017/1369',                                             'regulation (eu) 2017/1369'),
    ('energy labelling regulation (eu) 2017/1369',                 'regulation (eu) 2017/1369'),
    ('erp directive 2009/125/ec,',                                 'directive 2009/125/ec'),
    ('erp/ecodesign',                                              'regulation (eu) 2024/1781'),
    ('(eu) 2024/1781, erp directive 2009/125/ec, (eu) 2023/826',    'regulation (eu) 2023/826'),
    ('en 60529',                                                   'en 60529')
  ) AS m(tcf_ref, reg_ref),
  public.regulations r
 WHERE lower(btrim(cr.reference_code)) = m.tcf_ref
   AND lower(btrim(r.reference_code))  = m.reg_ref
   AND cr.regulation_id IS NULL;

-- --- 5. Remove IM section stubs that leaked into the requirements table -------
--
-- 21 rows on one category (Induction Hobs) carry reference_code = 'IM_SECTION' and a
-- `description` that is not a description at all but a JSON blob of IM section content:
--   {"order":7,"isPlaceholder":false,"content":{"en":"This product is guaranteed for a
--    period of 2 years from the date of purchase..."}}
-- Seven section names, each duplicated three times. Nothing in the codebase reads
-- 'IM_SECTION' -- these are the residue of an early import that wrote IM template sections
-- into compliance_requirements. They render in the compliance library as seven bogus
-- requirements called "Warranty", "Operation", "Before First Use" and so on.
--
-- They were never sent to a supplier (applies_by_default = false and no condition, so both
-- the portal and the request detail filter them out), which is why nobody noticed. That is
-- also why deleting them changes nothing a supplier has ever seen.
--
-- ARCHIVED FIRST, not trusted to a backup. The archive is a plain copy of the rows; undo is
--   INSERT INTO public.compliance_requirements
--   SELECT * FROM private_archive.compliance_requirements_im_section_139;
-- It lives outside `public` so PostgREST never exposes it -- a CTAS table in `public` would
-- have arrived with RLS disabled and been readable by anon, which is how a cleanup turns
-- into a leak.

CREATE SCHEMA IF NOT EXISTS private_archive;
REVOKE ALL ON SCHEMA private_archive FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private_archive.compliance_requirements_im_section_139 AS
  SELECT * FROM public.compliance_requirements WHERE reference_code = 'IM_SECTION';

DELETE FROM public.compliance_requirements WHERE reference_code = 'IM_SECTION';

NOTIFY pgrst, 'reload schema';
