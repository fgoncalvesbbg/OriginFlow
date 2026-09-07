import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for recomputePlaceholderData (the pure functions above need none of this — they
// stay unmocked). Mocking the PORT and the sibling services rather than a driver client, so
// these tests describe the service's own merge contract, not PostgREST's builder shape or
// the SKU-floor computation (covered separately by project-sku.service.test.ts). vi.hoisted
// so this state exists before the mock factories run.
// ---------------------------------------------------------------------------
const { dbState, updateCalls, getUserMock } = vi.hoisted(() => ({
  dbState: {
    projectImRow: { project_id: 'proj-1', bound_sku_ids: [] as string[] },
    freshPlaceholderData: {} as Record<string, string>,
    answerRows: [] as any[],
  },
  updateCalls: [] as Array<{ table: string; values: any; where: any }>,
  getUserMock: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'person@example.com' })),
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  return {
    db: {
      // Dispatches on the requested columns: the initial (project_id, bound_sku_ids) read
      // vs. the race-narrowing re-read of placeholder_data right before the write.
      selectOne: vi.fn((table: string, options: any) => {
        if (table !== 'project_ims') throw new Error(`unexpected selectOne table: ${table}`);
        if (options?.columns?.includes('bound_sku_ids')) return Promise.resolve(dbState.projectImRow);
        return Promise.resolve({ placeholder_data: dbState.freshPlaceholderData });
      }),
      select: vi.fn((table: string) => {
        if (table === 'im_placeholder_answers') return Promise.resolve(dbState.answerRows);
        return Promise.resolve([]);
      }),
      update: vi.fn((table: string, values: any, options: any) => {
        updateCalls.push({ table, values, where: options?.where });
        return Promise.resolve(values);
      }),
    },
    auth: { getUser: getUserMock },
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

// The SKU floor itself is out of scope here — an empty SKU list makes
// collapseSkuAttributeValues trivially return {}, so every test below is free to focus on
// the answer-row/existing-data merge these tests actually target.
vi.mock('../project/project-sku.service', () => ({
  getProjectSkus: vi.fn(() => Promise.resolve([])),
  collapseSkuAttributeValues: vi.fn(() => ({})),
}));
vi.mock('../project/project-attribute-request.service', () => ({
  getAttributeRequestsByProject: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../compliance/compliance-requirement.service', () => ({
  getCategoryAttributes: vi.fn(() => Promise.resolve([])),
}));

import { collapsePlaceholderAnswers, getEffectivePlaceholderValue, inferAnswerAction, recomputePlaceholderData } from './im-placeholder-answer.service';
import type { PlaceholderAnswer, PlaceholderAnswerStatus } from '../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeAnswer = (overrides: Partial<PlaceholderAnswer> & { placeholderKey: string; scope: 'project' | 'sku' }): PlaceholderAnswer => ({
  id: `ans-${overrides.placeholderKey}-${overrides.scope}-${overrides.projectSkuId ?? 'proj'}`,
  projectImId: 'im-1',
  status: 'answered',
  value: null,
  source: 'manual',
  skippedThenFilled: false,
  answeredBy: null,
  answeredAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// getEffectivePlaceholderValue
// ---------------------------------------------------------------------------

describe('getEffectivePlaceholderValue', () => {
  it('prefers an answered SKU-scope row over an answered project-scope row', () => {
    const answers = [
      makeAnswer({ placeholderKey: 'p1', scope: 'project', value: 'Project value' }),
      makeAnswer({ placeholderKey: 'p1', scope: 'sku', projectSkuId: 's1', value: 'SKU value' }),
    ];
    expect(getEffectivePlaceholderValue('s1', answers, 'p1')).toBe('SKU value');
  });

  it('falls back to the project-scope row when this SKU has no answer', () => {
    const answers = [makeAnswer({ placeholderKey: 'p1', scope: 'project', value: 'Project value' })];
    expect(getEffectivePlaceholderValue('s1', answers, 'p1')).toBe('Project value');
  });

  it('ignores a SKU-scope row belonging to a DIFFERENT SKU', () => {
    const answers = [
      makeAnswer({ placeholderKey: 'p1', scope: 'project', value: 'Project value' }),
      makeAnswer({ placeholderKey: 'p1', scope: 'sku', projectSkuId: 's2', value: 'Other SKU value' }),
    ];
    expect(getEffectivePlaceholderValue('s1', answers, 'p1')).toBe('Project value');
  });

  it('ignores pending and not_applicable rows — only an answered row contributes a value', () => {
    const answers = [
      makeAnswer({ placeholderKey: 'p1', scope: 'sku', projectSkuId: 's1', status: 'pending', value: null }),
      makeAnswer({ placeholderKey: 'p1', scope: 'project', status: 'not_applicable', value: null }),
    ];
    expect(getEffectivePlaceholderValue('s1', answers, 'p1')).toBe('');
  });

  it('returns empty string when neither scope has an answer', () => {
    expect(getEffectivePlaceholderValue('s1', [], 'p1')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// collapsePlaceholderAnswers
// ---------------------------------------------------------------------------

describe('collapsePlaceholderAnswers', () => {
  it('returns "" for an empty SKU list', () => {
    expect(collapsePlaceholderAnswers([], [], 'p1')).toBe('');
  });

  it('shows a single value when every bound SKU agrees', () => {
    const answers = [
      makeAnswer({ placeholderKey: 'p1', scope: 'sku', projectSkuId: 's1', value: '230V' }),
      makeAnswer({ placeholderKey: 'p1', scope: 'sku', projectSkuId: 's2', value: '230V' }),
    ];
    expect(collapsePlaceholderAnswers(['s1', 's2'], answers, 'p1')).toBe('230V');
  });

  it('joins distinct values with ", " when SKUs differ (deduped)', () => {
    const answers = [
      makeAnswer({ placeholderKey: 'p1', scope: 'sku', projectSkuId: 's1', value: 'Red' }),
      makeAnswer({ placeholderKey: 'p1', scope: 'sku', projectSkuId: 's2', value: 'Red' }),
      makeAnswer({ placeholderKey: 'p1', scope: 'sku', projectSkuId: 's3', value: 'Blue' }),
    ];
    expect(collapsePlaceholderAnswers(['s1', 's2', 's3'], answers, 'p1')).toBe('Red, Blue');
  });

  it('uses the first non-empty value for image-typed keys instead of joining', () => {
    const answers = [
      makeAnswer({ placeholderKey: 'img', scope: 'sku', projectSkuId: 's1', value: 'url-a' }),
      makeAnswer({ placeholderKey: 'img', scope: 'sku', projectSkuId: 's2', value: 'url-b' }),
    ];
    expect(collapsePlaceholderAnswers(['s1', 's2'], answers, 'img', new Set(['img']))).toBe('url-a');
  });

  it('falls back to the project-scope answer for a SKU with no SKU-scope row of its own', () => {
    const answers = [
      makeAnswer({ placeholderKey: 'p1', scope: 'project', value: 'Shared value' }),
      makeAnswer({ placeholderKey: 'p1', scope: 'sku', projectSkuId: 's2', value: 'Shared value' }),
    ];
    expect(collapsePlaceholderAnswers(['s1', 's2'], answers, 'p1')).toBe('Shared value');
  });

  it('drops SKUs with no effective value, collapsing to "" when none has one', () => {
    expect(collapsePlaceholderAnswers(['s1', 's2'], [], 'p1')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// inferAnswerAction
// ---------------------------------------------------------------------------

describe('inferAnswerAction', () => {
  const cases: Array<[PlaceholderAnswerStatus | undefined, PlaceholderAnswerStatus, string]> = [
    [undefined, 'answered', 'answer'],
    ['pending', 'answered', 'answer'],
    ['not_applicable', 'answered', 'answer'],
    ['answered', 'answered', 'update'],
    ['answered', 'pending', 'clear'],
    ['not_applicable', 'pending', 'unskip'],
    [undefined, 'pending', 'skip'],
    ['pending', 'pending', 'skip'],
    [undefined, 'not_applicable', 'mark_not_applicable'],
    ['pending', 'not_applicable', 'mark_not_applicable'],
    ['answered', 'not_applicable', 'mark_not_applicable'],
  ];

  it.each(cases)('%s -> %s yields %s', (oldStatus, newStatus, expected) => {
    expect(inferAnswerAction(oldStatus, newStatus)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// recomputePlaceholderData — the ownedKeys merge (bug 1) and the updated_by stamp (bug 2)
// ---------------------------------------------------------------------------

describe('recomputePlaceholderData', () => {
  beforeEach(() => {
    updateCalls.length = 0;
    getUserMock.mockClear();
    dbState.projectImRow = { project_id: 'proj-1', bound_sku_ids: [] };
    dbState.freshPlaceholderData = {};
    dbState.answerRows = [];
  });

  const rawAnswer = (overrides: Partial<Record<string, unknown>> & { placeholder_key: string; scope: 'project' | 'sku' }) => ({
    id: `ans-${overrides.placeholder_key}`,
    project_im_id: 'im-1',
    project_sku_id: null,
    status: 'answered',
    value: null,
    source: 'manual',
    skipped_then_filled: false,
    answered_by: null,
    answered_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  it('preserves __required_languages, __language_order, __field_bindings, __custom_logo, __custom_footer, __cover_title and an unrelated PM-typed key while recomputing an answered key', async () => {
    dbState.freshPlaceholderData = {
      __required_languages: '["en","de"]',
      __language_order: '["de","en"]',
      __field_bindings: '{"someSlot":["sku-1"]}',
      __custom_logo: 'https://cdn.example/logo.png',
      __custom_footer: 'Footer text',
      __cover_title: 'Cover Title',
      // A PM-typed value for a chip with no answer row (legacy ad-hoc chip, or an attribute
      // no section references) — NOT in ownedKeys, must survive untouched.
      unrelated_pm_key: 'PM typed value with no answer row',
    };
    dbState.answerRows = [
      rawAnswer({ placeholder_key: 'someAttr', scope: 'project', status: 'answered', value: 'Recomputed value' }),
    ];

    await recomputePlaceholderData('im-1');

    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0].values.placeholder_data;
    expect(written).toEqual({
      __required_languages: '["en","de"]',
      __language_order: '["de","en"]',
      __field_bindings: '{"someSlot":["sku-1"]}',
      __custom_logo: 'https://cdn.example/logo.png',
      __custom_footer: 'Footer text',
      __cover_title: 'Cover Title',
      unrelated_pm_key: 'PM typed value with no answer row',
      someAttr: 'Recomputed value',
    });
  });

  it('removes an owned key entirely once its answer is cleared back to pending, instead of resurrecting the stale value', async () => {
    dbState.freshPlaceholderData = {
      theKey: 'stale value from before the clear',
      otherKey: 'keep me — untouched by this recompute',
    };
    // The row now sitting at 'pending' with a null value — a cleared answer. It still HAS an
    // answer row, which is exactly what must make 'theKey' an owned key whose stale value
    // gets dropped rather than left behind.
    dbState.answerRows = [
      rawAnswer({ placeholder_key: 'theKey', scope: 'project', status: 'pending', value: null, skipped_then_filled: true }),
    ];

    await recomputePlaceholderData('im-1');

    const written = updateCalls[0].values.placeholder_data;
    expect(written).not.toHaveProperty('theKey');
    expect(written.otherKey).toBe('keep me — untouched by this recompute');
  });

  it('stamps updated_by with the acting user, the same source saveProjectIM uses', async () => {
    await recomputePlaceholderData('im-1');

    expect(updateCalls).toHaveLength(1);
    expect(getUserMock).toHaveBeenCalled();
    expect(updateCalls[0].values.updated_by).toBe('person@example.com');
    expect(typeof updateCalls[0].values.updated_at).toBe('string');
    expect(updateCalls[0].where).toEqual({ id: 'im-1' });
  });
});
