-- 106: Share-link lifecycle — expiry, revocation attribution, and a label.
--
-- im_shares rows previously carried only created_at/revoked_at: links were eternal
-- unless manually revoked, revocation recorded no one, and a list of five links was
-- indistinguishable. Adds:
--   - expires_at: optional TTL; the public resolver stops honoring expired tokens.
--   - revoked_by: who killed the link (audit trail).
--   - label:      free-text purpose/recipient ("DE distributor", "Amazon listing").

ALTER TABLE public.im_shares
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by TEXT,
  ADD COLUMN IF NOT EXISTS label TEXT;

-- Public resolution now also enforces expiry server-side (the SECURITY DEFINER RPC is
-- the only public read path — see migration 84).
CREATE OR REPLACE FUNCTION public.get_im_share_by_token(p_token text)
RETURNS TABLE (project_id uuid, template_type text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.project_id, s.template_type
  FROM public.im_shares s
  WHERE s.token = p_token
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_im_share_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_im_share_by_token(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
