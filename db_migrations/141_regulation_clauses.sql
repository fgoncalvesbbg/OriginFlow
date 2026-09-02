-- Migration 141: clauses and obligations — the two levels people were already using.
--
-- WHY THIS EXISTS
--
-- A regulation was one row with a free-text `checklist` blob. It has never been enough, and
-- the live data shows three ways operators worked around it:
--
--   1. EVERY one of the 66 checklist lines hand-encodes a clause number at the front —
--      "7.12.5", "7.14", "ANNEX IX", "4.5.1". Nobody was told to; there was no field.
--
--   2. 44 of those lines also carry a SECOND invented field: which artifact the obligation
--      lands on.  "7.1 · Rating label, Sales packaging, IM, Product — Rated voltage…"
--      That middle list is why a manual publisher today scrolls past rating-label-only
--      items: the app cannot see it, so it cannot filter on it.
--
--   3. Chapters were being smuggled in AS REGULATIONS to get their own summary and category
--      list. "EN IEC 60335-1 - Clause 7" (27 kB summary, 9 categories) exists alongside
--      "EN IEC 60335-1:2021" (18 kB, 1 category). Both describe clause 7 of the same
--      standard, both define 7.12.5 and 7.14, IN DIFFERENT WORDS. This is exactly the drift
--      migration 139 removed between the TCF and the IM, recurring one level down.
--
-- So: clauses become rows, and a checklist line becomes an obligation row that cites one.
--
-- WHY CLAUSE-LEVEL CHANGE TRACKING IS THE POINT. Amendments do not touch a standard evenly.
-- The EUR-Lex check found 89 amendments on RoHS (2011/65/EU), almost all of them Annex II/III
-- substance updates. "Has 2011/65/EU changed?" is unanswerable in a useful way; "has Annex II
-- changed since we last verified it?" is the question a compliance manager actually has.
--
-- WHAT A CLAUSE DELIBERATELY DOES NOT HAVE: a status. Expiry (migration 140) stays a
-- regulation-level decision, so the publish gate keeps resolving ONE blocking rule instead of
-- two interacting ones. A clause records that it changed; changing is a prompt to re-verify,
-- not a stop. `regulation_clauses.status` is the column to add if that ever proves too coarse.

