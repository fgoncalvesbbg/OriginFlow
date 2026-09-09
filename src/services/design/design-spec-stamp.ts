/**
 * The DRAFT stamp — what a reviewer's copy of a design spec says on every page.
 *
 * WHY IT EXISTS. A draft that reaches a factory unmarked is a draft a factory can tool up
 * from. So the copy served through a review link carries `DRAFT vN · FOR REVIEW ONLY` at the
 * top of every page and a traceable footer at the bottom, and the ORIGINAL bytes are never
 * touched — the stamp is written to a separate object (`…-review.pdf`), so the design team's
 * file is always recoverable and an internal download is always pristine.
 *
 * WHY IN THE BROWSER. The designer's browser already holds the bytes it just picked. A
 * design spec can be 50MB and a Netlify Function body cannot, so stamping server-side would
 * mean uploading, downloading, stamping and re-uploading the same 50MB. `pdf-lib` is already
 * a dependency of this app and works the same in both places.
 *
 * WHY HELVETICA. A standard PDF font needs no embedding, so the stamp adds a few hundred
 * bytes rather than a font subset, and it cannot fail for lack of a glyph file the way the
 * print pipeline's embedded Inter once did. The stamp is ASCII by construction — see
 * `asciiSafe` — because a standard font has no glyphs beyond WinAnsi and pdf-lib throws
 * rather than dropping a character it cannot draw.
 */

import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

/** Ink for the banner and the footer: a muted red that reads as a warning when printed grey. */
const STAMP_RED = rgb(0.7, 0.13, 0.13);
const FOOTER_GREY = rgb(0.45, 0.45, 0.45);

const BANNER_SIZE = 9;
const FOOTER_SIZE = 7;
const WATERMARK_SIZE = 60;

/** Distance from the page edge for the banner and footer, in points. */
const MARGIN = 14;

export interface StampInput {
  /** The picked file's bytes. Not mutated — pdf-lib works on its own parse. */
  pdf: ArrayBuffer;
  specCode: string;
  version: number;
  /** Project name or code, so a printed page traces back to a project without the app. */
  projectLabel: string;
  /** Defaults to today. Injectable so the output is deterministic under test. */
  date?: Date;
  /**
   * Draw the large diagonal DRAFT watermark across each page.
   *
   * On by default: it is what makes a photographed or photocopied page obviously a draft,
   * which a header alone does not. Worth turning off only for a spec whose artwork the
   * watermark would genuinely obscure — the header and footer still say DRAFT.
   */
  watermark?: boolean;
}

/**
 * Replace characters Helvetica cannot draw.
 *
 * pdf-lib THROWS on an un-encodable character rather than substituting one, so a spec title
 * or project name carrying a smart quote, a dash or an umlaut would fail the whole stamp —
 * and the failure would surface as "this draft is still being prepared" to a reviewer. The
 * common typographic characters are mapped to their ASCII equivalents and anything else
 * left over becomes '?', which is ugly exactly once and never breaks the upload.
 */
export const asciiSafe = (s: string): string => s
  .replace(/[‘’‚‛′]/g, "'")
  .replace(/[“”„‟″]/g, '"')
  .replace(/[–—―]/g, '-')
  .replace(/…/g, '...')
  .replace(/ /g, ' ')
  .replace(/[^\x20-\x7E]/g, '?');

/** ISO date (YYYY-MM-DD) — unambiguous for a reader in any locale. */
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Produce the reviewer's copy of a draft.
 *
 * Returns fresh bytes; the input buffer is left alone. Throws if the file is not a PDF
 * pdf-lib can parse — the caller surfaces that to the designer at pick time, which is the
 * only moment they can do anything about it.
 */
export const stampDraftPdf = async (input: StampInput): Promise<Uint8Array> => {
  const doc = await PDFDocument.load(input.pdf);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const footFont = await doc.embedFont(StandardFonts.Helvetica);

  const banner = asciiSafe(`DRAFT v${input.version} - FOR REVIEW ONLY`);
  const footer = asciiSafe(
    `${input.specCode} - ${input.projectLabel} - v${input.version} draft - ${isoDate(input.date ?? new Date())}`,
  );

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();

    if (input.watermark !== false) {
      const text = 'DRAFT';
      const textWidth = font.widthOfTextAtSize(text, WATERMARK_SIZE);
      // Drawn FIRST so the page's own artwork sits on top of it — a watermark that obscures
      // a dimension the reviewer is being asked to check is worse than no watermark. The low
      // opacity is what keeps it legible-but-not-in-the-way.
      page.drawText(text, {
        x: width / 2 - textWidth / 2,
        y: height / 2 - WATERMARK_SIZE / 2,
        size: WATERMARK_SIZE,
        font,
        color: STAMP_RED,
        opacity: 0.08,
        rotate: degrees(45),
      });
    }

    const bannerWidth = font.widthOfTextAtSize(banner, BANNER_SIZE);
    page.drawText(banner, {
      x: Math.max(MARGIN, width / 2 - bannerWidth / 2),
      y: height - MARGIN - BANNER_SIZE,
      size: BANNER_SIZE,
      font,
      color: STAMP_RED,
    });

    page.drawText(footer, {
      x: MARGIN,
      y: MARGIN,
      size: FOOTER_SIZE,
      font: footFont,
      color: FOOTER_GREY,
    });
  }

  return doc.save();
};

/** Page count, read without stamping — for `design_spec_versions.page_count`. */
export const readPageCount = async (pdf: ArrayBuffer): Promise<number | null> => {
  try {
    const doc = await PDFDocument.load(pdf);
    return doc.getPageCount();
  } catch (e) {
    // A page count is metadata, not a gate: a file pdf-lib cannot parse should still be
    // storable and openable in a browser's own viewer.
    console.error('[readPageCount] could not parse the PDF:', e);
    return null;
  }
};
