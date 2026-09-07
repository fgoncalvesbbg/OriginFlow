-- Migration 142: the placeholder wizard registry
--
-- WHY THIS EXISTS
--
-- Today a template's placeholders exist only as ad-hoc `.im-placeholder` chips (untyped,
-- authored inline in section HTML) or `{{attributeId}}` tokens bound to a category_attributes
-- row. Nothing stops a template from shipping a chip nobody registered, and nothing
-- distinguishes "regulatory, must be filled before publish" from "nice to have" from
-- "genuinely optional" -- every value is asked for identically, in whatever order a PM
-- scrolls the flat "Fill values" form.
--
-- This migration extends category_attributes IN PLACE with the wizard's per-question
-- metadata rather than creating a parallel table: an attribute-bound placeholder already
-- has an authoritative row, and duplicating its identity elsewhere would be a second source
-- of truth for the same question. A small new table, im_adhoc_placeholders, covers the other
-- half -- chips with no attribute behind them.
--
-- wizard_tier DEFAULTS TO 'optional' for every existing row, deliberately: nothing is newly
-- gated on rollout. A PM raises a field to 'regulatory' only when they mean it.
--
-- source_hint / "inserts" from the wizard spec are NOT separate columns:
--   - source_hint is derived from the existing akeneo_id / pt_attribute_id / eprel_id
--     columns (already provenance data) -- storing it again would drift the moment one of
--     those changes.
--   - "inserts" (which sections/chips reference this key) is answered by the lint scanner
--     (im-content.utils.ts findUnregisteredPlaceholders / getWizardQuestions) walking
--     sections live, rather than a redundantly-stored list that goes stale the moment a
--     section is edited.
--
-- wizard_depends_on_* mirrors the shape category_attributes conditions already use
-- elsewhere in this app (FeatureConditionFields: requires_feature / _label / _num_min /
-- _num_max / _absent) but flattened to ONE dependency attribute with a boolean flag
-- (wizard_depends_on_absent) choosing whether that attribute must be PRESENT (optionally
-- matching a label/range) or ABSENT -- a wizard question depends on exactly one other
-- answer, never on an independent presence-of-X-AND-absence-of-Y pair, so the richer
-- two-attribute FeatureConditionFields shape would carry a column nothing sets.

BEGIN;

-- --- 1. Wizard columns on category_attributes -----------------------------------

ALTER TABLE public.category_attributes
  ADD COLUMN IF NOT EXISTS wizard_tier text NOT NULL DEFAULT 'optional'
    CHECK (wizard_tier IN ('regulatory','recommended','optional')),
  ADD COLUMN IF NOT EXISTS wizard_hint text,
  ADD COLUMN IF NOT EXISTS wizard_note text,
  ADD COLUMN IF NOT EXISTS wizard_default_value text,
  ADD COLUMN IF NOT EXISTS wizard_depends_on_attribute_id uuid,
  ADD COLUMN IF NOT EXISTS wizard_depends_on_label text,
  ADD COLUMN IF NOT EXISTS wizard_depends_on_num_min text,
  ADD COLUMN IF NOT EXISTS wizard_depends_on_num_max text,
  ADD COLUMN IF NOT EXISTS wizard_depends_on_absent boolean NOT NULL DEFAULT false;

-- Self-referencing FK, added separately (not inline in ADD COLUMN) so a partial/interrupted
-- prior run of this migration can be re-applied without erroring on a duplicate constraint.
DO $$ BEGIN
  ALTER TABLE public.category_attributes
    ADD CONSTRAINT category_attributes_wizard_depends_on_attribute_id_fkey
    FOREIGN KEY (wizard_depends_on_attribute_id) REFERENCES public.category_attributes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.category_attributes.wizard_tier IS
  'Gates the placeholder intake wizard. regulatory = must be answered before a non-draft publish/print (render-print-prepare.ts and ProjectIMGenerator.buildPublishIssues both block on a pending regulatory question). recommended/optional are advisory only. Defaults to ''optional'' so no existing attribute is retroactively gated -- a PM raises the tier deliberately.';
COMMENT ON COLUMN public.category_attributes.wizard_hint IS
  'Always-visible short guidance shown under the question in the wizard (e.g. "Found on the rating label").';
COMMENT ON COLUMN public.category_attributes.wizard_note IS
  'Longer, expandable guidance -- shown behind a disclosure, not always visible (same pattern as TranslationStatusPanel).';
