import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calls, selectRows } = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; table: string; payload?: any }>,
  selectRows: { rows: [] as any[] },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  const errors = await import('../../data/ports/errors');
  return {
    db: {
      select: vi.fn((table: string) => {
        calls.push({ op: 'select', table });
        return Promise.resolve(selectRows.rows);
      }),
      insertMany: vi.fn((table: string, rows: any[]) => {
        calls.push({ op: 'insertMany', table, payload: rows });
        return Promise.resolve();
      }),
      updateWhere: vi.fn((table: string, values: any) => {
        calls.push({ op: 'updateWhere', table, payload: values });
        return Promise.resolve();
      }),
      rpc: vi.fn((routine: string) => {
        calls.push({ op: 'rpc', table: routine });
        return Promise.resolve([]);
      }),
    },
    isPermanent: errors.isPermanent,
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));
vi.mock('../ai/translation-verbatim.service', () => ({
  getTranslationVerbatims: vi.fn(async () => []),
}));

import {
  planTmTranslation,
  recordImportedTranslations,
  translateFragmentWithMemory,
  getProtectedPhraseRefs,
  resetProtectedPhrasesCache,
  type TmPlanContext,
} from './im-tm-translate';
import { getTranslationVerbatims } from '../ai/translation-verbatim.service';

const CTX: TmPlanContext = {
  runId: '11111111-1111-1111-1111-111111111111',
  runKind: 'ai',
  scope: 'template',
  templateId: 'tpl-1',
  domainCategoryId: 'kettles',
};

const ONE = '<p>Do not immerse the appliance in water.</p>';
const TWO = '<p>Do not immerse in water. Wipe with a damp cloth.</p>';

const insertedRows = () =>
  calls.filter((c) => c.op === 'insertMany' && c.table === 'im_tm_segments').flatMap((c) => c.payload);

beforeEach(() => {
  calls.length = 0;
  selectRows.rows = [];
});

describe('translateFragmentWithMemory', () => {
  it('calls the engine on a miss and remembers the result as unreviewed machine output', async () => {
    const plan = await planTmTranslation([{ id: 'frag-1', sourceHtml: ONE }], ['de'], CTX);
    const engine = vi.fn(async () => '<p>Das Gerat nicht in Wasser eintauchen.</p>');

    const out = await translateFragmentWithMemory('frag-1', ONE, 'de', plan, CTX, engine);

    expect(engine).toHaveBeenCalledOnce();
    expect(out.fromMemory).toBe(false);
    expect(out.html).toBe('<p>Das Gerat nicht in Wasser eintauchen.</p>');
    expect(out.writeBack).toHaveLength(1);
    expect(out.writeBack[0]).toMatchObject({
      sourceLocale: 'en',
      targetLocale: 'de',
      targetText: 'Das Gerat nicht in Wasser eintauchen.',
      // Derived here, never trusted from a caller.
      origin: 'machine',
      domainCategoryId: 'kettles',
      placeholderSafe: true,
    });
  });

  it('remembers each sentence of a multi-sentence fragment separately', async () => {
    const plan = await planTmTranslation([{ id: 'frag-1', sourceHtml: TWO }], ['de'], CTX);
    const out = await translateFragmentWithMemory(
      'frag-1',
      TWO,
      'de',
      plan,
      CTX,
      async () => '<p>Nicht in Wasser eintauchen. Mit einem feuchten Tuch abwischen.</p>',
    );
    expect(out.writeBack.map((w) => w.targetText)).toEqual([
      'Nicht in Wasser eintauchen.',
      'Mit einem feuchten Tuch abwischen.',
    ]);
  });

  it('remembers nothing when the translation cannot be aligned, but still returns it', async () => {
    const plan = await planTmTranslation([{ id: 'frag-1', sourceHtml: TWO }], ['de'], CTX);
    const out = await translateFragmentWithMemory(
      'frag-1',
      TWO,
      'de',
      plan,
      CTX,
      // The engine merged two sentences into one.
      async () => '<p>Nicht eintauchen und abwischen.</p>',
    );
    expect(out.html).toBe('<p>Nicht eintauchen und abwischen.</p>');
    expect(out.writeBack).toHaveLength(0);
    expect(out.alignmentRejection).toBe('segment_count_differs');
  });

  it('stores a placeholdered target so the row is reusable with other values', async () => {
    const html = '<p>The tank holds 2.5 l of water.</p>';
    const plan = await planTmTranslation([{ id: 'frag-1', sourceHtml: html }], ['de'], CTX);
    const out = await translateFragmentWithMemory(
      'frag-1',
      html,
      'de',
      plan,
      CTX,
      async () => '<p>Der Tank fasst 2,5 l Wasser.</p>',
    );
    expect(out.writeBack[0].targetText).toBe('Der Tank fasst {{P0}} Wasser.');
    expect(out.writeBack[0].placeholderTypes).toEqual(['measure']);
  });

  it('falls back to the plain engine call when the fragment is TM-ineligible', async () => {
    const html = '<p data-note="a > b">Text here.</p>';
    const plan = await planTmTranslation([{ id: 'frag-1', sourceHtml: html }], ['de'], CTX);
    const engine = vi.fn(async () => '<p data-note="a > b">Text hier.</p>');
    const out = await translateFragmentWithMemory('frag-1', html, 'de', plan, CTX, engine);
    expect(engine).toHaveBeenCalledOnce();
    expect(out.writeBack).toHaveLength(0);
  });
});

