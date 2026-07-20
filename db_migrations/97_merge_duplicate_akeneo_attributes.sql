-- 97_merge_duplicate_akeneo_attributes.sql
-- One-time cleanup: collapse the ~38 duplicated akeneo_id attributes (42 extra rows) created by
-- earlier per-category imports into a single canonical attribute each, then enforce global
-- uniqueness of akeneo_id at the database level (going-forward reuse is also enforced in
-- saveCategoryAttribute). Applied to the live DB via Supabase MCP on 2026-07-20.
--
-- Per duplicated code: pick a canonical row (prefer an existing global row, else lowest id),
-- repoint project_skus.attribute_values (JSONB) and sku_attribute_flags from the losers to the
-- canonical, union the losers' category associations onto the canonical, delete the losers, and
-- (for non-'Category Specific' groups, which are global in this app) make the canonical global.
-- NOTE: category_attributes.category_id is uuid; assigned_category_ids is text[] — hence the cast.

DO $$
DECLARE
  rec RECORD;
  canonical uuid;
  loser uuid;
  i int;
  make_global boolean;
BEGIN
  FOR rec IN
    SELECT akeneo_id, array_agg(id ORDER BY (category_id IS NULL) DESC, id) AS ids
    FROM category_attributes
    WHERE akeneo_id IS NOT NULL AND akeneo_id <> ''
    GROUP BY akeneo_id
    HAVING count(*) > 1
  LOOP
    canonical := rec.ids[1];
    SELECT ("group" IS DISTINCT FROM 'Category Specific') INTO make_global
    FROM category_attributes WHERE id = canonical;

    FOR i IN 2 .. array_length(rec.ids, 1) LOOP
      loser := rec.ids[i];

      UPDATE project_skus ps
      SET attribute_values = (
        SELECT jsonb_agg(
          CASE WHEN e->>'attributeId' = loser::text
               THEN jsonb_set(e, '{attributeId}', to_jsonb(canonical::text))
               ELSE e END)
        FROM jsonb_array_elements(ps.attribute_values) e)
      WHERE ps.attribute_values @> jsonb_build_array(jsonb_build_object('attributeId', loser::text));

      UPDATE sku_attribute_flags f
      SET attribute_id = canonical::text
      WHERE f.attribute_id = loser::text
        AND NOT EXISTS (SELECT 1 FROM sku_attribute_flags f2
                        WHERE f2.project_sku_id = f.project_sku_id AND f2.attribute_id = canonical::text);
      DELETE FROM sku_attribute_flags WHERE attribute_id = loser::text;

      UPDATE category_attributes c
      SET assigned_category_ids = ARRAY(
        SELECT DISTINCT x FROM unnest(
          coalesce(c.assigned_category_ids, '{}')
          || coalesce(l.assigned_category_ids, '{}')
          || CASE WHEN l.category_id IS NOT NULL THEN ARRAY[l.category_id::text] ELSE '{}'::text[] END
        ) x)
      FROM category_attributes l
      WHERE c.id = canonical AND l.id = loser;

      DELETE FROM category_attributes WHERE id = loser;
    END LOOP;

    IF make_global THEN
      UPDATE category_attributes SET category_id = NULL WHERE id = canonical;
    END IF;
  END LOOP;
END $$;

-- Forbid duplicate akeneo_ids at the database level (replaces the non-unique lookup index).
DROP INDEX IF EXISTS idx_category_attributes_akeneo_id;
CREATE UNIQUE INDEX IF NOT EXISTS category_attributes_akeneo_id_uniq
  ON category_attributes (akeneo_id)
  WHERE akeneo_id IS NOT NULL AND akeneo_id <> '';

NOTIFY pgrst, 'reload schema';
