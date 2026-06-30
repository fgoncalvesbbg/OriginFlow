-- Migration 44: Add attribute_responses JSONB column to rfq_entries
-- Stores supplier's proposed values for each RFQ attribute when submitting a quote.
--
-- Structure of each element in the array:
--   {
--     "attributeId": "<uuid>",
--     "name": "<attribute display name>",
--     "proposedValue": "<supplier's proposed value>"
--   }
--
-- For numeric range attributes: proposedValue is a number string within the PM's min-max range.
-- For multi-select enum attributes: proposedValue is one of the PM's accepted options.

ALTER TABLE public.rfq_entries
ADD COLUMN IF NOT EXISTS attribute_responses JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.rfq_entries.attribute_responses IS
  'Array of {attributeId, name, proposedValue} — supplier proposed values for RFQ technical specifications';

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';
