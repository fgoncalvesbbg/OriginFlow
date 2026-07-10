-- Migration 88: ai_prompts — externalize hardcoded Anthropic/Claude prompts so
-- they can be viewed and edited from the Admin panel instead of living in
-- Netlify function source (netlify/functions/translate.ts).
--
-- Each row is one prompt used by a server-side AI call, looked up by a stable
-- `key` (e.g. 'im_translation'). The system prompt may contain {{placeholder}}
-- tokens (e.g. {{sourceLang}}, {{targetLang}}) that the calling function fills
-- in at request time — admins can reword the prompt but the placeholders must
-- stay intact for the call to keep working.
--
-- Netlify functions read this table with the service-role key (bypasses RLS,
-- like the existing supplier-file-url.ts / render-print-pdf.ts functions), so
-- no anon/public SELECT policy is needed here. Only admins manage rows from
-- the app itself.

CREATE TABLE IF NOT EXISTS ai_prompts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key            TEXT        NOT NULL UNIQUE,
  name           TEXT        NOT NULL,
  description    TEXT,
  system_prompt  TEXT        NOT NULL,
  model          TEXT        NOT NULL DEFAULT 'claude-sonnet-5',
  max_tokens     INTEGER     NOT NULL DEFAULT 8000,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by     UUID        REFERENCES profiles(id)
);

ALTER TABLE ai_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_access_ai_prompts" ON ai_prompts;
CREATE POLICY "admin_all_access_ai_prompts" ON ai_prompts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));

INSERT INTO ai_prompts (key, name, description, system_prompt, model, max_tokens)
VALUES (
  'im_translation',
  'IM Translation',
  'System prompt used by netlify/functions/translate.ts to translate Instruction Manual HTML fragments. Keep the {{sourceLang}}, {{targetLang}} and numbered-rule structure intact — the caller relies on the model following rule 2 exactly to preserve {{FRZ_n}} placeholder tokens.',
  E'You are a professional translator localizing product instruction manuals from {{sourceLang}} to {{targetLang}}.\nYou are given one HTML fragment. Rules:\n1. Translate ONLY human-readable text. Keep every HTML tag, attribute, class and entity (e.g. &nbsp;) exactly as-is.\n2. Preserve every {{FRZ_n}} token VERBATIM — never translate, add, remove, or renumber them. Keep each token where its surrounding sentence needs it.\n3. Keep numbers, units, product/brand names and regulation identifiers (e.g. "(EU) 2019/2016") unchanged.\n4. Output ONLY the translated HTML fragment — no explanations, no markdown code fences.',
  'claude-sonnet-5',
  8000
)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
