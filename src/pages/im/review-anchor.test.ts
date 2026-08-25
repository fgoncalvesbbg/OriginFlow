import { describe, it, expect } from 'vitest';
import {
  buildReviewAnchor,
  markQuoteInHtml,
  normalizeQuote,
  REVIEW_HIT_CLASS,
  QUOTE_CONTEXT_CHARS,
  MAX_QUOTE_CHARS,
} from './review-anchor';

const MARK = `<mark class="${REVIEW_HIT_CLASS}">`;

describe('normalizeQuote', () => {
  it('collapses every kind of whitespace run to a single space', () => {
    expect(normalizeQuote('do  not\n\timmerse')).toBe('do not immerse');
  });

  it('treats a non-breaking space as whitespace, because contenteditable emits them constantly', () => {
    expect(normalizeQuote('do not immerse')).toBe('do not immerse');
  });

  it('trims the ends', () => {
    expect(normalizeQuote('  warning  ')).toBe('warning');
  });
});

describe('buildReviewAnchor', () => {
  const chapter = 'Before cleaning the appliance, do not immerse the base in water. Dry it fully.';

  it('stores the quote whitespace-normalized, not verbatim', () => {
    // The viewer wraps lines differently than the editor, so a verbatim quote carrying the
    // viewer's newlines would never match the editor's HTML again.
    const anchor = buildReviewAnchor({
      sectionId: 'sec-1',
      sectionText: chapter,
      quote: 'do not\n  immerse',
    });
    expect(anchor?.quote).toBe('do not immerse');
  });

  it('slices context either side of the quote so it can be relocated after an edit', () => {
    const anchor = buildReviewAnchor({
      sectionId: 'sec-1',
      sectionTitle: 'Safety',
      sectionText: chapter,
      quote: 'do not immerse',
    });
    expect(anchor?.quoteBefore).toBe('Before cleaning the appliance, ');
    expect(anchor?.quoteAfter).toBe(' the base in water. Dry it fully.');
    expect(anchor?.sectionTitle).toBe('Safety');
  });

  it('caps the context at QUOTE_CONTEXT_CHARS on each side', () => {
    const long = `${'a'.repeat(200)} TARGET ${'b'.repeat(200)}`;
    const anchor = buildReviewAnchor({ sectionId: 's', sectionText: long, quote: 'TARGET' });
    expect(anchor?.quoteBefore).toHaveLength(QUOTE_CONTEXT_CHARS);
    expect(anchor?.quoteAfter).toHaveLength(QUOTE_CONTEXT_CHARS);
  });

  it('still anchors when the quote is not found in the chapter text — context is a hint, not evidence', () => {
    const anchor = buildReviewAnchor({ sectionId: 's', sectionText: chapter, quote: 'nowhere' });
    expect(anchor?.quote).toBe('nowhere');
    expect(anchor?.quoteBefore).toBe('');
    expect(anchor?.quoteAfter).toBe('');
  });

  it('works with no chapter text at all', () => {
    expect(buildReviewAnchor({ sectionId: 's', quote: 'hi' })?.quote).toBe('hi');
  });

  it('returns null for an empty or whitespace-only selection', () => {
    // Routine, not an error: a stray click collapses the selection.
    expect(buildReviewAnchor({ sectionId: 's', quote: '' })).toBeNull();
    expect(buildReviewAnchor({ sectionId: 's', quote: '   \n ' })).toBeNull();
  });

  it('returns null without a chapter id', () => {
    expect(buildReviewAnchor({ sectionId: '  ', quote: 'text' })).toBeNull();
  });

  it('truncates a selection past the server-side cap rather than letting the RPC reject it', () => {
    const anchor = buildReviewAnchor({ sectionId: 's', quote: 'x'.repeat(MAX_QUOTE_CHARS + 500) });
    expect(anchor?.quote).toHaveLength(MAX_QUOTE_CHARS);
  });

  it('normalizes a blank title to null so the panel falls back to the live chapter name', () => {
    expect(buildReviewAnchor({ sectionId: 's', sectionTitle: '   ', quote: 'q' })?.sectionTitle).toBeNull();
  });
});

