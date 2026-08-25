-- 131: im_review_comments — supplier review notes on the ONLINE Instruction Manual.
--
-- WHY. Second half of the Markup.io replacement (see migration 130 for the first). A
-- supplier opens a 'review' share link, reads the published manual in the IM viewer, selects
-- the wording that is wrong and leaves a note. The PM sees those notes in a side panel
-- inside the IM editor, jumps to the chapter, and marks each one done or not.
--
-- ANCHORING. A note is anchored to a CHAPTER plus the text the reviewer actually selected —
-- not to a block. The published manual JSON gives blocks only ephemeral ids (`n-1`, `n-2`,
-- reassigned on every resolve, see im-resolver.ts), so a block-level anchor would have meant
-- changing the resolver, bumping the ResolvedManual schema, and republishing every existing
-- manual. Chapter + quote needs none of that: section ids are the real im_sections.id (or a
-- 'proj-…' id for a project-only chapter), and the PM side finds the exact wording by
-- matching the quote text. quote_before/quote_after keep a little context so the quote can
-- still be located after the surrounding prose is edited.
--
-- ANON WRITE PATH. This is the module's first table an unauthenticated visitor can write to,
-- so it gets NO anon policy at all — every supplier operation goes through a SECURITY
-- DEFINER RPC that re-resolves the token itself and derives share_id/project_id/
-- template_type/manual_version server-side. The client cannot name them. The RPCs also cap
-- field lengths and total comments per share; link expiry (migration 106) is the other half
-- of the containment.
--
-- House style: no Postgres enums (TEXT + CHECK) and no updated_at trigger.

CREATE TABLE IF NOT EXISTS public.im_review_comments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id       UUID        NOT NULL REFERENCES public.im_shares(id) ON DELETE CASCADE,
  project_id     UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  template_type  TEXT        NOT NULL DEFAULT 'im',
  language       TEXT        NOT NULL DEFAULT 'en',
  manual_version INTEGER,
  section_id     TEXT        NOT NULL,
  section_title  TEXT,
  quote          TEXT,
  quote_before   TEXT,
  quote_after    TEXT,
  body           TEXT        NOT NULL,
  author_name    TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'done', 'wont_fix')),
  resolved_at    TIMESTAMPTZ,
  resolved_by    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.im_review_comments IS
  'Supplier review notes left on the online IM via a mode=review share link. Replaces Markup.io threads.';
COMMENT ON COLUMN public.im_review_comments.project_id IS
  'Denormalised from the share on purpose: the PM panel queries by manual without joining through im_shares, and notes stay readable after the link is revoked.';
COMMENT ON COLUMN public.im_review_comments.section_id IS
  'im_sections.id, or a project-only "proj-…" chapter id. TEXT, not UUID, because of the latter.';
COMMENT ON COLUMN public.im_review_comments.section_title IS
  'Chapter title snapshotted at comment time, so the panel still reads sensibly if the chapter is later renamed or deleted.';
COMMENT ON COLUMN public.im_review_comments.quote IS
  'The exact text the reviewer selected. The PM side highlights this in the editor by text match.';
COMMENT ON COLUMN public.im_review_comments.manual_version IS
  'project_ims.version the note was made against — flags notes written before a republish.';

CREATE INDEX IF NOT EXISTS im_review_comments_manual_idx
  ON public.im_review_comments (project_id, template_type, status);
CREATE INDEX IF NOT EXISTS im_review_comments_share_idx
  ON public.im_review_comments (share_id, created_at);

ALTER TABLE public.im_review_comments ENABLE ROW LEVEL SECURITY;

-- Internal team reads the notes and triages them. Mirrors im_shares' own policy
-- (migration 84). No anon policy — suppliers reach this table only via the RPCs below.
DROP POLICY IF EXISTS "Auth all" ON public.im_review_comments;
CREATE POLICY "Auth all" ON public.im_review_comments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Supplier-facing RPCs. Each re-resolves the token with the same filters as
-- im_review_resolve (migration 130) but WITHOUT bumping use_count — that counter means
-- "portal opened", and commenting should not inflate it.
-- ---------------------------------------------------------------------------

