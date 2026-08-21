import { describe, it, expect, vi, beforeEach } from 'vitest';

// The port is mocked, not a driver client, so these tests describe the service's
// contract rather than PostgREST's builder shape — same reasoning as
// im-tm-write.service.test.ts. The real resilience helpers are re-imported so the
// deadline behaviour stays genuine.
const { calls, sessionToken } = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; table: string; payload?: any; where?: any }>,
  sessionToken: { value: 'test-token' as string | undefined },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  return {
    db: {
      select: vi.fn((table: string, options: any) => {
        calls.push({ op: 'select', table, where: options?.where });
        return Promise.resolve([]);
      }),
      selectMaybeOne: vi.fn((table: string, options: any) => {
        calls.push({ op: 'selectMaybeOne', table, where: options?.where });
        return Promise.resolve(null);
      }),
      count: vi.fn((table: string, options: any) => {
        calls.push({ op: 'count', table, where: options?.where });
        return Promise.resolve(0);
      }),
      insert: vi.fn((table: string, row: any) => {
        calls.push({ op: 'insert', table, payload: row });
        return Promise.resolve({ id: 'run-1', created_at: '2026-08-20T00:00:00Z', ...row });
      }),
      insertMany: vi.fn((table: string, rows: any[]) => {
        calls.push({ op: 'insertMany', table, payload: rows });
        return Promise.resolve();
      }),
      updateWhere: vi.fn((table: string, values: any, options: any) => {
        calls.push({ op: 'updateWhere', table, payload: values, where: options?.where });
        return Promise.resolve();
      }),
      delete: vi.fn((table: string, options: any) => {
        calls.push({ op: 'delete', table, where: options?.where });
        return Promise.resolve();
      }),
    },
    auth: {
      getSession: vi.fn(() => Promise.resolve(
        sessionToken.value ? { accessToken: sessionToken.value } : null)),
    },
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
    orUndefined: resilience.orUndefined,
  };
});

vi.mock('../../config/environment.config', () => ({
  isLive: true,
  // The service builds the edge-function URL from these.
  APP_CONFIG: { supabaseUrl: 'https://test.supabase.co', supabaseAnonKey: 'anon-key' },
}));

// The IM barrel pulls in the whole module graph; only these two reads are used.
vi.mock('../im', () => ({
  getIMSections: vi.fn(() => Promise.resolve([])),
  getIMBlocks: vi.fn(() => Promise.resolve([])),
}));

const { verbatimCalls, existingVerbatims } = vi.hoisted(() => ({
  verbatimCalls: [] as Array<{ phrase: string; note?: string; createdBy?: string }>,
  existingVerbatims: { rows: [] as Array<{ phrase: string }> },
}));

vi.mock('../ai/translation-verbatim.service', () => ({
  getTranslationVerbatims: vi.fn(() => Promise.resolve(existingVerbatims.rows)),
  createTranslationVerbatim: vi.fn((entry: any, createdBy?: string) => {
    verbatimCalls.push({ phrase: entry.phrase, note: entry.note, createdBy });
    return Promise.resolve();
  }),
}));

import {
  __resetRegCheckEndpointLatch,
  registerVerbatimFinding,
  runRegulatoryCheck,
  verifyVerbatimPhrase,
} from './regulatory-check.service';
import type { IMSection, IMTemplate, RegulatoryVerbatim, TemplateRegulation } from '../../types';

const template: IMTemplate = {
  id: 'tmpl-1',
  categoryId: 'cat-1',
  templateType: 'im',
  name: 'Fridge Manual Template',
  languages: ['en'],
  isFinalized: false,
};

const section = (over: Partial<IMSection> & { id: string }): IMSection => ({
  templateId: 'tmpl-1',
  parentId: null,
  title: 'Section',
  order: 0,
  isPlaceholder: false,
  content: {},
  blockRefs: [],
  ...over,
});

const assignment = (id: string, referenceCode: string): TemplateRegulation => ({
  id: `assign-${id}`,
  templateId: 'tmpl-1',
  regulationId: id,
  createdAt: '2026-08-01',
  source: 'explicit',
  regulation: {
    id,
    title: `Regulation ${referenceCode}`,
    referenceCode,
    summaryBytes: 1024,
    applicableCategories: [],
    status: 'active',
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
  },
});

