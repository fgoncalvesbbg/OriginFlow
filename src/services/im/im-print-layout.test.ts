/**
 * Page-count layout decisions in the print builder.
 *
 * The A5 five-language booklet spent 12 of its 141 pages on furniture: a cover, five language
 * dividers, five tables of contents and a back page. These guard the two changes that reclaim
 * part of that.
 */
import { describe, it, expect } from 'vitest';
import { buildPrintPartsHtml, type PrintManual, type PrintHtmlOptions } from './im-print-html';

const manual = (language: string): PrintManual => ({
  language,
  metadata: { pageSize: 'a5', primaryColor: '#123456', companyName: 'Acme' },
  sections: [
    { id: 'A', title: 'Chapter A', parentId: null, order: 10, nodes: [{ type: 'html', id: 'n', html: '<p>Body</p>' }] },
  ],
});

const build = (languages: string[], extra: Partial<PrintHtmlOptions> = {}) =>
  buildPrintPartsHtml(languages.map(manual), {
    pageSize: 'a5',
    cover: { title: 'T' },
    back: {},
    ...extra,
  });

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('language divider', () => {
  it('is a band on the TOC page, not a page of its own', () => {
    const parts = build(['en', 'de', 'fr', 'it', 'es']);
    const all = parts.map((p) => p.html).join('');
    // The standalone divider page cost one sheet per language for three lines of text.
    expect(all).not.toContain('im-page-divider');
    expect(all).not.toContain('im-divider-title');
    expect(countOf(all, 'class="im-lang-band"')).toBe(5);
  });

  it('names the language and its code, so the band still does the divider\'s job', () => {
    const german = build(['en', 'de'])[2];
    expect(german.html).toContain('Deutsch');
    expect(german.html).toContain('>DE<');
  });

  it('is omitted for a single-language booklet, which needs no wayfinding', () => {
    const parts = build(['en']);
    expect(parts.map((p) => p.html).join('')).not.toContain('class="im-lang-band"');
  });

  it('keeps one part per language plus a shared cover and back page', () => {
    // 1 cover + 5 languages + 1 back. The band must not have changed the part count, since
    // merge maps parts to edge tabs and to each language's start page by index.
    expect(build(['en', 'de', 'fr', 'it', 'es'])).toHaveLength(7);
  });
});

describe('table of contents', () => {
  it('by default forces content onto a fresh page after the TOC', () => {
    const [, body] = build(['en', 'de']);
    expect(body.html).toContain('class="im-page im-break im-page-content"');
  });

  it('lets content continue on the TOC page when the flag is on', () => {
    const [, body] = build(['en', 'de'], { mergeTocIntoContent: true });
    expect(body.html).toContain('class="im-page im-page-content"');
    expect(body.html).not.toContain('class="im-page im-break im-page-content"');
    // The TOC itself still starts the language part.
    expect(body.html).toContain('im-page im-break im-page-toc');
  });
});
