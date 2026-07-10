/**
 * Server-side translation proxy (Netlify Function).
 *
 * Keeps the Anthropic API key OFF the client: the browser POSTs an HTML fragment
 * here and this function injects the key (from ANTHROPIC_API_KEY — set it in
 * Netlify, NOT prefixed with VITE_) and forwards the request to Claude.
 *
 * This proxy is deliberately a DUMB translator with no knowledge of IM chips.
 * The caller (src/services/ai/translation.service.ts) freezes every placeholder/
 * condition chip into opaque {{FRZ_n}} tokens before sending, so all this needs
 * to do is preserve HTML tags + those tokens and translate the prose between them.
 *
 * The system prompt is NOT hardcoded here — it's loaded from the `ai_prompts`
 * table (key = 'im_translation') so admins can view/edit it from the Admin panel
 * without a code deploy. {{sourceLang}}/{{targetLang}} placeholders in the stored
 * prompt are filled in below; a hardcoded fallback covers the (unexpected) case
 * where the row is missing so translation still works.
 *
 * Request body:  { text: string, sourceLang: string, targetLang: string, model?: string }
 * Response body: { text: string }   |   { error: string }
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   — service role, so the prompt lookup bypasses RLS
 *   ANTHROPIC_API_KEY
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
}

const PROMPT_KEY = 'im_translation';
const DEFAULT_MODEL = 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 8000;
const FALLBACK_SYSTEM_TEMPLATE =
  `You are a professional translator localizing product instruction manuals from ` +
  `{{sourceLang}} to {{targetLang}}.\n` +
  `You are given one HTML fragment. Rules:\n` +
  `1. Translate ONLY human-readable text. Keep every HTML tag, attribute, class and ` +
  `entity (e.g. &nbsp;) exactly as-is.\n` +
  `2. Preserve every {{FRZ_n}} token VERBATIM — never translate, add, remove, or renumber ` +
  `them. Keep each token where its surrounding sentence needs it.\n` +
  `3. Keep numbers, units, product/brand names and regulation identifiers ` +
  `(e.g. "(EU) 2019/2016") unchanged.\n` +
  `4. Output ONLY the translated HTML fragment — no explanations, no markdown code fences.`;

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const LANG_NAMES: Record<string, string> = {
  en: 'English', bg: 'Bulgarian', hr: 'Croatian', cs: 'Czech', da: 'Danish',
  nl: 'Dutch', et: 'Estonian', fi: 'Finnish', fr: 'French', de: 'German',
  el: 'Greek', hu: 'Hungarian', it: 'Italian', lv: 'Latvian', lt: 'Lithuanian',
  pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', sk: 'Slovak', sl: 'Slovenian',
  es: 'Spanish', sv: 'Swedish',
};
const langName = (code: string) => LANG_NAMES[code] || code;

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'ANTHROPIC_API_KEY is not configured on the server.' });
  }

  let text: string;
  let sourceLang: string;
  let targetLang: string;
  let model: string | undefined;
  try {
    ({ text, sourceLang, targetLang, model } = JSON.parse(event.body || '{}'));
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (typeof text !== 'string' || !text.trim() || !sourceLang || !targetLang) {
    return json(400, { error: 'Request must include non-empty "text", "sourceLang" and "targetLang".' });
  }

  let systemTemplate = FALLBACK_SYSTEM_TEMPLATE;
  let promptModel: string | undefined;
  let promptMaxTokens: number | undefined;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceRoleKey) {
    try {
      const admin = createClient(supabaseUrl, serviceRoleKey);
      const { data } = await admin
        .from('ai_prompts')
        .select('system_prompt, model, max_tokens')
        .eq('key', PROMPT_KEY)
        .maybeSingle();
      if (data?.system_prompt) {
        systemTemplate = data.system_prompt;
        promptModel = data.model || undefined;
        promptMaxTokens = data.max_tokens || undefined;
      }
    } catch (e) {
      console.warn('[translate] Failed to load ai_prompts row, using fallback prompt.', e);
    }
  }

  const system = systemTemplate
    .replaceAll('{{sourceLang}}', langName(sourceLang))
    .replaceAll('{{targetLang}}', langName(targetLang));

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: model || promptModel || DEFAULT_MODEL,
      max_tokens: promptMaxTokens || DEFAULT_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: text }],
    });
    let out = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    // Strip an accidental ```html fence if the model added one.
    out = out.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
    return json(200, { text: out });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Translation request failed.';
    return json(502, { error: message });
  }
};
