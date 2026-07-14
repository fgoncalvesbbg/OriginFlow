/**
 * Client for the server-side translation proxy (see netlify/functions/translate.ts).
 *
 * The Anthropic API key lives only on the server; the browser calls this endpoint
 * instead of talking to the model directly. Note: requires the Netlify Functions
 * runtime — when running plain `vite` (npm start) without `netlify dev`, the
 * endpoint 404s and translation is unavailable locally.
 *
 * Chip safety lives HERE, not in the proxy: we freeze every placeholder/condition
 * chip (and <img>) into opaque {{FRZ_n}} tokens before sending, verify the token
 * count is unchanged in the response, then restore them — so a dropped or mangled
 * chip is impossible (the fragment throws instead of silently corrupting).
 *
 * Verbatim phrases (regulation text with official per-language wording — managed
 * in the Admin panel's `translation_verbatims` table) are frozen the same way,
 * and thawed back as the STORED translation for the target language: the model
 * never translates them, the approved wording is substituted directly. Languages
 * with no stored wording keep the source phrase unchanged.
 *
 * Every translation is followed by a best-effort QA pass: a second model call
 * (mode='qa') that sees ONLY the translated fragment — no source, no other
 * context — and fixes grammar/spelling/typos, never content. If the QA call
 * fails or drops a token, the first-pass translation is kept.
 */

import { freeze, freezeVerbatims, thaw, hasProse, countTokens, VerbatimEntry } from '../im/im-chip-freeze';
import { getTranslationVerbatims } from './translation-verbatim.service';
import type { TranslationVerbatim } from '../../types';

const ENDPOINT = '/.netlify/functions/translate';

// Repeated boilerplate (e.g. the same safety paragraph across sections) is
// translated once per target language and reused.
const cache = new Map<string, string>();

// Verbatim phrases are fetched once per session and shared by every fragment.
// A fetch failure degrades gracefully to "no verbatims" (translation still works).
let verbatimsPromise: Promise<TranslationVerbatim[]> | null = null;
const getVerbatims = (): Promise<TranslationVerbatim[]> => {
  if (!verbatimsPromise) {
    verbatimsPromise = getTranslationVerbatims().catch((e) => {
      console.warn('[translation] Failed to load verbatims; continuing without.', e);
      return [];
    });
  }
  return verbatimsPromise;
};

/**
 * Freeze entries for one target language: match the English phrase, thaw back
 * the officially stored wording for `targetLang` (or keep the phrase unchanged
 * when no wording is stored — right for language-neutral identifiers).
 */
const verbatimEntriesFor = async (targetLang: string): Promise<VerbatimEntry[]> =>
  (await getVerbatims()).map((v) => ({ phrase: v.phrase, replacement: v.translations?.[targetLang] }));

// Set after the endpoint 404s once: the Netlify Functions runtime isn't there
// (plain `vite` / `vite preview`), so every further call would 404 too. Failing
// fast spares a large translate run from hammering the server hundreds of times.
let endpointMissing = false;
const ENDPOINT_MISSING_MESSAGE =
  'Translation service not found (404). Translation runs as a Netlify function — run the app ' +
  'with `netlify dev` locally (plain `vite`/`npm run start`/`npm run serve` does not serve ' +
  'functions), or use the deployed site.';

