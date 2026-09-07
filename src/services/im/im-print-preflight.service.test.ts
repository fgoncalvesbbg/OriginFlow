import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { collectManualImages, checkPrintImageWeights } from './im-print-preflight.service';
import type { ResolvedManual, ResolvedSection } from '../../types';

// ---------------------------------------------------------------------------
// Mocks for checkPrintImageWeights — getPublishedManualUrl builds the deterministic public
// URL, resolvePublishedUrl re-signs it (staff path). Mocking the im-publish.service module
// boundary (not the storage port beneath it) keeps these tests about THIS service's own
// missing-vs-unreachable distinction, not about how signing itself is implemented.
// ---------------------------------------------------------------------------
const { resolvePublishedUrlMock } = vi.hoisted(() => ({
  resolvePublishedUrlMock: vi.fn(),
}));

vi.mock('./im-publish.service', () => ({
  getPublishedManualUrl: (projectId: string, templateType: string, language: string) =>
    `https://x.test/storage/v1/object/public/im-published/${projectId}/${templateType}/${language}.json`,
  resolvePublishedUrl: resolvePublishedUrlMock,
}));

const manual = (sections: ResolvedSection[]): ResolvedManual => ({
  schemaVersion: 2, templateId: 't1', language: 'en',
  metadata: {} as ResolvedManual['metadata'],
  sections, searchIndex: [], warnings: [],
});

describe('collectManualImages', () => {
  it('collects <img> sources from html and callout nodes with their section titles', () => {
    const m = manual([{
      id: 's1', title: 'Setup', layout: 'standard' as never, parentId: null, order: 0,
      nodes: [
        { type: 'html', id: 'n1', html: '<p>See <img src="https://x.test/a.png" alt=""> here</p>', text: 'See here' },
        { type: 'callout', id: 'n2', variant: 'warning' as never, html: '<img class="w" src="https://x.test/b.jpg">', text: '' },
      ],
    }]);
    const out = collectManualImages(m);
    expect([...out.keys()].sort()).toEqual(['https://x.test/a.png', 'https://x.test/b.jpg']);
    expect([...out.get('https://x.test/a.png')!]).toEqual(['Setup']);
  });

  it('collects structured image URLs (annotated sets, step sequences) and merges duplicate usage', () => {
    const m = manual([
      {
        id: 's1', title: 'Parts', layout: 'standard' as never, parentId: null, order: 0,
        nodes: [{
          type: 'annotated_image_set', id: 'n1',
          images: [{ asset_id: 'a', url: 'https://x.test/parts.png', width: 100, height: 100, alt: {}, annotations: [] }],
        }],
      },
      {
        id: 's2', title: 'Assembly', layout: 'standard' as never, parentId: null, order: 1,
        nodes: [{
          type: 'step_sequence', id: 'n2',
          steps: [
            { text: 'Attach', image: { url: 'https://x.test/parts.png', width: 100, height: 100 } },
            { text: 'No image step' },
          ],
        }],
      },
    ]);
    const out = collectManualImages(m);
    expect(out.size).toBe(1);
    expect([...out.get('https://x.test/parts.png')!]).toEqual(['Parts', 'Assembly']);
  });

  it('skips data: URIs and relative paths (nothing fetchable to weigh)', () => {
    const m = manual([{
      id: 's1', title: 'S', layout: 'standard' as never, parentId: null, order: 0,
      nodes: [{ type: 'html', id: 'n1', html: '<img src="data:image/png;base64,AAAA"><img src="/local.png">', text: '' }],
    }]);
    expect(collectManualImages(m).size).toBe(0);
  });
});

describe('checkPrintImageWeights — missing vs unreachable', () => {
  const emptyManual = manual([]);

  beforeEach(() => {
    resolvePublishedUrlMock.mockReset();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('treats a language whose signed fetch 404s as simply not published (silently skipped)', async () => {
    resolvePublishedUrlMock.mockImplementation((url: string) => Promise.resolve(`${url}?signed=1`));
    (global.fetch as any).mockResolvedValue({ ok: false, status: 404 });

    const report = await checkPrintImageWeights('proj-1', 'im', ['en', 'de']);

    expect(report.unreachable).toEqual([]);
    expect(report.checked).toBe(0);
  });

  it('does NOT report a signed-URL minting failure as "missing" — it is surfaced separately as unreachable', async () => {
    resolvePublishedUrlMock.mockImplementation((url: string) =>
      url.includes('/de.json') ? Promise.reject(new Error('network error')) : Promise.resolve(`${url}?signed=1`));
    (global.fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve(emptyManual) });

    const report = await checkPrintImageWeights('proj-1', 'im', ['en', 'de']);

    expect(report.unreachable).toEqual(['DE']);
    // 'en' still resolved and was fetched normally — one failure must not affect siblings.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('never calls fetch for a language whose URL failed to sign', async () => {
    resolvePublishedUrlMock.mockRejectedValue(new Error('403 from im-file-url'));

    const report = await checkPrintImageWeights('proj-1', 'im', ['en']);

    expect(report.unreachable).toEqual(['EN']);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
