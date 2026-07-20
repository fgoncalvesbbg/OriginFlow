-- 96_category_attributes_akeneo_lookup_index.sql
-- Akeneo ID is the global identity of an attribute: the same code must not be created twice
-- across categories. Enforced GO-FORWARD in app logic (saveCategoryAttribute reuses/links an
-- existing attribute with the same akeneo_id instead of creating a duplicate; the CSV importer
-- matches by code globally). This index just speeds up that lookup.
--
-- NOT a UNIQUE index: pre-existing data already contains duplicate akeneo_ids from earlier
-- per-category imports (see conversation). A unique constraint would require merging those
-- duplicates first, which is destructive (project_skus.attribute_values reference attribute
-- UUIDs) and is left as an explicit, opt-in cleanup.
-- Applied to the live DB via Supabase MCP on 2026-07-20.

CREATE INDEX IF NOT EXISTS idx_category_attributes_akeneo_id
    ON category_attributes (akeneo_id)
    WHERE akeneo_id IS NOT NULL AND akeneo_id <> '';

NOTIFY pgrst, 'reload schema';
