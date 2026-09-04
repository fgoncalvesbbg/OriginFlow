/**
 * Document codes — the printed identifier that says WHICH document a PDF is.
 *
 * A leaflet in a warehouse, a proof on a print buyer's desk and a file in an inbox all need to
 * be identifiable without system access. The code plus the version answers that: together they
 * name exactly one document.
 *
 *     WL-RAN-ANGLED-A7F-A5 · v8
 *     │  │   │      │   └── page size — a different trim is different artwork
 *     │  │   │      └────── fingerprint of the category id (see below)
 *     │  │   └───────────── the L3 category ("Angled Hoods")
 *     │  └───────────────── the L2 family ("Range Hoods")
 *     └──────────────────── document type: WL warning leaflet, IM instruction manual
 *
 * WHY THE FINGERPRINT. A code built from category names alone is not unique: across the 132 L3
 * categories, an L1+L3 abbreviation collapses to 111 distinct codes and an L2+L3 one to 126.
 * `LAR-BUILTI` alone would name five different documents (Built-In Dishwashers, Microwave
 * Ovens, Ovens, Hoods and Wine Coolers), because the word that distinguishes them lives in L2,
 * not L3 — and even L2+L3 collides. Three characters derived from the category's immutable id
 * close the gap: verified unique across all 132 (see im-doc-code.test.ts, which asserts it
 * against the real category list rather than trusting the claim).
 *
 * It also makes the code survive a rename. Category names DO change — six live categories were
 * renamed in one go in August 2026 — and a purely name-derived code would silently start
 * pointing somewhere else. The readable half may drift; the fingerprint half never does, so an
 * old printed code still resolves to the right category.
 *
 * NOTHING IS STORED. The code is a pure function of (document type, page size, category), so
 * reverse lookup is "compute it for every category and match" rather than a database column
 * that has to be migrated, backfilled and kept in sync. That also means it works retroactively
 * on renders produced before the code existed.
 *
 * Layout is deliberately NOT encoded: the classic and compact leaflet layouts are the same
 * document set in two ways, and the storage path already tells them apart.
 */

import type { IMTemplateType } from '../../types';

/**
 * Fingerprint alphabet: digits and upper-case letters with the look-alikes removed (no I, L,
 * O, U, 0 or 1). A code gets read off paper and typed back in, so `WL-RAN-ANGLED-A7F` must not
 * be transcribable as `...-A7F` vs `...-AZF` by accident.
 */
const FINGERPRINT_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** How many fingerprint characters the code carries. 3 over this alphabet is 27,000 values. */
export const FINGERPRINT_LENGTH = 3;

/** Letters only, upper-cased — drops spaces, ampersands, hyphens and curly apostrophes. */
const lettersOnly = (value: string): string => value.toUpperCase().replace(/[^A-Z]/g, '');

/**
 * A short, stable fingerprint of a category id.
 *
 * FNV-1a rather than a crypto hash on purpose: it must produce the SAME value in the browser
 * (which builds the request) and in the Netlify function (which stamps the PDF), synchronously
 * and with no dependency. `crypto.subtle` is async and awkward in both, and node's `crypto` is
 * not available in the browser bundle.
 */
export const categoryFingerprint = (categoryId: string, length = FINGERPRINT_LENGTH): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < categoryId.length; i++) {
    hash ^= categoryId.charCodeAt(i);
    // Math.imul keeps the multiply in 32-bit, which plain `*` would not.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < length; i++) {
    out = FINGERPRINT_ALPHABET[hash % FINGERPRINT_ALPHABET.length] + out;
    hash = Math.floor(hash / FINGERPRINT_ALPHABET.length);
  }
  return out;
};

export interface DocCodeInput {
  templateType: IMTemplateType | string;
  pageSize: string;
  /** The template's category — im_templates.category_id, i.e. a categories_l3 id. */
  categoryId: string;
  /** L2 family name ("Range Hoods"). Absent falls back to a placeholder rather than throwing. */
  l2Name?: string | null;
  /** L3 category name ("Angled Hoods"). */
  l3Name?: string | null;
}

/** `WL` for a warning leaflet, `IM` for a full manual. */
export const docCodeKind = (templateType: IMTemplateType | string): string =>
  templateType === 'warning_leaflet' ? 'WL' : 'IM';

/**
 * The document code for a (document type, page size, category) triple.
 *
 * Never throws: a missing category name degrades to `XXX`/`XXXXXX` so the code still carries a
 * usable type, fingerprint and page size. Returns '' only when there is no category id at all,
 * because then nothing identifies the document and a code would be a lie.
 */
export const buildDocCode = (input: DocCodeInput): string => {
  const categoryId = (input.categoryId ?? '').trim();
  if (!categoryId) return '';
  const family = lettersOnly(input.l2Name ?? '').slice(0, 3) || 'XXX';
  const item = lettersOnly(input.l3Name ?? '').slice(0, 6) || 'XXXXXX';
  return [
    docCodeKind(input.templateType),
    family,
    item,
    categoryFingerprint(categoryId),
    (input.pageSize ?? '').toUpperCase() || 'A5',
  ].join('-');
};

/**
 * Shape a document code must have to be stamped onto a PDF.
 *
 * The Netlify functions receive the code from the browser like the rest of the cover data, and
 * this is what stops an arbitrary string being printed on a safety document.
 */
export const DOC_CODE_RE = /^(WL|IM)-[A-Z]{1,3}-[A-Z]{1,6}-[2-9A-HJ-NP-Z]{3}-A[45]$/;

export const isValidDocCode = (value: unknown): value is string =>
  typeof value === 'string' && DOC_CODE_RE.test(value);
