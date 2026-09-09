-- 156: sku_change_log carries per-CELL history, so there is one history and not two.
--
-- ProductToolkit's Attribute Viewer keeps its own attr_audit table. OriginFlow already
-- has an append-only per-SKU log with actor, note, before and after — extending it is
-- strictly better than a parallel table, because "what happened to this SKU" stays one
-- query and one screen.
--
-- DELIBERATE DEVIATION from the plan's sketch, which had
-- `attribute_id ... references category_attributes(id) on delete set null`.
-- No FK here, on purpose. The point of an append-only audit is that it survives, and
-- attribute deletion is not hypothetical in this database — 172 rows were deleted on
-- 2026-08-28. `on delete set null` would erase which attribute an entry was about at
-- exactly the moment that becomes the interesting question. Keeping the raw id leaves a
-- dangling reference, which is the correct shape for a historical record, and the
-- trigger in 158 also writes the attribute's NAME into the existing `field` column, so
-- an entry stays readable after its attribute is gone.

alter table public.sku_change_log
  add column if not exists attribute_id uuid,
  add column if not exists source text;

comment on column public.sku_change_log.attribute_id is
  'For action = value/clear: which attribute the cell belonged to. Intentionally no FK — the log must outlive the attribute. `field` carries the name as it read at the time.';
comment on column public.sku_change_log.source is
  'For action = value/clear: the sku_attribute_values.source the write carried (manual, sheet-import, pt-import, supplier, wizard, eprel).';

-- 'value' = a cell was set or changed. 'clear' = a cell was explicitly emptied, which is
-- its own event and not an update to '' — the whole model turns on that distinction, so
-- the log should not blur it either.
alter table public.sku_change_log
  drop constraint if exists sku_change_log_action_check;

alter table public.sku_change_log
  add constraint sku_change_log_action_check
  check (action = any (array[
    'finalize', 'unlock', 'update', 'create', 'delete', 'export', 'value', 'clear'
  ]));

-- "Everything that ever happened to this attribute, across every SKU" — the Catalogue
-- panel's per-attribute history. Partial, because only value/clear rows carry one.
create index if not exists sku_change_log_attribute_id_idx
  on public.sku_change_log (attribute_id)
  where attribute_id is not null;
