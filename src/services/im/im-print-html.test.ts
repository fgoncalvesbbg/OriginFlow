import { describe, it, expect } from 'vitest';
import {
  buildPrintHtml,
  buildPrintPartsHtml,
  buildCoverPartHtml,
  PrintManual,
  PrintHtmlOptions,
} from './im-print-html';
import { defaultTypographyFor } from './im-print-typography';
import { DEFAULT_IM_LOGO_URL, DEFAULT_LEAFLET_LOGO_URL } from '../../config/im.constants';
import { IM_LANGUAGES } from '../../config/im-languages';

// A manual whose section `order` is assigned per sibling-group (10/20 within each parent).
// Roots: A(10) with child A1(10); B(20) with child B1(10). Correct reading order is the
// per-parent DFS: A, A1, B, B1. A flat global sort by `order` would produce A(10), A1(10),
// B1(10), B(20) — interleaving B1 before its parent — which is the bug this guards against.
const manual: PrintManual = {
  language: 'en',
  metadata: { pageSize: 'a4', primaryColor: '#000', companyName: 'Acme' },
  sections: [
    { id: 'A', title: 'Chapter A', parentId: null, order: 10, nodes: [{ type: 'html', id: 'nA', html: '<p>A body</p>' }] },
    { id: 'A1', title: 'A sub', parentId: 'A', order: 10, nodes: [{ type: 'html', id: 'nA1', html: '<p>A1 body</p>' }] },
    { id: 'B', title: 'Chapter B', parentId: null, order: 20, nodes: [{ type: 'html', id: 'nB', html: '<p>B body</p>' }] },
    { id: 'B1', title: 'B sub', parentId: 'B', order: 10, nodes: [{ type: 'html', id: 'nB1', html: '<p>B1 body</p>' }] },
  ],
};

const opts: PrintHtmlOptions = { pageSize: 'a4', cover: { title: 'T' }, back: {} };

