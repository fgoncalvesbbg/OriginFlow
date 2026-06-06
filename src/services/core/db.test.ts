import { describe, it, expect } from 'vitest';
import { runMutation, runQuery } from './db';

describe('runMutation', () => {
  it('resolves when the query reports no error', async () => {
    await expect(runMutation(Promise.resolve({ data: null, error: null }), 'ctx')).resolves.toBeUndefined();
  });

  it('throws when the query reports an error', async () => {
    await expect(
      runMutation(Promise.resolve({ data: null, error: { message: 'boom' } }), 'ctx'),
    ).rejects.toThrow();
  });
});

describe('runQuery', () => {
  it('returns the data when the query reports no error', async () => {
    const row = { id: '1', name: 'x' };
    await expect(runQuery(Promise.resolve({ data: row, error: null }), 'ctx')).resolves.toEqual(row);
  });

  it('throws when the query reports an error', async () => {
    await expect(
      runQuery(Promise.resolve({ data: null, error: { message: 'boom' } }), 'ctx'),
    ).rejects.toThrow();
  });
});