/** Two sections, each big enough that the pair splits into two chunks. */
const twoChunkSections = (): IMSection[] => {
  const filler = 'y'.repeat(4000);
  const blocks = (prefix: string) => Array.from({ length: 4 }, (_, i) => ({
    kind: 'inline' as const, id: `${prefix}r${i}`, content: { en: filler },
  }));
  return [
    section({ id: 'sec-a', title: 'A', order: 1, blockRefs: blocks('a') }),
    section({ id: 'sec-b', title: 'B', order: 2, blockRefs: blocks('b') }),
  ];
};

const okResponse = (body: Partial<Record<string, unknown>> = {}) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({
    findings: [],
    verbatims: [],
    notes: '',
    model: 'claude-opus-5',
    truncated: false,
    ...body,
  }),
});

const errorResponse = (status: number, error = 'boom') => {
  const body = JSON.stringify({ error });
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve({ error }),
  };
};

/**
 * A hosting-gateway failure: our function never ran, so there is no JSON body. This is
 * what a killed invocation actually looks like to the browser, and it is what an entire
 * 8-regulation run returned before the check moved off Netlify.
 */
const gatewayResponse = (status: number, body = '<html>Bad Gateway</html>') => ({
  ok: false,
  status,
  text: () => Promise.resolve(body),
  json: () => Promise.reject(new SyntaxError('Unexpected token <')),
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  calls.length = 0;
  verbatimCalls.length = 0;
  existingVerbatims.rows = [];
  sessionToken.value = 'test-token';
  __resetRegCheckEndpointLatch();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('runRegulatoryCheck — work units', () => {
  it('posts one call per (regulation × chunk) and never sends the summary', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse()));

    await runRegulatoryCheck({
      template,
      sections: twoChunkSections(),
      assignments: [assignment('reg-1', '(EU) 2019/2016'), assignment('reg-2', 'EN 60335-1')],
    });

    // 2 regulations × 2 chunks.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const bodies = fetchMock.mock.calls.map(([, init]: any) => JSON.parse(init.body));
    expect(bodies.map((b) => `${b.regulationId}:${b.chunkIndex}`).sort()).toEqual([
      'reg-1:0', 'reg-1:1', 'reg-2:0', 'reg-2:1',
    ]);
    // The regulation (and its 400 kB summary) is read server-side — the browser must
    // never upload it, on any chunk.
    for (const body of bodies) {
      expect(body.chunkCount).toBe(2);
      expect(JSON.stringify(body)).not.toMatch(/summary/i);
    }
  });

  it('calls the deployed edge function, with both the session token and the anon key', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse()));
    await runRegulatoryCheck({ template, sections: [], assignments: [assignment('reg-1', 'X')] });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://test.supabase.co/functions/v1/regulatory-check');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    // Without the anon key the edge gateway rejects the request before the handler runs.
    expect(init.headers.apikey).toBe('anon-key');
  });

  it('sends the bearer token on every call', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse()));
    await runRegulatoryCheck({ template, sections: [], assignments: [assignment('reg-1', 'X')] });
    const [, init] = fetchMock.mock.calls[0] as any;
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('refuses to run with no assignments, and never calls the endpoint', async () => {
    await expect(runRegulatoryCheck({ template, sections: [], assignments: [] }))
      .rejects.toThrow(/Assign at least one regulation/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to run without a session', async () => {
    sessionToken.value = undefined;
    await expect(runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'X')],
    })).rejects.toThrow(/signed in/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports progress once per unit', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse()));
    const seen: Array<{ done: number; total: number }> = [];
    await runRegulatoryCheck({
      template,
      sections: twoChunkSections(),
      assignments: [assignment('reg-1', 'A'), assignment('reg-2', 'B')],
      onProgress: (p) => seen.push({ done: p.done, total: p.total }),
    });
    expect(seen).toHaveLength(4);
    expect(seen.every((p) => p.total === 4)).toBe(true);
    expect(seen[seen.length - 1].done).toBe(4);
  });
});

