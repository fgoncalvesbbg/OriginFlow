/**
 * Localized ISO callout titles (WARNING / CAUTION / ELECTRIC HAZARD / FLAMMABLE / INFO).
 *
 * The callout title is generated at render time from the block variant + the
 * language the manual is being shown in, so the header is always translated.
 * English ('en') is the fallback for any missing language or unknown variant.
 *
 * Translations are best-effort safety-sign wording; adjust per locale as needed.
 * NOTE: `src/modules/im-viewer/callout-titles.i18n.ts` keeps an identical copy so
 * the customer-facing viewer module stays standalone — keep the two in sync.
 */

export const CALLOUT_TITLES_I18N: Record<string, Record<string, string>> = {
  warning: {
    en: 'WARNING', de: 'WARNUNG', fr: 'AVERTISSEMENT', es: 'ADVERTENCIA', it: 'AVVERTENZA', pt: 'ADVERTÊNCIA', nl: 'WAARSCHUWING', pl: 'OSTRZEŻENIE',
    bg: 'ПРЕДУПРЕЖДЕНИЕ', hr: 'UPOZORENJE', cs: 'VAROVÁNÍ', da: 'ADVARSEL', et: 'HOIATUS', fi: 'VAROITUS', el: 'ΠΡΟΕΙΔΟΠΟΙΗΣΗ', hu: 'FIGYELMEZTETÉS', lv: 'BRĪDINĀJUMS', lt: 'ĮSPĖJIMAS', ro: 'AVERTIZARE', sk: 'VAROVANIE', sl: 'OPOZORILO', sv: 'VARNING',
  },
  caution: {
    en: 'CAUTION', de: 'VORSICHT', fr: 'ATTENTION', es: 'PRECAUCIÓN', it: 'ATTENZIONE', pt: 'CUIDADO', nl: 'LET OP', pl: 'PRZESTROGA',
    bg: 'ВНИМАНИЕ', hr: 'OPREZ', cs: 'POZOR', da: 'FORSIGTIG', et: 'ETTEVAATUST', fi: 'HUOMIO', el: 'ΠΡΟΣΟΧΗ', hu: 'VIGYÁZAT', lv: 'UZMANĪBU', lt: 'ATSARGIAI', ro: 'ATENȚIE', sk: 'POZOR', sl: 'PREVIDNO', sv: 'FÖRSIKTIGHET',
  },
  electric: {
    en: 'ELECTRIC HAZARD', de: 'STROMSCHLAGGEFAHR', fr: 'DANGER ÉLECTRIQUE', es: 'PELIGRO ELÉCTRICO', it: 'PERICOLO ELETTRICO', pt: 'PERIGO ELÉTRICO', nl: 'ELEKTRISCH GEVAAR', pl: 'ZAGROŻENIE ELEKTRYCZNE',
    bg: 'ОПАСНОСТ ОТ ЕЛЕКТРИЧЕСКИ УДАР', hr: 'OPASNOST OD ELEKTRIČNE STRUJE', cs: 'NEBEZPEČÍ ÚRAZU ELEKTRICKÝM PROUDEM', da: 'FARE FOR ELEKTRISK STØD', et: 'ELEKTRILÖÖGI OHT', fi: 'SÄHKÖISKUN VAARA', el: 'ΚΙΝΔΥΝΟΣ ΗΛΕΚΤΡΟΠΛΗΞΙΑΣ', hu: 'ÁRAMÜTÉS VESZÉLYE', lv: 'ELEKTROTRIECIENA RISKS', lt: 'ELEKTROS SMŪGIO PAVOJUS', ro: 'PERICOL DE ELECTROCUTARE', sk: 'NEBEZPEČENSTVO ÚRAZU ELEKTRICKÝM PRÚDOM', sl: 'NEVARNOST ELEKTRIČNEGA UDARA', sv: 'RISK FÖR ELEKTRISK STÖT',
  },
  flammable: {
    en: 'FLAMMABLE', de: 'ENTZÜNDLICH', fr: 'INFLAMMABLE', es: 'INFLAMABLE', it: 'INFIAMMABILE', pt: 'INFLAMÁVEL', nl: 'ONTVLAMBAAR', pl: 'ŁATWOPALNE',
    bg: 'ЗАПАЛИМО', hr: 'ZAPALJIVO', cs: 'HOŘLAVÉ', da: 'BRANDFARLIGT', et: 'TULEOHTLIK', fi: 'SYTTYVÄÄ', el: 'ΕΥΦΛΕΚΤΟ', hu: 'GYÚLÉKONY', lv: 'UZLIESMOJOŠS', lt: 'DEGUS', ro: 'INFLAMABIL', sk: 'HORĽAVÉ', sl: 'VNETLJIVO', sv: 'BRANDFARLIGT',
  },
  info: {
    en: 'INFO', de: 'HINWEIS', fr: 'INFORMATION', es: 'INFORMACIÓN', it: 'INFORMAZIONI', pt: 'INFORMAÇÃO', nl: 'INFORMATIE', pl: 'INFORMACJA',
    bg: 'ИНФОРМАЦИЯ', hr: 'INFORMACIJE', cs: 'INFORMACE', da: 'INFORMATION', et: 'TEAVE', fi: 'TIEDOKSI', el: 'ΠΛΗΡΟΦΟΡΙΕΣ', hu: 'INFORMÁCIÓ', lv: 'INFORMĀCIJA', lt: 'INFORMACIJA', ro: 'INFORMAȚII', sk: 'INFORMÁCIE', sl: 'INFORMACIJE', sv: 'INFORMATION',
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

/**
 * Localized "Applies to" prefix for the per-chapter SKU header (e.g.
 * "Applies to: 10035294, 10035295"). English is the fallback.
 * NOTE: keep in sync with the viewer copy in
 * `src/modules/im-viewer/callout-titles.i18n.ts`.
 */
export const APPLIES_TO_I18N: Record<string, string> = {
  en: 'Applies to', de: 'Gilt für', fr: 'S’applique à', es: 'Se aplica a', it: 'Si applica a', pt: 'Aplica-se a', nl: 'Van toepassing op', pl: 'Dotyczy',
  bg: 'Отнася се за', hr: 'Primjenjuje se na', cs: 'Platí pro', da: 'Gælder for', et: 'Kehtib', fi: 'Koskee', el: 'Ισχύει για', hu: 'Vonatkozik', lv: 'Attiecas uz', lt: 'Taikoma', ro: 'Se aplică pentru', sk: 'Platí pre', sl: 'Velja za', sv: 'Gäller för',
};

/** Localized "Applies to" label for the SKU header. Normalizes BCP-47 → base code. */
export const getAppliesToLabel = (lang?: string): string => {
  const code = (lang ?? 'en').toLowerCase().split('-')[0];
  return APPLIES_TO_I18N[code] ?? APPLIES_TO_I18N.en;
};
