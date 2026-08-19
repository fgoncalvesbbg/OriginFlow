/**
 * Export IM template content as an XLIFF 1.2 document for an external translator
 * or TMS (e.g. XTM). One `<file>` per target language, one `<trans-unit>` per
 * translatable fragment (see im-translation-fragments.ts). Chips, images, and
 * verbatim regulation phrases are protected as XLIFF inline codes (im-xliff-codec.ts)
 * so a CAT tool can't let a translator corrupt them; verbatim phrases are
 * pre-filled with the approved wording for each target language, exactly as the
 * AI "Translate" path does. Shared blocks (`kind:'block'`) are skipped, same as
 * AI translate.
 *
 * TRANSLATION-MEMORY PRE-POPULATION
 * ---------------------------------
 * When a `tmPlan` is supplied (from `planTmTranslation`), a fragment whose every
 * segment resolves to APPROVED memory is emitted already translated:
 *
 *   <trans-unit approved="yes">
 *     <target state="translated" state-qualifier="exact-match">...</target>
 *     <alt-trans origin="originflow-tm-prefill" match-quality="100%">...</alt-trans>
 *
 * That combination is what CAT tools honour as pre-translated and exclude from the
 * billable word count — which is the entire point, since paying a vendor to
 * re-translate text we already own is the cost this whole feature exists to remove.
 *
 * Deliberately NOT `translate="no"`, and deliberately not `state="final"`. Both are
 * stronger wordcount-exclusion signals, and both would remove the vendor's ability
 * to flag a pre-fill that is actually wrong. Keeping the correction path open matters
 * more than the last few percent of exclusion, because a vendor noticing that our
 * approved wording is wrong is genuinely valuable information.
 *
 * The `<alt-trans>` copy is not redundant: it is how the IMPORT side later tells
 * "the vendor returned our pre-fill untouched" from "the vendor changed it", without
 * needing a second table or trusting its own memory of what it exported.
 *
 * A pre-fill is only emitted when the encoded target passes the very gate the
 * importer will apply to it (`sameMarkerSet` between source and target inline
 * codes). If the target reorders inline codes such that the gate would fail, the
 * fragment is downgraded to a suggestion instead — better to lose a little leverage
 * than to ship a file that cannot be imported cleanly.
 *
 * TM failure is SOFT here: no pre-fills and a loud warning. Verbatim failure stays
 * HARD. Paying a vendor twice is a cost problem; shipping legally-mandated wording
 * unprotected is a different class of problem.
 */
import { IMSection, IMTemplate } from '../../types';
import type { TranslationVerbatim } from '../../types';
import { freeze, freezeVerbatims, VerbatimEntry } from './im-chip-freeze';
import { decodeInlineXliff, encodeInlineXliff, sameMarkerSet } from './im-xliff-codec';
import { collectTranslationFragments, TranslationFragment } from './im-translation-fragments';
import { getTranslationVerbatims } from '../ai/translation-verbatim.service';
import { planKey, type TmPlanResult } from './im-tm-translate';

const escXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const verbatimEntriesFor = (verbatims: TranslationVerbatim[], targetLang: string): VerbatimEntry[] =>
  verbatims.map(v => ({ phrase: v.phrase, replacement: v.translations?.[targetLang] }));

/** Marks a `<target>` we filled in from approved memory. Read back by the import path. */
export const TM_PREFILL_ORIGIN = 'originflow-tm-prefill';
/** Marks a memory suggestion that is NOT a translation — the `<target>` stays empty. */
export const TM_SUGGESTION_ORIGIN = 'originflow-tm-suggestion';

export interface BuildTranslationXliffParams {
  template: Pick<IMTemplate, 'id' | 'name'>;
  sections: IMSection[];
  targetLangs: string[];
  /** Skip a fragment/language pair whose target-language content already exists. */
  skipExisting: boolean;
  sourceLang?: string;
  /**
   * Optional translation-memory coverage, from `planTmTranslation`. Injected rather
   * than fetched here so this module stays free of data access and testable without
   * a mocked port.
   */
  tmPlan?: TmPlanResult;
}

