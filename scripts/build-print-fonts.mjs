/**
 * Generate the embedded-Inter modules used by the print pipeline.
 *
 * WHY THIS EXISTS
 * The print HTML used to pull Inter from fonts.googleapis.com at render time, and PDFShift
 * is given no wait_for/delay — so the webfont was a race resolved independently per part.
 * A single lost fetch rendered a whole language part in the `Arial` fallback (LiberationSans
 * on Linux), which is how one booklet ended up in two typefaces from a part boundary onward.
 * Inlining the faces removes the network from the render path entirely.
 *
 * Separately, render-print-merge stamped the running footer, page numbers and edge tabs with
 * pdf-lib's StandardFonts.Helvetica — one of the base-14, which are NOT embedded by
 * definition and so fail vendor preflight. Those stamps now use a real embedded subset.
 *
 * OUTPUTS (both committed; regenerate with `npm run build:print-fonts`)
 *   src/services/im/fonts/inter-webfont.generated.ts        woff2 per subset x 400/600/700
 *   netlify/functions/lib/fonts/inter-stamp.generated.ts    ttf per subset, weight 400
 *
 * Only the subsets needed by a given document are inlined at render time, so having four
 * here costs bundle size but not request payload.
 *
 * fontkit cannot read woff2, so the stamp TTFs come from the .woff files via
 * scripts/woff-to-ttf.mjs (WOFF 1.0 is just zlib-deflated sfnt tables — no brotli
 * dependency needed). Sources are @fontsource/inter, a devDependency; nothing here runs at
 * request time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { woffToSfnt } from './woff-to-ttf.mjs';

const PKG = 'node_modules/@fontsource/inter';
const WEIGHTS = [400, 600, 700];
/** The scripts our 22 EU manual languages actually need: Western European (latin),
 *  Central/Eastern European diacritics (latin-ext), Greek (el), Bulgarian (cyrillic). */
const SUBSETS = ['latin', 'latin-ext', 'greek', 'cyrillic'];

if (!fs.existsSync(PKG)) {
  console.error('@fontsource/inter is not installed — run npm install first.');
  process.exit(1);
}

/** Pull each subset's authoritative unicode-range out of fontsource's own stylesheet,
 *  rather than hand-maintaining a copy of Google's ranges. */
const rangesFor = (weight) => {
  const css = fs.readFileSync(path.join(PKG, `${weight}.css`), 'utf8');
  const out = new Map();
  const blockRe = /\/\* inter-([a-z-]+)-\d+-normal \*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const [, subset, body] of css.matchAll(blockRe)) {
    const m = body.match(/unicode-range:\s*([^;]+);/);
    if (m) out.set(subset, m[1].trim());
  }
  return out;
};

/** "U+0301,U+0400-045F" -> [[0x301,0x301],[0x400,0x45F]] */
const parseRanges = (spec) =>
  spec.split(',').map((tok) => {
    const t = tok.trim().replace(/^U\+/i, '');
    const [a, b] = t.split('-');
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });

const ranges400 = rangesFor(400);
const b64 = (p) => fs.readFileSync(p).toString('base64');

const webfont = [];
const stamp = [];

for (const subset of SUBSETS) {
  const spec = ranges400.get(subset);
  if (!spec) throw new Error(`no unicode-range for subset "${subset}" in ${PKG}/400.css`);
  const ranges = parseRanges(spec);

  const faces = WEIGHTS.map((weight) => {
    const p = path.join(PKG, 'files', `inter-${subset}-${weight}-normal.woff2`);
    if (!fs.existsSync(p)) throw new Error(`missing ${p}`);
    return { weight, woff2Base64: b64(p) };
  });
  webfont.push({ subset, unicodeRange: spec, ranges, faces });

  const woff = path.join(PKG, 'files', `inter-${subset}-400-normal.woff`);
  if (!fs.existsSync(woff)) throw new Error(`missing ${woff}`);
  const ttf = woffToSfnt(fs.readFileSync(woff));
  stamp.push({ subset, ranges, ttfBase64: ttf.toString('base64') });
}

const banner = (extra) => `/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with \`npm run build:print-fonts\` (scripts/build-print-fonts.mjs).
 * Source: @fontsource/inter (SIL Open Font License 1.1).
 *
${extra}
 */
/* eslint-disable */
`;

const webOut = `${banner(` * Inter as inlined woff2, per unicode-range subset, for the print stylesheet's @font-face
 * rules. Replaces the old fonts.googleapis.com @import so the render never depends on a
 * network fetch that PDFShift does not wait for.`)}
export interface InterWebfontFace {
  weight: number;
  woff2Base64: string;
}

export interface InterWebfontSubset {
  /** fontsource subset name, e.g. "latin-ext". */
  subset: string;
  /** The CSS unicode-range value, emitted verbatim into @font-face. */
  unicodeRange: string;
  /** Same ranges parsed, for deciding which subsets a document actually needs. */
  ranges: readonly (readonly [number, number])[];
  faces: readonly InterWebfontFace[];
}

export const INTER_WEBFONT_SUBSETS: readonly InterWebfontSubset[] = ${JSON.stringify(webfont, null, 2)};
`;

const stampOut = `${banner(` * Inter as inlined TrueType, per unicode-range subset, for the pdf-lib stamp layer
 * (running footer, page numbers, TOC numbers, edge-tab labels). Replaces
 * StandardFonts.Helvetica, which is base-14 and therefore never embedded.
 *
 * Converted from the .woff sources because fontkit cannot read woff2. pdf-lib subsets
 * these again at embed time, so only the handful of stamped glyphs reaches the PDF.`)}
export interface InterStampSubset {
  subset: string;
  ranges: readonly (readonly [number, number])[];
  ttfBase64: string;
}

export const INTER_STAMP_SUBSETS: readonly InterStampSubset[] = ${JSON.stringify(stamp, null, 2)};
`;

const write = (file, contents) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  console.log(`  ${file}  ${(contents.length / 1024).toFixed(0)} KB`);
};

console.log('Generated:');
write('src/services/im/fonts/inter-webfont.generated.ts', webOut);
write('netlify/functions/lib/fonts/inter-stamp.generated.ts', stampOut);
