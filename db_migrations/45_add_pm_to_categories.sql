-- Migration 45: Add PM assignment to categories
-- Each category can have one assigned PM who owns all proposals and RFQs for that category.

ALTER TABLE public.categories_l3
ADD COLUMN IF NOT EXISTS pm_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.categories_l3.pm_id IS
  'The PM responsible for this category — sees all proposals and RFQs linked to it';

-- Index for fast PM-scoped lookups
CREATE INDEX IF NOT EXISTS idx_categories_l3_pm_id ON public.categories_l3(pm_id);

NOTIFY pgrst, 'reload schema';
