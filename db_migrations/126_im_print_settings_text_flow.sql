-- 126 — paragraph/list rhythm and table text size as settings.
--
-- WHY (paragraph_spacing_em)
-- The largest single source of wasted page space left in the A5 booklets, and unlike the
-- spacing fixed by migration 125 these values were already `em`-based, so they scaled with the
-- type correctly. The problem was the value, not the unit: 1em is a web default, and at the
-- live A5 setting (7pt / 1.20 line height) 1em is 2.47mm against a 2.96mm line box — every
-- paragraph break costs 0.83 of a line.
--
-- Measured over the section corpus (161 EN sections: 494 paragraphs, 98 lists, 411 list items)
-- the bottom margins on p / ul / ol / li came to 9.4 A5 pages per language of pure gap. Only
-- bottom margins are set, so nothing collapses and that figure is not inflated. At 0.5em it
-- falls to 4.9 pages — about 4.6 pages saved per language.
--
-- The compact leaflet path already overrode these to 0.35em/0.1em, which is exactly this
-- change; the manual never received it. Those overrides are now dropped in favour of this
-- column, with the leaflet profiles set to 0.35 so their output is unchanged.
--
-- WHY (table_font_scale)
-- Print manuals conventionally set tabular matter a step below running text. Expressed as a
-- ratio of body_pt rather than an absolute size so the two cannot drift apart when body size
-- changes — the same reason A5 should derive from A4 rather than duplicate it.
--
-- The renderer floors the result at MIN_TABLE_PT (see im-print-html.ts): this is safety
-- content, and a scale must not be able to shrink it without limit. Leaflets stay at 1.00,
-- since their body is already 6pt.

ALTER TABLE public.im_print_settings
  ADD COLUMN IF NOT EXISTS paragraph_spacing_em NUMERIC(4,2) NOT NULL DEFAULT 0.50;
ALTER TABLE public.im_print_settings
  ADD COLUMN IF NOT EXISTS table_font_scale NUMERIC(4,2) NOT NULL DEFAULT 0.95;

-- Ranges mirror PRINT_SETTING_LIMITS in src/services/im/im-print-typography.ts.
ALTER TABLE public.im_print_settings
  DROP CONSTRAINT IF EXISTS im_print_settings_paragraph_spacing_em_check;
ALTER TABLE public.im_print_settings
  ADD CONSTRAINT im_print_settings_paragraph_spacing_em_check
  CHECK (paragraph_spacing_em >= 0 AND paragraph_spacing_em <= 2);

ALTER TABLE public.im_print_settings
  DROP CONSTRAINT IF EXISTS im_print_settings_table_font_scale_check;
ALTER TABLE public.im_print_settings
  ADD CONSTRAINT im_print_settings_table_font_scale_check
  CHECK (table_font_scale >= 0.6 AND table_font_scale <= 1);

-- Preserve today's leaflet output exactly: 0.35em was their compact override, and their body
-- is already 6pt so tabular text should not shrink further.
UPDATE public.im_print_settings
   SET paragraph_spacing_em = 0.35, table_font_scale = 1.00
 WHERE template_type = 'warning_leaflet';

COMMENT ON COLUMN public.im_print_settings.paragraph_spacing_em IS
  'Bottom margin on paragraphs and lists, in em of body size. List items use 0.3x this. Was a hardcoded 1em (web default) on manuals.';
COMMENT ON COLUMN public.im_print_settings.table_font_scale IS
  'Table text size as a ratio of body_pt. Floored at MIN_TABLE_PT by the renderer so safety content cannot shrink without limit.';
