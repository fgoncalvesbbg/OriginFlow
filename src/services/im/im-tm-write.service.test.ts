import { describe, it, expect, vi, beforeEach } from 'vitest';

// The port is mocked, not a driver client, so these tests describe the service's
// contract rather than PostgREST's builder shape — same reasoning as
// im-section.service.test.ts. The real resilience/error helpers are re-imported so
// retry and deadline behaviour stays genuine.
const { calls, selectResult } = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; table: string; payload?: any; where?: any }>,
  selectResult: { rows: [] as any[] },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  const errors = await import('../../data/ports/errors');
  return {
    db: {
      select: vi.fn((table: string, options: any) => {
        calls.push({ op: 'select', table, where: options?.where });
        return Promise.resolve(selectResult.rows);
      }),
      selectOne: vi.fn((table: string, options: any) => {
        calls.push({ op: 'selectOne', table, where: options?.where });
        return Promise.resolve(selectResult.rows[0]);
      }),
      insert: vi.fn((table: string, row: any) => {
        calls.push({ op: 'insert', table, payload: row });
        return Promise.resolve({ id: 'new-row', ...row });
      }),
      insertMany: vi.fn((table: string, rows: any[]) => {
        calls.push({ op: 'insertMany', table, payload: rows });
        return Promise.resolve();
      }),
      updateWhere: vi.fn((table: string, values: any, options: any) => {
        calls.push({ op: 'updateWhere', table, payload: values, where: options?.where });
        return Promise.resolve();
      }),
      rpc: vi.fn((routine: string, params: any) => {
        calls.push({ op: 'rpc', table: routine, payload: params });
        return Promise.resolve(undefined);
      }),
    },
    isPermanent: errors.isPermanent,
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import {
  TM_APPROVAL_BATCH_LIMIT,
  TmApprovalDeniedError,
  TmBatchTooLargeError,
  TmImmutableSegmentError,
  approveTmSegments,
  deprecateTmSegments,
  logTmReuse,
  noteTmSegmentsUsed,
  recordTmSegments,
  replaceApprovedTmSegment,
  reuseTierFor,
  type RecordTmSegmentInput,
} from './im-tm-write.service';
import { NORMALIZATION_VERSION } from './im-tm-normalize';
import { PLACEHOLDER_VERSION } from './im-tm-placeholders';
import { SEGMENTATION_VERSION } from './im-tm-segment';

const input = (over: Partial<RecordTmSegmentInput> = {}): RecordTmSegmentInput => ({
  sourceLocale: 'en',
  targetLocale: 'de',
  sourceKey: 'a'.repeat(32),
  plainKey: 'b'.repeat(32),
  contextKey: 'c'.repeat(32),
  sourceFingerprint: 'd'.repeat(32),
  placeholderedSource: 'Do not immerse in water.',
  rawSource: 'Do not immerse in water.',
  targetText: 'Nicht in Wasser eintauchen.',
  placeholderTypes: [],
  tokenIdentities: [],
  placeholderSafe: true,
  origin: 'machine',
  ...over,
});

const storedRow = (over: Record<string, any> = {}) => ({
  id: 'seg-1',
  source_locale: 'en',
  target_locale: 'de',
  source_key: 'a'.repeat(32),
  plain_key: 'b'.repeat(32),
  context_key: 'c'.repeat(32),
  source_fingerprint: 'd'.repeat(32),
  placeholdered_source: 'Do not immerse in water.',
  raw_source: 'Do not immerse in water.',
  target_text: 'Nicht in Wasser eintauchen.',
  placeholder_types: [],
  token_identities: [],
  placeholder_safe: true,
  domain_category_id: null,
  domain_content_type: null,
  origin: 'machine',
  status: 'unreviewed',
  regulatory_refs: [],
  segmentation_version: SEGMENTATION_VERSION,
  normalization_version: NORMALIZATION_VERSION,
  placeholder_version: PLACEHOLDER_VERSION,
  usage_count: 0,
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  selectResult.rows = [];
});

describe('recordTmSegments', () => {
  it('writes a new candidate with the current versions and correct snake_case payload', async () => {
    const result = await recordTmSegments([input({ createdBy: 'a@example.test' })]);
    expect(result.inserted).toBe(1);
    const insert = calls.find((c) => c.op === 'insertMany');
    expect(insert?.table).toBe('im_tm_segments');
    expect(insert?.payload[0]).toMatchObject({
      source_locale: 'en',
      target_locale: 'de',
      target_text: 'Nicht in Wasser eintauchen.',
      origin: 'machine',
      status: 'unreviewed',
      segmentation_version: SEGMENTATION_VERSION,
      normalization_version: NORMALIZATION_VERSION,
      placeholder_version: PLACEHOLDER_VERSION,
      created_by: 'a@example.test',
    });
  });

  it('NEVER writes an approved row, whatever the caller passes', async () => {
    await recordTmSegments([input(), input({ sourceKey: 'e'.repeat(32) })]);
    const written = calls.filter((c) => c.op === 'insertMany').flatMap((c) => c.payload);
    expect(written).toHaveLength(2);
    for (const row of written) expect(row.status).toBe('unreviewed');
  });

  it('normalizes locale codes on the way in', async () => {
    await recordTmSegments([input({ targetLocale: 'DE-at' })]);
    const row = calls.find((c) => c.op === 'insertMany')?.payload[0];
    expect(row.target_locale).toBe('de-AT');
  });

  it('refreshes an existing unreviewed row rather than duplicating it', async () => {
    selectResult.rows = [storedRow({ target_text: 'Alte Fassung.' })];
    const result = await recordTmSegments([input()]);
    expect(result.inserted).toBe(0);
    expect(result.updatedUnreviewed).toBe(1);
    const update = calls.find((c) => c.op === 'updateWhere');
    expect(update?.where).toEqual({ id: 'seg-1' });
    expect(update?.payload.target_text).toBe('Nicht in Wasser eintauchen.');
  });

  it('does nothing at all when an unreviewed row already holds the same target', async () => {
    selectResult.rows = [storedRow()];
    const result = await recordTmSegments([input()]);
    expect(result.inserted).toBe(0);
    expect(result.updatedUnreviewed).toBe(0);
    expect(calls.some((c) => c.op === 'updateWhere' || c.op === 'insertMany')).toBe(false);
  });

  it('never overwrites an approved row, and reports the disagreement instead', async () => {
    // The primary anti-poisoning valve: a vendor or model "improving" signed-off wording.
    selectResult.rows = [storedRow({ status: 'approved', target_text: 'Freigegebene Fassung.' })];
    const result = await recordTmSegments([input({ targetText: 'Andere Fassung.' })]);

    expect(result.skippedApproved).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.updatedUnreviewed).toBe(0);
    expect(calls.some((c) => c.op === 'updateWhere' || c.op === 'insertMany')).toBe(false);
    expect(result.divergences).toEqual([
      {
        segmentId: 'seg-1',
        targetLocale: 'de',
        placeholderedSource: 'Do not immerse in water.',
        approvedTarget: 'Freigegebene Fassung.',
        submittedTarget: 'Andere Fassung.',
      },
    ]);
  });

  it('skips an approved row silently when the target agrees', async () => {
    selectResult.rows = [storedRow({ status: 'approved' })];
    const result = await recordTmSegments([input()]);
    expect(result.skippedApproved).toBe(1);
    expect(result.divergences).toHaveLength(0);
  });

  it('treats a different domain as a different row, so meaning cannot bleed between categories', async () => {
    selectResult.rows = [storedRow({ status: 'approved', domain_category_id: 'kettles' })];
    const result = await recordTmSegments([input({ domainCategoryId: 'pressure-washers' })]);
    expect(result.inserted).toBe(1);
    expect(result.skippedApproved).toBe(0);
  });

  it.each([
    ['a target missing a declared placeholder', { placeholderTypes: ['measure'] as any, targetText: 'Ohne Wert.' }],
    ['a target with an extra placeholder', { placeholderTypes: [] as any, targetText: 'Mit {{P0}}.' }],
    ['a target duplicating a placeholder', { placeholderTypes: ['measure'] as any, targetText: '{{P0}} und {{P0}}.' }],
    ['an empty target', { targetText: '   ' }],
  ])('refuses to store %s', async (_label, over) => {
    const result = await recordTmSegments([input(over as any)]);
    expect(result.skippedInvalid).toBe(1);
    expect(result.inserted).toBe(0);
    expect(calls.some((c) => c.op === 'insertMany')).toBe(false);
  });

  it('stores a target whose placeholders line up exactly', async () => {
    const result = await recordTmSegments([
      input({
        placeholderTypes: ['measure', 'code'] as any,
        placeholderedSource: 'Runs at {{P0}} as model {{P1}}.',
        targetText: 'Betrieb bei {{P0}} als Modell {{P1}}.',
      }),
    ]);
    expect(result.inserted).toBe(1);
  });

  it('reads the possible collisions in a single query', async () => {
    await recordTmSegments([input(), input({ sourceKey: 'f'.repeat(32) })]);
    expect(calls.filter((c) => c.op === 'select')).toHaveLength(1);
  });
});

