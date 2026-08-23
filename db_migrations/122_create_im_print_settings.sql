-- 122: Global print typography — one admin-owned setting per (template type x page size).
--
-- WHY: the exported PDF's typography was NOT a global decision. The font FAMILY came
-- from the IM template's metadata (im_templates.metadata.fontFamily), and a template is
-- bound to a product category — so the same booklet program printed in a different font
-- per category. Font SIZES, line spacing and page margins were worse: hardcoded in the
-- print-HTML builder (mm-based, with a fixed 0.82 A5 type scale) and in the render
-- functions (IM_MARGIN / LEAFLET_MARGIN), so changing them meant a code deploy.
--
-- Typography is a house-style decision, not a per-category one. This table makes it
-- global and admin-editable (Admin console -> IM Print), keyed by the two axes that
-- genuinely need different values:
--   * template_type - a full manual and a compact warning leaflet are set very
--     differently (a leaflet must fit a few pages; ~6pt vs ~10.8pt body).
--   * page_size     - A5 needs a smaller type scale than A4 at the same content.
-- Product category is deliberately NOT one of them.
--
-- Seeded with values that reproduce the previous hardcoded output byte-for-byte
-- (A4 body 3.8mm = 10.77pt, section title 6.2mm = 17.58pt, A5 = those x 0.82,
-- leaflet 6pt/8pt), so applying this migration changes no existing PDF.

CREATE TABLE IF NOT EXISTS public.im_print_settings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type    TEXT        NOT NULL CHECK (template_type IN ('im', 'warning_leaflet')),
  page_size        TEXT        NOT NULL CHECK (page_size IN ('a4', 'a5')),
  -- Google-font family name; must be one of GOOGLE_FONT_IMPORTS in im-print-html.ts
  -- (an unknown value degrades to Inter at render time rather than failing).
  font_family      TEXT        NOT NULL DEFAULT 'Inter',
  -- Body text size in POINTS (print's native unit) — applied to all running text.
  body_pt          NUMERIC(5,2) NOT NULL DEFAULT 10.77 CHECK (body_pt      BETWEEN 4 AND 32),
  -- Heading size in points — section titles; in-content h1/h2/h3 derive from it.
  heading_pt       NUMERIC(5,2) NOT NULL DEFAULT 17.58 CHECK (heading_pt   BETWEEN 4 AND 48),
  -- Unitless line-height multiplier for body text.
  line_height      NUMERIC(4,2) NOT NULL DEFAULT 1.60  CHECK (line_height  BETWEEN 1 AND 3),
  -- Page margins in mm, passed to the PDF engine. The bottom band also has to hold the
  -- stamped running footer / page number, hence the 8mm floor on it.
  margin_top_mm    NUMERIC(5,2) NOT NULL DEFAULT 16 CHECK (margin_top_mm    BETWEEN 0 AND 60),
  margin_bottom_mm NUMERIC(5,2) NOT NULL DEFAULT 18 CHECK (margin_bottom_mm BETWEEN 8 AND 60),
  margin_left_mm   NUMERIC(5,2) NOT NULL DEFAULT 14 CHECK (margin_left_mm   BETWEEN 0 AND 60),
  margin_right_mm  NUMERIC(5,2) NOT NULL DEFAULT 14 CHECK (margin_right_mm  BETWEEN 0 AND 60),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       UUID,
  UNIQUE (template_type, page_size)
);

COMMENT ON TABLE public.im_print_settings IS
  'Global print typography for the PDF export, one row per (template_type, page_size). Admin-owned; deliberately NOT per product category.';

ALTER TABLE public.im_print_settings ENABLE ROW LEVEL SECURITY;

-- Read for every signed-in user (the print-export dialog shows the active profile and
-- passes it to the render pipeline); write for admins only — same shape as im_markets
-- after migration 110.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_print_settings' AND policyname='Auth read') THEN
    CREATE POLICY "Auth read" ON public.im_print_settings FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_print_settings' AND policyname='Admin write') THEN
    CREATE POLICY "Admin write" ON public.im_print_settings FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'))
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
  END IF;
END $$;

-- Seed the four profiles with the values the hardcoded renderer already produced.
INSERT INTO public.im_print_settings
  (template_type, page_size, font_family, body_pt, heading_pt, line_height,
   margin_top_mm, margin_bottom_mm, margin_left_mm, margin_right_mm)
VALUES
  ('im',              'a4', 'Inter', 10.77, 17.58, 1.60, 16, 18, 14, 14),
  ('im',              'a5', 'Inter',  8.83, 14.41, 1.60, 16, 18, 14, 14),
  ('warning_leaflet', 'a4', 'Inter',  6.00,  8.00, 1.30,  8,  8, 10, 10),
  ('warning_leaflet', 'a5', 'Inter',  6.00,  8.00, 1.30,  8,  8, 10, 10)
ON CONFLICT (template_type, page_size) DO NOTHING;
