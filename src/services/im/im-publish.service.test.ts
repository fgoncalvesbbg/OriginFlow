import { describe, it, expect } from 'vitest';
import { normalizeResolverData, findVerbatimViolations } from './im-publish.service';
import type { ResolvedManual, TranslationVerbatim } from '../../types';

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

// findVerbatimViolations is the publish-time guard that legally-mandated wording
// present in the EN output still appears (as its approved translation) in every
// other published language.
describe('findVerbatimViolations', () => {
  const manualWith = (language: string, text: string): { language: string; resolved: ResolvedManual } => ({
    language,
    resolved: {
      schemaVersion: 2, templateId: 't1', language,
      metadata: {} as ResolvedManual['metadata'],
      sections: [{
        id: 's1', title: 'Safety', layout: 'standard' as never, parentId: null, order: 0,
        nodes: [{ type: 'html', id: 'n1', html: `<p>${text}</p>`, text }],
      }],
      searchIndex: [], warnings: [],
    },
  });
  const verbatim = (phrase: string, translations: Record<string, string> = {}): TranslationVerbatim => ({
    id: 'v1', phrase, translations, createdAt: '', updatedAt: '',
  });

  it('passes when every language carries its approved wording', () => {
    const out = findVerbatimViolations(
      [manualWith('en', 'Keep out of reach of children.'), manualWith('de', 'Von Kindern fernhalten.')],
      [verbatim('Keep out of reach of children.', { de: 'Von Kindern fernhalten.' })],
    );
    expect(out).toEqual([]);
  });

  it('flags a language whose approved wording is missing or altered', () => {
    const out = findVerbatimViolations(
      [manualWith('en', 'Keep out of reach of children.'), manualWith('de', 'Bitte von Kindern weghalten.')],
      [verbatim('Keep out of reach of children.', { de: 'Von Kindern fernhalten.' })],
    );
    expect(out).toEqual([{ phrase: 'Keep out of reach of children.', languages: ['DE'] }]);
  });

  it('ignores verbatims not present in the English output', () => {
    const out = findVerbatimViolations(
      [manualWith('en', 'Nothing relevant here.'), manualWith('de', 'Nichts.')],
      [verbatim('Keep out of reach of children.', { de: 'Von Kindern fernhalten.' })],
    );
    expect(out).toEqual([]);
  });

  it('expects the SOURCE phrase in other languages when no translation is stored (identifier case)', () => {
    const good = findVerbatimViolations(
      [manualWith('en', 'Complies with (EU) 2019/2016.'), manualWith('fr', 'Conforme à (EU) 2019/2016.')],
      [verbatim('(EU) 2019/2016')],
    );
    expect(good).toEqual([]);
    const bad = findVerbatimViolations(
      [manualWith('en', 'Complies with (EU) 2019/2016.'), manualWith('fr', 'Conforme à (UE) 2019/2016.')],
      [verbatim('(EU) 2019/2016')],
    );
    expect(bad).toEqual([{ phrase: '(EU) 2019/2016', languages: ['FR'] }]);
  });

  it('matches whitespace-insensitively but case-sensitively', () => {
    const spaced = findVerbatimViolations(
      [manualWith('en', 'Keep  out of reach of children.'), manualWith('de', 'Von  Kindern fernhalten.')],
      [verbatim('Keep out of reach of children.', { de: 'Von Kindern fernhalten.' })],
    );
    expect(spaced).toEqual([]);
    const cased = findVerbatimViolations(
      [manualWith('en', 'Keep out of reach of children.'), manualWith('de', 'von kindern fernhalten.')],
      [verbatim('Keep out of reach of children.', { de: 'Von Kindern fernhalten.' })],
    );
    expect(cased).toEqual([{ phrase: 'Keep out of reach of children.', languages: ['DE'] }]);
  });

  it('returns nothing without an English manual to anchor on', () => {
    const out = findVerbatimViolations(
      [manualWith('de', 'Irgendwas.')],
      [verbatim('Keep out of reach of children.', { de: 'Von Kindern fernhalten.' })],
    );
    expect(out).toEqual([]);
  });
});
