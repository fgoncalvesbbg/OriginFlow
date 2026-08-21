import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./translation-verbatim.service', () => ({ getTranslationVerbatims: vi.fn(async () => []) }));
// The proxy requires a session; without this the adapter has no configured
// Supabase client under vitest and every call fails as "You must be signed in".
vi.mock('../../data', () => ({ auth: { getSession: vi.fn(async () => ({ accessToken: 'test-token' })) } }));

import { translateHtml } from './translation.service';
import { MAX_CHUNK_CHARS } from './translation-chunk';

// A refusal essay shaped exactly like a real observed failure: the QA model, given
// a short header with ZERO {{FRZ_n}} tokens, responded conversationally instead of
// proofreading. It contains the literal substring "{{FRZ_n}}" (not a real numbered
// token), so countTokens sees 0 — matching a 0-token input trivially — which is
// exactly the hole isImplausibleLength exists to close.
const REFUSAL = `It looks like there's a misunderstanding — no HTML fragment was included in your message.
Please paste the Croatian HTML fragment you'd like me to proofread, and I will:
1. Correct only grammar, spelling, punctuation, and typographical errors
2. Leave all HTML tags, attributes, and entities unchanged
3. Preserve all {{FRZ_n}} tokens exactly as they appear
4. Return the fragment unchanged if no errors are found
Go ahead and share the text whenever you're ready.`;

const mockFetchSequence = (responses: Array<{ ok: boolean; status?: number; body: unknown }>) => {
  let call = 0;
  global.fetch = vi.fn(async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body,
    } as Response;
  });
};

describe('translateHtml — QA safety net against non-conforming (e.g. refusal) responses', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a QA refusal essay for a short, zero-token header and keeps the first-pass translation', async () => {
    mockFetchSequence([
      { ok: true, body: { text: 'Sigurnosne upute' } }, // translate pass — a plausible short result
      { ok: true, body: { text: REFUSAL } },              // QA pass — non-conforming refusal
    ]);
    const out = await translateHtml('Safety Instructions', 'en', 'hr');
    expect(out).toBe('Sigurnosne upute');
    expect(out).not.toContain('misunderstanding');
  });

  it('accepts a plausible QA correction of similar length', async () => {
    mockFetchSequence([
      { ok: true, body: { text: 'saftey instructons' } }, // translate pass — has typos
      { ok: true, body: { text: 'safety instructions' } }, // QA pass — plausible-length fix
    ]);
    const out = await translateHtml('Safety Instructions', 'en', 'de');
    expect(out).toBe('safety instructions');
  });

  it('throws (fragment left untranslated) when the PRIMARY translate call itself returns an implausible refusal', async () => {
    mockFetchSequence([{ ok: true, body: { text: REFUSAL } }]);
    // Distinct source text so this doesn't hit the module-level cache from the first test.
    await expect(translateHtml('Care Instructions', 'en', 'hr')).rejects.toThrow(/implausible/);
  });
});

/**
 * A proxy stand-in that UPPERCASES what it is asked to translate and returns QA
 * input unchanged. Uppercasing is case-preserving in length and in `{{FRZ_n}}`
 * tokens, so both safety nets pass — and because `\n` and tags-only pieces are
 * unaffected by it, "the whole fragment came back uppercased" is an exact
 * assertion that every chunk was translated and reassembled in the right order.
 */
const mockEchoProxy = () => {
  const calls: Array<{ text: string; mode?: string }> = [];
  global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ text: body.mode === 'qa' ? body.text : String(body.text).toUpperCase() }),
    } as Response;
  }) as typeof fetch;
  return calls;
};

/** Paragraph blocks totalling well over one call's budget. */
const oversized = (marker: string) =>
  Array.from(
    { length: 20 },
    (_, i) => `<p>${marker} paragraph ${i}: ${'keep the hob clean and dry. '.repeat(8)}</p>`,
  ).join('\n');

describe('translateHtml — oversized fragments are chunked, not lost', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('sends a fragment inside the budget as ONE call (plus QA) — unchanged behaviour', async () => {
    const calls = mockEchoProxy();
    const html = '<p>Unique short fragment about cleaning.</p>';
    expect(html.length).toBeLessThan(MAX_CHUNK_CHARS);
    await translateHtml(html, 'en', 'nl');
    expect(calls.map((c) => c.mode ?? 'translate')).toEqual(['translate', 'qa']);
    expect(calls[0].text).toBe(html);
  });

  it('splits an oversized fragment into several calls and reassembles it in order', async () => {
    const calls = mockEchoProxy();
    const html = oversized('alpha');
    expect(html.length).toBeGreaterThan(MAX_CHUNK_CHARS);
    const out = await translateHtml(html, 'en', 'el');
    // Every chunk translated, every separator kept, nothing reordered or dropped.
    expect(out).toBe(html.toUpperCase());
    const translateCalls = calls.filter((c) => (c.mode ?? 'translate') === 'translate');
    expect(translateCalls.length).toBeGreaterThan(1);
    // No single call exceeds the budget the proxy timeout imposes.
    for (const c of translateCalls) expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });

  it('descends into a single oversized container and keeps its tags out of the calls', async () => {
    const calls = mockEchoProxy();
    const html = `<table class="im-fault-table"><tbody>${
      Array.from({ length: 30 }, (_, i) =>
        `<tr><td>Beta fault ${i}</td><td>${'check that the pan is ferromagnetic. '.repeat(6)}</td></tr>`).join('')
    }</tbody></table>`;
    const out = await translateHtml(html, 'en', 'fi');
    // The wrapper is emitted verbatim (still lower-case); the rows went to the model.
    expect(out.startsWith('<table class="im-fault-table"><tbody>')).toBe(true);
    expect(out.endsWith('</tbody></table>')).toBe(true);
    expect(out).toContain('<TR><TD>BETA FAULT 0</TD>');
    for (const c of calls) expect(c.text).not.toContain('<table');
  });

  it('names the offending chunk when one chunk of an oversized fragment fails', async () => {
    let translateCall = 0;
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.mode === 'qa') return { ok: true, status: 200, json: async () => ({ text: body.text }) } as Response;
      translateCall += 1;
      // Second chunk comes back as a conversational essay instead of a translation.
      const text = translateCall === 2 ? 'I cannot help with that. '.repeat(400) : String(body.text).toUpperCase();
      return { ok: true, status: 200, json: async () => ({ text }) } as Response;
    }) as typeof fetch;
    await expect(translateHtml(oversized('gamma'), 'en', 'hu')).rejects.toThrow(/\(chunk 2\/\d+\) returned an implausible result/);
  });

  it('fails the fragment (not silently truncates it) when a chunk times out', async () => {
    let translateCall = 0;
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.mode === 'qa') return { ok: true, status: 200, json: async () => ({ text: body.text }) } as Response;
      translateCall += 1;
      if (translateCall > 2) {
        // What a Netlify timeout actually looks like: 5xx with a non-JSON body.
        return { ok: false, status: 504, json: async () => { throw new Error('not json'); } } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({ text: String(body.text).toUpperCase() }) } as Response;
    }) as typeof fetch;
    await expect(translateHtml(oversized('delta'), 'en', 'sk')).rejects.toThrow(/504/);
  });
});
