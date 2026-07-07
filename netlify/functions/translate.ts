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
 * Request body:  { text: string, sourceLang: string, targetLang: string, model?: string }
 * Response body: { text: string }   |   { error: string }
 */

import Anthropic from '@anthropic-ai/sdk';

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
}

const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 8000;

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

  const system =
    `You are a professional translator localizing product instruction manuals from ` +
    `${langName(sourceLang)} to ${langName(targetLang)}.\n` +
    `You are given one HTML fragment. Rules:\n` +
    `1. Translate ONLY human-readable text. Keep every HTML tag, attribute, class and ` +
    `entity (e.g. &nbsp;) exactly as-is.\n` +
    `2. Preserve every {{FRZ_n}} token VERBATIM — never translate, add, remove, or renumber ` +
    `them. Keep each token where its surrounding sentence needs it.\n` +
    `3. Keep numbers, units, product/brand names and regulation identifiers ` +
    `(e.g. "(EU) 2019/2016") unchanged.\n` +
    `4. Output ONLY the translated HTML fragment — no explanations, no markdown code fences.`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: model || DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
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
