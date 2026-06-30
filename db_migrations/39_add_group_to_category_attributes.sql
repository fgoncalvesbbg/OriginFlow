-- Add group column to category_attributes table
-- Groups: Category Specific, Standard Electric Specs, Product Dimensions,
--         Battery Information, Packaging, Accessories
ALTER TABLE category_attributes
  ADD COLUMN IF NOT EXISTS "group" text NOT NULL DEFAULT 'Category Specific';

-- Allow category_id to be NULL for predefined-group (global) attributes
-- that are shared across all categories
ALTER TABLE category_attributes
  ALTER COLUMN category_id DROP NOT NULL;