describe('runRegulatoryCheck — partial failure', () => {
  it('keeps the other units when one fails, and stores exactly one report', async () => {
    fetchMock.mockImplementation((_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.regulationId === 'reg-2' && body.chunkIndex === 0) {
        return Promise.resolve(errorResponse(400, 'that one broke'));
      }
      return Promise.resolve(okResponse({
        findings: [{
          severity: 'major', kind: 'missing', sectionId: 'sec-a', refId: '',
          clause: 'Annex IV', requirement: 'A required warning', issue: 'Absent',
          suggestedChange: 'Add it', quote: '',
        }],
      }));
    });

    const run = await runRegulatoryCheck({
      template,
      sections: twoChunkSections(),
      assignments: [assignment('reg-1', 'A'), assignment('reg-2', 'B')],
    });

    expect(run.status).toBe('partial');
    expect(run.report.failures).toHaveLength(1);
    expect(run.report.failures[0]).toMatchObject({ regulationId: 'reg-2', chunkIndex: 0 });
    // The three units that worked still contributed their findings.
    expect(run.report.findings).toHaveLength(3);

    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('im_regulatory_checks');
    expect(inserts[0].payload.status).toBe('partial');
    expect(inserts[0].payload.finding_count).toBe(3);
  });

  it('stores a failed run rather than losing the record', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(errorResponse(500, 'down')));
    const run = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    expect(run.status).toBe('failed');
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });

  it('retries a transient status, then succeeds', async () => {
    let attempts = 0;
    fetchMock.mockImplementation(() => {
      attempts++;
      return Promise.resolve(attempts === 1 ? errorResponse(503) : okResponse());
    });
    const run = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    expect(attempts).toBe(2);
    expect(run.status).toBe('complete');
  });

  it('does not retry a bodyless gateway 502 — a time limit will just recur', async () => {
    // The whole-run failure that moved this off Netlify: 16 units x 3 doomed attempts is
    // minutes of waiting to learn nothing, and "failed (502)" pointed at the wrong thing.
    fetchMock.mockImplementation(() => Promise.resolve(gatewayResponse(502)));
    const run = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    expect(run.status).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(run.report.failures[0].error).toMatch(/time limit/i);
    expect(run.report.failures[0].error).not.toMatch(/^Regulatory check failed/);
  });

  it('still retries a 502 that carries a real error body', async () => {
    let attempts = 0;
    fetchMock.mockImplementation(() => {
      attempts++;
      return Promise.resolve(attempts < 3 ? errorResponse(502, 'upstream hiccup') : okResponse());
    });
    const run = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    expect(attempts).toBe(3);
    expect(run.status).toBe('complete');
  });

  it("surfaces the function's own error message when it reports one", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(
      errorResponse(422, 'has no Markdown summary uploaded')));
    const run = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    expect(run.report.failures[0].error).toBe('has no Markdown summary uploaded');
  });

  it('tells the operator to deploy the function when it 404s, and latches', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(errorResponse(404, 'nope')));
    const first = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    expect(first.status).toBe('failed');
    expect(first.report.failures[0].error).toMatch(/supabase functions deploy/);

    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    expect(second.report.failures[0].error).toMatch(/supabase functions deploy/);
    // Nothing further hit the network.
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('runRegulatoryCheck — trusting the model', () => {
  it('clears an anchor the template does not contain and flags it', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse({
      findings: [{
        severity: 'minor', kind: 'wording', sectionId: 'does-not-exist', refId: 'nope',
        clause: '', requirement: 'R', issue: 'I', suggestedChange: '', quote: '',
      }],
    })));
    const run = await runRegulatoryCheck({
      template,
      sections: [section({ id: 'sec-a', blockRefs: [{ kind: 'inline', id: 'r1', content: { en: 'Text' } }] })],
      assignments: [assignment('reg-1', 'A')],
    });
    const [finding] = run.report.findings;
    expect(finding.sectionId).toBeUndefined();
    expect(finding.refId).toBeUndefined();
    expect(finding.unresolvedAnchor).toBe(true);
  });

  it('keeps and enriches an anchor the template does contain', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse({
      findings: [{
        severity: 'critical', kind: 'missing', sectionId: 'sec-a', refId: 'r1',
        clause: '§7.12', requirement: 'R', issue: 'I', suggestedChange: 'C', quote: 'Q',
      }],
    })));
    const run = await runRegulatoryCheck({
      template,
      sections: [section({ id: 'sec-a', title: 'Safety', order: 1, blockRefs: [{ kind: 'inline', id: 'r1', content: { en: 'Text' } }] })],
      assignments: [assignment('reg-1', 'A')],
    });
    expect(run.report.findings[0]).toMatchObject({
      sectionId: 'sec-a', sectionPath: '1', sectionTitle: 'Safety', refId: 'r1',
    });
    expect(run.report.findings[0].unresolvedAnchor).toBeUndefined();
  });

  it('drops malformed items and counts them instead of rendering undefined', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse({
      findings: [
        { severity: 'nonsense', kind: 'missing', sectionId: '', refId: '', clause: '', requirement: 'R', issue: 'I', suggestedChange: '', quote: '' },
        { severity: 'major', kind: 'missing', sectionId: '', refId: '', clause: '', requirement: '', issue: '', suggestedChange: '', quote: '' },
        { severity: 'major', kind: 'missing', sectionId: '', refId: '', clause: '', requirement: 'Real', issue: 'Real', suggestedChange: '', quote: '' },
      ],
      verbatims: [{ phrase: '', clause: '', rationale: '', sectionId: '', refId: '', exactness: 'exact' }],
    })));
    const run = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    expect(run.report.findings).toHaveLength(1);
    expect(run.report.dropped).toBe(3);
  });

  it("normalizes the schema's empty-string sentinel to undefined", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse({
      findings: [{
        severity: 'info', kind: 'placement', sectionId: '', refId: '',
        clause: '', requirement: 'R', issue: 'I', suggestedChange: '', quote: '',
      }],
      notes: '',
    })));
    const run = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    const [finding] = run.report.findings;
    expect(finding.clause).toBeUndefined();
    expect(finding.quote).toBeUndefined();
    expect(finding.sectionId).toBeUndefined();
    expect(run.report.notesByRegulation).toEqual({});
  });

  it('sorts findings by severity', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse({
      findings: ['info', 'critical', 'minor', 'major'].map((severity) => ({
        severity, kind: 'missing', sectionId: '', refId: '', clause: '',
        requirement: severity, issue: 'I', suggestedChange: '', quote: '',
      })),
    })));
    const run = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A')],
    });
    expect(run.report.findings.map((f) => f.severity))
      .toEqual(['critical', 'major', 'minor', 'info']);
  });

  it('dedupes a verbatim across regulations and downgrades to near if any call says so', async () => {
    fetchMock.mockImplementation((_url: string, init: any) => {
      const body = JSON.parse(init.body);
      return Promise.resolve(okResponse({
        verbatims: [{
          phrase: 'Do not damage the refrigerant circuit.',
          clause: 'X', rationale: 'Mandated', sectionId: '', refId: '',
          exactness: body.regulationId === 'reg-2' ? 'near' : 'exact',
        }],
      }));
    });
    const run = await runRegulatoryCheck({
      template, sections: [], assignments: [assignment('reg-1', 'A'), assignment('reg-2', 'B')],
    });
    expect(run.report.verbatims).toHaveLength(1);
    expect(run.report.verbatims[0].regulationIds.sort()).toEqual(['reg-1', 'reg-2']);
    // 'near' anywhere is the safer reading — it blocks registration.
    expect(run.report.verbatims[0].exactness).toBe('near');
  });
});

