-- 119: Pre-publish checklist items on a regulation, and the per-manual record of
--      which of them were taken into account.
--
-- WHY THIS EXISTS
--
-- The regulatory feature so far answers "what does the model think is wrong with this
-- template" (migration 115) and "what did a human decide about each finding"
-- (migration 118). Neither answers the question an operator actually has in front of a
-- manual about to go out: "of everything these regulations oblige us to do, what have I
-- confirmed?" The AI check is advisory and covers only what its summary happens to
-- describe; the obligations a person must eyeball -- the symbol is on the rating plate,
-- the declaration of conformity is enclosed, the QR code resolves -- have lived nowhere.
--
-- So a regulation can now carry CHECKLIST ITEMS, and every regulation that applies to a
-- template contributes its items to one combined list shown before publishing, where each
-- item can be marked. Marking is OPTIONAL and never blocks a publish: an unticked box
-- means "not confirmed", which is information, not a gate. Making it a gate would only
-- teach people to tick everything.
--
-- --- Decisions, each with a cheaper-looking alternative -----------------------
--
--   * CHECKLIST IS A TEXT COLUMN, ONE ITEM PER LINE -- not jsonb, and not a child table
--     with a row per item. This mirrors `regulations.notes`, which is already written and
--     read as one-bullet-per-line prose (src/services/regulatory/regulation-notes.ts).
--     An item is a sentence a person reads and ticks; it has no fields of its own, so a
--     child table would buy nothing but joins, and jsonb would need a migration and a
--     bespoke editor where a textarea does. Every existing row stays valid with the
--     column NULL.
--
--   * IT IS NOT SENT TO THE MODEL. `notes` IS interpolated into the regulatory-check
--     prompt, so the distinction matters and is stated here to stop the two being
--     conflated later: notes tell the model how to read the regulation, the checklist
--     tells a person what to verify by hand. Feeding these items to the check would
--     invite exactly the findings the check cannot support -- it sees serialized template
--     text, not the rating plate or the box contents.
--
--   * THE TICKS ARE PER PUBLISHED MANUAL, keyed (project_id, template_type), not per
--     template. Only a project IM is ever published (see im_publish_snapshots); a
--     template is authored, never published. "The declaration of conformity is enclosed"
--     is true of one product's manual, not of the template it came from, so recording it
--     against the template would show every other project's manual as pre-confirmed --
--     silently, and in the one place where a false confirmation is most expensive. The
--     template's only role is deciding WHICH items apply, via its regulations.
--
--   * KEYED BY ITEM CONTENT, NOT BY POSITION. `item_key` is derived from the item's text
--     by checklistItemKey() in src/services/regulatory/regulation-checklist.ts. A line
--     index would silently transfer a tick to a different obligation the moment somebody
--     inserts an item above it -- the worst available failure for this table. Content
--     keying instead means editing item 3 leaves items 1, 2 and 4 confirmed, and
--     reordering changes nothing at all.
--
--     The known limit, stated so it is not mistaken for a bug: REWORDING an item clears
--     its confirmation, because the key changes and the item comes back unticked. That is
--     the intended behaviour rather than a cost -- if the obligation was rewritten, what
--     somebody confirmed last month was a different sentence, and re-confirming it is the
--     point of the exercise.
--
--   * TWO STATUSES, AND NO 'open'. 'done' = taken into account. 'na' = deliberately not
--     applicable to this manual (this product has no water circuit, so the descaling
--     warning does not apply), which is what stops a checklist from being ticked
--     dishonestly to make it go quiet. Unreviewed is the ABSENCE of a row, so the default
--     costs nothing and clearing a decision is a DELETE -- same shape as
--     im_regulatory_finding_status.
--
--   * NO FK TO project_ims. The pair (project_id, template_type) is how every other
--     project-IM-scoped table addresses an instance (project_im_backups, migration 105)
--     and how the published artifacts are laid out in storage. project_id carries the
--     CASCADE, so deleting a project takes its confirmations with it.
--
-- NO Postgres enums and NO updated_at trigger, per house style.

-- --- 1. The items ------------------------------------------------------------

ALTER TABLE public.regulations
  ADD COLUMN IF NOT EXISTS checklist TEXT;

COMMENT ON COLUMN public.regulations.checklist IS
  'Pre-publish checklist items, ONE PER LINE, same convention as regulations.notes (parsed by parseRegulationChecklist in src/services/regulatory/regulation-checklist.ts). Every regulation applying to a template contributes its items to one combined checklist shown before a manual is published. UNLIKE notes, this is NEVER sent to the AI check: notes tell the model how to read the regulation, these tell a person what to verify by hand (symbol on the rating plate, DoC enclosed) -- things the check cannot see because it only reads serialized template text.';

-- --- 2. What was confirmed, per published manual ------------------------------

CREATE TABLE IF NOT EXISTS public.im_regulatory_checklist_state (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  template_type  TEXT        NOT NULL DEFAULT 'im',
  item_key       TEXT        NOT NULL,
  status         TEXT        NOT NULL CHECK (status IN ('done','na')),
  note           TEXT,
  updated_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.im_regulatory_checklist_state IS
  'Which regulatory checklist items were taken into account for ONE project manual, keyed (project_id, template_type) like project_im_backups. Advisory: an unticked item never blocks a publish. Unreviewed items have no row.';
COMMENT ON COLUMN public.im_regulatory_checklist_state.item_key IS
  'Content-derived key from checklistItemKey() in src/services/regulatory/regulation-checklist.ts -- the item text, whitespace/case/bullet-marker normalized. Content-keyed rather than positional so inserting or reordering items cannot move a confirmation onto a different obligation; the accepted cost is that REWORDING an item clears its confirmation, which is wanted (a rewritten obligation has not been confirmed).';
COMMENT ON COLUMN public.im_regulatory_checklist_state.status IS
  '''done'' = taken into account. ''na'' = deliberately not applicable to this manual, which exists so an inapplicable item can be cleared honestly instead of being ticked. There is deliberately no ''open'': unreviewed is the absence of a row.';
COMMENT ON COLUMN public.im_regulatory_checklist_state.template_type IS
  '''im'' or ''warning_leaflet'', mirroring project_ims.template_type: the two documents of one project are published separately and each carries its own confirmations.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_im_regulatory_checklist_state_key
  ON public.im_regulatory_checklist_state (project_id, template_type, item_key);
CREATE INDEX IF NOT EXISTS idx_im_regulatory_checklist_state_manual
  ON public.im_regulatory_checklist_state (project_id, template_type);

ALTER TABLE public.im_regulatory_checklist_state ENABLE ROW LEVEL SECURITY;

-- Blanket, like im_template_regulations and im_regulatory_finding_status: confirming a
-- checklist item is routine authoring work by the person publishing the manual, it cannot
-- alter any regulation or any check report, and updated_by/updated_at record who said so.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_regulatory_checklist_state' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON public.im_regulatory_checklist_state FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
