import { describe, it, expect } from 'vitest';
import { collectManualImages } from './im-print-preflight.service';
import type { ResolvedManual, ResolvedSection } from '../../types';

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
