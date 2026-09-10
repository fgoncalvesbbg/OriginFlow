/**
 * The REVIEW STAMP — what a reviewer's copy of a design spec says on every page.
 *
 * WHY IT EXISTS. A spec that reaches a factory unmarked is a spec a factory can tool up
 * from. So the copy served through a review link carries its release name at the top of
 * every page and a traceable footer at the bottom, and the ORIGINAL bytes are never touched
 * — the stamp is written to a separate object (`…-review.pdf`), so the design team's file is
 * always recoverable and an internal download is always pristine.
 *
 * WHAT IT SAYS DEPENDS ON THE STAGE, and the two unreleased stages are warned about
 * differently because the consequence of leaking them differs:
 *
 *   Internal Review   INTERNAL REVIEW v.01 - NOT FOR DISTRIBUTION   watermark: INTERNAL
 *   Initial Release   INITIAL RELEASE v.01 - FOR REVIEW ONLY        watermark: DRAFT
 *   Final Release     not stamped at all — it IS the released document
 *
 * The wording lives in `DESIGN_SPEC_STAGE_META` in src/pages/design/design-spec-release.ts,
 * so the banner on the page and the badge on the screen cannot drift apart. A Final Release
 * never reaches this module: `uploadDesignSpecVersion` asks for no stamped slot for one.
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
import {
  DESIGN_SPEC_STAGE_META, formatRevision, releaseLabel,
} from '../../pages/design/design-spec-release';
import type { DesignSpecStage } from '../../types/design-spec.types';

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
  /** Which release this copy is. Decides the banner, the watermark and the warning. */
  stage: DesignSpecStage;
  /** The revision within that stage — 2 prints as `v.02`. */
  revision: number;
  /** Project name or code, so a printed page traces back to a project without the app. */
  projectLabel: string;
  /** Defaults to today. Injectable so the output is deterministic under test. */
  date?: Date;
  /**
   * Draw the large diagonal watermark across each page.
   *
   * On by default: it is what makes a photographed or photocopied page obviously unreleased,
   * which a header alone does not. Worth turning off only for a spec whose artwork the
   * watermark would genuinely obscure — the header and footer still carry the release name.
   */
  watermark?: boolean;
}

/**
 * What the banner warns, per stage.
 *
 * An Internal Review is not merely provisional — it is a file that was never meant to leave
 * the building, so it says so rather than inviting review. An Initial Release IS an
 * invitation to review, and says that.
 */
const WARNING: Record<DesignSpecStage, string> = {
  internal: 'NOT FOR DISTRIBUTION',
  initial: 'FOR REVIEW ONLY',
  // Unreachable — a Final Release is never stamped — but a Record must be total, and a
  // stamp that somehow reached one must not claim it is released when it has not been issued.
  final: 'FOR REVIEW ONLY',
};

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
 * The three strings the stamp draws, built and made ASCII-safe.
 *
 * Split out of `stampReviewPdf` so the WORDING can be tested without a PDF: pdf-lib
 * flate-compresses the content streams it writes, so reading the sentences back out of the
 * produced file would mean decompressing it — and would be testing pdf-lib rather than this
 * module's one real decision, which is what each stage says.
 */
export const reviewStampText = (
  input: Pick<StampInput, 'stage' | 'revision' | 'specCode' | 'projectLabel' | 'date'>,
): { banner: string; footer: string; watermark: string } => {
  const meta = DESIGN_SPEC_STAGE_META[input.stage];
  return {
    banner: asciiSafe(
      `${meta.stamp?.banner ?? meta.label.toUpperCase()} ${formatRevision(input.revision)} - ${WARNING[input.stage]}`,
    ),
    footer: asciiSafe(
      `${input.specCode} - ${input.projectLabel} - ${releaseLabel({ stage: input.stage, revision: input.revision })} - ${isoDate(input.date ?? new Date())}`,
    ),
    watermark: meta.stamp?.watermark ?? 'DRAFT',
  };
};

/**
 * Produce the reviewer's copy of an unreleased version.
 *
 * Returns fresh bytes; the input buffer is left alone. Throws if the file is not a PDF
 * pdf-lib can parse — the caller surfaces that to the designer at pick time, which is the
 * only moment they can do anything about it.
 */
export const stampReviewPdf = async (input: StampInput): Promise<Uint8Array> => {
  const doc = await PDFDocument.load(input.pdf);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const footFont = await doc.embedFont(StandardFonts.Helvetica);

  const { banner, footer, watermark } = reviewStampText(input);

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();

    if (input.watermark !== false) {
      const textWidth = font.widthOfTextAtSize(watermark, WATERMARK_SIZE);
      // Drawn FIRST so the page's own artwork sits on top of it — a watermark that obscures
      // a dimension the reviewer is being asked to check is worse than no watermark. The low
      // opacity is what keeps it legible-but-not-in-the-way.
      page.drawText(watermark, {
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