describe('approveTmSegments', () => {
  it('records the reviewer and the timestamp together', async () => {
    selectResult.rows = [{ id: 'seg-1', target_locale: 'de', status: 'unreviewed' }];
    const count = await approveTmSegments(['seg-1'], { email: 'admin@example.test' });
    expect(count).toBe(1);
    const update = calls.find((c) => c.op === 'updateWhere');
    expect(update?.payload).toMatchObject({ status: 'approved', reviewed_by: 'admin@example.test' });
    expect(update?.payload.reviewed_at).toBeTruthy();
  });

  it('refuses a batch larger than the review limit', async () => {
    const ids = Array.from({ length: TM_APPROVAL_BATCH_LIMIT + 1 }, (_, i) => 'seg-' + i);
    await expect(approveTmSegments(ids, { email: 'a@example.test' })).rejects.toBeInstanceOf(
      TmBatchTooLargeError,
    );
    expect(calls.some((c) => c.op === 'updateWhere')).toBe(false);
  });

  it('refuses a selection spanning more than one target locale', async () => {
    selectResult.rows = [
      { id: 'seg-1', target_locale: 'de', status: 'unreviewed' },
      { id: 'seg-2', target_locale: 'pl', status: 'unreviewed' },
    ];
    await expect(approveTmSegments(['seg-1', 'seg-2'], { email: 'a@example.test' })).rejects.toBeInstanceOf(
      TmApprovalDeniedError,
    );
    expect(calls.some((c) => c.op === 'updateWhere')).toBe(false);
  });

  it('refuses an approval with no reviewer identity', async () => {
    await expect(approveTmSegments(['seg-1'], { email: '' })).rejects.toBeInstanceOf(
      TmApprovalDeniedError,
    );
  });

  it('skips rows that are already approved', async () => {
    selectResult.rows = [
      { id: 'seg-1', target_locale: 'de', status: 'approved' },
      { id: 'seg-2', target_locale: 'de', status: 'unreviewed' },
    ];
    const count = await approveTmSegments(['seg-1', 'seg-2'], { email: 'a@example.test' });
    expect(count).toBe(1);
    expect(calls.find((c) => c.op === 'updateWhere')?.where).toEqual({ id: ['seg-2'] });
  });
});