describe('regulatory refs on write-back', () => {
  // The carve-out in evaluateCandidate (im-tm-lookup.service.ts) restricts a segment
  // carrying any regulatory ref to same-domain, same-context auto-apply. It is only as
  // good as what gets written here: a mandated sentence stored with no ref is a sentence
  // the memory will happily reuse in an unrelated product category.
  const PHRASE_MAP = { 'Do not immerse in water': ['EN 60335-1'] };

  it('defaults to an empty array for ordinary prose', async () => {
    const plan = await planTmTranslation([{ id: 'f', sourceHtml: ONE }], ['de'], CTX);
    const out = await translateFragmentWithMemory(
      'f', ONE, 'de', plan, CTX, async () => '<p>Nicht eintauchen.</p>',
    );
    // Not undefined: regulatory_refs is NOT NULL in the schema.
    expect(out.writeBack[0].regulatoryRefs).toEqual([]);
  });

  it('tags only the segments that actually carry a mandated phrase', async () => {
    const ctx: TmPlanContext = { ...CTX, regulatoryRefsByPhrase: PHRASE_MAP };
    const plan = await planTmTranslation([{ id: 'f', sourceHtml: TWO }], ['de'], ctx);
    const out = await translateFragmentWithMemory(
      'f', TWO, 'de', plan, ctx,
      async () => '<p>Nicht in Wasser eintauchen. Mit einem feuchten Tuch abwischen.</p>',
    );
    expect(out.writeBack).toHaveLength(2);
    expect(out.writeBack[0].regulatoryRefs).toEqual(['EN 60335-1']);
    // The damp-cloth sentence is not regulation-derived and must stay freely reusable.
    expect(out.writeBack[1].regulatoryRefs).toEqual([]);
  });

  it('applies fragment-level refs to every segment and unions them with phrase refs', async () => {
    const ctx: TmPlanContext = {
      ...CTX,
      regulatoryRefsByPhrase: PHRASE_MAP,
      regulatoryRefs: ['(EU) 2019/2016'],
    };
    const plan = await planTmTranslation([{ id: 'f', sourceHtml: TWO }], ['de'], ctx);
    const out = await translateFragmentWithMemory(
      'f', TWO, 'de', plan, ctx,
      async () => '<p>Nicht in Wasser eintauchen. Mit einem feuchten Tuch abwischen.</p>',
    );
    expect(out.writeBack[0].regulatoryRefs).toEqual(['(EU) 2019/2016', 'EN 60335-1']);
    expect(out.writeBack[1].regulatoryRefs).toEqual(['(EU) 2019/2016']);
  });

  it('matches phrases case-sensitively, like the freezer does', async () => {
    const ctx: TmPlanContext = {
      ...CTX,
      regulatoryRefsByPhrase: { 'DO NOT IMMERSE IN WATER': ['EN 60335-1'] },
    };
    const plan = await planTmTranslation([{ id: 'f', sourceHtml: TWO }], ['de'], ctx);
    const out = await translateFragmentWithMemory(
      'f', TWO, 'de', plan, ctx,
      async () => '<p>Nicht in Wasser eintauchen. Mit einem feuchten Tuch abwischen.</p>',
    );
    expect(out.writeBack[0].regulatoryRefs).toEqual([]);
  });

  it('tags a vendor import the same way', async () => {
    await recordImportedTranslations(
      [{ fragmentId: 'f', sourceHtml: ONE, targetLocale: 'de', targetHtml: '<p>Nicht in Wasser eintauchen.</p>' }],
      { ...CTX, runKind: 'xliff_import', regulatoryRefsByPhrase: { 'immerse the appliance in water': ['EN 60335-1'] } },
    );
    expect(insertedRows()[0].regulatory_refs).toEqual(['EN 60335-1']);
  });
});

