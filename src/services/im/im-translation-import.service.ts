/**
 * Parse and apply an XLIFF 1.2 translation file (produced by `im-translation-export
 * .service.ts`, filled in by an external translator/CAT tool such as XTM) back
 * onto live IM template sections.
 *
 * No DOMParser/XML-DOM dependency — same hand-rolled-regex convention as
 * im-xliff-codec.ts, kept simple because the envelope this parses
 * (`<file>`/`<trans-unit>`/`<source>`/`<target>`) is small and fixed.
 */
import { auth, db } from '../../data';
import { isLive } from '../../config/environment.config';
import { IMSection } from '../../types';
import { decodeInlineXliff, sameMarkerSet } from './im-xliff-codec';
import {
  applyTranslationFragment,
  collectTranslationFragments,
  hasLegacyPositionalIds,
  readTranslationFragmentValue,
} from './im-translation-fragments';
import { TM_PREFILL_ORIGIN } from './im-translation-export.service';

export interface ParsedXliffUnit {
  id: string;
  /** Decoded target HTML, or null when untranslated / corrupted (see `warning`). */
  html: string | null;
  warning?: string;
  /** The unit carried `approved="yes"` — we pre-translated it from approved memory. */
  wasPrefilled?: boolean;
  /**
   * The decoded target we ourselves pre-filled, read back from the
   * `<alt-trans origin="originflow-tm-prefill">` copy. Comparing against this is how
   * "returned untouched" is told from "the vendor changed our approved wording",
   * without a second table and without trusting our own memory of the export.
   *
   * Compared on DECODED html rather than raw XML so it survives a CAT tool
   * re-serializing attributes, whitespace, or renumbering inline-code ids.
   */
  prefilledHtml?: string | null;
}

export interface ParsedXliffFile {
  targetLang: string;
  units: ParsedXliffUnit[];
}

export interface ParseTranslationXliffResult {
  files: ParsedXliffFile[];
  /** File-level problems (a whole <file>/<trans-unit> couldn't be read). */
  errors: string[];
  /**
   * True when the file addresses at least one block row by ARRAY POSITION rather than
   * by its stable id — i.e. it was exported before the id-based scheme. Rows reordered
   * since that export cannot be detected, so the preview must say so.
   */
  hasLegacyIds: boolean;
}

const attrValue = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
};

/** Inner text of the first `<tag ...>...</tag>` in `block`, '' if self-closed, null if absent. */
const extractElement = (block: string, tag: string): string | null => {
  if (new RegExp(`<${tag}\\b[^>]*/>`).exec(block)) return '';
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(block);
  return m ? m[1] : null;
};

const FILE_RE = /<file\b([^>]*)>([\s\S]*?)<\/file>/g;
const TRANS_UNIT_RE = /<trans-unit\b([^>]*)>([\s\S]*?)<\/trans-unit>/g;
const ALT_TRANS_RE = /<alt-trans\b([^>]*)>([\s\S]*?)<\/alt-trans>/g;

/**
 * The `<target>` inside our own pre-fill `<alt-trans>`, decoded. Null when the unit
 * carries no such block — either it was not pre-filled, or the vendor's tool stripped
 * alternatives, in which case a changed pre-fill is indistinguishable from an ordinary
 * translation and is treated as one.
 */
const extractPrefillAltTrans = (unitBody: string): string | null => {
  ALT_TRANS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ALT_TRANS_RE.exec(unitBody))) {
    const [, attrs, body] = m;
    if (attrValue(attrs, 'origin') !== TM_PREFILL_ORIGIN) continue;
    const target = extractElement(body, 'target');
    if (target === null) return null;
    return decodeInlineXliff(target).html;
  }
  return null;
};

/** Strip the `<alt-trans>` blocks so the unit's own `<source>`/`<target>` can be read unambiguously. */
const withoutAltTrans = (unitBody: string): string => unitBody.replace(ALT_TRANS_RE, '');