-- --- 1. Clauses ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.regulation_clauses (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  regulation_id   UUID        NOT NULL REFERENCES public.regulations(id) ON DELETE CASCADE,
  number          TEXT        NOT NULL,
  qualifier       TEXT,
  title           TEXT,
  kind            TEXT        NOT NULL DEFAULT 'clause'
                                CHECK (kind IN ('clause','annex','article','part','section')),
  sort_key        TEXT        NOT NULL DEFAULT '',
  summary         TEXT,
  tcf_description TEXT,
  amended_in      TEXT,
  last_changed_at DATE,
  source_anchor   TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.regulation_clauses IS
  'One chapter/clause/annex of a regulation. Exists because obligations, amendments and TCF evidence all attach at this level, not at the level of the whole document -- see migration 141. Deleting the parent regulation deletes its clauses (ON DELETE CASCADE): a clause has no meaning without the document it is a clause OF, unlike an obligation, which is a statement someone wrote.';
COMMENT ON COLUMN public.regulation_clauses.number IS
  'The citation as written: "7.12.5", "Annex II & III". Normalised for whitespace and the ALL-CAPS "ANNEX" spelling ONLY -- everything else is byte-preserved, because "7.12" and "7.1.2" are different obligations and a helpful normaliser would merge them.';
COMMENT ON COLUMN public.regulation_clauses.qualifier IS
  'A word following the number in a particular standard, e.g. the "Addition" in "7.12 Addition" -- Part 2-x adding to Part 1''s clause 7.12.';
COMMENT ON COLUMN public.regulation_clauses.sort_key IS
  'Zero-padded segments ("0007.0012.0005") so 7.2 sorts after 7.12 rather than before it. Maintained by the service at write time, per house style -- no trigger.';
COMMENT ON COLUMN public.regulation_clauses.amended_in IS
  'The amendment that last changed THIS clause, e.g. "A11:2020" or a CELEX. Free text: IEC, CENELEC and EUR-Lex each name amendments differently.';
COMMENT ON COLUMN public.regulation_clauses.last_changed_at IS
  'When this clause last changed. The whole reason clauses are rows: 89 of RoHS''s amendments touch Annex II/III, so a change date on the parent document answers nothing.';

-- One row per citation per regulation. A duplicate is always an accident, and two half-filled
-- clause 7.12s would split the obligations that belong together.
CREATE UNIQUE INDEX IF NOT EXISTS uq_regulation_clauses_number
  ON public.regulation_clauses (regulation_id, lower(btrim(number)));
CREATE INDEX IF NOT EXISTS idx_regulation_clauses_regulation
  ON public.regulation_clauses (regulation_id, sort_key);

-- --- 2. Obligations ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.regulation_obligations (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  regulation_id      UUID        NOT NULL REFERENCES public.regulations(id) ON DELETE CASCADE,
  clause_id          UUID        REFERENCES public.regulation_clauses(id) ON DELETE SET NULL,
  text               TEXT        NOT NULL,
  verbatim           TEXT,
  carriers           TEXT[]      NOT NULL DEFAULT '{}',
  optional_carriers  TEXT[]      NOT NULL DEFAULT '{}',
  sort_order         INTEGER     NOT NULL DEFAULT 0,
  note               TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.regulation_obligations IS
  'One thing that must be done, replacing a line of the old regulations.checklist blob. Carries BOTH regulation_id and clause_id: clause_id is nullable because an obligation whose line never named a clause is still a real obligation, and dropping it would defeat the point.';
COMMENT ON COLUMN public.regulation_obligations.carriers IS
  'Which artifacts must carry this obligation: IM | Product | Rating label | Sales packaging. Parsed from the "·"-delimited convention operators invented. AN EMPTY ARRAY MEANS "NOT CLASSIFIED", NOT "NONE" -- the IM checklist therefore SHOWS an unclassified obligation, because hiding the least-reviewed items in the least-visible place is how a compliance gap survives.';
COMMENT ON COLUMN public.regulation_obligations.optional_carriers IS
  'Carriers the source marked "(optional: …)" -- e.g. the Blue Guide CE mark, which must be on the rating label and may also appear in the manual.';
COMMENT ON COLUMN public.regulation_obligations.verbatim IS
  'Wording that must appear word-for-word, when the source quoted some. Only ever populated from a QUOTED field: the same slot in the legacy data also held remarks like "(No specific verbatim wording; …)", and storing one of those as mandated text would poison the translation freeze registry that this column naturally feeds.';
COMMENT ON COLUMN public.regulation_obligations.clause_id IS
  'ON DELETE SET NULL, unlike the clause''s own cascade: losing the chapter heading must not delete the obligation stated under it.';

CREATE INDEX IF NOT EXISTS idx_regulation_obligations_regulation
  ON public.regulation_obligations (regulation_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_regulation_obligations_clause
  ON public.regulation_obligations (clause_id) WHERE clause_id IS NOT NULL;

-- --- 3. A TCF requirement can cite a clause ------------------------------------

ALTER TABLE public.compliance_requirements
  ADD COLUMN IF NOT EXISTS clause_id UUID;

DO $$ BEGIN
  ALTER TABLE public.compliance_requirements
    ADD CONSTRAINT compliance_requirements_clause_id_fkey
    FOREIGN KEY (clause_id) REFERENCES public.regulation_clauses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.compliance_requirements.clause_id IS
  'The specific clause this evidence satisfies, when it is narrower than the whole regulation -- "LVD Annex III" rather than "the LVD". ON DELETE SET NULL: the requirement survives losing its clause, it just becomes regulation-scoped again. Must belong to regulation_id; enforced in the service, not by a composite FK, because that would need a redundant unique index on (id, regulation_id).';

CREATE INDEX IF NOT EXISTS idx_compliance_requirements_clause
  ON public.compliance_requirements (clause_id) WHERE clause_id IS NOT NULL;

-- --- 4. RLS: read for signed-in users, write for admins ------------------------
--
-- Identical to public.regulations (migration 115). Notably there is NO anon policy, which is
-- what keeps the supplier portal structurally unable to see any of this -- the same guarantee
-- migration 139 relies on.

ALTER TABLE public.regulation_clauses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulation_obligations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Auth read" ON public.regulation_clauses
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admin write" ON public.regulation_clauses
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                         WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auth read" ON public.regulation_obligations
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admin write" ON public.regulation_obligations
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p
                         WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- 5. The legacy blob --------------------------------------------------------
--
-- `regulations.checklist` is NOT dropped. It stays as the frozen pre-migration text, and the
-- service falls back to parsing it for any regulation that has no obligation rows yet -- so a
-- row nobody has migrated still contributes its items to a pre-publish checklist instead of
-- silently contributing none.

COMMENT ON COLUMN public.regulations.checklist IS
  'LEGACY (migration 141): the original free-text checklist, one obligation per line. Superseded by public.regulation_obligations, which is the read path whenever any obligation row exists for the regulation. Kept as the frozen pre-migration text and as the fallback for a regulation nobody has broken out yet. Do not write to it from new code.';

NOTIFY pgrst, 'reload schema';
