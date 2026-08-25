-- 130: im_shares gains a "review" mode — the first-party replacement for Markup.io.
--
-- WHY. The IM review round used to work by rendering a print PDF, pushing it to Markup.io
-- (netlify/functions/send-to-markup.ts) and polling that third party for the outcome
-- (migrations 111/112). Markup.io is being discontinued, so the round moves in-house and
-- onto the ONLINE manual instead of the PDF: a supplier opens an unguessable link, reads the
-- published IM in the browser, and leaves comments (see migration 131).
--
-- Rather than mint a second kind of link, this extends the share links we already have.
-- `mode` defaults to 'view', so every link that exists today keeps behaving exactly as it
-- does now, and the whole lifecycle we already built — label, expires_at, revoked_at/by,
-- last_used_at/use_count (migrations 106/109) — is inherited for free by review links.
--
-- DELIBERATELY NOT DONE HERE:
--  * get_im_share_by_token is left untouched. Widening its RETURNS TABLE would need a
--    DROP + CREATE (migration 114 learned that the hard way), and dropping it — even for a
--    moment — takes the live public /share/im/ page down mid-deploy. The review portal gets
--    its own resolver, im_review_resolve, below. A 'review' token therefore still opens
--    read-only at /share/im/:token, which is harmless and occasionally useful.
--  * The dead Markup columns on project_ims (review_url, review_markup_id, review_status
--    from migrations 111/112) are NOT dropped. They simply stop being written. Repo
--    migrations are known to drift from live, and dropping columns is the one irreversible
--    move in this change set.

ALTER TABLE public.im_shares
  ADD COLUMN IF NOT EXISTS mode           TEXT NOT NULL DEFAULT 'view'
    CHECK (mode IN ('view', 'review')),
  ADD COLUMN IF NOT EXISTS submitted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by   TEXT,
  ADD COLUMN IF NOT EXISTS manual_version INTEGER;

COMMENT ON COLUMN public.im_shares.mode IS
  'view = read-only shared manual (/#/share/im/:token). review = supplier review portal (/#/review/im/:token), which also accepts comments.';
COMMENT ON COLUMN public.im_shares.submitted_at IS
  'When the reviewer clicked "Submit review". This is what replaces the polled Markup.io "done" flag — see im-manual-status.ts.';
COMMENT ON COLUMN public.im_shares.submitted_by IS
  'Display name the reviewer submitted under (self-declared, unauthenticated).';
COMMENT ON COLUMN public.im_shares.manual_version IS
  'project_ims.version at the moment the link was minted, so a later republish is detectable as "reviewed against v3, now on v4".';

-- Review links are looked up by token on every portal load.
CREATE INDEX IF NOT EXISTS idx_im_shares_review
  ON public.im_shares (project_id, template_type)
  WHERE mode = 'review' AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Public resolver for the review portal.
--
-- Same UPDATE ... RETURNING shape as get_im_share_by_token (migration 109) so opening the
-- portal still stamps last_used_at / use_count. Enforces mode, revocation and expiry
-- server-side; a token that fails any of them matches no row, is not counted, and returns
-- nothing — the portal renders its "invalid or revoked" screen.
--
-- Returns the share id too: the comment RPCs below all re-resolve the token themselves, so
-- the client never gets to say which share a comment belongs to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.im_review_resolve(p_token text)
RETURNS TABLE (
  share_id       uuid,
  project_id     uuid,
  template_type  text,
  label          text,
  submitted_at   timestamptz,
  submitted_by   text,
  manual_version integer,
  expires_at     timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.im_shares s
  SET last_used_at = NOW(),
      use_count    = s.use_count + 1
  WHERE s.token = p_token
    AND s.mode = 'review'
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
  RETURNING s.id, s.project_id, s.template_type, s.label,
            s.submitted_at, s.submitted_by, s.manual_version, s.expires_at;
$$;

REVOKE ALL ON FUNCTION public.im_review_resolve(text) FROM public;
GRANT EXECUTE ON FUNCTION public.im_review_resolve(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
