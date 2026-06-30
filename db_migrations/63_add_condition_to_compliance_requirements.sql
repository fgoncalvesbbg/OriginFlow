-- Migration 63: Attribute-based conditional TCF requirements
-- Adds an attribute-condition gate to compliance requirements (mirroring IM block refs)
-- and stores the attribute values captured at request creation on the request itself.
--
-- All changes are additive. The legacy product-feature mechanism
-- (compliance_requirements.condition_feature_ids / compliance_requests.features) was
-- never wired into the UI and is left intact but unused — no data migration needed.

-- 1. Requirement-level condition: a single FeatureConditionFields object, e.g.
--    { "requires_feature": "<attrId>", "requires_feature_label": "Rotary, Piston" }
--    or { "requires_feature_absent": "<attrId>" }. NULL = always applies.
ALTER TABLE public.compliance_requirements
  ADD COLUMN IF NOT EXISTS condition jsonb;

-- 2. Request-level captured attribute values used to evaluate the conditions above.
--    Keyed by attribute id, e.g. { "<attrId>": "Rotary" }.
ALTER TABLE public.compliance_requests
  ADD COLUMN IF NOT EXISTS condition_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;
