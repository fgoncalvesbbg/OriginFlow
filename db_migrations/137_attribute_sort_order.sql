-- Migration 137: explicit ordering for category attributes
--
-- Until now attributes had no stored order: every list sorted by group, then alphabetically
-- by name (attributeGroupRank + localeCompare), so "Airflow max" always sat above "Airflow
-- min" and a team could not put the fields in the order they actually want to fill them in.
-- The supplier-facing forms inherit that order, so this is not only an admin nicety.
--
-- sort_order is scoped WITHIN a group, not globally: the group's position is still decided by
-- ATTRIBUTE_GROUPS (see attributeGroupRank), and sort_order only orders rows inside it.
--
-- Default 0 for every existing row, which means "unordered" and keeps today's behaviour
-- exactly: the shared comparator falls through to name when two rows tie on sort_order. A
-- group only becomes explicitly ordered once someone moves a row in it, at which point that
-- group is renumbered 10, 20, 30... (gaps left deliberately so a later single insert does not
-- force a full renumber).
--
-- ProductToolkit definitions already carry a sortOrder per attribute, which the importer
-- previously had to discard for lack of a column to put it in — it now lands here.

ALTER TABLE public.category_attributes
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.category_attributes.sort_order IS
  'Order WITHIN the attribute group. 0 = unordered (falls back to name). Group order itself comes from ATTRIBUTE_GROUPS.';

-- Ordering is always read per group, so index the pair.
CREATE INDEX IF NOT EXISTS idx_category_attributes_group_sort
  ON public.category_attributes ("group", sort_order);

NOTIFY pgrst, 'reload schema';
