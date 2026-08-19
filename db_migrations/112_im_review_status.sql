-- 112: Markup.io review OUTCOME — polled from the Markup API and cached here.
--
-- Migration 111 records that a review round went OUT (review_url/_requested_at/
-- _version); nothing recorded whether it came BACK. The markup-review-status
-- Netlify function GETs /api/v2/markups/{review_markup_id} and caches what it
-- learned on the manual, so the dashboard/generator can show "Review done" (and
-- open-thread progress) without every browser holding the Markup API key.
--
--   review_status         raw Markup.io markup status ('editing', 'complete', …,
--                          or 'deleted' when the markup vanished from Markup.io)
--   review_done           derived: the markup status reads completed/approved, OR
--                          at least one explicit approval (projectReviews) exists
--   review_active_threads open (unresolved) comment threads at last check
--   review_approvals      explicit approvals at last check
--   review_checked_at     when the Markup API was last polled
--
-- Like the 111 columns, these are NOT content columns — the migration-102/110
-- FINAL guard leaves them writable on a locked manual by design.

ALTER TABLE public.project_ims
  ADD COLUMN IF NOT EXISTS review_status TEXT,
  ADD COLUMN IF NOT EXISTS review_done BOOLEAN,
  ADD COLUMN IF NOT EXISTS review_active_threads INTEGER,
  ADD COLUMN IF NOT EXISTS review_approvals INTEGER,
  ADD COLUMN IF NOT EXISTS review_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.project_ims.review_status IS
  'Raw Markup.io markup status at last check (editing/complete/…; ''deleted'' = markup gone). Null = never checked.';
COMMENT ON COLUMN public.project_ims.review_done IS
  'Derived at last check: markup status completed/approved OR >=1 explicit approval. Null = never checked.';
COMMENT ON COLUMN public.project_ims.review_active_threads IS
  'Open (unresolved) Markup.io comment threads at last check.';
COMMENT ON COLUMN public.project_ims.review_approvals IS
  'Explicit Markup.io approvals (projectReviews) at last check.';
COMMENT ON COLUMN public.project_ims.review_checked_at IS
  'When the Markup.io API was last polled for this manual''s review round.';
