-- 161: "EPREL ID" as a global attribute — the per-product key the registry cross-check needs.
--
-- WHY THIS EXISTS. The EPREL cross-check (Phase 6 of
-- docs/originflow-attribute-viewer-merge-plan.md) was blocked because OriginFlow stored no
-- per-PRODUCT EPREL identifier. It had no schema gap — attribute values are exactly how
-- OriginFlow holds per-SKU facts — only a missing attribute. This adds it.
--
-- DO NOT CONFUSE THE TWO EPREL THINGS, because they are one word apart:
--
--   category_attributes.eprel_id   (the COLUMN, migration 138)
--       Names a FIELD inside an EPREL product record, so a value can be compared against the
--       registry's own figure. Already populated for four globals: 'energyClass',
--       'energyAnnual', 'noise', 'family'. It is per-ATTRIBUTE and says WHAT to compare.
--
--   the "EPREL ID" attribute        (this migration, a ROW)
--       The registration number EPREL assigns to a product model — the number in the QR code
--       on the energy label. It is per-SKU and says WHICH product to look up.
--
-- One answers "which field", the other "which product". The cross-check needs both, which is
-- why the column alone was not enough.
--
-- Its own eprel_id is deliberately NULL: this attribute is the lookup KEY, not a figure to
-- compare against itself.

insert into public.category_attributes (
  -- NULL category_id = global: getAttributesForCategory returns it for EVERY category, which is
  -- what "add it to all categories" means here. One row rather than ~200, so a later correction
  -- is one edit and cannot drift between categories.
  category_id,
  name,
  data_type,
  "group",
  sort_order,
  -- Visible to suppliers on purpose. For a supplier-manufactured model the SUPPLIER registered
  -- it and holds the number, so this is a field worth asking them for. It is a presentation
  -- flag, not access control.
  supplier_visible,
  -- Stored as text, not a number: registration numbers are identifiers, and a numeric column
  -- would drop a leading zero and turn a long one into a float.
  validation_rules,
  eprel_id,
  wizard_tier,
  wizard_hint
)
select
  null,
  'EPREL ID',
  'text',
  -- Sits with the energy-label data it unlocks, immediately above "Energy efficiency class"
  -- (sort_order 42), so the block reads key-then-figures.
  '2. Standard Electric Specs',
  41,
  true,
  jsonb_build_object('placeholder', 'e.g. 123456'),
  null,
  'optional',
  'The registration number EPREL assigned to this model — the number encoded in the QR code on its energy label. Used to cross-check our values against the registry.'
where not exists (
  -- Idempotent, and matched on the NAME because that is what an operator would create by hand
  -- if they got there first. Re-running must not produce a second one.
  select 1 from public.category_attributes
  where category_id is null and lower(name) = 'eprel id'
);
