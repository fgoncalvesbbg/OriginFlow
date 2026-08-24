/**
 * Font embedding for the print pipeline.
 *
 * Guards the two defects these modules were written to fix:
 *  - the print stylesheet pulled Inter from fonts.googleapis.com while PDFShift was given no
 *    wait_for/delay, so a lost fetch rendered a whole language part in the Arial fallback
 *    (LiberationSans on Linux) and the booklet shipped in two typefaces; and
 *  - the pdf-lib stamp layer used StandardFonts.Helvetica, a base-14 font that is never
 *    embedded, and filtered every glyph outside WinAnsi so Greek and Bulgarian footers
 *    silently lost their text.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import { buildPrintPartsHtml, type PrintManual, type PrintHtmlOptions } from './im-print-html';
import { interSubsetsForText, interFontFaceCss } from './fonts/inter-webfont';
import { embedStampFonts } from '../../../netlify/functions/lib/fonts/inter-stamp';

const manualWith = (language: string, body: string): PrintManual => ({
  language,
  metadata: { pageSize: 'a5', primaryColor: '#000', companyName: 'Acme' },
  sections: [
    { id: 'A', title: 'Chapter A', parentId: null, order: 10, nodes: [{ type: 'html', id: 'n', html: `<p>${body}</p>` }] },
  ],
});

const opts: PrintHtmlOptions = { pageSize: 'a5', cover: { title: 'T' }, back: {} };
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('inlined Inter webfont', () => {
  it('inlines Inter as @font-face data URIs and makes no Google Fonts request', () => {
    const parts = buildPrintPartsHtml([manualWith('en', 'Instructions')], opts);
    for (const part of parts) {
      expect(part.html).toContain('@font-face');
      expect(part.html).toContain('data:font/woff2;base64,');
      expect(part.html).not.toContain('fonts.googleapis.com');
    }
  });

  it('emits the 400/600/700 faces the stylesheet actually uses', () => {
    const css = interFontFaceCss('Instructions');
    for (const weight of [400, 600, 700]) expect(css).toContain(`font-weight: ${weight};`);
  });

  it('inlines only the subsets the document needs', () => {
    const latin = interSubsetsForText('Bedienungsanleitung Größe café niño').map((s) => s.subset);
    expect(latin).toEqual(['latin']);

    // Each non-Latin subset is additive: Inter's greek/cyrillic subsets do not declare ASCII,
    // so the Latin face has to come along for digits, spaces and the " · " separator.
    expect(interSubsetsForText('Οδηγίες χρήσης').map((s) => s.subset)).toEqual(['latin', 'greek']);
    expect(interSubsetsForText('Ръководство').map((s) => s.subset)).toEqual(['latin', 'cyrillic']);
    expect(interSubsetsForText('Instrukcja obsługi łóżko').map((s) => s.subset)).toEqual(['latin', 'latin-ext']);
  });

  it('does not carry the Greek and Cyrillic faces in a Latin-only booklet', () => {
    const [, body] = buildPrintPartsHtml([manualWith('de', 'Größe')], opts);
    // 3 weights x 1 subset.
    expect(countOf(body.html, '@font-face')).toBe(3);
  });

  it('grows the payload only when a non-Latin language is present', () => {
    const [, greek] = buildPrintPartsHtml([manualWith('el', 'Οδηγίες χρήσης')], opts);
    expect(countOf(greek.html, '@font-face')).toBe(6); // 3 weights x (latin + greek)
  });
});

describe('embedded Inter stamp fonts', () => {
  const stampedFontNames = (raw: string) =>
    [...raw.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/g)].map((m) => m[1]);

  const render = async (text: string) => {
    const doc = await PDFDocument.create();
    const fonts = await embedStampFonts(doc, [text]);
    const page = doc.addPage([420, 595]);
    fonts.drawText(page, text, { x: 40, y: 40, size: 8, color: rgb(0.39, 0.45, 0.55) });
    const raw = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
    return { fonts, raw };
  };

  it('embeds a real font program instead of referencing base-14 Helvetica', async () => {
    const { raw } = await render('MDA26003 Bedienungsanleitung · 7 / 141');
    expect(raw).toContain('/FontFile2');
    expect(stampedFontNames(raw).some((n) => n.includes('Helvetica'))).toBe(false);
    expect(stampedFontNames(raw).some((n) => n.includes('Inter'))).toBe(true);
  });

  it('stamps Greek and Cyrillic without dropping glyphs', async () => {
    for (const text of ['Οδηγίες χρήσης · 7 / 141', 'Ръководство за употреба · 7 / 141']) {
      const { fonts, raw } = await render(text);
      expect(fonts.unsupported(text)).toEqual([]);
      expect(fonts.widthOfText(text, 8)).toBeGreaterThan(0);
      // The script's own face plus the Latin face for the separator and page numbers.
      expect(countOf(raw, '/FontFile2')).toBe(2);
    }
  });

  it('reports characters no subset covers rather than silently dropping them', async () => {
    const text = 'Größe 取扱説明書';
    const { fonts } = await render(text);
    expect(fonts.unsupported(text)).toEqual(['取', '扱', '説', '明', '書']);
  });
});
