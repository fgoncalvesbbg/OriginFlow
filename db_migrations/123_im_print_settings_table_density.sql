-- 123 — table density controls for IM print settings.
--
-- WHY
-- Table rows were the single largest source of wasted page space in the A5 booklets. Two
-- hardcoded values drove it, neither reachable from Admin -> IM Print:
--
--   1. `.imv-content th, td { padding: 0.5rem }` in im-print-html.ts. 0.5rem is 8px ~ 2.12mm
--      per side, so 4.23mm of vertical chrome per row. At the A5 body size (7pt / 1.20 line
--      height) a line box is 2.96mm — the padding alone exceeded a full line of text by 43%.
--      Being rem-based it also ignored both existing scales, so a 6pt warning leaflet used
--      the same 8px as a 10.77pt A4 manual.
--
--   2. No max-height on images anywhere in the print stylesheet. An illustration set the row
--      height and the sibling text cells stretched to match, so one-line instructions sat in
--      55mm rows.
--
-- Both are now per-profile settings, in mm, so each (template_type, page_size) pair carries
-- its own value and neither is scaled behind the operator's back.
--
-- Additive and backward compatible: the columns are NOT NULL with defaults, so existing rows
-- adopt the new values, and a renderer that predates this migration simply never reads them.

ALTER TABLE public.im_print_settings
  ADD COLUMN IF NOT EXISTS table_cell_padding_mm NUMERIC(5,2) NOT NULL DEFAULT 1.20,
  ADD COLUMN IF NOT EXISTS cell_image_max_height_mm NUMERIC(6,2) NOT NULL DEFAULT 40;

-- Ranges mirror PRINT_SETTING_LIMITS in src/services/im/im-print-typography.ts, so a value
-- the admin form accepts also passes here.
ALTER TABLE public.im_print_settings
  DROP CONSTRAINT IF EXISTS im_print_settings_table_cell_padding_mm_check;
ALTER TABLE public.im_print_settings
  ADD CONSTRAINT im_print_settings_table_cell_padding_mm_check
  CHECK (table_cell_padding_mm >= 0 AND table_cell_padding_mm <= 6);

ALTER TABLE public.im_print_settings
  DROP CONSTRAINT IF EXISTS im_print_settings_cell_image_max_height_mm_check;
ALTER TABLE public.im_print_settings
  ADD CONSTRAINT im_print_settings_cell_image_max_height_mm_check
  CHECK (cell_image_max_height_mm >= 5 AND cell_image_max_height_mm <= 200);

-- A4 has 263mm of text height against A5's 182mm, so it can afford a taller illustration
-- before one image starts costing a page.
UPDATE public.im_print_settings SET cell_image_max_height_mm = 60 WHERE page_size = 'a4';
UPDATE public.im_print_settings SET cell_image_max_height_mm = 40 WHERE page_size = 'a5';
-- Leaflets are a single dense sheet; keep illustrations small enough not to push a column.
UPDATE public.im_print_settings SET cell_image_max_height_mm = 30 WHERE template_type = 'warning_leaflet';

COMMENT ON COLUMN public.im_print_settings.table_cell_padding_mm IS
  'Padding inside every print table cell, per side, in mm. Was a hardcoded 0.5rem (~2.12mm).';
COMMENT ON COLUMN public.im_print_settings.cell_image_max_height_mm IS
  'Max rendered height of an image inside body content, in mm. Was unbounded, so an illustration set its table row height.';