COMMENT ON COLUMN public.category_attributes.wizard_default_value IS
  'Pre-filled suggestion shown when no answer exists yet. The PM still has to accept it (source=''manual'' on save); it is never auto-committed as an answer.';
COMMENT ON COLUMN public.category_attributes.wizard_depends_on_attribute_id IS
  'The single other attribute this question is sequenced behind in the wizard. NULL = no dependency, always eligible. ON DELETE SET NULL: losing the gating attribute must not delete this question, it just stops being gated. Must never point to a cycle (A depends on B depends on A) -- validated at save time in the admin editor, not by a DB constraint, because a CHECK cannot walk the graph.';
COMMENT ON COLUMN public.category_attributes.wizard_depends_on_absent IS
  'false (default): the dependency attribute must have a value (optionally matching wizard_depends_on_label / _num_min / _num_max). true: the dependency attribute must have NO value. Mirrors the two mutually-exclusive halves of FeatureConditionFields (requires_feature vs requires_feature_absent), flattened onto one dependency column since a wizard question only ever depends on one prior answer.';

-- --- 2. Ad-hoc (non-attribute-bound) placeholder registry ------------------------
--
-- One row per template-authored `.im-placeholder` chip that has no attribute binding (no
-- data-attr-id) -- there is nothing existing to extend for these, unlike the attribute-bound
-- half above. Rows here are auto-materialized on template save (upsert, wizard_tier
-- defaulting to 'optional') by the template editor's save path, so no existing template
-- fails a registry lint on rollout -- this migration only creates the table.

CREATE TABLE IF NOT EXISTS public.im_adhoc_placeholders (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id                     UUID        NOT NULL REFERENCES public.im_templates(id) ON DELETE CASCADE,
  -- Matches the chip's data-id (see InlineBlockEditor.tsx commitPlaceholder / confirm):
  -- an attribute-bound chip uses the attribute's own id as data-id, so it never lands here --
  -- only a chip with no attribute binding gets a generated id and a row in this table.
  placeholder_id                  TEXT        NOT NULL,
  label                           TEXT        NOT NULL DEFAULT '',
  type                            TEXT        NOT NULL DEFAULT 'text' CHECK (type IN ('text','image')),
  wizard_tier                     TEXT        NOT NULL DEFAULT 'optional'
                                              CHECK (wizard_tier IN ('regulatory','recommended','optional')),
  wizard_hint                     TEXT,
  wizard_note                     TEXT,
  wizard_default_value            TEXT,
  wizard_depends_on_attribute_id  UUID        REFERENCES public.category_attributes(id) ON DELETE SET NULL,
  wizard_depends_on_label         TEXT,
  wizard_depends_on_num_min       TEXT,
  wizard_depends_on_num_max       TEXT,
  wizard_depends_on_absent        BOOLEAN     NOT NULL DEFAULT false,
  sort_order                      INTEGER     NOT NULL DEFAULT 0,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, placeholder_id)
);

COMMENT ON TABLE public.im_adhoc_placeholders IS
  'The wizard registry entry for a template-authored .im-placeholder chip that is NOT bound to a category attribute (no data-attr-id). Auto-materialized (upserted) whenever a template section is saved, keyed by (template_id, placeholder_id) so re-saving never duplicates a chip already known. wizard_tier defaults to ''optional'' -- a chip only blocks publish once a PM deliberately raises it.';
COMMENT ON COLUMN public.im_adhoc_placeholders.placeholder_id IS
  'The chip''s data-id as authored by the chip-insertion UI. Relied on as a generated, collision-free key -- a free-typed id would risk two unrelated chips in the same template colliding on this row. Not a UUID column because it is compared against a DOM attribute string, never joined against another table''s id.';

CREATE INDEX IF NOT EXISTS idx_im_adhoc_placeholders_template
  ON public.im_adhoc_placeholders (template_id, sort_order);

-- --- 3. RLS: same trust tier as im_templates -- authenticated, full access ------
--
-- These rows are authoring metadata for a template, exactly like im_templates/im_sections
-- themselves: no supplier-portal surface reads or writes this table, so a blanket
-- authenticated policy (the IM-module convention -- see migration 132) is enough.

ALTER TABLE public.im_adhoc_placeholders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_adhoc_placeholders' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON public.im_adhoc_placeholders FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
