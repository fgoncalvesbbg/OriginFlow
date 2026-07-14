-- Migration 89: prompt_library — a shared library of predefined prompts users
-- maintain in the Admin panel's "AI Prompts" area. Unlike ai_prompts (system
-- prompts consumed by server-side Claude calls), these rows are never sent to
-- the API by the app: they exist to be copied (or opened via claude.ai/new)
-- and used directly in Claude chat outside the app.

CREATE TABLE IF NOT EXISTS prompt_library (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT        NOT NULL,
  description  TEXT,
  prompt_text  TEXT        NOT NULL,
  created_by   UUID        REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prompt_library ENABLE ROW LEVEL SECURITY;

-- Shared team library: every signed-in user can read AND manage entries (it is
-- a convenience collection, not app-critical configuration — the app never
-- executes these prompts). Access to the managing UI is a separate concern.
DROP POLICY IF EXISTS "authenticated_all_prompt_library" ON prompt_library;
CREATE POLICY "authenticated_all_prompt_library" ON prompt_library FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
