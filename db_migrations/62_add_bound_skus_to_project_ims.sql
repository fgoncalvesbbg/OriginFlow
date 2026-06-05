-- Migration 62: bind each project IM to specific project SKUs.
-- An IM is always tied to one project (project_id) and now to one or more of that
-- project's SKUs. `bound_sku_ids` holds project_skus.id values; an empty array is
-- treated as "all of the project's SKUs" (backward compatible for rows created
-- before this column). The bound SKUs drive resolution — only their attribute
-- values and SKU numbers feed the generated/published manual.
ALTER TABLE project_ims
  ADD COLUMN IF NOT EXISTS bound_sku_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
