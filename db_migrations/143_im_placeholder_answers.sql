-- Migration 143: the placeholder wizard's answer store
--
-- WHY THIS EXISTS
--
-- Migration 142 gave every placeholder a registry row (tier, hint, dependency). This
-- migration gives each one somewhere to record its ANSWER with a status (pending / answered
-- / not_applicable), a scope (project vs. one SKU), who set it and when, and a full history --
-- none of which project_ims.placeholder_data can express: it is a flat string map with no
-- room for "deliberately left blank for now" versus "never asked about", no per-SKU
-- overlay, and no audit trail.
--
-- Mirrors migration 94 (project_skus.is_final + sku_change_log) exactly: a fast-upsertable
-- current-state table plus a separate append-only audit log, because an append-only table
-- cannot also be an UPSERT target.
--
-- project_ims.placeholder_data IS NOT TOUCHED by this migration and keeps its exact current
-- shape -- im-resolver.ts, im-publish.service.ts, render-print-prepare.ts, translation
-- memory and backups need zero changes. A service function (im-placeholder-answer.service.ts,
-- recomputePlaceholderData) rebuilds it from the rows here after every answer write; see that
-- file for why this is safe as a non-atomic, idempotent, always-total rewrite rather than a
-- DB trigger (there is no existing precedent in this codebase for one table projecting into
-- another's column via a trigger -- every trigger here is a guard, never a projection).
--
-- placeholder_key IS A BARE TEXT KEY, NOT A FOREIGN KEY -- same convention as
-- sku_attribute_flags.attribute_id. It holds either a category_attributes.id or an
-- im_adhoc_placeholders.placeholder_id, and deliberately does not cascade when either is
-- deleted: a template edited after SKUs already have answers must keep its answer HISTORY
-- even once the registry row backing it is gone (see the plan's risk note on this).

BEGIN;

-- --- 1. Current-state answers -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.im_placeholder_answers (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_im_id         UUID        NOT NULL REFERENCES public.project_ims(id) ON DELETE CASCADE,
  placeholder_key       TEXT        NOT NULL,
  scope                 TEXT        NOT NULL DEFAULT 'project' CHECK (scope IN ('project','sku')),
  project_sku_id        UUID        REFERENCES public.project_skus(id) ON DELETE CASCADE,
  status                TEXT        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending','answered','not_applicable')),
  value                 TEXT,
  source                TEXT        NOT NULL DEFAULT 'manual'
                                     CHECK (source IN ('manual','pim','eprel','supplier','carried_over')),
  skipped_then_filled   BOOLEAN     NOT NULL DEFAULT false,
  answered_by           TEXT,
  answered_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (scope = 'project' OR project_sku_id IS NOT NULL)
);

COMMENT ON TABLE public.im_placeholder_answers IS
  'Current-state answer for one placeholder on one manual, at project scope or one SKU''s scope. The source of truth for the wizard; project_ims.placeholder_data is a disposable projection of these rows (see im-placeholder-answer.service.ts recomputePlaceholderData) -- never the other way around.';
COMMENT ON COLUMN public.im_placeholder_answers.placeholder_key IS
  'category_attributes.id OR im_adhoc_placeholders.placeholder_id. Deliberately NOT a foreign key -- same convention as sku_attribute_flags.attribute_id -- so deleting/renaming the registry row behind a key never cascades away the answer history that was recorded against it.';
COMMENT ON COLUMN public.im_placeholder_answers.scope IS
  'project = one value shared by every bound SKU. sku = overlays the project-scope value for one project_sku_id only (getEffectivePlaceholderValue: an answered SKU-scope row wins over an answered project-scope row).';
COMMENT ON COLUMN public.im_placeholder_answers.skipped_then_filled IS
  'True once a question that was ever left pending is later answered. Purely informational (the wizard can badge "answered after being skipped"); never read by any gate.';
COMMENT ON COLUMN public.im_placeholder_answers.source IS
  'Where the CURRENT value came from. ''carried_over'' marks lazy hydration: a value already present in project_ims.placeholder_data before this table existed, materialized into a row the first time getWizardQuestions sees it with no answer row yet (see that function) -- never written by a migration-time backfill.';

-- Partial unique indexes (NULL project_sku_id values are never equal to each other in
-- Postgres, which is exactly the behaviour wanted: many 'sku' rows may share a
-- project_im_id + placeholder_key as long as each has a distinct project_sku_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_placeholder_answers_project
  ON public.im_placeholder_answers (project_im_id, placeholder_key)
  WHERE scope = 'project';

CREATE UNIQUE INDEX IF NOT EXISTS uq_placeholder_answers_sku
  ON public.im_placeholder_answers (project_im_id, placeholder_key, project_sku_id)
  WHERE scope = 'sku';

-- The wizard's main read: every answer for one manual.
CREATE INDEX IF NOT EXISTS idx_placeholder_answers_project_im
  ON public.im_placeholder_answers (project_im_id);

-- --- 2. Append-only audit log ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.im_placeholder_answer_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_im_id         UUID        REFERENCES public.project_ims(id) ON DELETE SET NULL,
  project_sku_id        UUID        REFERENCES public.project_skus(id) ON DELETE SET NULL,
  sku_number_snapshot   TEXT        NOT NULL DEFAULT '',
  placeholder_key       TEXT        NOT NULL,
  scope                 TEXT        NOT NULL CHECK (scope IN ('project','sku')),
  action                TEXT        NOT NULL
                                     CHECK (action IN ('answer','update','skip','unskip','mark_not_applicable','clear')),
  old_value             TEXT,
  new_value             TEXT,
  old_status            TEXT,
  new_status            TEXT        NOT NULL,
  changed_by            UUID,
  changed_by_name       TEXT        NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.im_placeholder_answer_log IS
  'Append-only audit trail of every answer change -- mirrors sku_change_log (migration 94). ON DELETE SET NULL (not CASCADE) on both FKs so the trail survives a manual or SKU deletion; sku_number_snapshot is denormalised so a deleted SKU''s history still reads sensibly.';
COMMENT ON COLUMN public.im_placeholder_answer_log.action IS
  'Derived from the status transition by saveWizardAnswer/inferAnswerAction: ->''not_applicable'' = ''mark_not_applicable''; ->''answered'' = ''answer'' (or ''update'' when the prior status was already ''answered'' -- an edit, not a first answer); ''answered''->''pending'' = ''clear''; ''not_applicable''->''pending'' = ''unskip''; anything else ->''pending'' (no prior row, or prior was ''pending'') = ''skip''.';

CREATE INDEX IF NOT EXISTS idx_placeholder_answer_log_project_im
  ON public.im_placeholder_answer_log (project_im_id, created_at DESC);

-- --- 3. RLS --------------------------------------------------------------------

ALTER TABLE public.im_placeholder_answers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.im_placeholder_answer_log  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_placeholder_answers' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON public.im_placeholder_answers FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Append-only: INSERT + SELECT only, no update/delete policy -- same DB-enforced
-- immutability as sku_change_log (migration 94).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_placeholder_answer_log' AND policyname='Auth insert') THEN
    CREATE POLICY "Auth insert" ON public.im_placeholder_answer_log FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_placeholder_answer_log' AND policyname='Auth select') THEN
    CREATE POLICY "Auth select" ON public.im_placeholder_answer_log FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