export const parseTranslationXliff = (xmlText: string): ParseTranslationXliffResult => {
  const errors: string[] = [];
  if (!/<xliff\b/.test(xmlText)) {
    return {
      files: [],
      errors: ['This file does not look like an XLIFF document (no <xliff> root element found).'],
      hasLegacyIds: false,
    };
  }

  const files: ParsedXliffFile[] = [];
  FILE_RE.lastIndex = 0;
  let fileMatch: RegExpExecArray | null;
  while ((fileMatch = FILE_RE.exec(xmlText))) {
    const [, attrs, body] = fileMatch;
    const targetLang = attrValue(attrs, 'target-language');
    if (!targetLang) {
      errors.push('A <file> element is missing its target-language attribute — skipped.');
      continue;
    }

    const units: ParsedXliffUnit[] = [];
    TRANS_UNIT_RE.lastIndex = 0;
    let unitMatch: RegExpExecArray | null;
    while ((unitMatch = TRANS_UNIT_RE.exec(body))) {
      const [, unitAttrs, rawUnitBody] = unitMatch;
      const id = attrValue(unitAttrs, 'id');
      if (!id) {
        errors.push(`A <trans-unit> in the ${targetLang.toUpperCase()} file is missing an id — skipped.`);
        continue;
      }

      // Read our own pre-fill copy BEFORE stripping alternatives, then work on a body
      // without them so the unit's own <source>/<target> can't be confused with an
      // alternative's.
      const prefilledHtml = extractPrefillAltTrans(rawUnitBody);
      const wasPrefilled = attrValue(unitAttrs, 'approved') === 'yes' || prefilledHtml !== null;
      const unitBody = withoutAltTrans(rawUnitBody);

      const targetInner = extractElement(unitBody, 'target');
      if (targetInner === null || !targetInner.trim()) {
        units.push({
          id,
          html: null,
          warning: 'No translation provided (empty <target>) — left untranslated.',
          wasPrefilled,
          prefilledHtml,
        });
        continue;
      }

      const decodedTarget = decodeInlineXliff(targetInner);

      // A pre-fill returned untouched needs no integrity check: we wrote it, it already
      // passed every gate on the way out, and comparing decoded html is immune to a CAT
      // tool renumbering inline-code ids.
      const unchangedPrefill = prefilledHtml !== null && prefilledHtml === decodedTarget.html;

      const sourceInner = extractElement(unitBody, 'source');
      if (!unchangedPrefill && sourceInner !== null) {
        const decodedSource = decodeInlineXliff(sourceInner);
        if (!sameMarkerSet(decodedSource.markerIds, decodedTarget.markerIds)) {
          units.push({
            id,
            html: null,
            warning: 'Placeholder/tag mismatch between source and target — a chip, image, or formatting tag was added, removed, or altered. Skipped for safety.',
            wasPrefilled,
            prefilledHtml,
          });
          continue;
        }
      }
      units.push({ id, html: decodedTarget.html, wasPrefilled, prefilledHtml });
    }
    files.push({ targetLang, units });
  }

  if (!files.length && !errors.length) {
    errors.push('No <file> elements found in this XLIFF document.');
  }
  const hasLegacyIds = hasLegacyPositionalIds(files.flatMap(f => f.units.map(u => u.id)));
  return { files, errors, hasLegacyIds };
};

export interface TranslationImportReport {
  finishedAt: string;
  targets: string[];
  total: number;
  ok: number;
  saved: boolean;
  okByLang: Record<string, number>;
  failures: Array<{ lang: string; label: string; error: string }>;
  source: 'xliff-import';
  /** Units we pre-translated that came back exactly as sent — nothing to do. */
  unchangedPrefills?: number;
  /** Units we pre-translated that the vendor altered. Applied only with explicit opt-in. */
  changedPrefills?: number;
  /** The file addressed at least one row by position, so a reorder could not be detected. */
  hadLegacyIds?: boolean;
}

export interface ApplyTranslationImportOptions {
  /**
   * Apply units where the vendor CHANGED wording we had pre-translated from approved
   * memory. Off by default on purpose.
   *
   * Such a change is either a real error report (valuable) or CAT-tool noise
   * (whitespace, entity normalization). Both need a human: silently accepting it would
   * overwrite text a reviewer signed off on, and then write the vendor's version back
   * into the memory as if it were authoritative — poisoning the memory against its own
   * approved content.
   */
  acceptChangedPrefills?: boolean;
}

export interface ApplyTranslationImportResult {
  sections: IMSection[];
  changedSectionIds: Set<string>;
  report: Omit<TranslationImportReport, 'saved'>;
  /** Vendor edits to approved pre-fills, for the preview to list before committing. */
  changedPrefillUnits: Array<{ lang: string; label: string; id: string; ours: string; theirs: string }>;
}

/**
 * Apply every usable unit from a parsed XLIFF file onto a copy of `sections`.
 * Untranslated/corrupted units are recorded as failures (not thrown) so a
 * partially-usable import still applies everything it safely can.
 */
