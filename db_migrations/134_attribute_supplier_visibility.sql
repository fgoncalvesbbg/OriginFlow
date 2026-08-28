-- Migration 134: per-attribute supplier visibility
--
-- Splits the attribute set into what a supplier is asked for and what stays internal.
-- Everything that reaches an external supplier is filtered on this flag:
--   * SupplierAttributePortal  (token portal — the requested-values form and its XLSX export)
--   * SubmitProposalModal      (supplier portal — free proposal submission)
--   * CreateRFQ                (PM-facing, but the RFQ it builds is sent to suppliers)
--
-- Default TRUE, so every attribute that exists today keeps behaving exactly as it does now
-- and the supplier portals are unchanged until someone marks an attribute internal. That is
-- a fail-OPEN default: a new internal attribute is visible to suppliers until it is marked.
-- It was chosen because the opposite would empty every supplier form the moment this ships.
--
-- NOTE this is a presentation filter, not an access control. category_attributes still has a
-- "Allow public read attributes" RLS policy, so anyone holding the anon key can read every
-- row including internal ones. Hiding an attribute stops it being SHOWN to a supplier; it
-- does not stop it being READ. Tightening that needs a separate change to the policy plus a
-- server-side read path for the portals.

ALTER TABLE public.category_attributes
  ADD COLUMN IF NOT EXISTS supplier_visible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.category_attributes.supplier_visible IS
  'false = internal only: never rendered in a supplier-facing attribute list. Presentation filter, not RLS.';

-- Partial index: the interesting set is the small "internal" one, not the majority.
CREATE INDEX IF NOT EXISTS idx_category_attributes_internal
  ON public.category_attributes (id) WHERE NOT supplier_visible;

NOTIFY pgrst, 'reload schema';
