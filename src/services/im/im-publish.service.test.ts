import { describe, it, expect } from 'vitest';
import { normalizeResolverData } from './im-publish.service';

// normalizeResolverData bridges the generator's persisted key shape (secvis_<sectionId>,
// cond_<featureId>) to the bare keys the resolver reads. This is what makes the published
// JSON honor manual visibility / condition toggles, so it's worth pinning down.
describe('normalizeResolverData', () => {
  it('expands secvis_ keys to bare section ids while preserving the originals', () => {
    const out = normalizeResolverData({ 'secvis_sec-1': 'false' });
    expect(out['sec-1']).toBe('false');
    expect(out['secvis_sec-1']).toBe('false');
  });

  it('expands cond_ keys to bare feature ids', () => {
    const out = normalizeResolverData({ 'cond_attr-9': 'true' });
    expect(out['attr-9']).toBe('true');
    expect(out['cond_attr-9']).toBe('true');
  });

  it('expands refvis_ keys to bare `<sectionId>:<index>` ref keys', () => {
    const out = normalizeResolverData({ 'refvis_sec-1:2': 'false' });
    expect(out['sec-1:2']).toBe('false');
    expect(out['refvis_sec-1:2']).toBe('false');
  });

  it('leaves unprefixed attribute values untouched', () => {
    const out = normalizeResolverData({ 'attr-model': 'XL-9000' });
    expect(out).toEqual({ 'attr-model': 'XL-9000' });
  });

  it('does not mutate the input object', () => {
    const input = { 'secvis_sec-1': 'true' };
    normalizeResolverData(input);
    expect(input).toEqual({ 'secvis_sec-1': 'true' });
  });
});
