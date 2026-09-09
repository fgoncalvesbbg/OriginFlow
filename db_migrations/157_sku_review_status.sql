-- 157: Review status gains the two facts a reader actually asks for.
--
-- project_skus.is_final already answers "is this signed off". It does not answer the two
-- questions that come next, both of which ProductToolkit's attr_sku_status carries:
--
--   "when, and by whom?"  — is_final is a bare boolean; the change log has the event but
--                           reading a log to render a column header is the wrong shape.
--   "why is this open again?" — a SKU that was Final and is now open is the one a
--                           reviewer stops on. The reason belongs on the SKU, shown on
--                           its column header, not buried in a note field.

alter table public.project_skus
  add column if not exists finalized_at  timestamptz,
  add column if not exists finalized_by  uuid,
  add column if not exists reopen_reason text;

comment on column public.project_skus.finalized_at is
  'When is_final was last set true. Cleared on unlock.';
comment on column public.project_skus.finalized_by is
  'Who set is_final true. No FK, matching the other actor columns — a deleted user must not take the record with them.';
comment on column public.project_skus.reopen_reason is
  'Why a signed-off SKU was reopened. Rendered on the SKU column header so a reader scanning a hundred columns can see why one is still open. Cleared when the SKU is finalized again.';

-- Backfill what can be known. Anything already Final was finalized at some point in the
-- past that nothing recorded on the row; the change log has 'finalize' entries, so take
-- the most recent one per SKU rather than inventing now() — a fabricated timestamp on a
-- sign-off is worse than a null one.
update public.project_skus s
set finalized_at = l.created_at,
    finalized_by = l.changed_by
from (
  select distinct on (project_sku_id) project_sku_id, created_at, changed_by
  from public.sku_change_log
  where action = 'finalize' and project_sku_id is not null
  order by project_sku_id, created_at desc
) l
where l.project_sku_id = s.id
  and s.is_final
  and s.finalized_at is null;