export interface BuildTranslationXliffResult {
  xml: string;
  /** Units emitted already translated from approved memory — the vendor should not bill these. */
  prefilled: number;
  /** Units carrying a memory suggestion but an empty target. */
  suggested: number;
  /** Units with nothing from memory. */
  fresh: number;
  /** Per-language breakdown, for the export dialog. */
  byLang: Record<string, { prefilled: number; suggested: number; fresh: number }>;
  /**
   * Fragment ids that actually went into the file, per language.
   *
   * `skipExisting` means the file usually contains fewer fragments than were planned,
   * so the caller must log reuse decisions for THESE pairs only. Logging the whole plan
   * would credit the memory with decisions about units nobody exported and make the
   * leverage report overstate itself.
   */
  unitIdsByLang: Record<string, string[]>;
  warnings: string[];
}

const fragmentNeedsTranslation = (
  sections: IMSection[],
  fragment: TranslationFragment,
  targetLang: string,
): boolean => {
  const s = sections.find(sec => sec.id === fragment.sectionId);
  if (!s) return true;
  if (fragment.kind === 'title') return !s.titleI18n?.[targetLang]?.trim();
  if (fragment.kind === 'legacy') return !s.content?.[targetLang]?.trim();
  // Prefer the stable ref id; fall back to the position for a ref that has none yet.
  const refs = s.blockRefs ?? [];
  const ref = fragment.refId
    ? refs.find(r => r.id === fragment.refId)
    : fragment.refIndex !== undefined ? refs[fragment.refIndex] : undefined;
  if (!ref) return true;
  if (fragment.kind === 'inline' && ref.kind === 'inline') return !ref.content?.[targetLang]?.trim();
  if (fragment.kind === 'sku_label' && ref.kind === 'sku_slot') return !ref.label?.[targetLang]?.trim();
  return true;
};

/** Encode a piece of fragment HTML as XLIFF inline markup, protecting chips and verbatims. */
const encodeFragmentHtml = (html: string, entries: VerbatimEntry[]): string => {
  const { text, frozen } = freezeVerbatims(freeze(html), entries);
  return encodeInlineXliff(text, frozen);
};

/**
 * Build one XLIFF 1.2 document (one `<file>` per target language) ready to hand
 * to an external translator. Returns null if there is nothing to translate for
 * any selected language (e.g. everything is already translated and
 * `skipExisting` is set).
 */
