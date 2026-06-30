-- Seed the global "Product Images" standard attribute group.
--
-- These are image-upload slots that apply to every category (category_id = null,
-- the same convention used by the other predefined groups — see migration 39).
-- A supplier or internal user uploads ONE image per slot; the value stored in
-- project_attribute_requests.submitted_data is the public URL of the uploaded
-- image (im-assets bucket). The image can later be bound to an IM placeholder so
-- it renders inline in the generated manual.
--
-- Fixed UUIDs are used so IM template/block placeholders can reference a slot by a
-- stable id across environments. Idempotent: re-running does nothing.

INSERT INTO category_attributes (id, category_id, assigned_category_ids, name, data_type, validation_rules, "group", akeneo_id)
VALUES
  ('a1000000-0000-4000-8000-000000000001', NULL, '{}', 'Front',         'image', '{}'::jsonb, 'Product Images', NULL),
  ('a1000000-0000-4000-8000-000000000002', NULL, '{}', 'Side',          'image', '{}'::jsonb, 'Product Images', NULL),
  ('a1000000-0000-4000-8000-000000000003', NULL, '{}', 'Top',           'image', '{}'::jsonb, 'Product Images', NULL),
  ('a1000000-0000-4000-8000-000000000004', NULL, '{}', 'Bottom',        'image', '{}'::jsonb, 'Product Images', NULL),
  ('a1000000-0000-4000-8000-000000000005', NULL, '{}', 'Control Panel', 'image', '{}'::jsonb, 'Product Images', NULL),
  ('a1000000-0000-4000-8000-000000000006', NULL, '{}', 'Remote',        'image', '{}'::jsonb, 'Product Images', NULL),
  ('a1000000-0000-4000-8000-000000000007', NULL, '{}', 'Others',        'image', '{}'::jsonb, 'Product Images', NULL)
ON CONFLICT (id) DO NOTHING;