describe('getProtectedPhraseRefs', () => {
  beforeEach(() => resetProtectedPhrasesCache());

  it('maps a mandated phrase to its regulation and omits phrases without one', async () => {
    vi.mocked(getTranslationVerbatims).mockResolvedValueOnce([
      { id: '1', phrase: 'Do not immerse in water', translations: {}, regulatoryRef: 'EN 60335-1', createdAt: '', updatedAt: '' },
      { id: '2', phrase: 'Keep out of reach of children', translations: {}, createdAt: '', updatedAt: '' },
    ]);
    const map = await getProtectedPhraseRefs();
    expect(map).toEqual({ 'Do not immerse in water': ['EN 60335-1'] });
    // "protected" and "regulation-derived" are different claims; only the second one
    // restricts reuse, so an unattributed phrase must not appear at all.
    expect(map['Keep out of reach of children']).toBeUndefined();
  });
});

describe('recordImportedTranslations', () => {
  it('stores a vendor translation as unreviewed imported content with its file name', async () => {
    const summary = await recordImportedTranslations(
      [{ fragmentId: 'frag-1', sourceHtml: ONE, targetLocale: 'de', targetHtml: '<p>Nicht eintauchen bitte.</p>' }],
      { ...CTX, runKind: 'xliff_import', sourceRef: 'Kettle.DE.xliff' },
    );
    expect(summary.attempted).toBe(1);
    expect(summary.rejected).toBe(0);
    const row = insertedRows()[0];
    expect(row).toMatchObject({
      origin: 'imported',
      // Never authoritative on arrival — a human still has to approve it.
      status: 'unreviewed',
      source_ref: 'Kettle.DE.xliff',
      target_text: 'Nicht eintauchen bitte.',
      target_locale: 'de',
    });
  });

  it('reports and skips a fragment it cannot align, without failing the rest', async () => {
    const summary = await recordImportedTranslations(
      [
        { fragmentId: 'ok', sourceHtml: ONE, targetLocale: 'de', targetHtml: '<p>Nicht eintauchen.</p>' },
        { fragmentId: 'bad', sourceHtml: TWO, targetLocale: 'de', targetHtml: '<p>Zusammengefasst.</p>' },
      ],
      { ...CTX, runKind: 'xliff_import' },
    );
    expect(summary.attempted).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.rejections[0]).toMatchObject({ fragmentId: 'bad', reason: 'segment_count_differs' });
    expect(insertedRows()).toHaveLength(1);
  });

  it('segments a shared source fragment once across several target locales', async () => {
    const summary = await recordImportedTranslations(
      [
        { fragmentId: 'frag-1', sourceHtml: ONE, targetLocale: 'de', targetHtml: '<p>Nicht eintauchen.</p>' },
        { fragmentId: 'frag-1', sourceHtml: ONE, targetLocale: 'fr', targetHtml: '<p>Ne pas immerger.</p>' },
      ],
      { ...CTX, runKind: 'xliff_import' },
    );
    expect(summary.attempted).toBe(2);
    const locales = insertedRows().map((r: any) => r.target_locale).sort();
    expect(locales).toEqual(['de', 'fr']);
  });

  it('writes nothing at all for an empty list', async () => {
    const summary = await recordImportedTranslations([], { ...CTX, runKind: 'xliff_import' });
    expect(summary.attempted).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
