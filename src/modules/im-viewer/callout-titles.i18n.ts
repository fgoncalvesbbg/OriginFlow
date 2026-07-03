/**
 * Localized ISO callout titles (WARNING / CAUTION / ELECTRIC HAZARD / FLAMMABLE / INFO).
 *
 * The callout title is generated at render time from the block variant + the
 * language the manual is being shown in, so the header is always translated.
 * English ('en') is the fallback for any missing language or unknown variant.
 *
 * Translations are best-effort safety-sign wording; adjust per locale as needed.
 * NOTE: this is a standalone copy of `src/services/im/callout-titles.i18n.ts` so
 * the customer-facing viewer module imports nothing from the host app — keep the
 * two in sync.
 */

export const CALLOUT_TITLES_I18N: Record<string, Record<string, string>> = {
  warning: {
    en: 'WARNING', de: 'WARNUNG', fr: 'AVERTISSEMENT', es: 'ADVERTENCIA', it: 'AVVERTENZA', pt: 'ADVERTÊNCIA', nl: 'WAARSCHUWING', pl: 'OSTRZEŻENIE',
    bg: 'ПРЕДУПРЕЖДЕНИЕ', hr: 'UPOZORENJE', cs: 'VAROVÁNÍ', da: 'ADVARSEL', et: 'HOIATUS', fi: 'VAROITUS', el: 'ΠΡΟΕΙΔΟΠΟΙΗΣΗ', hu: 'FIGYELMEZTETÉS', ga: 'RABHADH', lv: 'BRĪDINĀJUMS', lt: 'ĮSPĖJIMAS', mt: 'TWISSIJA', ro: 'AVERTIZARE', sk: 'VAROVANIE', sl: 'OPOZORILO', sv: 'VARNING',
    zh: '警告', ja: '警告', tr: 'UYARI', ru: 'ПРЕДУПРЕЖДЕНИЕ',
  },
  caution: {
    en: 'CAUTION', de: 'VORSICHT', fr: 'ATTENTION', es: 'PRECAUCIÓN', it: 'ATTENZIONE', pt: 'CUIDADO', nl: 'LET OP', pl: 'PRZESTROGA',
    bg: 'ВНИМАНИЕ', hr: 'OPREZ', cs: 'POZOR', da: 'FORSIGTIG', et: 'ETTEVAATUST', fi: 'HUOMIO', el: 'ΠΡΟΣΟΧΗ', hu: 'VIGYÁZAT', ga: 'AIRE', lv: 'UZMANĪBU', lt: 'ATSARGIAI', mt: 'ATTENZJONI', ro: 'ATENȚIE', sk: 'POZOR', sl: 'PREVIDNO', sv: 'FÖRSIKTIGHET',
    zh: '小心', ja: '注意', tr: 'DİKKAT', ru: 'ОСТОРОЖНО',
  },
  electric: {
    en: 'ELECTRIC HAZARD', de: 'STROMSCHLAGGEFAHR', fr: 'DANGER ÉLECTRIQUE', es: 'PELIGRO ELÉCTRICO', it: 'PERICOLO ELETTRICO', pt: 'PERIGO ELÉTRICO', nl: 'ELEKTRISCH GEVAAR', pl: 'ZAGROŻENIE ELEKTRYCZNE',
    bg: 'ОПАСНОСТ ОТ ЕЛЕКТРИЧЕСКИ УДАР', hr: 'OPASNOST OD ELEKTRIČNE STRUJE', cs: 'NEBEZPEČÍ ÚRAZU ELEKTRICKÝM PROUDEM', da: 'FARE FOR ELEKTRISK STØD', et: 'ELEKTRILÖÖGI OHT', fi: 'SÄHKÖISKUN VAARA', el: 'ΚΙΝΔΥΝΟΣ ΗΛΕΚΤΡΟΠΛΗΞΙΑΣ', hu: 'ÁRAMÜTÉS VESZÉLYE', ga: 'GUAIS LEICTREACH', lv: 'ELEKTROTRIECIENA RISKS', lt: 'ELEKTROS SMŪGIO PAVOJUS', mt: 'PERIKLU ELETTRIKU', ro: 'PERICOL DE ELECTROCUTARE', sk: 'NEBEZPEČENSTVO ÚRAZU ELEKTRICKÝM PRÚDOM', sl: 'NEVARNOST ELEKTRIČNEGA UDARA', sv: 'RISK FÖR ELEKTRISK STÖT',
    zh: '电气危险', ja: '電気危険', tr: 'ELEKTRİK TEHLİKESİ', ru: 'ОПАСНОСТЬ ПОРАЖЕНИЯ ТОКОМ',
  },
  flammable: {
    en: 'FLAMMABLE', de: 'ENTZÜNDLICH', fr: 'INFLAMMABLE', es: 'INFLAMABLE', it: 'INFIAMMABILE', pt: 'INFLAMÁVEL', nl: 'ONTVLAMBAAR', pl: 'ŁATWOPALNE',
    bg: 'ЗАПАЛИМО', hr: 'ZAPALJIVO', cs: 'HOŘLAVÉ', da: 'BRANDFARLIGT', et: 'TULEOHTLIK', fi: 'SYTTYVÄÄ', el: 'ΕΥΦΛΕΚΤΟ', hu: 'GYÚLÉKONY', ga: 'INLASTA', lv: 'UZLIESMOJOŠS', lt: 'DEGUS', mt: 'FJAMMABBLI', ro: 'INFLAMABIL', sk: 'HORĽAVÉ', sl: 'VNETLJIVO', sv: 'BRANDFARLIGT',
    zh: '易燃', ja: '可燃性', tr: 'YANICI', ru: 'ОГНЕОПАСНО',
  },
  info: {
    en: 'INFO', de: 'HINWEIS', fr: 'INFORMATION', es: 'INFORMACIÓN', it: 'INFORMAZIONI', pt: 'INFORMAÇÃO', nl: 'INFORMATIE', pl: 'INFORMACJA',
    bg: 'ИНФОРМАЦИЯ', hr: 'INFORMACIJE', cs: 'INFORMACE', da: 'INFORMATION', et: 'TEAVE', fi: 'TIEDOKSI', el: 'ΠΛΗΡΟΦΟΡΙΕΣ', hu: 'INFORMÁCIÓ', ga: 'EOLAS', lv: 'INFORMĀCIJA', lt: 'INFORMACIJA', mt: 'INFORMAZZJONI', ro: 'INFORMAȚII', sk: 'INFORMÁCIE', sl: 'INFORMACIJE', sv: 'INFORMATION',
    zh: '信息', ja: '情報', tr: 'BİLGİ', ru: 'ИНФОРМАЦИЯ',
  },
};

/**
 * Localized callout title for a variant. Normalizes BCP-47 codes ('pt-BR' → 'pt')
 * and falls back to English, then the upper-cased variant name.
 */
export const getCalloutTitle = (variant: string, lang?: string): string => {
  const byLang = CALLOUT_TITLES_I18N[variant];
  if (!byLang) return variant.toUpperCase();
  const code = (lang ?? 'en').toLowerCase().split('-')[0];
  return byLang[code] ?? byLang.en ?? variant.toUpperCase();
};
