import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — only createIMShare's own dependencies (db.insert + auth.getUser). Mocking the PORT
// rather than a driver client, so these tests describe the service's own default-expiry
// contract, not PostgREST's builder shape.
// ---------------------------------------------------------------------------
const { insertCalls, getUserMock } = vi.hoisted(() => ({
  insertCalls: [] as Array<{ table: string; values: any }>,
  getUserMock: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'person@example.com' })),
}));

vi.mock('../../data', () => ({
  db: {
    insert: vi.fn((table: string, values: any) => {
      insertCalls.push({ table, values });
      return Promise.resolve({ id: 'share-1', token: 'tok-1', ...values });
    }),
  },
  auth: { getUser: getUserMock },
  portalDb: { rpc: vi.fn() },
  orEmpty: (p: Promise<unknown>) => p,
}));

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import { createIMShare } from './im-share.service';

describe('createIMShare — default expiry', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    getUserMock.mockClear();
  });

  it('defaults to ~30 days from now when opts is omitted entirely', async () => {
    const before = Date.now();
    await createIMShare('proj-1', 'im');
    const after = Date.now();

    expect(insertCalls).toHaveLength(1);
    const expiresAt = insertCalls[0].values.expires_at;
    expect(expiresAt).not.toBeNull();
    const expiresMs = new Date(expiresAt).getTime();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    expect(expiresMs).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS - 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + THIRTY_DAYS_MS + 1000);
  });

  it('defaults to ~30 days from now when opts is given but expiresAt is not one of its keys', async () => {
    await createIMShare('proj-1', 'im', { label: 'DE distributor', mode: 'view' });
    const expiresAt = insertCalls[0].values.expires_at;
    expect(expiresAt).not.toBeNull();
  });

  it('honors an explicit expiresAt (a real ISO date) exactly as passed', async () => {
    await createIMShare('proj-1', 'im', { expiresAt: '2030-01-01T00:00:00.000Z' });
    expect(insertCalls[0].values.expires_at).toBe('2030-01-01T00:00:00.000Z');
  });

  it('honors an explicit expiresAt: null ("no expiry") rather than defaulting it', async () => {
    await createIMShare('proj-1', 'im', { expiresAt: null, mode: 'review' });
    expect(insertCalls[0].values.expires_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The subject seam (migration 162). createIMShare is now a thin adapter over
// createReviewShare, and these assert the part of that translation nothing else covers:
// which table it writes to, and that an IM round is addressed by (project, template type)
// with no per-version subject row.
// ---------------------------------------------------------------------------

describe('createIMShare — subject mapping', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    getUserMock.mockClear();
  });

  it('writes to review_shares, not the pre-162 im_shares', async () => {
    await createIMShare('proj-1', 'im');
    expect(insertCalls[0].table).toBe('review_shares');
  });

  it('maps the template type onto subject_type and leaves subject_id null', async () => {
    await createIMShare('proj-1', 'warning_leaflet');
    const { values } = insertCalls[0];
    expect(values.subject_type).toBe('warning_leaflet');
    // An IM round has no per-version subject row — see migration 119.
    expect(values.subject_id).toBeNull();
    expect(values).not.toHaveProperty('template_type');
  });

  it('carries the manual version through as subject_version', async () => {
    await createIMShare('proj-1', 'im', { mode: 'review', manualVersion: 11 });
    expect(insertCalls[0].values.subject_version).toBe(11);
    expect(insertCalls[0].values).not.toHaveProperty('manual_version');
  });

  it('stamps a review stage on a review link and none on a view link', async () => {
    await createIMShare('proj-1', 'im', { mode: 'review', reviewStage: 'final' });
    expect(insertCalls[0].values.review_stage).toBe('final');

    insertCalls.length = 0;
    await createIMShare('proj-1', 'im', { mode: 'view' });
    expect(insertCalls[0].values.review_stage).toBeNull();
  });

  it('still defaults the stage to draft when a review link does not name one', async () => {
    await createIMShare('proj-1', 'im', { mode: 'review' });
    expect(insertCalls[0].values.review_stage).toBe('draft');
  });
});