describe('markQuoteInHtml', () => {
  it('wraps a plain match', () => {
    expect(markQuoteInHtml('<p>Do not immerse the base.</p>', 'not immerse'))
      .toBe(`<p>Do ${MARK}not immerse${'</mark>'} the base.</p>`);
  });

  it('matches across inline markup and wraps piecewise so the HTML stays well-formed', () => {
    // A single <mark> pair spanning the <strong> would parse as f<mark>oo<b>bar</mark></b>,
    // which every parser re-nests into something wrong.
    const out = markQuoteInHtml('<p>do <strong>not</strong> immerse</p>', 'do not immerse');
    expect(out).toBe(
      `<p>${MARK}do </mark><strong>${MARK}not</mark></strong>${MARK} immerse</mark></p>`,
    );
    // Well-formed: every open tag closes in order.
    expect((out.match(/<mark/g) || []).length).toBe((out.match(/<\/mark>/g) || []).length);
  });

  it('matches through a non-breaking space', () => {
    const out = markQuoteInHtml('<p>do&nbsp;not immerse</p>', 'do not immerse');
    expect(out).toContain(MARK);
    // The entity itself is preserved inside the highlight, not rewritten to a plain space.
    expect(out).toContain('&nbsp;');
  });

  it('matches when the source HTML wraps lines mid-sentence', () => {
    expect(markQuoteInHtml('<p>do not\n   immerse</p>', 'do not immerse')).toContain(MARK);
  });

  it('never matches inside a tag name or an attribute value', () => {
    // Quoting the word "manual" must not highlight the href.
    const html = '<p><a href="/manual/base">Read the guide</a></p>';
    expect(markQuoteInHtml(html, 'manual')).toBe(html);
  });

  it('decodes entities so a quoted ampersand matches', () => {
    expect(markQuoteInHtml('<p>Salt &amp; Pepper</p>', 'Salt & Pepper')).toContain(MARK);
  });

  it('falls back to a case-insensitive match', () => {
    expect(markQuoteInHtml('<p>WARNING: hot surface</p>', 'warning: hot')).toContain(MARK);
  });

  it('highlights only the first occurrence', () => {
    const out = markQuoteInHtml('<p>hot</p><p>hot</p>', 'hot');
    expect((out.match(/<mark/g) || []).length).toBe(1);
  });

  it('returns the html untouched when the wording has since been edited away', () => {
    // A stale comment shows no highlight; the PM still lands on the right chapter.
    const html = '<p>Do not submerge the base.</p>';
    expect(markQuoteInHtml(html, 'do not immerse')).toBe(html);
  });

  it('returns the html untouched for an empty, null or undefined quote', () => {
    const html = '<p>anything</p>';
    expect(markQuoteInHtml(html, '')).toBe(html);
    expect(markQuoteInHtml(html, null)).toBe(html);
    expect(markQuoteInHtml(html, undefined)).toBe(html);
  });

  it('returns empty html untouched', () => {
    expect(markQuoteInHtml('', 'anything')).toBe('');
  });

  it('handles markup-only html without throwing', () => {
    expect(markQuoteInHtml('<hr /><br />', 'x')).toBe('<hr /><br />');
  });

  it('recovers from an unterminated tag instead of dropping the rest of the fragment', () => {
    expect(markQuoteInHtml('<p>keep this < and this</p>', 'keep this')).toContain(MARK);
  });

  it('matches a quote sitting inside a table cell', () => {
    const out = markQuoteInHtml('<table><tr><td>Max load</td><td>5 kg</td></tr></table>', '5 kg');
    expect(out).toContain(`${MARK}5 kg</mark>`);
  });
});
