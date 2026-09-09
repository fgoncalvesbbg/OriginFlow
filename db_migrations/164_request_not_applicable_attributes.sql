-- 164: Stop re-asking suppliers for fields somebody already ruled out.
--
-- Numbered 164, not 163: prefix 163 was taken concurrently by 163_design_specs.sql. Two files
-- sharing a prefix leaves their relative order undefined — the exact ambiguity CLAUDE.md calls
-- out for the existing duplicate 132 pair — so this one moved rather than adding a second.
--
-- THE PROBLEM. Migration 155 gave OriginFlow a way to say "this product genuinely has none of
-- this attribute" — a `sku_attribute_values` row whose value IS NULL, distinct from a cell
-- nobody has touched. But the JSONB mirror cannot express that (a cleared cell mirrors as ''),
-- and every consumer that reads the mirror therefore treats a deliberate "not applicable" as
-- "not filled in yet".
--
-- The place that costs something is the supplier attribute request. Its form asks for every
-- supplier-visible attribute of the category, so a field a person deliberately cleared comes
-- back round as a question — asking a supplier to supply data somebody already decided does not
-- apply to the product. They then either invent a value or ask why they are being asked.
--
-- THE FIX, and why it is a snapshot rather than a live lookup. The request records WHICH
-- attributes were not applicable at the moment it was created. It would be easier to look the
-- cleared set up live when the portal renders, and it would be wrong: a request is a record of
-- what was asked. If somebody clears another field a week later, the supplier's form must not
-- silently change under them, and a submitted request must still show what the question was.
--
-- Empty array = nothing was excluded, which is every request created before this migration.
-- That is the correct reading for them: they genuinely did ask for everything.

alter table public.project_attribute_requests
  add column if not exists not_applicable_attribute_ids text[] not null default '{}';

comment on column public.project_attribute_requests.not_applicable_attribute_ids is
  'Attributes recorded as deliberately not applicable for this SKU when the request was created, so the supplier form does not ask for them. A SNAPSHOT: clearing another field later must not change what an existing request asked. text[] rather than uuid[] to match assigned_category_ids and the attributeId strings in submitted_data.';