describe('buildPrintHtml — section ordering + pagination', () => {
  it('emits sections in per-parent DFS reading order (not a flat global sort)', () => {
    const html = buildPrintHtml([manual], opts);
    const order = ['A', 'A1', 'B', 'B1'].map((id) => html.indexOf(`id="sec-${id}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    // Strictly increasing → A, A1, B, B1.
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Specifically: the sub of B must come AFTER chapter B (the old global sort put B1 before B).
    expect(html.indexOf('id="sec-B"')).toBeLessThan(html.indexOf('id="sec-B1"'));
  });

  it('the TOC lists sections in the same DFS order', () => {
    const html = buildPrintHtml([manual], opts);
    const toc = html.slice(html.indexOf('class="im-toc"'));
    const order = ['A', 'A1', 'B', 'B1'].map((id) => toc.indexOf(`href="#sec-${id}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('flows sections continuously — no forced page break per section', () => {
    const html = buildPrintHtml([manual], opts);
    // Individual sections are plain flowing blocks…
    expect(html).toContain('<section id="sec-A" class="im-section">');
    // …and none of them carries the page-break class.
    expect(html).not.toContain('class="im-page im-break im-page-content"><section');
    expect(/id="sec-\w+" class="im-page im-break/.test(html)).toBe(false);
    // Exactly one content page container wraps the whole (single-language) flow.
    const contentPages = html.match(/class="im-page im-break im-page-content"/g) ?? [];
    expect(contentPages).toHaveLength(1);
  });

  it('the TOC heading is translated into the manual\'s language, not hardcoded English', () => {
    const de: PrintManual = { ...manual, language: 'de' };
    const html = buildPrintHtml([de], opts);
    expect(html).toContain('<h2 class="im-toc-title">Inhalt</h2>');
    expect(html).not.toContain('<h2 class="im-toc-title">Contents</h2>');
  });

  it('falls back to the English "Contents" heading for an unmapped language', () => {
    const xx: PrintManual = { ...manual, language: 'xx' };
    const html = buildPrintHtml([xx], opts);
    expect(html).toContain('<h2 class="im-toc-title">Contents</h2>');
  });
});

describe('buildPrintPartsHtml — Warning Leaflet compact layout', () => {
  const de: PrintManual = { ...manual, language: 'de' };

  it('compact: one part per language — no cover / TOC / divider / back parts', () => {
    const parts = buildPrintPartsHtml([manual, de], { ...opts, compact: true });
    // Exactly one part per language (no separate cover or back parts).
    expect(parts).toHaveLength(2);
    const all = parts.map((p) => p.html).join('\n');
    // Assert on the actual page ELEMENT markup (the class names also appear in the shared CSS).
    expect(all).not.toContain('class="im-page im-page-cover"');
    expect(all).not.toContain('im-page im-break im-page-toc');
    expect(all).not.toContain('im-page im-break im-page-divider');
    expect(all).not.toContain('im-page im-break im-page-end');
  });

  it('compact: each language part starts with the logo header and carries its edge tab', () => {
    const parts = buildPrintPartsHtml([manual, de], { ...opts, compact: true });
    parts.forEach((p, i) => {
      expect(p.html).toContain('im-leaflet-header');
      expect(p.html).toContain('im-leaflet-logo');
      // Multi-language → every language body gets a tab with the correct index/code.
      expect(p.tab).toEqual({ index: i, total: 2, code: i === 0 ? 'en' : 'de' });
    });
  });

  it('compact: single language has no edge tab (matches the main manual)', () => {
    const [part] = buildPrintPartsHtml([manual], { ...opts, compact: true });
    expect(part.tab).toBeNull();
    expect(part.html).toContain('im-leaflet-header');
  });

  it('compact: the content block does NOT force a page break (header stays with content)', () => {
    const [part] = buildPrintPartsHtml([manual], { ...opts, compact: true });
    // The compact stylesheet neutralizes the forced break on the content container.
    expect(part.html).toContain('break-before: auto');
  });

  it('compact: the global typography profile is applied to all text + all headings', () => {
    const [part] = buildPrintPartsHtml([manual], {
      ...opts,
      compact: true,
      typography: { ...defaultTypographyFor('warning_leaflet', 'a4'), bodyPt: 8, headingPt: 11, lineHeight: 1.45 },
    });
    // Universal body-text rule and the heading rule carry the configured pt sizes,
    // and the line spacing is the configured one (not the old hardcoded 1.3).
    expect(part.html).toContain('.im-page-content * { font-size: 8pt; line-height: 1.45;');
    expect(part.html).toContain('font-size: 11pt');
  });

  it('compact: falls back to the leaflet default profile when no typography is passed', () => {
    const [part] = buildPrintPartsHtml([manual], { ...opts, compact: true });
    const leaflet = defaultTypographyFor('warning_leaflet', 'a4');
    expect(part.html).toContain(`font-size: ${leaflet.bodyPt}pt`);
    expect(part.html).toContain(`font-size: ${leaflet.headingPt}pt`);
  });

  it('non-compact ignores the manual metadata font family — typography is global', () => {
    // Regression guard for the reason this setting exists: the font used to come from the
    // template's metadata, and a template belongs to a product category, so the same
    // booklet program printed in a different font per category.
    const branded: PrintManual = { ...manual, metadata: { ...manual.metadata, fontFamily: 'Montserrat' } };
    const html = buildPrintHtml([branded], {
      ...opts,
      typography: { ...defaultTypographyFor('im', 'a4'), fontFamily: 'Lato' },
    });
    expect(html).toContain('Lato');
    expect(html).not.toContain('Montserrat');
  });

  it('non-compact: body, heading and line spacing come from the profile', () => {
    const html = buildPrintHtml([manual], {
      ...opts,
      typography: { ...defaultTypographyFor('im', 'a4'), bodyPt: 12, headingPt: 20, lineHeight: 1.8 },
    });
    expect(html).toContain('.im-section-content { font-size: 12pt; line-height: 1.8;');
    expect(html).toContain('font-size: 20pt');
  });

  it('regression: non-compact still emits cover + TOC + back parts', () => {
    const parts = buildPrintPartsHtml([manual, de], opts);
    // [cover, lang0, lang1, back]
    expect(parts).toHaveLength(4);
    const all = parts.map((p) => p.html).join('\n');
    expect(all).toContain('class="im-page im-page-cover"');
    expect(all).toContain('im-page im-break im-page-toc');
    expect(all).toContain('im-page im-break im-page-end');
    expect(all).not.toContain('im-leaflet-header');
  });
});

describe('default logo fallback — normalized-empty companyLogoUrl', () => {
  // normalizeIMTemplateMetadata stores a missing companyLogoUrl as '' (not undefined),
  // so published manifests carry the empty string. The default logo must still apply.
  const normalized: PrintManual = {
    ...manual,
    metadata: { ...manual.metadata, companyLogoUrl: '' },
  };

  it('compact leaflet: header falls back to the standard leaflet logo', () => {
    const [part] = buildPrintPartsHtml([normalized], { ...opts, compact: true });
    expect(part.html).toContain(DEFAULT_LEAFLET_LOGO_URL);
    expect(part.html).toContain('im-leaflet-logo');
  });

  it('full manual: cover falls back to the standard IM logo', () => {
    const html = buildPrintHtml([normalized], opts);
    expect(html).toContain(DEFAULT_IM_LOGO_URL);
  });

  it('an explicit cover logo still wins over both defaults', () => {
    const [part] = buildPrintPartsHtml([normalized], {
      ...opts,
      compact: true,
      cover: { title: 'T', logoUrl: 'https://example.com/custom.png' },
    });
    expect(part.html).toContain('https://example.com/custom.png');
    expect(part.html).not.toContain(DEFAULT_LEAFLET_LOGO_URL);
  });
});

describe('cover language directory — every supported language has a translated name', () => {
  // Regression guard: INSTRUCTION_MANUAL_NAMES (im-print-html.ts) is a hand-maintained
  // map keyed by language code; a language present in IM_LANGUAGES but missing from that
  // map silently falls back to the bare code (e.g. "BG" instead of a translated phrase) —
  // exactly the bug a real cover PDF shipped with. This drives every canonical language
  // through the actual directory-row builder and fails if ANY of them still falls back.
  it('never falls back to the bare code for any IM_LANGUAGES entry', () => {
    const manuals: PrintManual[] = IM_LANGUAGES.map((l) => ({ ...manual, language: l.code }));
    const html = buildCoverPartHtml(manuals, opts, manuals.map(() => null));
    const rows = [...html.matchAll(/im-cix-code">([^<]*)<\/span><span class="im-cix-name">([^<]*)</g)]
      .map((m) => ({ code: m[1], name: m[2] }));
    expect(rows).toHaveLength(IM_LANGUAGES.length);
    for (const { code, name } of rows) {
      expect(name).not.toBe(code);
    }
  });
});

// The global print settings (Admin → IM Print) were seeded from the values this builder used
// to hardcode, so applying the feature must not change a single existing booklet. These pin
// the built-in defaults to the exact CSS the old mm-based rules produced — if a default is
// ever "tidied up", this is what catches the silently re-flowed back catalogue.
describe('built-in typography defaults reproduce the previous hardcoded output', () => {
  const styles = (pageSize: 'a4' | 'a5', compact: boolean) => {
    const parts = buildPrintPartsHtml([manual], { ...opts, pageSize, compact });
    return parts[compact ? 0 : 1].html;
  };

  it('A4 full manual: body 3.8mm → 10.77pt, section title 6.2mm → 17.58pt', () => {
    const html = styles('a4', false);
    expect(html).toContain('.im-section-content { font-size: 10.77pt; line-height: 1.6;');
    expect(html).toContain('font-size: 17.58pt;');
    expect(html).toContain('.im-section-content h1 { font-size: 15.59pt; }');
    // Cover/divider fill height is now derived from the margins; 297 − 16 − 18 − 8 = the
    // 255mm that used to be a literal in PAGE_DIMS.
    expect(html).toContain('.im-page-cover { min-height: 255mm;');
    expect(html).toContain('font-family: Inter, Arial, sans-serif');
  });

  it('A5 full manual: the old 0.82 type scale, and the old 168mm fill height', () => {
    const html = styles('a5', false);
    expect(html).toContain('.im-section-content { font-size: 8.83pt;');
    expect(html).toContain('font-size: 14.41pt;');
    expect(html).toContain('.im-page-cover { min-height: 168mm;');
  });

  it('leaflet: the old 6pt / 8pt / 1.3 compact setting', () => {
    const html = styles('a5', true);
    expect(html).toContain('.im-page-content, .im-page-content * { font-size: 6pt; line-height: 1.3; }');
    expect(html).toContain('font-size: 8pt;');
  });
});
