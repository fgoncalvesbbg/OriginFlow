-- Migration 92: Add an internal-only title to im_blocks
-- ---------------------------------------------------------------------------
-- A brief label authors use to tell shared blocks apart in the Block Library
-- and block pickers. It is NEVER rendered into a generated IM — callout blocks
-- print a type-derived localized header (WARNING/CAUTION/…) and content blocks
-- print no title, so this field is purely for internal differentiation.

ALTER TABLE public.im_blocks
  ADD COLUMN IF NOT EXISTS internal_title text;

COMMENT ON COLUMN public.im_blocks.internal_title IS
  'Internal-only label to differentiate blocks in the library/pickers. Never printed on generated IMs.';
