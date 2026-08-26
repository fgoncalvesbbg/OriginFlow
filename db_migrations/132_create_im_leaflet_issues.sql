-- Migration 132: which leaflet PDF does a given SKU get?
--
-- THE PROBLEM
--
-- Safety leaflets come in two kinds and the app could express neither:
--
--   * GENERIC (e.g. Pergolas) -- one leaflet, no SKU data inside, answers for every SKU in
--     the category. Adding a SKU next year must require no action at all.
--   * SKU-SPECIFIC (e.g. Beverage Coolers) -- the leaflet CONTAINS SKU data, so one PDF
--     covers one SKU or a GROUP of them, and a category has several such groups.
--
-- Before this migration nothing answered "which leaflet does SKU 12345 get?".
-- project_documents has no SKU column; the IM dashboard's SKU chips only ever reflect a
-- manual's CURRENT bound_sku_ids, which drifts from what any historical PDF contained.
-- Meanwhile im_print_renders is append-only history keyed by PROJECT (29 leaflet renders
-- across 3 categories, up to v22) with nothing marking WHICH render is the one you hand out.
--
-- WHAT THIS ADDS
--
-- Two small tables and one view. Nothing existing is altered -- in particular im_templates
-- is deliberately NOT touched. It is finalization-guarded (migrations 87/98/102) and read
-- across the whole IM module, so keeping the issued-PDF pointer out of it means the
-- authoring path cannot regress.
--
--   im_leaflet_policies -- which KIND a category is. Absent row = 'category'.
--   im_leaflet_issues   -- "this render is the leaflet for ___", where ___ is a whole
--                          category (sku_number IS NULL) or one SKU (sku_number set).
--   im_sku_leaflet_coverage -- the read model: one row per SKU number, resolved leaflet
--                          and the gap state, all derived.
--
-- DESIGN DECISIONS, recorded so they are not rediscovered as bugs
--
-- 1. sku_number IS NULL MEANS "EVERY SKU IN THE CATEGORY". This is the same
--    scoped-or-applies-to-all convention already used three times here:
--    project_ims.bound_sku_ids empty = all project SKUs (migration 62),
--    project_ims.section_skus missing key = all bound SKUs (migration 82),
--    project_skus.project_id IS NULL = catalog row (migration 93).
--    It is what makes the generic case free: issue once and every future SKU is covered
--    with no second action, because no per-SKU row was ever the mechanism.
--
-- 2. A PER-SKU ISSUE WINS OVER THE CATEGORY ISSUE. Same precedence as migration 116's
--    explicit-beats-derived. A mostly-generic category can therefore carry one odd
--    SKU-specific leaflet with no schema change.
--
-- 3. THE KEY IS sku_number TEXT, NOT project_sku_id UUID, AND THERE IS NO FOREIGN KEY.
--    The business identity is the SKU number -- it is what packaging and Akeneo key on.
--    More importantly a uuid key would be AMBIGUOUS: the same SKU legitimately exists
--    twice in project_skus (a catalog row with project_id NULL, and a row inside the
--    leaflet project that produced the PDF), so a uuid would let the coverage report show
--    one SKU twice with two different answers. FK-less text association with the tradeoff
--    written down is established practice here -- see project_attribute_requests.sku_number
--    and the explicit "the category half has NO FOREIGN KEY behind it" note in migration
--    116. The accepted cost: nothing in the database stops an issue naming a SKU that does
--    not exist. Mitigated by never free-typing one (the UI only ever issues from a render's
--    bound SKUs or a picker over existing SKUs) and by the view's LEFT JOINs, which leave
--    an orphan visible rather than silently dropping it.
--
-- 4. MANY SKUS SHARING ONE PDF IS N ROWS SHARING A render_id. No group entity and no join
--    table: the render IS the group's identity, and that mirrors how the PDF was actually
--    produced (one project_ims bound to those SKUs, exported once). A group table would be
--    a second source of truth for the same fact.
--
-- 5. render_id IS "ON DELETE SET NULL", NOT RESTRICT. Deleting a project or a render must
--    never be blocked by this bookkeeping table (im_print_renders cascades from projects,
--    and migration 103 allows render deletes). The issue row survives with a null render
--    and reports as NOT ISSUED -- a correct, visible failure instead of a hidden one.
--    This is why render_id is nullable.
--
-- 6. NO market COLUMN, DELIBERATELY. Renders already carry `market` (migration 107) and no
--    leaflet render in the database uses it -- all 29 are NULL. Adding the dimension now
--    would mean either a column nothing reads or row fan-out in the view (a DE-market
--    per-SKU issue pairing with an FR-market category issue). The issued render's own
--    market stays visible through the join, so no information is lost, and adding a market
--    dimension later is a clean additive migration plus an index rebuild.
--
-- 7. template_type IS IN BOTH UNIQUE KEYS even though only 'warning_leaflet' matters today,
--    so full manuals ('im') need no migration to join in later.
--
-- 8. THE PARTIAL UNIQUE INDEXES CANNOT BE USED AS A PostgREST UPSERT TARGET. PostgREST's
--    on_conflict takes column names only, never the index predicate, so ON CONFLICT cannot
--    infer a partial index. leaflet-coverage.service.ts therefore reads then inserts or
--    updates, exactly as bulkUpsertCatalogSkus already does. The indexes still earn their
--    place: a concurrent duplicate fails loudly instead of silently double-issuing.

