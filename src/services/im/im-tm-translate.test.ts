import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectRows, rpcRows, calls, failures } = vi.hoisted(() => ({
  selectRows: { rows: [] as any[] },
  rpcRows: { rows: [] as any[] },
  calls: [] as string[],
  failures: { select: false },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  const errors = await import('../../data/ports/errors');
  return {
    db: {
      select: vi.fn(() => {
        calls.push('select');
        if (failures.select) return Promise.reject(new Error('down'));
        return Promise.resolve(selectRows.rows);
      }),
      rpc: vi.fn(() => {
        calls.push('rpc');
        return Promise.resolve(rpcRows.rows);
      }),
      insertMany: vi.fn(() => {
        calls.push('insertMany');
        return Promise.resolve();
      }),
    },
    isPermanent: errors.isPermanent,
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import {
  appliedSegmentIdsOf,
  planKey,
  planTmTranslation,
  reuseEventsOf,
  summarizeCoverage,
  type TmPlanContext,
} from './im-tm-translate';
import { buildTmSourceUnits } from './im-tm-core';
import { NORMALIZATION_VERSION } from './im-tm-normalize';
import { PLACEHOLDER_VERSION } from './im-tm-placeholders';
import { SEGMENTATION_VERSION } from './im-tm-segment';

const CTX: TmPlanContext = {
  runId: '11111111-1111-1111-1111-111111111111',
  runKind: 'ai',
  scope: 'template',
  templateId: 'tpl-1',
  domainCategoryId: 'kettles',
};

/** Build a stored memory row that will exactly match one segment of `html`. */
const rowFor = (
  html: string,
  segmentIndex: number,
  targetText: string,
  over: Record<string, any> = {},
) => {
  const built = buildTmSourceUnits('frag-1', html, { sourceLocale: 'en' });
  const unit = built.units.find((u) => u.segment.index === segmentIndex)!;
  return {
    id: 'seg-' + segmentIndex,
    source_locale: 'en',
    target_locale: 'de',
    source_key: unit.keys.segmentKey,
    plain_key: unit.keys.plainKeyHash,
    context_key: unit.keys.contextHash,
    source_fingerprint: unit.keys.sourceFingerprint,
    placeholdered_source: unit.placeholdered.patternText,
    raw_source: unit.segment.rawText,
    target_text: targetText,
    placeholder_types: unit.placeholdered.placeholders.map((p) => p.type),
    token_identities: unit.segment.tokens.map((t) => t.identity),
    placeholder_safe: unit.placeholdered.placeholderSafe,
    container: unit.segment.container,
    anchor_path: unit.segment.anchorPath,
    domain_category_id: 'kettles',
    domain_content_type: null,
    origin: 'human',
    status: 'approved',
    regulatory_refs: [],
    segmentation_version: SEGMENTATION_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    placeholder_version: PLACEHOLDER_VERSION,
    usage_count: 0,
    reviewed_by: 'admin@example.test',
    created_by: 'pm@example.test',
    ...over,
  };
};

beforeEach(() => {
  selectRows.rows = [];
  rpcRows.rows = [];
  calls.length = 0;
  failures.select = false;
});

const ONE = '<p>Do not immerse the appliance in water.</p>';
const TWO = '<p>Do not immerse the appliance in water. Wipe it with a damp cloth.</p>';

describe('planTmTranslation', () => {
  it('reports a full miss against an empty memory, and plans no html', async () => {
    const r = await planTmTranslation([{ id: 'frag-1', sourceHtml: ONE }], ['de'], CTX);
    const plan = r.plans.get(planKey('frag-1', 'de'))!;
    expect(plan.fullyCovered).toBe(false);
    expect(plan.html).toBeNull();
    expect(plan.misses).toHaveLength(1);
    expect(plan.reuseEvents[0]).toMatchObject({ tier: 'miss', applied: false });
  });

  it('covers a fragment outright when every segment is an approved exact match', async () => {
    selectRows.rows = [rowFor(ONE, 0, 'Das Gerat nicht in Wasser eintauchen.')];
    const r = await planTmTranslation([{ id: 'frag-1', sourceHtml: ONE }], ['de'], CTX);
    const plan = r.plans.get(planKey('frag-1', 'de'))!;
    expect(plan.fullyCovered).toBe(true);
    expect(plan.html).toBe('<p>Das Gerat nicht in Wasser eintauchen.</p>');
    expect(plan.misses).toHaveLength(0);
    expect(plan.appliedSegmentIds).toEqual(['seg-0']);
    expect(plan.reuseEvents[0]).toMatchObject({ tier: 'perfect', applied: true, matchPercent: 100 });
  });

  it('does NOT cover a fragment when only some of its segments are known', async () => {
    // Partial coverage is not a translation: the fragment still needs the engine, and
    // the covered segment is re-applied afterwards by the caller.
    selectRows.rows = [rowFor(TWO, 0, 'Das Gerat nicht in Wasser eintauchen.')];
    const r = await planTmTranslation([{ id: 'frag-1', sourceHtml: TWO }], ['de'], CTX);
    const plan = r.plans.get(planKey('frag-1', 'de'))!;
    expect(plan.fullyCovered).toBe(false);
    expect(plan.html).toBeNull();
    expect(plan.outcomes).toHaveLength(2);
    expect(plan.outcomes.filter((o) => o.match.autoApply)).toHaveLength(1);
  });

  it('covers a two-sentence fragment when BOTH segments are known', async () => {
    selectRows.rows = [
      rowFor(TWO, 0, 'Das Gerat nicht in Wasser eintauchen.'),
      rowFor(TWO, 1, 'Mit einem feuchten Tuch abwischen.', { id: 'seg-1' }),
    ];
    const r = await planTmTranslation([{ id: 'frag-1', sourceHtml: TWO }], ['de'], CTX);
    const plan = r.plans.get(planKey('frag-1', 'de'))!;
    expect(plan.fullyCovered).toBe(true);
    expect(plan.html).toBe(
      '<p>Das Gerat nicht in Wasser eintauchen. Mit einem feuchten Tuch abwischen.</p>',
    );
    expect(plan.appliedSegmentIds).toHaveLength(2);
  });

  it('never covers a fragment from unreviewed memory, but does offer it as a reference', async () => {
    selectRows.rows = [rowFor(ONE, 0, 'Maschinelle Fassung.', { status: 'unreviewed' })];
    const r = await planTmTranslation([{ id: 'frag-1', sourceHtml: ONE }], ['de'], CTX);
    const plan = r.plans.get(planKey('frag-1', 'de'))!;
    expect(plan.fullyCovered).toBe(false);
    expect(plan.references.size).toBe(1);
    expect(plan.reuseEvents[0].applied).toBe(false);
    expect(plan.reuseEvents[0].referenceOnly).toBe(true);
  });

  it('builds source units once per fragment regardless of target language count', async () => {
    selectRows.rows = [];
    const r = await planTmTranslation(
      [{ id: 'frag-1', sourceHtml: TWO }],
      ['de', 'fr', 'es', 'it', 'pl'],
      CTX,
    );
    // One exact query for the whole run, five plans, and identical segmentation reused.
    expect(calls.filter((c) => c === 'select')).toHaveLength(1);
    expect(r.plans.size).toBe(5);
    expect(r.segmented.size).toBe(1);
  });

  it('produces one plan per fragment and locale pair', async () => {
    const r = await planTmTranslation(
      [{ id: 'a', sourceHtml: ONE }, { id: 'b', sourceHtml: TWO }],
      ['de', 'fr'],
      CTX,
    );
    expect([...r.plans.keys()].sort()).toEqual(['a::de', 'a::fr', 'b::de', 'b::fr']);
  });

  it('marks an ineligible fragment as a miss and records why', async () => {
    const r = await planTmTranslation(
      [{ id: 'frag-1', sourceHtml: '<p data-note="a > b">Text here.</p>' }],
      ['de'],
      CTX,
    );
    const plan = r.plans.get(planKey('frag-1', 'de'))!;
    expect(plan.ineligibleReason).toBe('ambiguous_markup');
    expect(plan.fullyCovered).toBe(false);
    expect(plan.reuseEvents).toHaveLength(0);
  });

  it('degrades to a full miss when the memory is unreadable', async () => {
    failures.select = true;
    const r = await planTmTranslation([{ id: 'frag-1', sourceHtml: ONE }], ['de'], CTX);
    expect(r.memoryUnavailable).toBe(true);
    expect(r.plans.get(planKey('frag-1', 'de'))!.fullyCovered).toBe(false);
  });

  it('localizes a numeric placeholder for the target when reusing', async () => {
    const html = '<p>The tank holds 2.5 l of water.</p>';
    selectRows.rows = [rowFor(html, 0, 'Der Tank fasst {{P0}} Wasser.')];
    const r = await planTmTranslation([{ id: 'frag-1', sourceHtml: html }], ['de'], CTX);
    expect(r.plans.get(planKey('frag-1', 'de'))!.html).toBe('<p>Der Tank fasst 2,5 l Wasser.</p>');
  });

  it('preserves a chip byte-for-byte when reusing', async () => {
    const chip = '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>';
    const html = '<p>The ' + chip + ' must be earthed.</p>';
    selectRows.rows = [rowFor(html, 0, 'Das {{T0:chip.model_name}} muss geerdet sein.')];
    const r = await planTmTranslation([{ id: 'frag-1', sourceHtml: html }], ['de'], CTX);
    expect(r.plans.get(planKey('frag-1', 'de'))!.html).toBe(
      '<p>Das ' + chip + ' muss geerdet sein.</p>',
    );
  });

  it('refuses to cover a fragment whose reassembly fails an integrity gate', async () => {
    const chip = '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>';
    const html = '<p>The ' + chip + ' must be earthed.</p>';
    // A stored target that dropped the chip marker: reassembly rejects it, so the plan
    // must fall back to a miss rather than persist a fragment missing its placeholder.
    selectRows.rows = [rowFor(html, 0, 'Das muss geerdet sein.')];
    const r = await planTmTranslation([{ id: 'frag-1', sourceHtml: html }], ['de'], CTX);
    const plan = r.plans.get(planKey('frag-1', 'de'))!;
    expect(plan.fullyCovered).toBe(false);
    expect(plan.html).toBeNull();
    expect(plan.appliedSegmentIds).toHaveLength(0);
  });
});

describe('run-level helpers', () => {
  it('collects every reuse event across the run', async () => {
    const r = await planTmTranslation(
      [{ id: 'a', sourceHtml: ONE }, { id: 'b', sourceHtml: ONE }],
      ['de', 'fr'],
      CTX,
    );
    expect(reuseEventsOf(r)).toHaveLength(4);
  });

  it('deduplicates applied segment ids for the usage counters', async () => {
    selectRows.rows = [rowFor(ONE, 0, 'Nicht eintauchen.')];
    const r = await planTmTranslation(
      [{ id: 'a', sourceHtml: ONE }, { id: 'b', sourceHtml: ONE }],
      ['de'],
      CTX,
    );
    // The same memory row covered both fragments; the counter must be bumped once.
    expect(appliedSegmentIdsOf(r)).toEqual(['seg-0']);
  });

  it('summarizes coverage per locale without blending the tiers', async () => {
    selectRows.rows = [rowFor(ONE, 0, 'Nicht eintauchen.')];
    const r = await planTmTranslation(
      [{ id: 'a', sourceHtml: ONE }, { id: 'b', sourceHtml: TWO }],
      ['de'],
      CTX,
    );
    const s = summarizeCoverage(r, 'de');
    expect(s.prefilled).toBe(1);
    expect(s.prefilled + s.withReference + s.fresh).toBe(2);
  });
});
