/**
 * Export IM template content as an XLIFF 1.2 document for an external translator
 * or TMS (e.g. XTM). One `<file>` per target language, one `<trans-unit>` per
 * translatable fragment (see im-translation-fragments.ts). Chips, images, and
 * verbatim regulation phrases are protected as XLIFF inline codes (im-xliff-codec.ts)
 * so a CAT tool can't let a translator corrupt them; verbatim phrases are
 * pre-filled with the approved wording for each target language, exactly as the
 * AI "Translate" path does. Shared blocks (`kind:'block'`) are skipped, same as
 * AI translate.
 */
import { IMSection, IMTemplate } from '../../types';
import type { TranslationVerbatim } from '../../types';
import { freeze, freezeVerbatims, VerbatimEntry } from './im-chip-freeze';
import { encodeInlineXliff } from './im-xliff-codec';
import { collectTranslationFragments, TranslationFragment } from './im-translation-fragments';
import { getTranslationVerbatims } from '../ai/translation-verbatim.service';

const escXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const verbatimEntriesFor = (verbatims: TranslationVerbatim[], targetLang: string): VerbatimEntry[] =>
  verbatims.map(v => ({ phrase: v.phrase, replacement: v.translations?.[targetLang] }));

export interface BuildTranslationXliffParams {
  template: Pick<IMTemplate, 'id' | 'name'>;
  sections: IMSection[];
  targetLangs: string[];
  /** Skip a fragment/language pair whose target-language content already exists. */
  skipExisting: boolean;
  sourceLang?: string;
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
  const ref = fragment.refIndex !== undefined ? s.blockRefs?.[fragment.refIndex] : undefined;
  if (!ref) return true;
  if (fragment.kind === 'inline' && ref.kind === 'inline') return !ref.content?.[targetLang]?.trim();
  if (fragment.kind === 'sku_label' && ref.kind === 'sku_slot') return !ref.label?.[targetLang]?.trim();
  return true;
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
}: BuildTranslationXliffParams): Promise<string | null> => {
  const fragments = collectTranslationFragments(sections, sourceLang);
  const verbatims = await getTranslationVerbatims().catch(() => [] as TranslationVerbatim[]);

  let totalUnits = 0;
  const fileBlocks = targetLangs.map(targetLang => {
    const entries = verbatimEntriesFor(verbatims, targetLang);
    const units = fragments
      .filter(f => !skipExisting || fragmentNeedsTranslation(sections, f, targetLang))
      .map(f => {
        const { text, frozen } = freezeVerbatims(freeze(f.sourceHtml), entries);
        const sourceInline = encodeInlineXliff(text, frozen);
        return `      <trans-unit id="${escXml(f.id)}">
        <source>${sourceInline}</source>
        <target></target>
        <note>${escXml(f.label)}</note>
      </trans-unit>`;
      });
    totalUnits += units.length;

    return `  <file source-language="${sourceLang}" target-language="${targetLang}" datatype="html" original="im-template:${escXml(template.id)}" tool-id="originflow">
    <header>
      <note>OriginFlow IM Template Translation Export — "${escXml(template.name)}". Fill in each &lt;target&gt; element with the translation. Do not edit trans-unit ids, or the ids/content of &lt;ph&gt;, &lt;bpt&gt;, &lt;ept&gt;, &lt;x&gt; — reposition them if the target word order needs it, but every one must remain present exactly once.</note>
    </header>
    <body>
${units.join('\n')}
    </body>
  </file>`;
  });

  if (totalUnits === 0) return null;

  return `<?xml version="1.0" encoding="UTF-8"?>\n<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n${fileBlocks.join('\n')}\n</xliff>\n`;
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
