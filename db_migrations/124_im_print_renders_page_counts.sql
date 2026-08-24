-- 124 — record how many pages a render produced, per language.
--
-- WHY
-- Nothing in the codebase measured pages. render-print-merge already computes each part's
-- page count (it needs them to print the cover's "jump to your language" directory), but the
-- numbers were used for that one purpose and then thrown away: im_print_renders stored bytes,
-- languages and page_size, never pages. So there was no way to answer "did this template
-- change add 12 pages across five languages?" without opening two PDFs side by side, and no
-- way to notice one language drifting away from the others.
--
-- Storing them turns three separate asks into simple queries: the page-budget diff between
-- renders, the per-language density readout, and the divergence check across languages.
--
-- Additive and nullable: rows written before this migration keep NULL, which reads correctly
-- as "not measured" rather than as zero pages.

ALTER TABLE public.im_print_renders
  ADD COLUMN IF NOT EXISTS pages INTEGER,
  ADD COLUMN IF NOT EXISTS pages_by_language JSONB;

ALTER TABLE public.im_print_renders
  DROP CONSTRAINT IF EXISTS im_print_renders_pages_check;
ALTER TABLE public.im_print_renders
  ADD CONSTRAINT im_print_renders_pages_check
  CHECK (pages IS NULL OR pages > 0);

COMMENT ON COLUMN public.im_print_renders.pages IS
  'Total pages in the merged PDF, including cover and back matter. NULL for renders made before migration 124.';
COMMENT ON COLUMN public.im_print_renders.pages_by_language IS
  'Language code -> page count for that language''s body, excluding shared cover/back pages.';
