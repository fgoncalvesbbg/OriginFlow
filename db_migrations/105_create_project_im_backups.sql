-- 105: Daily rolling backups for project manuals.
--
-- One snapshot per manual per calendar day, upserted on every save that day (so at day
-- rollover the row froze at that day's last state) and pruned by the client to the 3
-- newest days. Rows are compact: images are externalized to Storage before every save,
-- so `payload` is JSONB of URLs and text — kilobytes per row, ~3 rows per manual.
--
-- The payload is the full project_ims column set (placeholder_data, sku_content,
-- section_additions, extra_sections, section_overrides, section_skus, block_overrides,
-- bound_sku_ids, template_id, status, version), so a restore reproduces the editable
-- state exactly. Restore is editor-side: the generator loads a snapshot into its state
-- for review, and the operator saves it like any other edit.

CREATE TABLE IF NOT EXISTS public.project_im_backups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  template_type text NOT NULL DEFAULT 'im',
  backup_date   date NOT NULL,
  payload       jsonb NOT NULL,
  saved_by      text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, template_type, backup_date)
);

CREATE INDEX IF NOT EXISTS project_im_backups_lookup_idx
  ON public.project_im_backups (project_id, template_type, backup_date DESC);

ALTER TABLE public.project_im_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all for project im backups" ON public.project_im_backups;
CREATE POLICY "Enable all for project im backups" ON public.project_im_backups
  FOR ALL USING (auth.role() = 'authenticated');
