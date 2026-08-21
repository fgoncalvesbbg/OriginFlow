import { describe, it, expect } from 'vitest';
import { normalizeResolverData, findVerbatimViolations, getProjectRequiredLanguages } from './im-publish.service';
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

// getProjectRequiredLanguages decides which languages publish, print export and the
// staleness check all produce. The category/blank split is the load-bearing part: a
// category-template project may only narrow its template's list (its section content
// exists in no other language), while a project on the shared BLANK template authors
// every fragment itself and therefore owns its own language set.
describe('getProjectRequiredLanguages', () => {
  const categoryTemplate = (languages: string[]) =>
    ({ id: 't1', categoryId: 'cat-1', templateType: 'im', name: 'T', languages, isFinalized: false }) as any;
  const blankTemplate = (languages: string[] = ['en']) =>
    ({ id: 't0', categoryId: null, templateType: 'im', name: 'Blank Standardized Template', languages, isFinalized: false }) as any;

  it('defaults to every template language, in template order', () => {
    expect(getProjectRequiredLanguages(categoryTemplate(['en', 'de', 'fr']), {})).toEqual(['en', 'de', 'fr']);
  });

  it('narrows a category-template project to the stored subset, English implicit', () => {
    const out = getProjectRequiredLanguages(categoryTemplate(['en', 'de', 'fr', 'it']), {
      __required_languages: JSON.stringify(['de', 'it']),
    });
    expect(out).toEqual(['en', 'de', 'it']);
  });

  it('refuses a language the category template does not have', () => {
    // 'pl' has no template content; publishing it would emit English prose under a
    // Polish label. It must be added to the category template first.
    const out = getProjectRequiredLanguages(categoryTemplate(['en', 'de']), {
      __required_languages: JSON.stringify(['de', 'pl']),
    });
    expect(out).toEqual(['en', 'de']);
  });

  it('lets a blank-template project pick languages the template never listed', () => {
    // The regression this exists for: the shared blank template ships languages:['en'],
    // which used to clip a project-based import back to English alone.
    const out = getProjectRequiredLanguages(blankTemplate(), {
      __required_languages: JSON.stringify(['de', 'fr']),
    });
    // Canonical IM_LANGUAGES order (English first, then alphabetical by English name),
    // not the order they were stored in — that is what __language_order is for.
    expect(out).toEqual(['en', 'fr', 'de']);
  });

  it('drops codes outside the canonical language list', () => {
    // A code with no IM_LANGUAGES entry has no print header and would publish unlabelled.
    const out = getProjectRequiredLanguages(blankTemplate(), {
      __required_languages: JSON.stringify(['de', 'klingon']),
    });
    expect(out).toEqual(['en', 'de']);
  });

  it('applies the stored custom order to a blank-template selection', () => {
    const out = getProjectRequiredLanguages(blankTemplate(), {
      __required_languages: JSON.stringify(['de', 'fr', 'it']),
      __language_order: JSON.stringify(['de', 'en', 'fr']),
    });
    // Custom order first, remaining enabled languages appended ("then others").
    expect(out).toEqual(['de', 'en', 'fr', 'it']);
  });

  it('falls back to all template languages on unparseable stored values', () => {
    expect(getProjectRequiredLanguages(categoryTemplate(['en', 'de']), { __required_languages: '{oops' }))
      .toEqual(['en', 'de']);
  });
});
