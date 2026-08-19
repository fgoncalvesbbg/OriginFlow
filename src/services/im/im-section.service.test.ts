import { describe, it, expect, vi, beforeEach } from 'vitest';

// The port's `db.upsert` resolves from a controllable queue and records payloads, so tests
// can assert exactly what would be written. Mocking the PORT rather than a driver client
// means these tests describe the service's contract, not PostgREST's builder shape — they
// stay valid across a backend swap. vi.hoisted so these exist before the mock factory runs.
const { upsertCalls, upsertQueue, refreshSession } = vi.hoisted(() => ({
  upsertCalls: [] as any[],
  upsertQueue: [] as Array<() => Promise<any>>,
  refreshSession: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  const errors = await import('../../data/ports/errors');
  return {
    db: {
      upsert: vi.fn((_table: string, payload: any) => {
        upsertCalls.push(payload);
        const next = upsertQueue.shift();
        return next ? next() : Promise.resolve();
      }),
    },
    auth: { refreshSession },
    isPermanent: errors.isPermanent,
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

// Stand-in for the real externalizer: swaps every base64 data URI for a storage URL.
vi.mock('./im-asset.service', () => ({
  externalizeFormDataImages: vi.fn(async (map: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(map).map(([k, v]) => [
        k,
        v.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, 'https://cdn.example/img.png'),
      ]),
    ),
  ),
}));

import { saveIMSection } from './im-section.service';
import { externalizeFormDataImages } from './im-asset.service';

const B64_IMG = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" />';

describe('saveIMSection', () => {
  beforeEach(() => {
    upsertCalls.length = 0;
    upsertQueue.length = 0;
    refreshSession.mockClear();
    vi.mocked(externalizeFormDataImages).mockClear();
  });

  it('externalizes base64 images from content and inline block refs before writing', async () => {
    const saved = await saveIMSection({
      id: 'sec-1',
      templateId: 'tmpl-1',
      title: 'T',
      order: 10,
      isPlaceholder: false,
      content: { en: `<p>hi</p>${B64_IMG}`, de: `<p>hallo</p>${B64_IMG}` },
      blockRefs: [
        { kind: 'inline', content: { en: `<p>ref</p>${B64_IMG}` } } as any,
        { kind: 'block', block_id: 'b-1' } as any,
      ],
    });

    expect(upsertCalls).toHaveLength(1);
    const written = JSON.stringify(upsertCalls[0]);
    expect(written).not.toContain('data:image');
    expect(written).toContain('https://cdn.example/img.png');
    // The returned section carries the externalized copies so the editor can
    // sync its state and never re-upload the same images.
    expect(saved.content.en).toContain('https://cdn.example/img.png');
    expect((saved.blockRefs?.[0] as any).content.en).toContain('https://cdn.example/img.png');
    // Every ref is backfilled with a stable id on save — project overrides key on it,
    // so template reordering can't re-point them.
    expect(saved.blockRefs?.[1]).toEqual(expect.objectContaining({ kind: 'block', block_id: 'b-1' }));
    expect((saved.blockRefs?.[0] as any).id).toMatch(/[0-9a-f-]{36}/);
    expect((saved.blockRefs?.[1] as any).id).toMatch(/[0-9a-f-]{36}/);
  });

  it('preserves an existing ref id instead of regenerating it', async () => {
    const saved = await saveIMSection({
      id: 'sec-ids',
      templateId: 'tmpl-1',
      title: 'T',
      order: 1,
      isPlaceholder: false,
      content: { en: '' },
      blockRefs: [{ kind: 'inline', id: 'keep-me', content: { en: '<p>x</p>' } } as any],
    });
    expect((saved.blockRefs?.[0] as any).id).toBe('keep-me');
  });

  it('leaves clean content untouched and skips block-ref externalization when nothing is inline-base64', async () => {
    const saved = await saveIMSection({
      id: 'sec-2',
      templateId: 'tmpl-1',
      title: 'T',
      order: 10,
      isPlaceholder: false,
      content: { en: '<p><img src="https://cdn.example/already.png"/></p>' },
      blockRefs: [{ kind: 'inline', content: { en: '<p>clean</p>' } } as any],
    });
    expect(saved.content.en).toContain('already.png');
    // Only the content map goes through the externalizer; clean block refs skip it.
    expect(vi.mocked(externalizeFormDataImages)).toHaveBeenCalledTimes(1);
  });

  it('retries a timed-out write via the shared pipeline and succeeds', async () => {
    upsertQueue.push(() => Promise.reject(new Error('Request timed out after 12s')));
    upsertQueue.push(() => Promise.resolve());
    const saved = await saveIMSection({ id: 'sec-3', templateId: 'tmpl-1', title: 'T', order: 1, isPlaceholder: false, content: { en: '<p>x</p>' } });
    expect(saved.id).toBe('sec-3');
    expect(upsertCalls).toHaveLength(2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('generates an id for new sections and returns it', async () => {
    const saved = await saveIMSection({ templateId: 'tmpl-1', title: 'New', order: 1, isPlaceholder: false, content: { en: '' } });
    expect(saved.id).toMatch(/[0-9a-f-]{36}/);
    expect(upsertCalls[0].id).toBe(saved.id);
  });
});