BEGIN;

-- ---------------------------------------------------------------------------------------
-- Which kind of leaflet a category has.
-- ---------------------------------------------------------------------------------------
-- An ABSENT row means 'category', and that default is the safe one on purpose: a generic
-- leaflet covers everything, so a category nobody has classified can never UNDER-report
-- its coverage. The column is load-bearing for the gap report, not cosmetic -- without it
-- "Beverage Coolers is generic and unissued" (gap = 1 action) is indistinguishable from
-- "Beverage Coolers is per-SKU and 119 of 122 SKUs are unassigned" (gap = 119 actions).
CREATE TABLE IF NOT EXISTS im_leaflet_policies (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   TEXT        NOT NULL,
  template_type TEXT        NOT NULL DEFAULT 'warning_leaflet'
                            CHECK (template_type IN ('im', 'warning_leaflet')),
  mode          TEXT        NOT NULL DEFAULT 'category'
                            CHECK (mode IN ('category', 'sku')),
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Total (not partial) unique index, so this one IS a valid PostgREST upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_im_leaflet_policies
  ON im_leaflet_policies (category_id, template_type);

-- ---------------------------------------------------------------------------------------
-- "This rendered PDF is the leaflet for ___".
-- ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS im_leaflet_issues (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Always set, even on a per-SKU row: it is what groups the report and what lets a
  -- category's per-SKU issues be found without joining back through project_skus.
  category_id   TEXT        NOT NULL,
  template_type TEXT        NOT NULL DEFAULT 'warning_leaflet'
                            CHECK (template_type IN ('im', 'warning_leaflet')),
  -- NULL = this issue covers EVERY SKU in the category (see decision 1 above).
  sku_number    TEXT,
  -- Nullable BECAUSE of ON DELETE SET NULL (decision 5), not because it is optional to fill.
  render_id     UUID        REFERENCES im_print_renders(id) ON DELETE SET NULL,
  note          TEXT,
  issued_by     TEXT,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Two PARTIAL unique indexes, the technique migration 93 already uses for catalog SKUs:
-- at most one generic issue per category+type, and at most one issue per SKU+type.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leaflet_issue_category
  ON im_leaflet_issues (category_id, template_type)
  WHERE sku_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leaflet_issue_sku
  ON im_leaflet_issues (sku_number, template_type)
  WHERE sku_number IS NOT NULL;

-- Reporting reads by category ("show me this category's per-SKU issues").
CREATE INDEX IF NOT EXISTS idx_leaflet_issues_category
  ON im_leaflet_issues (category_id, template_type);

-- Used when a render is deleted / when listing which SKUs sit behind one PDF.
CREATE INDEX IF NOT EXISTS idx_leaflet_issues_render
  ON im_leaflet_issues (render_id);

-- ---------------------------------------------------------------------------------------
-- RLS: the IM-module convention (blanket authenticated, one policy), copied verbatim from
-- migration 101 / 84. These screens already sit behind ProtectedRoute and there is no
-- anon/public surface for leaflet coverage, so no SECURITY DEFINER RPC is needed.
-- ---------------------------------------------------------------------------------------
ALTER TABLE im_leaflet_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE im_leaflet_issues   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_leaflet_policies' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON im_leaflet_policies FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_leaflet_issues' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON im_leaflet_issues FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------------------
-- The read model.
-- ---------------------------------------------------------------------------------------
-- One row per distinct SKU NUMBER, carrying the resolved leaflet or the reason there
-- isn't one. Every join is a LEFT JOIN so nothing ever disappears from the report -- an
-- uncovered SKU appears with NULLs, which is exactly what the gap view needs to show.
--
-- The status the UI renders is DERIVED from these columns, never stored:
--   category_id IS NULL                    -> unclassified
--   template_id IS NULL                    -> no_template
--   render_id IS NOT NULL                  -> issued (is_sku_specific says which kind)
--   mode='category', no render             -> category_not_issued  (one action fixes all)
--   mode='sku',      no render             -> sku_not_assigned     (one action per group)
--
-- security_invoker = true is NOT optional: a plain view runs with the owner's rights and
-- trips the `security_definer_view` advisor that migration 80 exists to fix.
DROP VIEW IF EXISTS public.im_sku_leaflet_coverage;

CREATE VIEW public.im_sku_leaflet_coverage
WITH (security_invoker = true) AS
-- DISTINCT ON collapses the catalog-row/project-row duplicate of one SKU number, and the
-- ORDER BY makes the CATALOG row (project_id IS NULL) the roster of record. Without this a
-- SKU that is both a catalog entry and a member of a leaflet project would be reported
-- twice. See decision 3.
SELECT DISTINCT ON (s.sku_number)
       s.id                                  AS sku_id,
       s.sku_number,
       s.sku_title,
       s.project_id,
       s.is_final,
       s.category_id,
       c.name                                AS category_name,
       COALESCE(pol.mode, 'category')        AS mode,
       t.id                                  AS template_id,
       t.name                                AS template_name,
       COALESCE(si.id, ci.id)                AS issue_id,
       (si.id IS NOT NULL)                   AS is_sku_specific,
       COALESCE(si.issued_at, ci.issued_at)  AS issued_at,
       COALESCE(si.issued_by, ci.issued_by)  AS issued_by,
       COALESCE(si.note, ci.note)            AS issue_note,
       r.id                                  AS render_id,
       r.project_id                          AS render_project_id,
       r.im_version,
       r.languages,
       r.page_size,
       r.market,
       r.url,
       r.pages,
       r.created_at                          AS rendered_at,
       r.comment                             AS render_comment
FROM       public.project_skus        s
-- categories_l3.id is UUID while every category REFERENCE in the app is TEXT
-- (im_templates.category_id, project_skus.category_id) -- hence the cast. See migration 93.
LEFT JOIN  public.categories_l3       c   ON c.id::text = s.category_id
LEFT JOIN  public.im_leaflet_policies pol ON pol.category_id   = s.category_id
                                         AND pol.template_type = 'warning_leaflet'
LEFT JOIN  public.im_templates        t   ON t.category_id   = s.category_id
                                         AND t.template_type = 'warning_leaflet'
-- si = the SKU-specific issue (wins), ci = the category-wide issue (fallback).
LEFT JOIN  public.im_leaflet_issues   si  ON si.sku_number    = s.sku_number
                                         AND si.template_type = 'warning_leaflet'
LEFT JOIN  public.im_leaflet_issues   ci  ON ci.category_id   = s.category_id
                                         AND ci.template_type = 'warning_leaflet'
                                         AND ci.sku_number IS NULL
LEFT JOIN  public.im_print_renders    r   ON r.id = COALESCE(si.render_id, ci.render_id)
ORDER BY   s.sku_number, (s.project_id IS NULL) DESC;

COMMENT ON VIEW public.im_sku_leaflet_coverage IS
  'Read model for leaflet coverage: one row per distinct project_skus.sku_number, with the leaflet PDF that SKU gets and enough columns to derive the gap state. A SKU-specific im_leaflet_issues row wins over the category-wide one (sku_number IS NULL), mirroring migration 116''s explicit-beats-derived precedence. DISTINCT ON prefers the catalog row (project_id IS NULL) as the roster of record so a SKU present both in the catalog and in a leaflet project is reported once. Scoped to template_type=''warning_leaflet''; the tables behind it already carry template_type so full manuals can be added without a schema change.';

COMMENT ON COLUMN public.im_leaflet_issues.sku_number IS
  'NULL means this issue covers EVERY SKU in category_id -- the same applies-to-all convention as project_ims.bound_sku_ids (migration 62) and project_ims.section_skus (migration 82). That is what makes a generic leaflet free to maintain: no per-SKU row exists, so a SKU imported next year is covered with no second action. TEXT and deliberately FK-less: a uuid key would report one SKU twice when it exists both as a catalog row and inside the leaflet project that produced the PDF.';

COMMENT ON COLUMN public.im_leaflet_policies.mode IS
  'category = one generic leaflet answers for every SKU (no SKU data in the PDF). sku = the PDF contains SKU data, so each SKU or group of SKUs needs its own issued render. LOAD-BEARING for the gap report, not a display hint: it is the only thing that distinguishes "unissued, one action away" from "N SKUs still unassigned". An absent row reads as ''category'' so an unclassified category never under-reports coverage.';

NOTIFY pgrst, 'reload schema';
