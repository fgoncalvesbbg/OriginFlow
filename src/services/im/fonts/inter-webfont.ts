/**
 * Inlined-Inter @font-face CSS for the print stylesheet.
 *
 * Replaces the fonts.googleapis.com @import that used to sit at the top of the print
 * stylesheet. PDFShift is called with no wait_for/delay, so that @import was a race run
 * independently for every part; when one part lost it, that entire language rendered in the
 * `Arial` fallback (LiberationSans on Linux) and the booklet shipped in two typefaces from a
 * part boundary onward. A data: URI has nothing to lose.
 *
 * Only the subsets a document actually uses are emitted, so a Latin-only booklet does not
 * carry the Greek and Cyrillic faces. Selection is driven by the document's own codepoints
 * rather than a language -> script table, because a stale table fails the same silent way
 * the webfont did.
 */
import { INTER_WEBFONT_SUBSETS, type InterWebfontSubset } from './inter-webfont.generated';

/**
 * Always emitted. It carries ASCII plus the Western European accents, and every other
 * subset is narrower — so it is also the face that covers the separators (" · ", "/")
 * appearing in text whose letters come from Greek or Cyrillic.
 */
const BASE_SUBSET = 'latin';

const inRanges = (ranges: readonly (readonly [number, number])[], cp: number): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

/** Distinct non-ASCII codepoints in `text`. ASCII is skipped — BASE_SUBSET always covers it. */
const nonAsciiCodepoints = (text: string): Set<number> => {
  const out = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp >= 0x80) out.add(cp);
  }
  return out;
};

/** The subsets needed to render `text`, in the generated (widest-first) order. */
export const interSubsetsForText = (text: string): readonly InterWebfontSubset[] => {
  const needed = new Set<string>([BASE_SUBSET]);
  const codepoints = nonAsciiCodepoints(text);
  for (const subset of INTER_WEBFONT_SUBSETS) {
    if (subset.subset === BASE_SUBSET) continue;
    for (const cp of codepoints) {
      if (inRanges(subset.ranges, cp)) { needed.add(subset.subset); break; }
    }
  }
  return INTER_WEBFONT_SUBSETS.filter((s) => needed.has(s.subset));
};

/**
 * @font-face blocks for every subset `text` needs, as data: URIs.
 *
 * `font-display: block` rather than swap: there is no network fetch to wait on, and a
 * flash of fallback text is a wrong-typeface page in a PDF, not a transient.
 */
export const interFontFaceCss = (text: string): string =>
  interSubsetsForText(text)
    .flatMap((subset) =>
      subset.faces.map((face) => `@font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: ${face.weight};
      font-display: block;
      src: url(data:font/woff2;base64,${face.woff2Base64}) format('woff2');
      unicode-range: ${subset.unicodeRange};
    }`),
    )
    .join('\n    ');
