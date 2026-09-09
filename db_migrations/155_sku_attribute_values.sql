-- 155: Attribute values become rows — one per (SKU record, attribute).
--
-- Phase 1 of docs/originflow-attribute-viewer-merge-plan.md. Values live today in
-- project_skus.attribute_values, a JSONB array on the SKU row. That shape cannot answer
-- the questions the merged Attribute Viewer is built to answer:
--   - "how many of this category's 138 SKUs have a value for this attribute?" (coverage)
--   - "who set this cell, when, and where did the value come from?" (provenance)
--   - "set this attribute across 40 ticked SKUs, but only where it is empty" (bulk fill)
-- all of which are a server-side aggregate over rows and a full client-side scan over
-- JSONB.
--
-- WHAT THIS MIGRATION IS NOT: a data migration. Measured before writing it — all 141
-- JSONB entries across all 154 SKUs carry `"value": ""`. They are placeholder scaffolding
-- written by the SKU Catalog's add-SKU path, never filled in. 102 of the 141 point at
-- attribute ids deleted in the 2026-08-28 attribute wipe. So the backfill below is
-- expected to insert ZERO rows, and this table starts empty. It is written as a real
-- backfill anyway because it must stay correct if it is ever re-run against a database
-- that does hold values.
--
-- project_skus.attribute_values is NOT dropped and NOT stopped being written. It is read
-- by the ProductToolkit readback API (netlify/functions/sku-attributes.ts), the IM
-- placeholder wizard, the supplier portal and the RFQ builder. This table becomes
-- authoritative; the JSONB becomes a mirror the service layer refreshes on every write.
-- Retiring the mirror is a separate, later change once every reader has moved.

create table if not exists public.sku_attribute_values (
  id              uuid primary key default gen_random_uuid(),

  -- Keyed on the SKU RECORD, not the SKU NUMBER. A number is not unique in OriginFlow:
  -- live, 10046631 / 10046632 / 10047753 and many others each name two different
  -- project_skus rows. Keying on the number would silently merge two products' values.
  -- The Attribute Viewer shows the duplicate as two columns instead of picking one.
  project_sku_id  uuid not null references public.project_skus(id) on delete cascade,

  -- The attribute's own id, which is what project_skus.attribute_values already carries
  -- as `attributeId` and what sku_attribute_flags keys on. It survives a rename of both
  -- the display name and the akeneo_id, so it is the only safe join key.
  attribute_id    uuid not null references public.category_attributes(id) on delete cascade,

  -- NULL = explicitly CLEARED: somebody emptied a field on purpose. NO ROW AT ALL =
  -- nobody has ever touched this cell. Those are different facts and the grid renders
  -- them differently, because the difference is what a coverage number means.
  --
  -- Stored as TEXT, verbatim, exactly as typed. A numeric column would turn "1,5" from a
  -- German keyboard into either an error or a silent 15. The attribute's data_type says
  -- how to read it; validation happens on the way in (validateAttributeValue).
  value           text,

  -- The unit belongs to the VALUE, not to the attribute's default. Hard-won upstream:
  -- ProductToolkit found the same cable-length attribute holding some products in
  -- centimetres and others in metres. Exporting both under one attribute-level default
  -- rescales half of them by a hundred, in a file that imports without a complaint.
  unit            text,

  -- Where this value came from. Not decoration: an importer must be able to say "this
  -- came from the supplier" vs "a person typed this", and the EPREL seed path must be
  -- distinguishable from a confirmed edit.
  source          text not null default 'manual',

  -- Actor columns carry no FK, matching sku_change_log.changed_by and
  -- sku_attribute_flags.flagged_by. A deleted user must not take the trail with them.
  updated_by      uuid,
  updated_by_name text not null default '',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint sku_attribute_values_sku_attr_key
    unique (project_sku_id, attribute_id),

  constraint sku_attribute_values_source_check
    check (source in ('manual', 'sheet-import', 'pt-import', 'supplier', 'wizard', 'eprel'))
);

comment on table public.sku_attribute_values is
  'One row per (SKU record, attribute) that anyone has touched. value NULL = explicitly cleared; no row = never touched. Authoritative over project_skus.attribute_values, which is kept as a mirror.';