describe('deprecateTmSegments', () => {
  it('requires a reason, because it is the audit trail', async () => {
    await expect(deprecateTmSegments(['seg-1'], '  ')).rejects.toBeInstanceOf(TmApprovalDeniedError);
  });

  it('marks the rows deprecated with the reason', async () => {
    await deprecateTmSegments(['seg-1'], 'EN 60335-1 superseded');
    const update = calls.find((c) => c.op === 'updateWhere');
    expect(update?.payload).toMatchObject({ status: 'deprecated', deprecated_reason: 'EN 60335-1 superseded' });
  });
});

describe('replaceApprovedTmSegment', () => {
  it('deprecates the old row and inserts an UNREVIEWED replacement linked by supersedes_id', async () => {
    selectResult.rows = [storedRow({ status: 'approved' })];
    const created = await replaceApprovedTmSegment('seg-1', 'Neue Fassung.', 'wording corrected');

    const update = calls.find((c) => c.op === 'updateWhere');
    expect(update?.payload).toMatchObject({ status: 'deprecated', deprecated_reason: 'wording corrected' });

    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.payload).toMatchObject({
      target_text: 'Neue Fassung.',
      // A correction is exactly when a second pair of eyes matters most, so the
      // replacement is never auto-approved.
      status: 'unreviewed',
      supersedes_id: 'seg-1',
      origin: 'human',
    });
    expect(created?.targetText).toBe('Neue Fassung.');
  });

  it('requires both a target and a reason', async () => {
    await expect(replaceApprovedTmSegment('seg-1', '', 'r')).rejects.toBeInstanceOf(
      TmImmutableSegmentError,
    );
    await expect(replaceApprovedTmSegment('seg-1', 't', '')).rejects.toBeInstanceOf(
      TmImmutableSegmentError,
    );
  });
});

