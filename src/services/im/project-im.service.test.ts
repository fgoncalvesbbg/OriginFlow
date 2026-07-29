import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks the DATABASE PORT, not a driver client: `selectMaybeOne` is the existing-row lookup
// and `update` is the write, resolving from a controllable queue so a test can make the first
// write fail and the second succeed. Because the port throws (rather than returning an in-band
// `{ error }`), a failing write is expressed as a rejection — which is exactly what the retry
// pipeline consumes. vi.hoisted so these are initialized before the mock factory runs.
const { readResult, writeQueue, refreshSession } = vi.hoisted(() => ({
  readResult: { current: { id: 'existing-id' } as any },
  writeQueue: [] as Array<() => Promise<any>>,
  refreshSession: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  const errors = await import('../../data/ports/errors');
  const takeWrite = () => {
    const next = writeQueue.shift();
    if (!next) throw new Error('write called more times than queued');
    return next();
  };
  return {
    db: {
      selectMaybeOne: vi.fn(() => Promise.resolve(readResult.current)),
      update: vi.fn(takeWrite),
      insert: vi.fn(takeWrite),
    },
    auth: { refreshSession },
    isPermanent: errors.isPermanent,
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import { saveProjectIM } from './project-im.service';
import { DataAccessError } from '../../data/ports/errors';

const call = () =>
  saveProjectIM('proj-1', 'tmpl-1', { a: '1' }, 'draft');

describe('saveProjectIM', () => {
  beforeEach(() => {
    writeQueue.length = 0;
    readResult.current = { id: 'existing-id' };
    refreshSession.mockClear();
  });

  it('returns the saved row on a first-try success without refreshing the session', async () => {
    // The write echoes only the cheap columns; the rest of the result comes from the payload.
    writeQueue.push(() => Promise.resolve({ id: 'existing-id', version: 2, updated_at: 't1' }));
    const result = await call();
    expect(result.id).toBe('existing-id');
    expect(result.version).toBe(2);
    expect(result.status).toBe('draft');
    expect(result.placeholderData).toEqual({ a: '1' });
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes the session and retries when the first write times out', async () => {
    writeQueue.push(() => Promise.reject(new Error('Request timed out after 12s')));
    writeQueue.push(() => Promise.resolve({ id: 'existing-id', version: 0, updated_at: 't1' }));
    const result = await call();
    expect(result.id).toBe('existing-id');
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('gives up with a diagnostic error after all attempts fail (never hangs)', async () => {
    writeQueue.push(() => Promise.reject(new Error('Request timed out after 12s')));
    writeQueue.push(() => Promise.reject(new Error('Request timed out after 12s')));
    writeQueue.push(() => Promise.reject(new Error('Request timed out after 12s')));
    await expect(call()).rejects.toThrow(/save failed after 3 attempts.*timed out/s);
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });

  it('fails fast on a permanent error (constraint violation) without retrying', async () => {
    // The adapter classifies driver errors; the retry pipeline trusts that classification.
    writeQueue.push(() =>
      Promise.reject(
        new DataAccessError(
          'duplicate key value violates unique constraint "project_ims_project_type_uniq" (23505)',
          { kind: 'permanent', context: 'db.update(project_ims)', driverCode: '23505' },
        ),
      ),
    );
    await expect(call()).rejects.toThrow(/duplicate key/);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(writeQueue.length).toBe(0); // exactly one write attempt consumed
  });
});
