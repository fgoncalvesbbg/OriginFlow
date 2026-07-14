import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./translation-verbatim.service', () => ({ getTranslationVerbatims: vi.fn(async () => []) }));

import { translateHtml } from './translation.service';

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
