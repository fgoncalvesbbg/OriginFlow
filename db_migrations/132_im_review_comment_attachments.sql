-- 132: image attachments on supplier review notes.
--
-- !! APPLY THIS BEFORE DEPLOYING THE MATCHING FRONTEND. !!
-- The client now calls im_review_add_comment with a p_attachments argument. Against the
-- 8-argument version from migration 131, PostgREST cannot resolve the call and every attempt
-- to leave a review note fails with "could not find the function". Migration first, then
-- deploy. (Migration 71 carries the same kind of banner for the same kind of reason.)
--
-- WHY. "The text on page 4 is wrong" is often best said with a screenshot or a photo of the
-- printed page. Reviewers were already pasting descriptions of what they could see; letting
-- them attach the image removes a whole round trip.
--
-- HOW THE ANONYMOUS UPLOAD IS MADE SAFE. This is the awkward part: a reviewer holds nothing
-- but a bearer token, and Storage RLS cannot see that token — a policy can only tell that the
-- caller is `anon`. An anon INSERT policy on the bucket would therefore be an open file drop
-- for the whole internet, so there isn't one.
--
-- Instead the browser never uploads with its own authority at all:
--   1. netlify/functions/review-upload-url.ts validates the review token (same filters as
--      im_review_resolve), then uses the SERVICE ROLE to mint a one-shot signed upload URL
--      for a path it chooses itself: `<share_id>/<uuid>.<ext>`.
--   2. The browser PUTs the bytes to that URL. The signed URL is the authorization, so no
--      storage policy is involved and the bytes never pass through the function.
--   3. im_review_add_comment below re-checks that every attachment path sits under the
--      share's OWN id. That is what stops a caller inventing a path or pointing a note at
--      another reviewer's upload — the function chose the prefix, and the RPC enforces it.
--
-- The bucket is PUBLIC, deliberately and consistently: the manual these notes annotate is
-- already anonymously readable by URL (im-published, migration 54), and both the reviewer's
-- own list and the PM's panel have to render the thumbnails without a signing round trip per
-- image. Paths carry a v4 uuid, so they are unguessable. Do not put anything more sensitive
-- than a screenshot of a manual in here.

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'im-review-uploads',
  'im-review-uploads',
  true,
  5242880,                                        -- 5 MB; the client downscales well below this
  ARRAY['image/jpeg', 'image/png', 'image/webp']  -- images only: this is an anonymous write path
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
ALTER TABLE public.im_review_comments
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.im_review_comments.attachments IS
  'Array of {path, width, height} objects in the im-review-uploads bucket. Paths are always <share_id>/<uuid>.<ext>, enforced by im_review_add_comment.';

-- ---------------------------------------------------------------------------
-- im_review_add_comment, now taking attachments.
--
-- DROPped rather than CREATE OR REPLACEd: adding a parameter (even a defaulted one) creates
-- an OVERLOAD, and PostgREST then cannot tell which of the two to call — migration 114 hit
-- exactly this. Dropping the 8-arg signature first leaves precisely one function.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.im_review_add_comment(text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.im_review_add_comment(
  p_token         text,
  p_author_name   text,
  p_body          text,
  p_section_id    text,
  p_section_title text DEFAULT NULL,
  p_quote         text DEFAULT NULL,
  p_quote_before  text DEFAULT NULL,
  p_quote_after   text DEFAULT NULL,
  p_attachments   jsonb DEFAULT '[]'::jsonb
)
RETURNS public.im_review_comments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_share  public.im_shares%ROWTYPE;
  v_count  integer;
  v_row    public.im_review_comments%ROWTYPE;
  v_item   jsonb;
  v_path   text;
  v_prefix text;
  v_clean  jsonb := '[]'::jsonb;
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

  -- Attachments. Rebuilt element by element rather than stored as handed in: only the three
  -- keys we render survive, so nothing a caller invents reaches the panel.
  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) = 'array' THEN
    IF jsonb_array_length(p_attachments) > 5 THEN
      RAISE EXCEPTION 'A comment can carry at most 5 images.';
    END IF;
    v_prefix := v_share.id::text || '/';
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_attachments) LOOP
      v_path := v_item ->> 'path';
      -- The upload function chose this prefix; enforcing it here is what stops a caller
      -- attaching an arbitrary object, or another reviewer's image, to their own note.
      IF v_path IS NULL OR left(v_path, length(v_prefix)) <> v_prefix THEN
        RAISE EXCEPTION 'An image could not be attached to this comment.';
      END IF;
      IF length(v_path) > 300 OR position('..' in v_path) > 0 THEN
        RAISE EXCEPTION 'An image could not be attached to this comment.';
      END IF;
      -- Dimensions are a rendering hint (they let the panel reserve space), so a malformed
      -- one is worth ignoring rather than failing the whole note over. A bare ::int cast
      -- would throw on `"width": "abc"`, turning a cosmetic field into a hard rejection.
      v_clean := v_clean || jsonb_build_object(
        'path',   v_path,
        'width',  CASE WHEN jsonb_typeof(v_item -> 'width')  = 'number'
                       THEN (v_item ->> 'width')::int  ELSE 0 END,
        'height', CASE WHEN jsonb_typeof(v_item -> 'height') = 'number'
                       THEN (v_item ->> 'height')::int ELSE 0 END
      );
    END LOOP;
  END IF;

  INSERT INTO public.im_review_comments (
    share_id, project_id, template_type, manual_version,
    section_id, section_title, quote, quote_before, quote_after,
    body, author_name, attachments
  ) VALUES (
    v_share.id, v_share.project_id, v_share.template_type, v_share.manual_version,
    btrim(p_section_id),
    nullif(btrim(coalesce(p_section_title, '')), ''),
    nullif(btrim(coalesce(p_quote, '')), ''),
    left(coalesce(p_quote_before, ''), 200),
    left(coalesce(p_quote_after, ''), 200),
    btrim(p_body), btrim(p_author_name), v_clean
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.im_review_add_comment(text, text, text, text, text, text, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.im_review_add_comment(text, text, text, text, text, text, text, text, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
