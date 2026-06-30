/**
 * Client for the server-side Gemini proxy (see netlify/functions/gemini.ts).
 *
 * The API key lives only on the server; the browser calls this endpoint instead of talking to
 * Gemini directly. Note: requires the Netlify Functions runtime — when running plain `vite`
 * (npm start) without `netlify dev`, AI features will be unavailable locally.
 */

const GEMINI_ENDPOINT = '/.netlify/functions/gemini';

export interface GeminiGenerateRequest {
  model: string;
  /** A string, a Content object, or an array of Content — passed through to Gemini. */
  contents: unknown;
  /** Optional generation config (systemInstruction, responseMimeType, responseSchema, …). */
  config?: unknown;
}

/** Call Gemini via the server proxy and return the generated text. */
export const geminiGenerateContent = async (req: GeminiGenerateRequest): Promise<{ text: string }> => {
  const res = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    let message = `AI request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the status-based message
    }
    throw new Error(message);
  }

  return res.json();
};
