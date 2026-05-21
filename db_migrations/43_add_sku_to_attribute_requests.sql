-- Migration 43: Add SKU fields to project_attribute_requests
-- Allows multiple requests per project/step, one per SKU

ALTER TABLE project_attribute_requests
  ADD COLUMN IF NOT EXISTS sku_number TEXT NOT NULL DEFAULT '';

ALTER TABLE project_attribute_requests
  ADD COLUMN IF NOT EXISTS sku_title TEXT NOT NULL DEFAULT '';
