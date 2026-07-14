/**
 * Parse and apply an XLIFF 1.2 translation file (produced by `im-translation-export
 * .service.ts`, filled in by an external translator/CAT tool such as XTM) back
 * onto live IM template sections.
 *
 * No DOMParser/XML-DOM dependency — same hand-rolled-regex convention as
 * im-xliff-codec.ts, kept simple because the envelope this parses
 * (`<file>`/`<trans-unit>`/`<source>`/`<target>`) is small and fixed.
 */
import { IMSection } from '../../types';
import { decodeInlineXliff, sameMarkerSet } from './im-xliff-codec';
import { applyTranslationFragment, collectTranslationFragments } from './im-translation-fragments';

export interface ParsedXliffUnit {
  id: string;
  /** Decoded target HTML, or null when untranslated / corrupted (see `warning`). */
  html: string | null;
  warning?: string;
}

export interface ParsedXliffFile {
  targetLang: string;
  units: ParsedXliffUnit[];
}

export interface ParseTranslationXliffResult {
  files: ParsedXliffFile[];
  /** File-level problems (a whole <file>/<trans-unit> couldn't be read). */
  errors: string[];
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

export const parseTranslationXliff = (xmlText: string): ParseTranslationXliffResult => {
  const errors: string[] = [];
  if (!/<xliff\b/.test(xmlText)) {
    return { files: [], errors: ['This file does not look like an XLIFF document (no <xliff> root element found).'] };
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
      const [, unitAttrs, unitBody] = unitMatch;
      const id = attrValue(unitAttrs, 'id');
      if (!id) {
        errors.push(`A <trans-unit> in the ${targetLang.toUpperCase()} file is missing an id — skipped.`);
        continue;
      }

      const targetInner = extractElement(unitBody, 'target');
      if (targetInner === null || !targetInner.trim()) {
        units.push({ id, html: null, warning: 'No translation provided (empty <target>) — left untranslated.' });
        continue;
      }

      const decodedTarget = decodeInlineXliff(targetInner);
      const sourceInner = extractElement(unitBody, 'source');
      if (sourceInner !== null) {
        const decodedSource = decodeInlineXliff(sourceInner);
        if (!sameMarkerSet(decodedSource.markerIds, decodedTarget.markerIds)) {
          units.push({
            id,
            html: null,
            warning: 'Placeholder/tag mismatch between source and target — a chip, image, or formatting tag was added, removed, or altered. Skipped for safety.',
          });
          continue;
        }
      }
      units.push({ id, html: decodedTarget.html });
    }
    files.push({ targetLang, units });
  }

  if (!files.length && !errors.length) {
    errors.push('No <file> elements found in this XLIFF document.');
  }
  return { files, errors };
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
}

export interface ApplyTranslationImportResult {
  sections: IMSection[];
  changedSectionIds: Set<string>;
  report: Omit<TranslationImportReport, 'saved'>;
}

/**
 * Apply every usable unit from a parsed XLIFF file onto a copy of `sections`.
 * Untranslated/corrupted units are recorded as failures (not thrown) so a
 * partially-usable import still applies everything it safely can.
 */
export const applyTranslationImport = (
  sections: IMSection[],
  parsed: ParseTranslationXliffResult,
): ApplyTranslationImportResult => {
  const labelById = new Map(collectTranslationFragments(sections).map(f => [f.id, f.label]));
  let working = sections;
  const changedSectionIds = new Set<string>();
  const okByLang: Record<string, number> = {};
  const failures: Array<{ lang: string; label: string; error: string }> = [];
  let total = 0;
  let ok = 0;

  for (const file of parsed.files) {
    for (const unit of file.units) {
      total += 1;
      const label = labelById.get(unit.id) ?? unit.id;
      if (unit.warning || unit.html === null) {
        failures.push({ lang: file.targetLang, label, error: unit.warning ?? 'No translation available.' });
        continue;
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
    report: {
      finishedAt: new Date().toISOString(),
      targets: parsed.files.map(f => f.targetLang),
      total,
      ok,
      okByLang,
      failures,
      source: 'xliff-import',
    },
  };
};
