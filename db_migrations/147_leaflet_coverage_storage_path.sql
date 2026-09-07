-- Migration 147: expose the leaflet render's storage_path on im_sku_leaflet_coverage.
--
-- **NOT YET APPLIED** - blocked by the local permission classifier on 2026-09-05 (the
-- DROP VIEW). Run it manually in the Supabase SQL editor.
--
-- VERIFIED SAFE 2026-09-05: pg_get_viewdef() of the LIVE view was diffed against the
-- CREATE VIEW below - every column, join, filter and the ORDER BY match exactly; the only
-- difference is the added storage_path column. Applying this is purely additive.
--
-- Original note: Written as part of the im-print bucket's public -> private flip
-- (see im-file-url.ts / im-print-export.service.ts's getSignedPrintPdfUrlForPath), but not
-- run against any database yet. Until it is applied, LeafletCoverageTab.tsx has no
-- storage_path to sign and falls back to the view's existing (permanent, public) `url`
-- column — see the comment at its call site.
--
-- THE PROBLEM
--
-- im_sku_leaflet_coverage (migration 132) exposes `r.url` -- im_print_renders' permanent
-- public URL -- but not `r.storage_path`, the value every OTHER reader of a print render
-- signs through (getSignedPrintPdfUrlForPath). Once im-print is flipped private, `url` stops
-- resolving and this view has nothing else to offer: there is no path here through which
-- LeafletCoverageTab could mint a fresh signed URL.
--
-- THE FIX
--
-- Recreate the view (same technique migration 132 itself used: DROP + CREATE, inside a
-- transaction) with the identical SELECT list plus one additional column,
-- `r.storage_path AS storage_path`. Every existing column, join, filter, ORDER BY and the
-- DISTINCT ON collapsing keeps its exact behaviour -- this is additive only. Nothing reads
-- storage_path yet in a way that would break if it is null (legacy renders written before
-- storage_path existed on im_print_renders, or a row with no resolved render at all, both
-- already leave every render_* column null through the LEFT JOINs).
--
-- security_invoker = true is carried over unchanged -- see migration 132's own note on why
-- (migration 80's security_definer_view advisor).

BEGIN;

DROP VIEW IF EXISTS public.im_sku_leaflet_coverage;

CREATE VIEW public.im_sku_leaflet_coverage
WITH (security_invoker = true) AS
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
       -- NEW: the render's storage path, so a caller can mint a short-TTL signed URL
       -- (getSignedPrintPdfUrlForPath) instead of relying on the permanent public `url` above,
       -- which stops resolving once im-print is flipped private.
       r.storage_path                       AS storage_path,
       r.pages,
       r.created_at                          AS rendered_at,
       r.comment                             AS render_comment
FROM       public.project_skus        s
LEFT JOIN  public.categories_l3       c   ON c.id::text = s.category_id
LEFT JOIN  public.im_leaflet_policies pol ON pol.category_id   = s.category_id
                                         AND pol.template_type = 'warning_leaflet'
LEFT JOIN  public.im_templates        t   ON t.category_id   = s.category_id
                                         AND t.template_type = 'warning_leaflet'
LEFT JOIN  public.im_leaflet_issues   si  ON si.sku_number    = s.sku_number
                                         AND si.template_type = 'warning_leaflet'
LEFT JOIN  public.im_leaflet_issues   ci  ON ci.category_id   = s.category_id
                                         AND ci.template_type = 'warning_leaflet'
                                         AND ci.sku_number IS NULL
LEFT JOIN  public.im_print_renders    r   ON r.id = COALESCE(si.render_id, ci.render_id)
ORDER BY   s.sku_number, (s.project_id IS NULL) DESC;

COMMENT ON VIEW public.im_sku_leaflet_coverage IS
  'Read model for leaflet coverage: one row per distinct project_skus.sku_number, with the leaflet PDF that SKU gets and enough columns to derive the gap state. A SKU-specific im_leaflet_issues row wins over the category-wide one (sku_number IS NULL), mirroring migration 116''s explicit-beats-derived precedence. DISTINCT ON prefers the catalog row (project_id IS NULL) as the roster of record so a SKU present both in the catalog and in a leaflet project is reported once. Scoped to template_type=''warning_leaflet''; the tables behind it already carry template_type so full manuals can be added without a schema change. Migration 147 added storage_path (additive) so callers can sign a short-TTL URL instead of relying on the render''s permanent public url, once im-print is private.';

COMMIT;

NOTIFY pgrst, 'reload schema';
