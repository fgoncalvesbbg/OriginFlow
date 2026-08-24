-- 128: user-submitted bug reports / feature requests.
--
-- A small "Report an issue" widget (bottom-right, collapsed) lets any signed-in user
-- file a bug or feature request from wherever they are in the app. Submissions are
-- write-only for the reporter — only an admin can read the list and mark items done,
-- matching the existing admin-gate pattern (migration 110): profiles.role, case-insensitive,
-- auth.uid() IS NULL (service role) always allowed.

CREATE TABLE IF NOT EXISTS public.feedback_reports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT        NOT NULL CHECK (type IN ('bug', 'feature')),
  message       TEXT        NOT NULL,
  page_path     TEXT,
  status        TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_by    UUID        REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID        REFERENCES public.profiles(id)
);

ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can file a report, only as themselves.
DROP POLICY IF EXISTS "Auth insert own" ON public.feedback_reports;
CREATE POLICY "Auth insert own" ON public.feedback_reports FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Only admins triage the queue.
DROP POLICY IF EXISTS "Admin read" ON public.feedback_reports;
CREATE POLICY "Admin read" ON public.feedback_reports FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));

DROP POLICY IF EXISTS "Admin update" ON public.feedback_reports;
CREATE POLICY "Admin update" ON public.feedback_reports FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));

CREATE INDEX IF NOT EXISTS feedback_reports_status_idx ON public.feedback_reports (status, created_at DESC);

NOTIFY pgrst, 'reload schema';
