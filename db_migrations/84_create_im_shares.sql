-- Migration 84: im_shares — public shareable links for generated Instruction Manuals.
--
-- A PM on the IM Viewer tab can mint a link (`/#/share/im/:token`) that renders the exact
-- same read-only IMViewer for anyone with the URL — no login required. The manual content
-- itself is already anonymously readable by URL (im-published bucket, migration 54); this
-- table just maps an unguessable token to the (project_id, template_type) pair so the
-- public page can resolve which manifest to load, and gives PMs a way to revoke a link.
--
-- Resolution is via a SECURITY DEFINER RPC (get_im_share_by_token) rather than a public
-- SELECT policy on the table, mirroring get_project_by_token_secure / get_rfq_entry_by_token
-- (migrations 70/73) — the function returns only the two columns the public page needs and
-- enforces revoked_at IS NULL server-side.

CREATE TABLE IF NOT EXISTS im_shares (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token          TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  project_id     UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_type  TEXT        NOT NULL DEFAULT 'im',
  created_by     TEXT,                          -- email/id of the user who created the link
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_im_shares_project
  ON im_shares(project_id, template_type, created_at DESC);

ALTER TABLE im_shares ENABLE ROW LEVEL SECURITY;

-- Internal team manages links (create/list/revoke) — mirrors project_ims' authenticated-only
-- policy; no anon/public policy is created here on purpose, resolution goes through the RPC.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_shares' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON im_shares FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Public resolution: token -> (project_id, template_type), only while not revoked.
CREATE OR REPLACE FUNCTION public.get_im_share_by_token(p_token text)
RETURNS TABLE (project_id uuid, template_type text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.project_id, s.template_type
  FROM public.im_shares s
  WHERE s.token = p_token AND s.revoked_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_im_share_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_im_share_by_token(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
