-- Migration 90: translation verbatims + translation QA prompt.
--
-- 1. translation_verbatims — exact phrases (regulation text, standard
--    identifiers like "(EU) 2019/2016" or "EN 60335-2-6") that AI translation
--    must never alter. The client freezes exact matches into opaque {{FRZ_n}}
--    tokens before the text reaches the model (src/services/im/im-chip-freeze.ts),
--    so the model physically cannot change them. Users grow this list from the
--    Admin panel's "AI Prompts" area over time.
--
-- 2. ai_prompts row 'im_translation_qa' — the second-pass proofreader agent:
--    it sees ONLY the translated fragment (no source, no other context) and
--    fixes grammar/spelling/typos, never content.
--
-- 3. Improved 'im_translation' system prompt — adds fluency/terminology rules
--    while keeping the structure the translate proxy relies on.

CREATE TABLE IF NOT EXISTS translation_verbatims (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase      TEXT        NOT NULL UNIQUE,
  note        TEXT,
  created_by  UUID        REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE translation_verbatims ENABLE ROW LEVEL SECURITY;

-- Shared team list: every signed-in user can read (the browser needs the list
-- to freeze phrases before translating) and manage entries.
DROP POLICY IF EXISTS "authenticated_all_translation_verbatims" ON translation_verbatims;
CREATE POLICY "authenticated_all_translation_verbatims" ON translation_verbatims FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Second-pass proofreader prompt (used by netlify/functions/translate.ts with mode='qa').
INSERT INTO ai_prompts (key, name, description, system_prompt, model, max_tokens)
VALUES (
  'im_translation_qa',
  'IM Translation QA',
  'Second-pass proofreader used by netlify/functions/translate.ts (mode="qa") after every translation. It receives ONLY the translated fragment — no source text, no other context — and must fix grammar/spelling/typos only, never content. Keep the {{targetLang}} placeholder and the {{FRZ_n}} preservation rule intact.',
  E'You are a meticulous proofreader of {{targetLang}}.\nYou receive one HTML fragment written in {{targetLang}}. Rules:\n1. Correct ONLY grammar, spelling, punctuation and typographical errors.\n2. Do NOT change meaning, terminology, tone, sentence order, or content in any way. Do not rephrase text that is already correct.\n3. Keep every HTML tag, attribute, class and entity (e.g. &nbsp;) exactly as-is.\n4. Preserve every {{FRZ_n}} token VERBATIM — never translate, add, remove, or renumber them.\n5. If the fragment is already correct, return it unchanged.\n6. Output ONLY the corrected HTML fragment — no explanations, no markdown code fences.',
  'claude-sonnet-5',
  8000
)
ON CONFLICT (key) DO NOTHING;

-- Improved first-pass translation prompt: same guardrails, plus fluency and
-- terminology-consistency rules so the output reads like a native manual
-- rather than a word-for-word rendering.
UPDATE ai_prompts SET
  system_prompt = E'You are a professional translator localizing product instruction manuals from {{sourceLang}} to {{targetLang}}.\nYou are given one HTML fragment. Rules:\n1. Translate ONLY human-readable text. Keep every HTML tag, attribute, class and entity (e.g. &nbsp;) exactly as-is.\n2. Preserve every {{FRZ_n}} token VERBATIM — never translate, add, remove, or renumber them. Keep each token where its surrounding sentence needs it.\n3. Keep numbers, units, product/brand names and regulation identifiers (e.g. "(EU) 2019/2016", "EN 60335-2-6") unchanged.\n4. Write natural, fluent {{targetLang}} as used in professionally published instruction manuals — not a word-for-word rendering. Use the imperative mood for instruction steps where that is the convention in {{targetLang}}.\n5. Use consistent terminology: translate a recurring term the same way every time it appears in the fragment.\n6. Never add, remove, or summarize content — every sentence in the source must be represented in the translation.\n7. Output ONLY the translated HTML fragment — no explanations, no markdown code fences.',
  updated_at = NOW()
WHERE key = 'im_translation';

NOTIFY pgrst, 'reload schema';
