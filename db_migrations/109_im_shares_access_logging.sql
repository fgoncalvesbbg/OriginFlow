-- 109: Share-link access logging — last_used_at / use_count.
--
-- Shares now have labels and expiry (migration 106), but there was no way to tell
-- whether a link was ever OPENED — "is this link dead?" and "is this link being
-- hammered from somewhere unexpected?" were both unanswerable. The public resolver
-- RPC is the single read path for tokens, so bumping a counter there captures every
-- successful resolution with zero client changes.

ALTER TABLE public.im_shares
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.im_shares.last_used_at IS
  'When the public token was last successfully resolved (viewer opened). Null = never opened.';
COMMENT ON COLUMN public.im_shares.use_count IS
  'How many times the public token has been successfully resolved.';

-- Same signature and filters as migration 106, but the SELECT becomes an
-- UPDATE ... RETURNING so every successful resolution stamps the row. Revoked or
-- expired tokens match no row, are not counted, and return nothing — unchanged.
CREATE OR REPLACE FUNCTION public.get_im_share_by_token(p_token text)
RETURNS TABLE (project_id uuid, template_type text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.im_shares s
  SET last_used_at = NOW(),
      use_count = s.use_count + 1
  WHERE s.token = p_token
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
  RETURNING s.project_id, s.template_type;
$$;

REVOKE ALL ON FUNCTION public.get_im_share_by_token(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_im_share_by_token(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
