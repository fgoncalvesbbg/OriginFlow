-- 127 — table rule weight as a setting.
--
-- WHY
-- Both table flavours drew `border: 1px solid #cbd5e1`. In print 1 CSS px is 1/96 inch, so that
-- rule is 0.265mm = **0.75pt** — against 6.65pt table text (body 7pt x the 0.95 table scale from
-- migration 126) the line is 11% of the type size, which is why the tables read as heavy boxes
-- rather than as a grid supporting the text. Fine tabular rules are conventionally 0.25-0.5pt.
--
-- Like every other value in this series it was a web default (`1px`) that belonged to neither of
-- the renderer's scales, so it was identical on a 6pt leaflet and a 10.77pt A4 manual.
--
-- Default 0.10mm = 0.28pt: 2.6x finer than before, and deliberately just above the ~0.25pt
-- floor below which hairlines risk dropping out on press. 0 is allowed and means no rule at
-- all, which is a legitimate choice for a table that reads as columns of text.

ALTER TABLE public.im_print_settings
  ADD COLUMN IF NOT EXISTS table_border_mm NUMERIC(4,2) NOT NULL DEFAULT 0.10;

-- Range mirrors PRINT_SETTING_LIMITS in src/services/im/im-print-typography.ts.
ALTER TABLE public.im_print_settings
  DROP CONSTRAINT IF EXISTS im_print_settings_table_border_mm_check;
ALTER TABLE public.im_print_settings
  ADD CONSTRAINT im_print_settings_table_border_mm_check
  CHECK (table_border_mm >= 0 AND table_border_mm <= 1);

COMMENT ON COLUMN public.im_print_settings.table_border_mm IS
  'Table rule weight in mm. Was a hardcoded 1px (0.75pt). 0 means no rules; below ~0.09mm (0.25pt) hairlines risk dropout on press.';
