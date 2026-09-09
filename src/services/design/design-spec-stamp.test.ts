/**
 * The DRAFT stamp.
 *
 * Two things are worth pinning down here. First `asciiSafe`, because pdf-lib THROWS on a
 * character a standard font cannot encode rather than substituting one — so a spec title or
 * a project name with a smart quote in it would fail the whole upload, and the reviewer
 * would see "this draft is still being prepared" with no explanation. Second that stamping
 * neither loses pages nor touches the caller's buffer, since the original bytes are the copy
 * the design team gets back.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { asciiSafe, stampDraftPdf, readPageCount } from './design-spec-stamp';

/** A small multi-page PDF to stamp. */
const makePdf = async (pages = 3): Promise<ArrayBuffer> => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]); // A4 portrait, in points
    page.drawText(`page ${i + 1}`, { x: 50, y: 400, size: 12, font });
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

describe('asciiSafe', () => {
  it('leaves plain ASCII alone', () => {
    expect(asciiSafe('DS-0142 - Nevora Induction - v2 draft')).toBe('DS-0142 - Nevora Induction - v2 draft');
  });

  it('folds typographic quotes and dashes to their ASCII equivalents', () => {
    expect(asciiSafe('“Nevora” — the ‘white’ one…')).toBe('"Nevora" - the \'white\' one...');
  });

  it('replaces a non-breaking space with a real one', () => {
    // A non-breaking space is the one that sneaks in from copied text and is invisible in a
    // diff, so it is the most likely single cause of a stamp failure.
    expect(asciiSafe('v2 draft')).toBe('v2 draft');
  });

  it('replaces anything else it cannot draw rather than throwing', () => {
    // One '?' per un-encodable character — 冷蔵庫 is three.
    expect(asciiSafe('Kühlschrank 冷蔵庫')).toBe('K?hlschrank ???');
  });

  it('produces only WinAnsi-drawable characters, which is the whole point', async () => {
    // The real assertion: hand the output to the font pdf-lib will use and confirm it does
    // not throw. Without asciiSafe this exact call is what fails an upload.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const nasty = 'Kühlschrank — “Nevora” ‘x’ … 冷蔵庫  ';
    expect(() => font.widthOfTextAtSize(asciiSafe(nasty), 9)).not.toThrow();
  });
});

describe('stampDraftPdf', () => {
  it('keeps every page and returns a parseable PDF', async () => {
    const original = await makePdf(3);
    const stamped = await stampDraftPdf({
      pdf: original,
      specCode: 'DS-0142',
      version: 2,
      projectLabel: 'Nevora Induction White LED',
      date: new Date('2026-09-09T00:00:00Z'),
    });

    const reparsed = await PDFDocument.load(stamped);
    expect(reparsed.getPageCount()).toBe(3);
  });

  it('does not touch the caller s buffer — the original is what the design team gets back', async () => {
    const original = await makePdf(1);
    const before = new Uint8Array(original.slice(0));
    await stampDraftPdf({
      pdf: original,
      specCode: 'DS-0001',
      version: 1,
      projectLabel: 'Project',
    });
    expect(new Uint8Array(original)).toEqual(before);
  });

  it('survives a project name full of characters Helvetica cannot draw', async () => {
    // The regression this guards: an un-encodable character used to throw out of pdf-lib and
    // fail the whole upload.
    const original = await makePdf(1);
    await expect(stampDraftPdf({
      pdf: original,
      specCode: 'DS-0002',
      version: 1,
      projectLabel: 'Kühlschrank — “Premium” 冷蔵庫',
    })).resolves.toBeInstanceOf(Uint8Array);
  });

  it('can skip the watermark without failing', async () => {
    const original = await makePdf(2);
    const stamped = await stampDraftPdf({
      pdf: original,
      specCode: 'DS-0003',
      version: 4,
      projectLabel: 'Project',
      watermark: false,
    });
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(2);
  });

  it('rejects something that is not a PDF, at pick time', async () => {
    const notAPdf = new TextEncoder().encode('this is not a pdf').buffer as ArrayBuffer;
    await expect(stampDraftPdf({
      pdf: notAPdf,
      specCode: 'DS-0004',
      version: 1,
      projectLabel: 'Project',
    })).rejects.toBeTruthy();
  });
});

describe('readPageCount', () => {
  it('counts the pages', async () => {
    expect(await readPageCount(await makePdf(5))).toBe(5);
  });

  it('returns null rather than throwing for an unparseable file', async () => {
    // A page count is metadata, not a gate — a file pdf-lib cannot read should still be
    // storable and openable in a browser's own viewer.
    const junk = new TextEncoder().encode('nope').buffer as ArrayBuffer;
    expect(await readPageCount(junk)).toBeNull();
  });
});
