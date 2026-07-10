import { describe, it, expect, vi, beforeEach } from 'vitest';

const { refreshSession } = vi.hoisted(() => ({
  refreshSession: vi.fn(() => Promise.resolve({ data: {}, error: null })),
}));

vi.mock('./supabase.client', () => ({ supabase: { auth: { refreshSession } } }));

import { saveWithRetry, timeoutForPayload, mapWithConcurrency } from './save-retry';

describe('timeoutForPayload', () => {
  it('uses the 12s base for small payloads', () => {
    expect(timeoutForPayload(0)).toBe(12000);
    expect(timeoutForPayload(10_000)).toBeLessThan(13000);
  });

  it('scales with payload size (5 MB ≈ base + 20s)', () => {
    expect(timeoutForPayload(5_000_000)).toBe(32000);
  });

  it('caps at 90s for absurd payloads', () => {
    expect(timeoutForPayload(1_000_000_000)).toBe(90000);
  });
});

describe('saveWithRetry', () => {
  beforeEach(() => refreshSession.mockClear());

  it('returns the write result on first-try success without refreshing the session', async () => {
    const runWrite = vi.fn(async () => 'ok');
    await expect(saveWithRetry(runWrite, { context: 'test' })).resolves.toBe('ok');
    expect(runWrite).toHaveBeenCalledTimes(1);
    expect(runWrite).toHaveBeenCalledWith(12000);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('retries transient failures with a session refresh and an escalated timeout', async () => {
    const runWrite = vi
      .fn<(timeoutMs: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error('Request timed out after 12s'))
      .mockResolvedValueOnce('ok');
    await expect(saveWithRetry(runWrite, { context: 'test' })).resolves.toBe('ok');
    expect(runWrite).toHaveBeenCalledTimes(2);
    expect(runWrite.mock.calls[0][0]).toBe(12000);
    expect(runWrite.mock.calls[1][0]).toBe(18000); // 1.5× the base on attempt 2
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('fails fast on permanent errors (constraint / validation)', async () => {
    const runWrite = vi.fn(async () => {
      throw new Error('duplicate key value violates unique constraint "x"');
    });
    await expect(saveWithRetry(runWrite, { context: 'test' })).rejects.toThrow(/duplicate key/);
    expect(runWrite).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('throws a diagnostic error naming context, attempts, and payload size when exhausted', async () => {
    const runWrite = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });
    await expect(
      saveWithRetry(runWrite, { context: 'saveThing', payloadBytes: 2_048_000, attempts: 3 }),
    ).rejects.toThrow(/saveThing: save failed after 3 attempts \(payload 2000 KB\) — Failed to fetch/);
    expect(runWrite).toHaveBeenCalledTimes(3);
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order and never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = [1, 2, 3, 4, 5, 6, 7];
    const results = await mapWithConcurrency(items, 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('rejects when an item fails', async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