-- Add a note. Every identifying column is derived from the resolved token, never from the
-- caller. The 500-per-share ceiling is the backstop on an anonymous insert path: without it
-- a leaked token is an unbounded write. No real review round comes close.
CREATE OR REPLACE FUNCTION public.im_review_add_comment(
  p_token         text,
  p_author_name   text,
  p_body          text,
  p_section_id    text,
  p_section_title text DEFAULT NULL,
  p_quote         text DEFAULT NULL,
  p_quote_before  text DEFAULT NULL,
  p_quote_after   text DEFAULT NULL
)
RETURNS public.im_review_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_share public.im_shares%ROWTYPE;
  v_count integer;
  v_row   public.im_review_comments%ROWTYPE;
BEGIN
  SELECT * INTO v_share
  FROM public.im_shares s
  WHERE s.token = p_token
    AND s.mode = 'review'
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > NOW());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This review link is invalid, expired or has been revoked.';
  END IF;

  IF coalesce(btrim(p_body), '') = '' THEN
    RAISE EXCEPTION 'A comment cannot be empty.';
  END IF;
  IF coalesce(btrim(p_author_name), '') = '' THEN
    RAISE EXCEPTION 'A reviewer name is required.';
  END IF;
  IF coalesce(btrim(p_section_id), '') = '' THEN
    RAISE EXCEPTION 'A comment must be anchored to a chapter.';
  END IF;
  IF length(p_body) > 4000 THEN
    RAISE EXCEPTION 'Comment is too long (max 4000 characters).';
  END IF;
  IF length(p_author_name) > 120 THEN
    RAISE EXCEPTION 'Reviewer name is too long (max 120 characters).';
  END IF;
  IF length(coalesce(p_quote, '')) > 2000 THEN
    RAISE EXCEPTION 'Selected text is too long (max 2000 characters).';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.im_review_comments c WHERE c.share_id = v_share.id;
  IF v_count >= 500 THEN
    RAISE EXCEPTION 'This review link has reached its comment limit.';
  END IF;

  INSERT INTO public.im_review_comments (
    share_id, project_id, template_type, manual_version,
    section_id, section_title, quote, quote_before, quote_after,
    body, author_name
  ) VALUES (
    v_share.id, v_share.project_id, v_share.template_type, v_share.manual_version,
    btrim(p_section_id),
    nullif(btrim(coalesce(p_section_title, '')), ''),
    nullif(btrim(coalesce(p_quote, '')), ''),
    left(coalesce(p_quote_before, ''), 200),
    left(coalesce(p_quote_after, ''), 200),
    btrim(p_body), btrim(p_author_name)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

-- Only this share's own notes. A supplier must never see another supplier's review.
CREATE OR REPLACE FUNCTION public.im_review_list_comments(p_token text)
RETURNS SETOF public.im_review_comments
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  SELECT c.*
  FROM public.im_review_comments c
  JOIN public.im_shares s ON s.id = c.share_id
  WHERE s.token = p_token
    AND s.mode = 'review'
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
  ORDER BY c.created_at;
$fn$;

-- Retract a note: own share only, and only while the PM has not acted on it.
CREATE OR REPLACE FUNCTION public.im_review_delete_comment(p_token text, p_comment_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_deleted integer;
BEGIN
  DELETE FROM public.im_review_comments c
  USING public.im_shares s
  WHERE c.id = p_comment_id
    AND s.id = c.share_id
    AND s.token = p_token
    AND s.mode = 'review'
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
    AND c.status = 'open';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$fn$;

-- "I am done reviewing." Idempotent: the first submission's timestamp stands, so a reviewer
-- who keeps commenting afterwards does not keep restarting the round.
CREATE OR REPLACE FUNCTION public.im_review_submit(p_token text, p_author_name text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_at timestamptz;
BEGIN
  UPDATE public.im_shares s
  SET submitted_at = coalesce(s.submitted_at, NOW()),
      submitted_by = coalesce(s.submitted_by, nullif(btrim(coalesce(p_author_name, '')), ''))
  WHERE s.token = p_token
    AND s.mode = 'review'
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
  RETURNING s.submitted_at INTO v_at;

  IF v_at IS NULL THEN
    RAISE EXCEPTION 'This review link is invalid, expired or has been revoked.';
  END IF;
  RETURN v_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.im_review_add_comment(text, text, text, text, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.im_review_list_comments(text) FROM public;
REVOKE ALL ON FUNCTION public.im_review_delete_comment(text, uuid) FROM public;
REVOKE ALL ON FUNCTION public.im_review_submit(text, text) FROM public;

GRANT EXECUTE ON FUNCTION public.im_review_add_comment(text, text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.im_review_list_comments(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.im_review_delete_comment(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.im_review_submit(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
