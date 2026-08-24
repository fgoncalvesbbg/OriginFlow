/**
 * Embedded Inter for the pdf-lib stamp layer (running footer, page numbers, TOC numbers,
 * edge-tab labels).
 *
 * Replaces StandardFonts.Helvetica. pdf-lib's StandardFonts are the PDF base-14, which are
 * referenced by name and never embedded — so every stamped glyph was a non-embedded font in
 * the delivered file, which fails preflight at any print vendor.
 *
 * It also retires encodeForFont's WinAnsi filter, which silently dropped every glyph outside
 * WinAnsi: Greek and Bulgarian footers lost their text with no warning.
 *
 * Inter ships as per-script subsets and none of the non-Latin ones declare ASCII, so a Greek
 * footer ("Οδηγίες · 1 / 141") genuinely needs two faces — the Greek letters from `greek`,
 * and the separator, digits and spaces from `latin`. Text is therefore split into runs and
 * each run drawn with the face that declares it.
 */
import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont, PDFPage, RGB } from 'pdf-lib';
import { INTER_STAMP_SUBSETS, type InterStampSubset } from './inter-stamp.generated';

/** Always embedded: the only subset declaring ASCII, punctuation and the Latin-1 accents. */
const BASE_SUBSET = 'latin';

const inRanges = (ranges: readonly (readonly [number, number])[], cp: number): boolean =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

const declares = (subset: InterStampSubset, cp: number): boolean => inRanges(subset.ranges, cp);

export interface StampFonts {
  /** The base (Latin) face. For ASCII-only strings — page numbers, ISO 639-1 tab labels. */
  base: PDFFont;
  /** Advance width of `text` at `size`, summed across whichever faces it needs. */
  widthOfText(text: string, size: number): number;
  /** Draw `text` from a left baseline origin, switching face per run. */
  drawText(page: PDFPage, text: string, o: { x: number; y: number; size: number; color: RGB }): void;
  /** Characters no embedded subset declares. They are skipped; callers may report them. */
  unsupported(text: string): string[];
}

/**
 * Embed only the subsets `sampleTexts` need, always including BASE_SUBSET.
 *
 * pdf-lib subsets again at embed time, so a face contributes only the glyphs actually
 * stamped — a few hundred bytes, not the 20-125KB of the source subset.
 */
export const embedStampFonts = async (
  doc: PDFDocument,
  sampleTexts: readonly string[],
): Promise<StampFonts> => {
  doc.registerFontkit(fontkit);

  const codepoints = new Set<number>();
  for (const text of sampleTexts) {
    for (const ch of text ?? '') {
      const cp = ch.codePointAt(0);
      if (cp !== undefined) codepoints.add(cp);
    }
  }

  const wanted = INTER_STAMP_SUBSETS.filter(
    (s) => s.subset === BASE_SUBSET || [...codepoints].some((cp) => declares(s, cp)),
  );

  const embedded: { subset: InterStampSubset; font: PDFFont }[] = [];
  for (const subset of wanted) {
    const bytes = Buffer.from(subset.ttfBase64, 'base64');
    embedded.push({ subset, font: await doc.embedFont(bytes, { subset: true }) });
  }

  const base = embedded.find((e) => e.subset.subset === BASE_SUBSET)?.font;
  if (!base) throw new Error(`stamp font "${BASE_SUBSET}" failed to embed`);

  const faceFor = (cp: number): PDFFont | null =>
    embedded.find((e) => declares(e.subset, cp))?.font ?? null;

  /** Consecutive characters sharing a face, in order. Undeclared characters are dropped. */
  const runsOf = (text: string): { font: PDFFont; text: string }[] => {
    const runs: { font: PDFFont; text: string }[] = [];
    for (const ch of text ?? '') {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      const font = faceFor(cp);
      if (!font) continue;
      const last = runs[runs.length - 1];
      if (last && last.font === font) last.text += ch;
      else runs.push({ font, text: ch });
    }
    return runs;
  };

  return {
    base,
    widthOfText: (text, size) =>
      runsOf(text).reduce((w, run) => w + run.font.widthOfTextAtSize(run.text, size), 0),
    drawText: (page, text, o) => {
      let x = o.x;
      for (const run of runsOf(text)) {
        page.drawText(run.text, { x, y: o.y, size: o.size, font: run.font, color: o.color });
        x += run.font.widthOfTextAtSize(run.text, o.size);
      }
    },
    unsupported: (text) => {
      const out: string[] = [];
      for (const ch of text ?? '') {
        const cp = ch.codePointAt(0);
        if (cp !== undefined && !faceFor(cp)) out.push(ch);
      }
      return [...new Set(out)];
    },
  };
};