describe('runRegulatoryCheck — additive-only guarantee', () => {
  it('writes to no table other than im_regulatory_checks', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(okResponse({
      findings: [{
        severity: 'major', kind: 'missing', sectionId: '', refId: '', clause: '',
        requirement: 'R', issue: 'I', suggestedChange: '', quote: '',
      }],
      verbatims: [{ phrase: 'A phrase', clause: '', rationale: 'r', sectionId: '', refId: '', exactness: 'exact' }],
    })));

    await runRegulatoryCheck({
      template,
      sections: twoChunkSections(),
      assignments: [assignment('reg-1', 'A'), assignment('reg-2', 'B')],
    });

    const writes = calls.filter((c) =>
      ['insert', 'insertMany', 'updateWhere', 'delete', 'upsert'].includes(c.op));
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual(['insert:im_regulatory_checks']);
    // In particular, running a check never touches translation_verbatims — that only
    // happens on an explicit click.
    expect(verbatimCalls).toHaveLength(0);
  });
});

describe('verifyVerbatimPhrase', () => {
  // freezeVerbatims only substitutes a phrase inside ONE plain-prose run. A phrase the
  // model lifted from tag-stripped text often is not, and registering it would be a
  // silent no-op — so this gate is what makes the register button safe.
  it("returns 'exact' for a phrase inside a single prose run", () => {
    const sections = [section({
      id: 's1',
      blockRefs: [{ kind: 'inline', id: 'r1', content: { en: '<p>WARNING: Do not damage the circuit.</p>' } }],
    })];
    expect(verifyVerbatimPhrase('Do not damage the circuit.', sections)).toBe('exact');
  });

  it("returns 'stripped-only' for a phrase that crosses a tag", () => {
    const sections = [section({
      id: 's1',
      blockRefs: [{ kind: 'inline', id: 'r1', content: { en: '<p><strong>WARNING:</strong> Do not damage the circuit.</p>' } }],
    })];
    expect(verifyVerbatimPhrase('WARNING: Do not damage the circuit.', sections)).toBe('stripped-only');
  });

  it("returns 'stripped-only' for a phrase whose space is an &nbsp; in the source", () => {
    const sections = [section({
      id: 's1',
      blockRefs: [{ kind: 'inline', id: 'r1', content: { en: '<p>Keep&nbsp;clear of the vent.</p>' } }],
    })];
    expect(verifyVerbatimPhrase('Keep clear of the vent.', sections)).toBe('stripped-only');
  });

  it("returns 'absent' when the phrase is nowhere in the template", () => {
    const sections = [section({
      id: 's1',
      blockRefs: [{ kind: 'inline', id: 'r1', content: { en: '<p>Something else entirely.</p>' } }],
    })];
    expect(verifyVerbatimPhrase('A paraphrased sentence.', sections)).toBe('absent');
  });

  it('finds a freezable copy in a later block even when an earlier one is unfreezable', () => {
    const sections = [section({
      id: 's1',
      blockRefs: [
        { kind: 'inline', id: 'r1', content: { en: '<p>Keep <em>clear</em> of the vent.</p>' } },
        { kind: 'inline', id: 'r2', content: { en: '<p>Keep clear of the vent.</p>' } },
      ],
    })];
    expect(verifyVerbatimPhrase('Keep clear of the vent.', sections)).toBe('exact');
  });

  it("checks legacy section content too", () => {
    const sections = [section({ id: 's1', blockRefs: [], content: { en: '<p>Keep clear of the vent.</p>' } })];
    expect(verifyVerbatimPhrase('Keep clear of the vent.', sections)).toBe('exact');
  });
});