// Gateway/overload statuses worth retrying: a mass translation run routinely hits
// transient 502/504s from the function host or the model API under load.
const TRANSIENT_STATUSES = new Set([502, 503, 504, 529]);
const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * True when `output` is implausibly long for a translation/proofread of `input`.
 *
 * The {{FRZ_n}} token-count check is NOT a sufficient safety net on its own: a
 * short header or title routinely carries ZERO tokens (no placeholders, no
 * verbatims), so "count before === count after" is trivially satisfied by ANY
 * response — including a full conversational refusal (e.g. the model asking
 * the user to "please paste the HTML fragment") — since 0 === 0 regardless of
 * content. A real translation/correction of a short fragment stays roughly the
 * same size (even verbose target languages don't 5x a two-word title), so a
 * wildly longer response is a reliable signal that the model didn't do the
 * requested task and must be rejected rather than adopted verbatim.
 */
const isImplausibleLength = (input: string, output: string): boolean =>
  output.length > Math.max(80, input.length * 3);

/** POST one frozen fragment to the proxy (retrying transient 5xx); returns the model output or throws. */
const callProxy = async (body: Record<string, unknown>): Promise<string> => {
  for (let attempt = 1; ; attempt++) {
    if (endpointMissing) throw new Error(ENDPOINT_MISSING_MESSAGE);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const { text } = (await res.json()) as { text: string };
      return text;
    }
    // 404 = the function endpoint itself isn't served (it only returns 400/405/500/502/200).
    if (res.status === 404) {
      endpointMissing = true;
      throw new Error(ENDPOINT_MISSING_MESSAGE);
    }
    if (TRANSIENT_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      const wait = 1000 * 3 ** (attempt - 1); // 1s, 3s
      console.warn(`[translation] Transient ${res.status} from translate proxy — retrying in ${wait / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS}).`);
      await sleep(wait);
      continue;
    }
    let message = `Translation failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      // non-JSON error body — keep the status-based message
    }
    throw new Error(message);
  }
};

/**
 * Translate one HTML fragment from `sourceLang` to `targetLang`, preserving all
 * HTML formatting, placeholder/condition chips, and verbatim regulation phrases
 * exactly, then proofread the result (grammar/typos only) with a second pass.
 *
 * Chip-only / empty fragments are returned unchanged without an API call.
 * @throws if the request fails or the model dropped/duplicated a chip token.
 */
export const translateHtml = async (
  html: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> => {
  if (!html || !html.trim()) return html;

  const cacheKey = `${targetLang} ${html}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Freeze chips/<img>, then verbatim phrases (thawed back as the stored
  // official wording for the target language), so neither can be altered.
  const { text, frozen } = freezeVerbatims(freeze(html), await verbatimEntriesFor(targetLang));
  if (!hasProse(text)) {
    // Nothing left for the model — but thaw anyway: a fragment that is entirely
    // a verbatim sentence must still come back as the stored target wording.
    const result = thaw(text, frozen);
    cache.set(cacheKey, result);
    return result;
  }

  const translated = await callProxy({ text, sourceLang, targetLang });

  // Safety net: the token count must be identical, or a chip/verbatim was lost.
  const before = countTokens(text);
  if (countTokens(translated) !== before) {
    throw new Error(`Placeholder mismatch after translating to ${targetLang} (${before} → ${countTokens(translated)}); fragment left untranslated.`);
  }
  // Second safety net (see isImplausibleLength) — catches a non-conforming response
  // (e.g. a conversational refusal) that the token count alone can't, on fragments
  // with zero tokens to begin with (short headers/titles are the common case).
  if (isImplausibleLength(text, translated)) {
    throw new Error(`Translation to ${targetLang} returned an implausible result (${translated.length} chars for a ${text.length}-char fragment); fragment left untranslated.`);
  }

  // Best-effort QA pass: proofread the (still frozen) translation with no other
  // context. Any failure — network, proxy error, a dropped token, or an implausibly
  // long response — keeps the first-pass translation; QA never fails the fragment.
  let final = translated;
  try {
    const proofread = await callProxy({ text: translated, targetLang, mode: 'qa' });
    if (countTokens(proofread) === before && !isImplausibleLength(translated, proofread)) {
      final = proofread;
    } else {
      console.warn(`[translation] QA pass returned an implausible/mismatched result for ${targetLang}; keeping first-pass translation.`);
    }
  } catch (e) {
    console.warn(`[translation] QA pass failed for ${targetLang}; keeping first-pass translation.`, e);
  }

  const result = thaw(final, frozen);
  cache.set(cacheKey, result);
  return result;
};
