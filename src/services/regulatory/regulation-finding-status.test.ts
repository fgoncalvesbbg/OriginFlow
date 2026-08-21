import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calls, rows } = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; table: string; payload?: any; where?: any; onConflict?: string }>,
  rows: { value: [] as any[] },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  return {
    db: {
      select: vi.fn((table: string, options: any) => {
        calls.push({ op: 'select', table, where: options?.where });
        return Promise.resolve(rows.value);
      }),
      upsert: vi.fn((table: string, payload: any, options: any) => {
        calls.push({ op: 'upsert', table, payload, onConflict: options?.onConflict });
        return Promise.resolve();
      }),
      delete: vi.fn((table: string, options: any) => {
        calls.push({ op: 'delete', table, where: options?.where });
        return Promise.resolve();
      }),
    },
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import { findingKey, getFindingStatuses, setFindingStatus } from './regulation-finding-status';
import type { RegulatoryFinding } from '../../types';

const finding = (over: Partial<RegulatoryFinding> = {}): RegulatoryFinding => ({
  severity: 'major',
  kind: 'missing',
  regulationId: 'reg-1',
  regulationReference: 'EN 60335-1',
  sectionId: 'sec-a',
  refId: 'ref-1',
  requirement: 'A warning about hot surfaces must appear',
  issue: 'No such warning is present',
  suggestedChange: 'Add the warning',
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  rows.value = [];
});

describe('findingKey', () => {
  it('is stable for the same finding', () => {
    expect(findingKey(finding())).toBe(findingKey(finding()));
  });

  it('ignores whitespace and case differences in the text', () => {
    // Trivial reformatting between runs must not orphan a decision already made.
    expect(findingKey(finding({ requirement: 'A WARNING   about hot surfaces\nmust appear' })))
      .toBe(findingKey(finding()));
  });

  it('ignores severity and suggestedChange, which the model may legitimately re-rate', () => {
    expect(findingKey(finding({ severity: 'critical', suggestedChange: 'Totally different advice' })))
      .toBe(findingKey(finding()));
  });

  it('changes when the requirement is genuinely reworded', () => {
    // The accepted cost: a reworded finding reappears untriaged, rather than risking a
    // "solved" mark being carried onto a different problem.
    expect(findingKey(finding({ requirement: 'A warning about sharp edges must appear' })))
      .not.toBe(findingKey(finding()));
  });

  it('changes when the issue text differs', () => {
    expect(findingKey(finding({ issue: 'The warning is present but too weak' })))
      .not.toBe(findingKey(finding()));
  });

  it('distinguishes the same problem under different regulations', () => {
    expect(findingKey(finding({ regulationId: 'reg-2' }))).not.toBe(findingKey(finding()));
  });

  it('distinguishes the same problem at different anchors', () => {
    expect(findingKey(finding({ refId: 'ref-2' }))).not.toBe(findingKey(finding()));
  });

  it('falls back to the section when there is no ref, then to a placeholder', () => {
    const bySection = findingKey(finding({ refId: undefined }));
    const unanchored = findingKey(finding({ refId: undefined, sectionId: undefined }));
    expect(bySection).toContain('sec-a');
    expect(unanchored).toContain(':-:');
    expect(bySection).not.toBe(unanchored);
  });

  it('prefers the ref over the section, so a block-level decision is per block', () => {
    expect(findingKey(finding())).toContain('ref-1');
  });
});

describe('getFindingStatuses', () => {
  it('maps rows into a lookup keyed by finding key', async () => {
    rows.value = [
      { finding_key: 'k1', status: 'solved', note: 'fixed in §3', updated_by: 'me@x.com', updated_at: '2026-08-21' },
      { finding_key: 'k2', status: 'wrong', note: null, updated_by: null, updated_at: '2026-08-21' },
    ];
    const out = await getFindingStatuses('t1');
    expect(out.k1).toMatchObject({ status: 'solved', note: 'fixed in §3', updatedBy: 'me@x.com' });
    expect(out.k2.status).toBe('wrong');
    expect(out.k2.note).toBeUndefined();
    expect(calls[0].where).toEqual({ template_id: 't1' });
  });

  it('returns an empty map for a template with no decisions', async () => {
    expect(await getFindingStatuses('t1')).toEqual({});
  });

  it('reads nothing without a template id', async () => {
    expect(await getFindingStatuses('')).toEqual({});
    expect(calls).toHaveLength(0);
  });
});

describe('setFindingStatus', () => {
  it('upserts on the (template, finding) pair so re-deciding overwrites', async () => {
    await setFindingStatus('t1', 'k1', 'solved', { note: ' fixed ', actor: 'me@x.com' });
    const upsert = calls.find((c) => c.op === 'upsert')!;
    expect(upsert.table).toBe('im_regulatory_finding_status');
    expect(upsert.onConflict).toBe('template_id,finding_key');
    expect(upsert.payload).toMatchObject({
      template_id: 't1', finding_key: 'k1', status: 'solved', note: 'fixed', updated_by: 'me@x.com',
    });
    expect(upsert.payload.updated_at).toBeTruthy();
  });

  it('stores a blank note as null rather than an empty string', async () => {
    await setFindingStatus('t1', 'k1', 'skipped', { note: '   ' });
    expect(calls.find((c) => c.op === 'upsert')!.payload.note).toBeNull();
  });

  it('deletes the row when the decision is cleared', async () => {
    // Untriaged is the absence of a row, not a fourth status.
    await setFindingStatus('t1', 'k1', null);
    const del = calls.find((c) => c.op === 'delete')!;
    expect(del.table).toBe('im_regulatory_finding_status');
    expect(del.where).toEqual({ template_id: 't1', finding_key: 'k1' });
    expect(calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('never writes to the immutable report table', async () => {
    await setFindingStatus('t1', 'k1', 'wrong');
    expect(calls.every((c) => c.table === 'im_regulatory_finding_status')).toBe(true);
  });
});
