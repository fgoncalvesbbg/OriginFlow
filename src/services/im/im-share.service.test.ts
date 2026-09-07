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