export const applyTranslationImport = (
  sections: IMSection[],
  parsed: ParseTranslationXliffResult,
  options: ApplyTranslationImportOptions = {},
): ApplyTranslationImportResult => {
  const labelById = new Map(collectTranslationFragments(sections).map(f => [f.id, f.label]));
  let working = sections;
  const changedSectionIds = new Set<string>();
  const okByLang: Record<string, number> = {};
  const failures: Array<{ lang: string; label: string; error: string }> = [];
  const changedPrefillUnits: ApplyTranslationImportResult['changedPrefillUnits'] = [];
  let total = 0;
  let ok = 0;
  let unchangedPrefills = 0;

  for (const file of parsed.files) {
    for (const unit of file.units) {
      total += 1;
      const label = labelById.get(unit.id) ?? unit.id;
      if (unit.warning || unit.html === null) {
        failures.push({ lang: file.targetLang, label, error: unit.warning ?? 'No translation available.' });
        continue;
      }

      if (unit.prefilledHtml != null) {
        if (unit.prefilledHtml === unit.html) {
          // Returned exactly as we sent it. Already in the template and already in the
          // memory, so there is nothing to write and nothing to report as a failure.
          unchangedPrefills += 1;
          continue;
        }
        changedPrefillUnits.push({
          lang: file.targetLang,
          label,
          id: unit.id,
          ours: unit.prefilledHtml,
          theirs: unit.html,
        });
        if (!options.acceptChangedPrefills) {
          failures.push({
            lang: file.targetLang,
            label,
            error: 'The vendor changed wording we had pre-translated from approved memory. '
              + 'Not applied — review it and re-import with the override enabled to accept.',
          });
          continue;
        }
      }

      const result = applyTranslationFragment(working, unit.id, file.targetLang, unit.html);
      if (!result) {
        failures.push({
          lang: file.targetLang,
          label,
          error: 'Section/row no longer exists — template structure changed since export.',
        });
        continue;
      }
      working = result;
      changedSectionIds.add(unit.id.split('#')[0]);
      okByLang[file.targetLang] = (okByLang[file.targetLang] ?? 0) + 1;
      ok += 1;
    }
  }

  return {
    sections: working,
    changedSectionIds,
    changedPrefillUnits,
    report: {
      finishedAt: new Date().toISOString(),
      targets: parsed.files.map(f => f.targetLang),
      total,
      ok,
      okByLang,
      failures,
      source: 'xliff-import',
      unchangedPrefills,
      changedPrefills: changedPrefillUnits.length,
      hadLegacyIds: parsed.hasLegacyIds,
    },
  };
};

/**
 * Per-language count of units where the vendor altered wording we pre-translated from
 * approved memory. Shown in the import preview next to the overwrite count, because it
 * is a different and more serious kind of overwrite: it contradicts a review decision
 * rather than merely replacing an untranslated or machine-translated slot.
 */
export const countChangedPrefills = (
  parsed: ParseTranslationXliffResult,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const file of parsed.files) {
    let n = 0;
    for (const unit of file.units) {
      if (unit.html === null || unit.prefilledHtml == null) continue;
      if (unit.prefilledHtml !== unit.html) n += 1;
    }
    if (n) out[file.targetLang] = n;
  }
  return out;
};

/**
 * Per-language count of usable units that would OVERWRITE an existing translation
 * (vs fill a blank). Shown in the import preview so the operator sees what a vendor
 * file will destroy BEFORE committing — imports write straight into the live shared
 * template with no undo.
 */
export const countTranslationOverwrites = (
  sections: IMSection[],
  parsed: ParseTranslationXliffResult,
): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const file of parsed.files) {
    let n = 0;
    for (const unit of file.units) {
      if (unit.html === null) continue;
      // A pre-fill returned untouched is not an overwrite — it is the value already in
      // the template. Counting it would inflate the "this will destroy N translations"
      // warning to the point where an operator stops reading it.
      if (unit.prefilledHtml != null && unit.prefilledHtml === unit.html) continue;
      const current = readTranslationFragmentValue(sections, unit.id, file.targetLang);
      if (current && current.trim()) n += 1;
    }
    if (n) out[file.targetLang] = n;
  }
  return out;
};

/**
 * Durable record of a committed import (im_translation_imports, migration 108) — who
 * imported which file into which template, with the full run-report. Best-effort:
 * a failure here never blocks the import itself (which already happened), it just
 * loses the audit row, so it logs instead of throwing.
 */
export const saveTranslationImportReport = async (
  templateId: string,
  fileName: string | null,
  report: TranslationImportReport,
): Promise<void> => {
  if (!isLive) return;
  try {
    const user = await auth.getUser();
    await db.insert('im_translation_imports', {
      template_id: templateId,
      file_name: fileName,
      imported_by: user?.email ?? user?.id ?? null,
      report,
    });
  } catch (e) {
    console.warn('[im-translation-import] failed to persist import report (non-fatal):', e);
  }
};
