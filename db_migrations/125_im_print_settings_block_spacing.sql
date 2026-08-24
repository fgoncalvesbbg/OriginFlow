-- 125 — one vertical-rhythm setting for print content blocks.
--
-- WHY
-- Migration 123 moved table cell padding onto the mm scale, but that was one instance of a
-- wider problem: nearly all spacing between content blocks in the print stylesheet was
-- expressed in `rem` or `px`, which belong to NEITHER of the two scales the renderer uses —
-- the pt scale (body/heading sizes) and the mm() furniture scale (which applies a 0.82 factor
-- on A5). So these values were identical on a 6pt A5 leaflet and a 10.77pt A4 manual.
--
-- At the live A5 setting (7pt / 1.20 line height) one line box is 2.96mm, against:
--
--   .imv-content table  margin: 1rem 0      ->  8.47mm  = 2.9 lines, per table
--   editor image        margin: 1rem 0      ->  8.47mm  = 2.9 lines, per image
--   .imv-block-wrapper  padding+margin      -> 21.17mm  = 7.2 lines, per callout
--   .imv-steps          margin: 1.25rem 0   -> 10.58mm  = 3.6 lines, per step list
--   .imv-legend-table   margin: 1.25rem 0   -> 10.58mm  = 3.6 lines, per legend
--   .imv-annotated      margin: 1.25rem 0   -> 10.58mm  = 3.6 lines, per image set
--
-- Measured over the section corpus (161 EN sections: 38 tables, 45 images), the table and
-- image margins alone cost roughly 3.9 A5 pages per language.
--
-- The compact leaflet path already overrode these to 0.35-0.5rem, so the tightening was
-- known to matter — the full manual simply never received it. This replaces all of them with
-- one admin-owned value per profile, in mm, so the rhythm is a decision rather than a
-- leftover.
--
-- Additive and backward compatible: NOT NULL with a default, and a renderer predating this
-- migration never reads the column.

ALTER TABLE public.im_print_settings
  ADD COLUMN IF NOT EXISTS block_spacing_mm NUMERIC(5,2) NOT NULL DEFAULT 2.50;

-- Range mirrors PRINT_SETTING_LIMITS in src/services/im/im-print-typography.ts, so a value
-- the admin form accepts also passes here.
ALTER TABLE public.im_print_settings
  DROP CONSTRAINT IF EXISTS im_print_settings_block_spacing_mm_check;
ALTER TABLE public.im_print_settings
  ADD CONSTRAINT im_print_settings_block_spacing_mm_check
  CHECK (block_spacing_mm >= 0 AND block_spacing_mm <= 15);

-- Leaflets are a single dense sheet and already ran tighter than the manual; keep them there.
UPDATE public.im_print_settings SET block_spacing_mm = 1.50 WHERE template_type = 'warning_leaflet';

COMMENT ON COLUMN public.im_print_settings.block_spacing_mm IS
  'Vertical rhythm between print content blocks (tables, images, callouts, step lists, legends, annotated sets), in mm. Replaces the unscaled 1rem/1.25rem values.';
