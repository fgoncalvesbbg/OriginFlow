-- 116: Category marking on a regulation now ASSOCIATES it, not merely sorts a picker.
--
-- No schema change -- this migration only corrects COMMENTs that migration 115 got
-- wrong, and it exists because those comments are now actively misleading about a
-- compliance behaviour.
--
-- WHAT CHANGED, AND WHY
--
-- 115 shipped `regulations.applicable_categories` as a "PICKER HINT ONLY", on the
-- reasoning that a category's manual and its warning leaflet answer for different
-- obligations, so the association had to be per template. The consequence in practice:
-- an operator ticked "Induction hob" on four regulations, opened the induction-hob
-- template, and it reported zero regulations -- because ticking a category did nothing
-- except reorder a dropdown. Ticking a category reads as associating the regulation, so
-- it now does.
--
-- A template's effective list is now the UNION of:
--   * explicit  -- an im_template_regulations row for THIS template. Still the only
--                  place a per-template scope note can live, and still what lets one
--                  template narrow or add beyond its category.
--   * category  -- an ACTIVE regulation whose applicable_categories contains the
--                  template's category_id. Derived at read time; NO ROW EXISTS.
--
-- Resolved in src/services/regulatory/regulation-assignment.service.ts, and enforced
-- again server-side in netlify/functions/regulatory-check.ts, which must accept both
-- forms or it would 403 every category-derived regulation.
--
-- ACCEPTED COSTS, recorded so they are not rediscovered as bugs:
--   * A check can run against a regulation nobody attached to that specific template.
--   * The IM and the warning leaflet of one category cannot answer for different
--     CATEGORY-marked sets; differentiating still requires explicit assignment.
--   * The category half has NO FOREIGN KEY behind it, so nothing in the database stops
--     a regulation being deleted while templates rely on it by category. deleteRegulation
--     pre-checks effective usage for exactly this reason -- ON DELETE RESTRICT on
--     im_template_regulations only ever covered the explicit half.
--
-- A derived entry has no row, so it cannot be unassigned from the template UI (untick the
-- category instead) and carries no scope note -- saving a note MATERIALIZES the explicit
-- row, which then wins over the derived entry.

COMMENT ON COLUMN public.regulations.applicable_categories IS
  'categories_l3 ids AS TEXT, mirroring im_blocks.applicable_categories and im_templates.category_id byte-for-byte (that column is TEXT while categories_l3.id is UUID). LOAD-BEARING, not a hint: an ACTIVE regulation listing a category automatically applies to every im_templates row with that category_id, and a regulatory check there includes it. Superseding the regulation is what stops that. Superseded by migration 116 -- migration 115 described this column as a picker hint, which it no longer is.';

COMMENT ON COLUMN public.im_template_regulations.regulation_id IS
  'ON DELETE RESTRICT on purpose -- deleting a regulation that templates still cite is refused, exactly like deleting an in-use im_block. Note this protects only the EXPLICIT half of a template''s list: regulations that apply via regulations.applicable_categories have no row here and therefore no FK, so deleteRegulation must pre-check effective usage. Retire with regulations.status = ''superseded'' instead.';

COMMENT ON TABLE public.im_template_regulations IS
  'EXPLICIT per-template regulation assignments. Not the whole picture since migration 116: a template also answers for every ACTIVE regulation whose applicable_categories contains its category_id, derived at read time with no row here. An explicit row wins over the derived entry for the same regulation, because it is the one that can carry a scope note.';

NOTIFY pgrst, 'reload schema';
