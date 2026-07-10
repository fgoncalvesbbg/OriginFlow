import { describe, it, expect, vi, beforeEach } from 'vitest';

// Terminal `.upsert()` resolves from a controllable queue and records payloads,
// so tests can assert exactly what would be written. vi.hoisted so these exist
// before the hoisted vi.mock factories run.
const { upsertCalls, upsertQueue, refreshSession } = vi.hoisted(() => ({
  upsertCalls: [] as any[],
  upsertQueue: [] as Array<() => Promise<any>>,
  refreshSession: vi.fn(() => Promise.resolve({ data: {}, error: null })),
}));

vi.mock('../core/supabase.client', () => {
  const builder: any = {};
  builder.from = vi.fn(() => builder);
  builder.upsert = vi.fn((payload: any) => {
    upsertCalls.push(payload);
    const next = upsertQueue.shift();
    return next ? next() : Promise.resolve({ data: null, error: null });
  });
  return { supabase: { ...builder, auth: { refreshSession } } };
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
    expect(saved.blockRefs?.[1]).toEqual({ kind: 'block', block_id: 'b-1' });
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
    upsertQueue.push(() => Promise.resolve({ data: null, error: null }));
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
