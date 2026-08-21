-- 120: The same regulatory checklist, confirmed by the person who BUILDS the template.
--
-- WHY A SECOND TABLE RATHER THAN A SCOPE COLUMN ON migration 119's
--
-- 119 records "this product's manual takes obligation X into account", keyed
-- (project_id, template_type), because only a project manual is ever published. That left
-- the template author -- the person who actually writes the compliant content -- with a
-- read-only list. They need the same checklist as a readiness gate on the TEMPLATE: is
-- what I built complete and compliant enough to release?
--
-- These are two different statements, made by two different people, at two different times,
-- about two different objects. The template author confirms the template covers an
-- obligation; the publisher confirms this product's manual does. Neither implies the other:
-- a template can cover an obligation the manual then hides behind an unmet condition, and a
-- manual can satisfy one through project-only content the template never had. So both are
-- recorded, and neither is derived from the other.
--
-- The obvious cheaper alternative -- one table with nullable template_id/project_id and a
-- CHECK that exactly one is set -- was rejected for a concrete reason, not on taste: the
-- uniqueness it needs is two PARTIAL unique indexes, and PostgREST cannot name a partial
-- index as an ON CONFLICT target. Every write would stop being an upsert and become a
-- read-then-insert-or-update, which is both racy and slower. Two tables keep both writes a
-- single idempotent upsert.
--
-- Everything else is identical to 119 and for identical reasons, stated there in full:
--   * item_key is CONTENT-derived (checklistItemKey), never positional, so inserting or
--     reordering items cannot move a confirmation onto a different obligation, and
--     rewording an item deliberately clears it;
--   * two statuses, 'done' and 'na', with unreviewed being the ABSENCE of a row;
--   * advisory only -- nothing here blocks finalizing a template, for the same reason the
--     publish checklist does not block publishing: a gate that blocks only teaches people
--     to tick everything.
--
-- NOT gated on im_templates.is_finalized either, matching the regulatory check itself: a
-- released template is exactly the one most worth re-reviewing, and a tick is a record of
-- review rather than a content change.
--
-- NO Postgres enums and NO updated_at trigger, per house style.

CREATE TABLE IF NOT EXISTS public.im_regulatory_checklist_template_state (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID        NOT NULL REFERENCES public.im_templates(id) ON DELETE CASCADE,
  item_key     TEXT        NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('done','na')),
  note         TEXT,
  updated_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.im_regulatory_checklist_template_state IS
  'The template author''s confirmation that the TEMPLATE covers each regulatory checklist item -- the readiness gate before a template is released. Sibling of im_regulatory_checklist_state (migration 119), which records the same checklist per PUBLISHED MANUAL. Neither is derived from the other: covering an obligation in the template and satisfying it in one product''s manual are different claims. Advisory: an unticked item never blocks anything. Unreviewed items have no row.';
COMMENT ON COLUMN public.im_regulatory_checklist_template_state.item_key IS
  'Content-derived key from checklistItemKey() in src/services/regulatory/regulation-checklist.ts -- the SAME key function as im_regulatory_checklist_state, so the two scopes talk about the same item and one can be shown as context beside the other.';
COMMENT ON COLUMN public.im_regulatory_checklist_template_state.status IS
  '''done'' = the template covers it. ''na'' = the item does not apply to this template at all (e.g. a packaging-insert obligation on a warning leaflet). No ''open'': unreviewed is the absence of a row.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_im_reg_checklist_template_state_key
  ON public.im_regulatory_checklist_template_state (template_id, item_key);
CREATE INDEX IF NOT EXISTS idx_im_reg_checklist_template_state_template
  ON public.im_regulatory_checklist_template_state (template_id);

ALTER TABLE public.im_regulatory_checklist_template_state ENABLE ROW LEVEL SECURITY;

-- Blanket, like im_template_regulations, im_regulatory_finding_status and migration 119:
-- confirming a checklist item is routine authoring work, it cannot alter any regulation or
-- any check report, and updated_by/updated_at record who said so.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_regulatory_checklist_template_state' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON public.im_regulatory_checklist_template_state FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