describe('noteTmSegmentsUsed', () => {
  it('goes through the atomic rpc and deduplicates ids', async () => {
    await noteTmSegmentsUsed(['seg-1', 'seg-1', 'seg-2']);
    const rpc = calls.find((c) => c.op === 'rpc');
    expect(rpc?.table).toBe('im_tm_note_used');
    expect(rpc?.payload.p_ids).toEqual(['seg-1', 'seg-2']);
  });

  it('does nothing for an empty list', async () => {
    await noteTmSegmentsUsed([]);
    expect(calls).toHaveLength(0);
  });
});

describe('logTmReuse', () => {
  const event = (over: Partial<Parameters<typeof logTmReuse>[0][number]> = {}) => ({
    runId: '11111111-1111-1111-1111-111111111111',
    runKind: 'ai' as const,
    scope: 'template' as const,
    templateId: 'tpl-1',
    segmentIndex: 0,
    sourceLocale: 'en',
    targetLocale: 'de',
    tier: 'perfect' as const,
    matchPercent: 100,
    localeDistance: 0,
    matchedSegmentId: 'seg-1',
    applied: true,
    referenceOnly: false,
    sourceChars: 24,
    ...over,
  });

  it('writes one append-only row per decision', async () => {
    const n = await logTmReuse([event(), event({ tier: 'miss', applied: false, matchedSegmentId: null, matchPercent: null })]);
    expect(n).toBe(2);
    const insert = calls.find((c) => c.op === 'insertMany');
    expect(insert?.table).toBe('im_tm_reuse_log');
    expect(insert?.payload[0]).toMatchObject({
      run_kind: 'ai',
      tier: 'perfect',
      applied: true,
      source_chars: 24,
      target_locale: 'de',
    });
  });

  it('logs misses too, since they are the denominator of any leverage figure', async () => {
    await logTmReuse([event({ tier: 'miss', applied: false, matchPercent: null, matchedSegmentId: null })]);
    expect(calls.find((c) => c.op === 'insertMany')?.payload[0].tier).toBe('miss');
  });
});

describe('reuseTierFor', () => {
  it.each([
    ['exact_in_context', 'perfect'],
    ['exact', 'exact'],
    ['fuzzy_auto', 'fuzzy_high'],
    ['fuzzy_review', 'fuzzy_high'],
    ['reference', 'fuzzy_low'],
    ['none', 'miss'],
  ])('maps %s to the reporting tier %s', (tier, expected) => {
    expect(reuseTierFor(tier)).toBe(expected);
  });
});