comment on column public.sku_attribute_values.value is
  'The value as typed, verbatim text. NULL means explicitly cleared, which is different from having no row.';
comment on column public.sku_attribute_values.unit is
  'The unit this value was captured in. Belongs to the value, not to the attribute default.';

-- Coverage and "which SKUs have this attribute" are per-attribute reads across a
-- category, so the attribute side needs its own index; the unique constraint already
-- covers lookups that lead with project_sku_id.
create index if not exists sku_attribute_values_attribute_id_idx
  on public.sku_attribute_values (attribute_id);

-- ── RLS: mirror project_skus exactly ────────────────────────────────────────────────
--
-- project_skus is `(project_id IS NULL) OR can_see_project(project_id)` on all four
-- commands for `authenticated`. A value row inherits the visibility of the SKU it
-- belongs to — writing our own predicate here would be a second, drifting copy of the
-- project-scoping rule. can_see_project is SECURITY DEFINER STABLE with a pinned
-- search_path, so it is safe to call from a policy.
--
-- Note the deliberate difference from sku_attribute_flags, whose policies are plain
-- `true`. That table predates project scoping; this one should not inherit its looseness.

alter table public.sku_attribute_values enable row level security;

drop policy if exists "Scoped select" on public.sku_attribute_values;
create policy "Scoped select" on public.sku_attribute_values
  for select to authenticated
  using (
    exists (
      select 1 from public.project_skus s
      where s.id = sku_attribute_values.project_sku_id
        and (s.project_id is null or public.can_see_project(s.project_id))
    )
  );

drop policy if exists "Scoped insert" on public.sku_attribute_values;
create policy "Scoped insert" on public.sku_attribute_values
  for insert to authenticated
  with check (
    exists (
      select 1 from public.project_skus s
      where s.id = sku_attribute_values.project_sku_id
        and (s.project_id is null or public.can_see_project(s.project_id))
    )
  );

drop policy if exists "Scoped update" on public.sku_attribute_values;
create policy "Scoped update" on public.sku_attribute_values
  for update to authenticated
  using (
    exists (
      select 1 from public.project_skus s
      where s.id = sku_attribute_values.project_sku_id
        and (s.project_id is null or public.can_see_project(s.project_id))
    )
  )
  with check (
    exists (
      select 1 from public.project_skus s
      where s.id = sku_attribute_values.project_sku_id
        and (s.project_id is null or public.can_see_project(s.project_id))
    )
  );

drop policy if exists "Scoped delete" on public.sku_attribute_values;
create policy "Scoped delete" on public.sku_attribute_values
  for delete to authenticated
  using (
    exists (
      select 1 from public.project_skus s
      where s.id = sku_attribute_values.project_sku_id
        and (s.project_id is null or public.can_see_project(s.project_id))
    )
  );

-- ── Backfill ────────────────────────────────────────────────────────────────────────
--
-- Only entries that actually hold something become rows. A blank string in the JSONB
-- means "this cell was scaffolded, never filled", which is NO ROW — not a row with NULL,
-- because NULL here means somebody deliberately cleared it.
--
-- Entries pointing at an attribute that no longer exists are skipped rather than
-- resurrected: 102 of the current 141 are orphans of the 2026-08-28 wipe, and the FK
-- would reject them anyway. They stay visible in the JSONB, which is not being dropped.
--
-- Idempotent: ON CONFLICT DO NOTHING, so re-running never overwrites a value somebody
-- has since typed. That is the structural version of "a refresh must never be able to
-- overwrite what a person typed".

insert into public.sku_attribute_values (project_sku_id, attribute_id, value, source)
select
  s.id,
  (e->>'attributeId')::uuid,
  e->>'value',
  'manual'
from public.project_skus s
cross join lateral jsonb_array_elements(coalesce(s.attribute_values, '[]'::jsonb)) e
where e->>'attributeId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and btrim(coalesce(e->>'value', '')) <> ''
  and exists (
    select 1 from public.category_attributes a
    where a.id = (e->>'attributeId')::uuid
  )
on conflict (project_sku_id, attribute_id) do nothing;
