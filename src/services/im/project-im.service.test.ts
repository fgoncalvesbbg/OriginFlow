import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable Supabase query-builder stub. Every intermediate method returns the builder;
// terminal `.maybeSingle()` (the existing-row read) and `.single()` (the write) resolve from
// controllable queues so a test can make the first write fail and the second succeed.
// vi.hoisted so these are initialized before the hoisted vi.mock factory runs.
const { readResult, singleQueue, refreshSession } = vi.hoisted(() => ({
  readResult: { current: { data: { id: 'existing-id' }, error: null } as any },
  singleQueue: [] as Array<() => Promise<any>>,
  refreshSession: vi.fn(() => Promise.resolve({ data: {}, error: null })),
}));

vi.mock('../core/supabase.client', () => {
  const builder: any = {};
  for (const m of ['from', 'select', 'eq', 'update', 'insert']) builder[m] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve(readResult.current));
  builder.single = vi.fn(() => {
    const next = singleQueue.shift();
    if (!next) throw new Error('single() called more times than queued');
    return next();
  });
  return { supabase: { ...builder, auth: { refreshSession } } };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import { saveProjectIM } from './project-im.service';

const call = () =>
  saveProjectIM('proj-1', 'tmpl-1', { a: '1' }, 'draft');

describe('saveProjectIM', () => {
  beforeEach(() => {
    singleQueue.length = 0;
    readResult.current = { data: { id: 'existing-id' }, error: null };
    refreshSession.mockClear();
  });

  it('returns the saved row on a first-try success without refreshing the session', async () => {
    // The write echoes only the cheap columns; the rest of the result comes from the payload.
    singleQueue.push(() => Promise.resolve({ data: { id: 'existing-id', version: 2, updated_at: 't1' }, error: null }));
    const result = await call();
    expect(result.id).toBe('existing-id');
    expect(result.version).toBe(2);
    expect(result.status).toBe('draft');
    expect(result.placeholderData).toEqual({ a: '1' });
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes the session and retries when the first write times out', async () => {
    singleQueue.push(() => Promise.reject(new Error('Request timed out after 12s')));
    singleQueue.push(() => Promise.resolve({ data: { id: 'existing-id', version: 0, updated_at: 't1' }, error: null }));
    const result = await call();
    expect(result.id).toBe('existing-id');
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('gives up with a diagnostic error after all attempts fail (never hangs)', async () => {
    singleQueue.push(() => Promise.reject(new Error('Request timed out after 12s')));
    singleQueue.push(() => Promise.reject(new Error('Request timed out after 12s')));
    singleQueue.push(() => Promise.reject(new Error('Request timed out after 12s')));
    await expect(call()).rejects.toThrow(/save failed after 3 attempts.*timed out/s);
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });

  it('fails fast on a permanent error (constraint violation) without retrying', async () => {
    singleQueue.push(() =>
      Promise.resolve({
        data: null,
        error: { message: 'duplicate key value violates unique constraint "project_ims_project_type_uniq"' },
      }),
    );
    await expect(call()).rejects.toThrow(/duplicate key/);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(singleQueue.length).toBe(0); // exactly one write attempt consumed
  });
});
