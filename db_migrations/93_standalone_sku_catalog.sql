-- 93_standalone_sku_catalog.sql
-- Let SKUs exist independently of a project (legacy catalog items) and carry their own
-- category, so their attribute set resolves without going through projects.category_id.
--
-- Design (see conversation): reuse project_skus rather than a separate table.
--   * project_id becomes nullable — a NULL project_id means "catalog / project-less SKU".
--   * a category_id column is added and backfilled from the owning project for existing rows.
--   * catalog SKUs (project_id IS NULL) get a unique sku_number for idempotent bulk upsert.
-- RLS on project_skus is already blanket "authenticated" (migration 56), which covers catalog
-- rows too, so no policy change is needed.

BEGIN;

-- 1. Allow project-less SKUs.
ALTER TABLE project_skus ALTER COLUMN project_id DROP NOT NULL;

-- 2. Category directly on the SKU (TEXT to match categories_l3.id, like other tables).
ALTER TABLE project_skus ADD COLUMN IF NOT EXISTS category_id TEXT;

-- 3. Backfill category from the owning project so project SKUs resolve their attribute set
--    the same way catalog SKUs do.
UPDATE project_skus s
   SET category_id = p.category_id
  FROM projects p
 WHERE s.project_id = p.id
   AND s.category_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_skus_category_id ON project_skus(category_id);

-- 4. Catalog SKUs must have a unique SKU number so re-importing a bulk file updates the same
--    row instead of duplicating. Partial index scopes uniqueness to project-less rows only —
--    project SKUs keep their existing (non-unique) behaviour.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_skus_catalog_number
    ON project_skus (sku_number)
    WHERE project_id IS NULL;

COMMIT;

-- Force PostgREST to reload its schema cache so the new category_id column is visible
-- immediately (otherwise inserts fail with "Could not find the 'category_id' column ...").
NOTIFY pgrst, 'reload schema';