describe('registerVerbatimFinding', () => {
  const entry = (over: Partial<RegulatoryVerbatim> = {}): RegulatoryVerbatim => ({
    phrase: 'Do not damage the refrigerant circuit.',
    clause: 'Annex IV(2)',
    rationale: 'Mandated wording',
    exactness: 'exact',
    regulationIds: ['reg-1'],
    regulationReferences: ['(EU) 2019/2016'],
    verification: 'exact',
    ...over,
  });

  it('creates the entry with a provenance note naming the regulation and clause', async () => {
    const result = await registerVerbatimFinding(entry(), 'someone@example.com');
    expect(result).toBe('created');
    expect(verbatimCalls).toHaveLength(1);
    expect(verbatimCalls[0].phrase).toBe('Do not damage the refrigerant circuit.');
    expect(verbatimCalls[0].note).toContain('(EU) 2019/2016');
    expect(verbatimCalls[0].note).toContain('Annex IV(2)');
    expect(verbatimCalls[0].note).toMatch(/regulatory check of \d{4}-\d{2}-\d{2}/);
    expect(verbatimCalls[0].createdBy).toBe('someone@example.com');
  });

  it('reuses an existing entry rather than colliding with the unique phrase index', async () => {
    existingVerbatims.rows = [{ phrase: 'Do not damage the refrigerant circuit.' }];
    expect(await registerVerbatimFinding(entry())).toBe('already-registered');
    expect(verbatimCalls).toHaveLength(0);
  });

  it('refuses a near-wording finding — its phrase is not the mandated wording', async () => {
    await expect(registerVerbatimFinding(entry({ exactness: 'near' })))
      .rejects.toThrow(/cannot be registered/);
    expect(verbatimCalls).toHaveLength(0);
  });

  it('refuses a phrase that could not be verified as freezable', async () => {
    await expect(registerVerbatimFinding(entry({ verification: 'stripped-only' })))
      .rejects.toThrow(/cannot be registered/);
    expect(verbatimCalls).toHaveLength(0);
  });
});
