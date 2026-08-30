-- Migration 138: ProductToolkit sync identity + an attribute-usage probe
--
-- TWO things, both in service of syncing the full PT attribute structure without silently
-- destroying data that already points at an attribute.
--
-- 1. IDENTITY. PT's detail endpoint now returns a stable numeric `attributeId` per attribute
--    (verified live: 71 attributes, all ids unique). Storing it makes the sync rename-safe:
--    matching on it survives a change of displayName AND of akeneoCode, where our previous
--    name/code matching would see a rename as "delete the old one, create a new one" and
--    orphan every stored value. `eprel_id` also finally gets a home; it was being dropped.
--
-- 2. USAGE. attribute_usage() answers "what would break if this attribute changed or went
--    away". There is no foreign key from any of these to category_attributes (values live in
--    jsonb), so nothing in the database prevents an orphan — the only protection is looking
--    before the write. Counted per attribute id:
--      * project_skus.attribute_values[].attributeId       — captured SKU values
--      * project_attribute_requests.submitted_data[].attributeId — supplier submissions
--      * sku_attribute_flags.attribute_id                  — review flags
--      * project_ims.placeholder_data                      — IM placeholders, keyed by attribute id
--      * project_ims.block_overrides / section_overrides / extra_sections / sku_content
--        and im_blocks.content / im_templates.metadata     — IM block visibility conditions
--        (requires_feature / requires_feature_absent / conditionFeatureId hold an attribute id)
--
--    The IM columns are searched as text rather than by path: the condition fields sit at
--    several different depths inside those documents, and a substring probe for the uuid
--    cannot miss one by looking in the wrong place. It can in principle over-count if a uuid
--    appears for an unrelated reason, which is the right way round for a safety check —
--    over-reporting a risk is recoverable, under-reporting it is what loses data.

ALTER TABLE public.category_attributes
  ADD COLUMN IF NOT EXISTS pt_attribute_id integer,
  ADD COLUMN IF NOT EXISTS eprel_id text;

COMMENT ON COLUMN public.category_attributes.pt_attribute_id IS
  'ProductToolkit''s stable attribute id. The rename-safe join key for syncing; NULL for rows never seen in a PT definition.';
COMMENT ON COLUMN public.category_attributes.eprel_id IS
  'EPREL identifier carried by the ProductToolkit definition. Reference only; OriginFlow does not interpret it.';

-- One PT attribute maps to at most one OriginFlow attribute.
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_attributes_pt_attribute_id
  ON public.category_attributes (pt_attribute_id) WHERE pt_attribute_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.attribute_usage(p_ids uuid[])
RETURNS TABLE (
  attribute_id   uuid,
  sku_values     bigint,
  request_values bigint,
  review_flags   bigint,
  im_refs        bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.id AS attribute_id,
    (SELECT count(*) FROM public.project_skus s, jsonb_array_elements(s.attribute_values) e
       WHERE jsonb_typeof(s.attribute_values) = 'array' AND (e->>'attributeId') = a.id::text),
    (SELECT count(*) FROM public.project_attribute_requests r, jsonb_array_elements(r.submitted_data) e
       WHERE jsonb_typeof(r.submitted_data) = 'array' AND (e->>'attributeId') = a.id::text),
    (SELECT count(*) FROM public.sku_attribute_flags f WHERE f.attribute_id = a.id::text),
    (SELECT
       (SELECT count(*) FROM public.project_ims p
          WHERE coalesce(p.placeholder_data::text, '') LIKE '%' || a.id::text || '%'
             OR coalesce(p.block_overrides::text, '') LIKE '%' || a.id::text || '%'
             OR coalesce(p.section_overrides::text, '') LIKE '%' || a.id::text || '%'
             OR coalesce(p.extra_sections::text, '') LIKE '%' || a.id::text || '%'
             OR coalesce(p.sku_content::text, '') LIKE '%' || a.id::text || '%')
     + (SELECT count(*) FROM public.im_blocks b
          WHERE coalesce(b.content::text, '') LIKE '%' || a.id::text || '%')
     + (SELECT count(*) FROM public.im_templates t
          WHERE coalesce(t.metadata::text, '') LIKE '%' || a.id::text || '%'))
  FROM unnest(p_ids) AS a(id);
$$;

REVOKE ALL ON FUNCTION public.attribute_usage(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.attribute_usage(uuid[]) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
