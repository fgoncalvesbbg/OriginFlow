/**
 * Server-side Gemini proxy (Netlify Function).
 *
 * Keeps the Gemini API key OFF the client: the browser POSTs a generateContent request here and
 * this function injects the key (from the GEMINI_API_KEY env var — set it in Netlify, NOT prefixed
 * with VITE_) and forwards it to Gemini. Chat is modelled as generateContent with history in
 * `contents` + an optional `systemInstruction` in `config`.
 *
 * Request body:  { model: string, contents: unknown, config?: unknown }
 * Response body: { text: string }   |   { error: string }
 */

import { GoogleGenAI } from '@google/genai';

interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
}

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'GEMINI_API_KEY is not configured on the server.' });
  }

  let model: string;
  let contents: unknown;
  let config: unknown;
  try {
    ({ model, contents, config } = JSON.parse(event.body || '{}'));
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (!model || contents == null) {
    return json(400, { error: 'Request must include "model" and "contents".' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({ model, contents, config } as Parameters<typeof ai.models.generateContent>[0]);
    return json(200, { text: response.text ?? '' });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'AI request failed.';
    return json(502, { error: message });
  }
};