export const buildTranslationXliff = async ({
  template,
  sections,
  targetLangs,
  skipExisting,
  sourceLang = 'en',
  tmPlan,
}: BuildTranslationXliffParams): Promise<BuildTranslationXliffResult | null> => {
  const fragments = collectTranslationFragments(sections, sourceLang);
  // HARD requirement, not best-effort: verbatims are the legally-mandated phrases that
  // must reach the translator as protected <ph> codes. Swallowing a fetch failure here
  // used to export them as ordinary editable text with no warning to anyone.
  let verbatims: TranslationVerbatim[];
  try {
    verbatims = await getTranslationVerbatims();
  } catch (e) {
    throw new Error(
      'Could not load the verbatim phrase list — exporting now would send legally-mandated ' +
      `wording to the translator unprotected. Try again in a moment. (${(e as Error).message})`,
    );
  }

  const warnings: string[] = [];
  if (tmPlan?.memoryUnavailable) {
    warnings.push(
      'The translation memory could not be read, so nothing was pre-translated in this file. '
      + 'The export is complete and correct — but the vendor will be quoted for text we may already own.',
    );
  }

  let totalUnits = 0;
  let prefilled = 0;
  let suggested = 0;
  let fresh = 0;
  let downgraded = 0;
  const byLang: Record<string, { prefilled: number; suggested: number; fresh: number }> = {};
  const unitIdsByLang: Record<string, string[]> = {};

  const fileBlocks = targetLangs.map(targetLang => {
    const entries = verbatimEntriesFor(verbatims, targetLang);
    const counts = { prefilled: 0, suggested: 0, fresh: 0 };
    const exportedIds: string[] = [];

    const units = fragments
      .filter(f => !skipExisting || fragmentNeedsTranslation(sections, f, targetLang))
      .map(f => {
        exportedIds.push(f.id);
        const sourceInline = encodeFragmentHtml(f.sourceHtml, entries);
        const plan = tmPlan?.plans.get(planKey(f.id, targetLang));

        // --- A fully covered fragment: emit it already translated ----------------
        if (plan?.fullyCovered && plan.html) {
          const targetInline = encodeFragmentHtml(plan.html, entries);
          const srcIds = decodeInlineXliff(sourceInline).markerIds;
          const tgtIds = decodeInlineXliff(targetInline).markerIds;
          if (sameMarkerSet(srcIds, tgtIds)) {
            counts.prefilled++;
            return `      <trans-unit id="${escXml(f.id)}" approved="yes">
        <source>${sourceInline}</source>
        <target state="translated" state-qualifier="exact-match">${targetInline}</target>
        <alt-trans origin="${TM_PREFILL_ORIGIN}" match-quality="100%">
          <source>${sourceInline}</source>
          <target>${targetInline}</target>
        </alt-trans>
        <note>${escXml(f.label)} — pre-translated from approved translation memory. Please review rather than retranslate; correct it only if it is wrong.</note>
      </trans-unit>`;
          }
          // The importer's own integrity gate would reject this pairing, so do not ship
          // it as a translation. Downgrade to a suggestion instead.
          downgraded++;
        }

        // --- A whole-fragment suggestion: target stays EMPTY ---------------------
        if (plan?.referenceHtml) {
          const quality = Math.max(0, Math.min(100, plan.referenceQuality ?? 0));
          const refInline = encodeFragmentHtml(plan.referenceHtml, entries);
          counts.suggested++;
          return `      <trans-unit id="${escXml(f.id)}">
        <source>${sourceInline}</source>
        <target></target>
        <alt-trans origin="${TM_SUGGESTION_ORIGIN}" match-quality="${quality}%">
          <source>${sourceInline}</source>
          <target>${refInline}</target>
        </alt-trans>
        <note>${escXml(f.label)} — a similar sentence exists in our translation memory (${quality}% match, shown as an alternative). It is NOT approved for this context; treat it as a reference.</note>
      </trans-unit>`;
        }

        // --- Nothing from memory -------------------------------------------------
        counts.fresh++;
        return `      <trans-unit id="${escXml(f.id)}">
        <source>${sourceInline}</source>
        <target></target>
        <note>${escXml(f.label)}</note>
      </trans-unit>`;
      });

    totalUnits += units.length;
    prefilled += counts.prefilled;
    suggested += counts.suggested;
    fresh += counts.fresh;
    byLang[targetLang] = counts;
    unitIdsByLang[targetLang] = exportedIds;

    const coverageNote = tmPlan
      ? ` ${counts.prefilled} of ${units.length} units are already translated from our approved translation memory (marked approved="yes" with state="translated") and should be excluded from the quoted word count; ${counts.suggested} carry a non-binding memory suggestion as an &lt;alt-trans&gt;.`
      : '';

    return `  <file source-language="${sourceLang}" target-language="${targetLang}" datatype="html" original="im-template:${escXml(template.id)}" tool-id="originflow">
    <header>
      <note>OriginFlow IM Template Translation Export — "${escXml(template.name)}". Fill in each &lt;target&gt; element with the translation. Do not edit trans-unit ids, or the ids/content of &lt;ph&gt;, &lt;bpt&gt;, &lt;ept&gt;, &lt;x&gt; — reposition them if the target word order needs it, but every one must remain present exactly once.${coverageNote}</note>
    </header>
    <body>
${units.join('\n')}
    </body>
  </file>`;
  });

  if (totalUnits === 0) return null;

  if (downgraded > 0) {
    warnings.push(
      `${downgraded} unit(s) had a complete memory translation that could not be pre-filled `
      + 'because its inline codes would not round-trip cleanly; they were emitted as suggestions instead.',
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n${fileBlocks.join('\n')}\n</xliff>\n`;
  return { xml, prefilled, suggested, fresh, byLang, unitIdsByLang, warnings };
};

/** Blob-download the XLIFF document (mirrors the existing translate-report download). */
export const downloadTranslationXliff = (xml: string, templateName: string, targetLangs: string[]): void => {
  const blob = new Blob([xml], { type: 'application/xliff+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const langsPart = targetLangs.map(l => l.toUpperCase()).join('+');
  a.download = `${templateName.replace(/\s+/g, '_')}.${langsPart}.xliff`;
  a.click();
  URL.revokeObjectURL(a.href);
};
