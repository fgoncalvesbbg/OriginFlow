-- Migration 49: Add sku_content column to project_ims
-- Stores structured per-SKU content (control panels, how-it-works prose, legend tables,
-- assembly steps) as typed JSON keyed by slot name.
-- The resolver reads this column when assembling a ResolvedManual for a project.

ALTER TABLE public.project_ims
  ADD COLUMN IF NOT EXISTS sku_content jsonb NOT NULL DEFAULT '{}';
