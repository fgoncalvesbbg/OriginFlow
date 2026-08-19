-- 111: Markup.io supplier-review round for project manuals.
--
-- "Send for review" uploads a rendered print PDF to Markup.io (via the
-- send-to-markup Netlify function, service role) and records the returned share
-- link in two places:
--
--   1. im_print_renders — per-PDF: which render was sent, and its markup link.
--      Every review round creates a NEW markup (old links + supplier comments
--      stay intact), so the render history doubles as the review history.
--   2. project_ims — the manual's CURRENT review round. "In Review" is DERIVED,
--      not stored: a manual is in review while status = 'generated' AND
--      review_requested_at is set AND review_version matches the published
--      version. A draft save already flips status to 'draft' and a republish
--      bumps version, so either kind of edit ends the review state without any
--      extra clearing write.
--
-- The migration-102/110 finalized guard freezes only the enumerated CONTENT
-- columns, so these review columns stay writable on a FINAL manual by design —
-- sign-off does not block sharing the locked PDF for a review round.

ALTER TABLE public.project_ims
  ADD COLUMN IF NOT EXISTS review_url text,
  ADD COLUMN IF NOT EXISTS review_markup_id text,
  ADD COLUMN IF NOT EXISTS review_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_requested_by text,
  ADD COLUMN IF NOT EXISTS review_version integer;

COMMENT ON COLUMN public.project_ims.review_url IS
  'Markup.io share link of the most recent review round (kept after the round ends, as history).';
COMMENT ON COLUMN public.project_ims.review_markup_id IS
  'Markup.io markup id of the most recent review round.';
COMMENT ON COLUMN public.project_ims.review_requested_at IS
  'When the manual was last sent to Markup.io for review. The manual displays as In Review while status=generated and review_version = version.';
COMMENT ON COLUMN public.project_ims.review_requested_by IS
  'Email/id of the user who sent the manual for review.';
COMMENT ON COLUMN public.project_ims.review_version IS
  'The publish version (project_ims.version) that was sent for review.';

ALTER TABLE public.im_print_renders
  ADD COLUMN IF NOT EXISTS markup_url text,
  ADD COLUMN IF NOT EXISTS markup_id text;

COMMENT ON COLUMN public.im_print_renders.markup_url IS
  'Markup.io share link this rendered PDF was sent to for review (null = never sent).';
COMMENT ON COLUMN public.im_print_renders.markup_id IS
  'Markup.io markup id for markup_url.';
