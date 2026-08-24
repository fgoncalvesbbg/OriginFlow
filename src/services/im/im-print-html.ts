/**
 * Print-HTML builder for the PDF exporter.
 *
 * Turns one or more resolved Information Manuals (`ResolvedManual`) into a SINGLE self-contained
 * HTML string for a hosted, Chromium-based HTML→PDF engine (PDFShift). It produces ONE combined
 * booklet: a shared front cover, each selected language's body in order, then a shared back cover.
 *
 * Engine note: this targets a Chromium renderer, so it deliberately AVOIDS CSS Paged Media / GCPM
 * features that only Prince-class engines support (`@page { bleed; marks }`, `position: running()`
 * margin boxes, `target-counter()`):
 *   - page numbers are added by the engine's footer (see netlify/functions/render-print-pdf.ts),
 *     not via CSS counters;
 *   - the TOC lists clickable section links (internal anchors); printed page numbers cannot come
 *     from CSS (`target-counter()` is Prince-only) — they are STAMPED at merge time from the
 *     links' own GoTo destinations (see stampTocPageNumbers in render-print-merge.ts);
 *   - pagination is flow-based (`break-before: page` per page-block) so long sections flow across
 *     pages instead of being clipped.
 *
 * Framework-agnostic and dependency-free (pure string building). The resolved HTML comes from our
 * own resolver/publish pipeline and is trusted server-side, so it is injected verbatim.
 */

import { getCalloutTitle, getContentsLabel } from './callout-titles.i18n';
import { sanitizeAuthorHtml, styleOf, IMG_TAG_RE, TAG_END_RE } from './im-author-html';
import { A5_FURNITURE_SCALE } from './im-print-geometry';
import { inferImageAlign, FLOAT_MAX_WIDTH_PCT, type ImageAlign } from './im-image-align';
import { DEFAULT_IM_LOGO_URL, DEFAULT_LEAFLET_LOGO_URL } from '../../config/im.constants';
import { defaultTypographyFor, type PrintTypography , effectiveTablePt } from './im-print-typography';
import { interFontFaceCss } from './fonts/inter-webfont';

export type PrintPageSize = 'a4' | 'a5';

// ---------------------------------------------------------------------------
// Render contract — a deliberately local, minimal shape of the published
// ResolvedManual JSON (mirrors src/modules/im-viewer/types.ts). Kept independent
// of the host `Resolved*` types because the resolver passes annotated-image
// alt/caption/label through UNRESOLVED (multilingual), so those fields may be a
// plain string OR a per-language map at runtime — we resolve them here.
// ---------------------------------------------------------------------------

type LangValue = string | Record<string, string>;

const pickLang = (v: LangValue | undefined, lang: string): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v[lang] ?? v['en'] ?? Object.values(v)[0] ?? '';
};

interface PrintAnnotatedImage {
  url: string;
  alt?: LangValue;
  caption?: LangValue;
  annotations: Array<{ number: number; x: number; y: number; label: LangValue }>;
}

type PrintNode =
  | { type: 'html'; id: string; html: string }
  | { type: 'callout'; id: string; variant: string; html: string }
  | { type: 'annotated_image_set'; id: string; images: PrintAnnotatedImage[] }
  | { type: 'legend_table'; id: string; rows: Array<{ number: number; label: string }> }
  | { type: 'step_sequence'; id: string; steps: Array<{ text: string; image?: { url: string } }> };

interface PrintSection {
  id: string;
  title: string;
  parentId: string | null;
  order: number;
  nodes: PrintNode[];
}

interface PrintManualMetadata {
  pageSize?: string;
  primaryColor?: string;
  coverImageUrl?: string;
  companyLogoUrl?: string;
  companyName?: string;
  backPageContent?: string;
  footerText?: string;
  /**
   * Per-template (therefore per-CATEGORY) font family. No longer read by the print path —
   * print typography is one global, admin-owned setting (see ./im-print-typography), so the
   * same booklet program can't print in a different font per product category. Still used by
   * the on-screen viewer/preview theme; kept here only so published manifests round-trip.
   */
  fontFamily?: string;
}

export interface PrintManual {
  language: string;
  metadata: PrintManualMetadata;
  sections: PrintSection[];
}

/**
 * Unresolved {{attribute}} tokens still present in published manual HTML. The resolver
 * leaves an unmatched token as literal `{{name}}` text (im-resolver substituteTokens),
 * which would otherwise print verbatim in the final booklet. The print pipeline's
 * prepare step scans with this and refuses to render — a print-shop artifact is the
 * least reversible output, so it fails loudly instead of shipping placeholder braces.
 */
export const findUnresolvedTokens = (
  manuals: PrintManual[],
): Array<{ language: string; section: string; token: string }> => {
  const out: Array<{ language: string; section: string; token: string }> = [];
  const seen = new Set<string>();
  const TOKEN_RE = /\{\{\s*[^{}]+?\s*\}\}/g;
  for (const manual of manuals) {
    for (const section of manual.sections) {
      for (const node of section.nodes) {
        if (!('html' in node) || !node.html) continue;
        for (const m of node.html.match(TOKEN_RE) ?? []) {
          const key = `${manual.language}::${section.id}::${m}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ language: manual.language, section: section.title, token: m });
        }
      }
    }
  }
  return out;
};

export interface PrintCoverOptions {
  logoUrl?: string;
  coverImageUrl?: string;
  title?: string;
  /** Cover subtitle. When empty, the builder auto-fills "Instruction Manual" in every printed language. */
  subtitle?: string;
  /** Certification / brand mark image URLs laid out in a row (CE, UKCA, WEEE, …). */
  markUrls?: string[];
  /** SKU / article numbers this manual covers (one IM can cover several SKUs). Shown on the cover. */
  skus?: string[];
  /** The IM / manual name, shown in the cover footer. */
  imName?: string;
  companyName?: string;
  footerText?: string;
  /**
   * Per-language directory shown on the cover ("EN Instruction Manual … 14"), so a reader
   * can jump straight to their language. `page` is the language's start page in the merged
   * booklet (null while unknown — the print function fills it in on a second cover render).
   * Only rendered for multi-language booklets; replaces the plain subtitle when present.
   */
  languageIndex?: { code: string; name: string; page: number | null }[];
}

export interface PrintBackOptions {
  contentHtml?: string;
  logoUrl?: string;
  markUrls?: string[];
}

export interface PrintHtmlOptions {
  pageSize: PrintPageSize;
  cover: PrintCoverOptions;
  back: PrintBackOptions;
  /** Publish version stamped onto the back page (e.g. 3 → "v3"). */
  version?: number;
  /**
   * Compact 'warning_leaflet' layout: no cover / TOC / language dividers / back page, a
   * per-language logo-only header, and tight spacing. Default false = the full IM booklet.
   * Only consulted by buildPrintPartsHtml (the PDF render path).
   */
  compact?: boolean;
  /**
   * The global print typography (font family, body/heading point sizes, line spacing, page
   * margins) for this template type and page size — one admin-owned setting, NOT per product
   * category. Omit to fall back to the built-in defaults, which reproduce the sizes this
   * builder used to hardcode. Margins are consumed by the render functions (they belong to
   * the PDF engine, not to CSS); the rest is consumed here.
   */
  typography?: PrintTypography;
  /**
   * Let the first content section continue on the table-of-contents page instead of forcing
   * it onto a fresh sheet.
   *
   * A TOC uses roughly 23 of the ~61 lines an A5 page holds, and the content block that
   * follows carried its own `im-break`, so the rest of that sheet was always discarded — once
   * per language. Off by default: it saves a page per language but gives up the clean
   * "contents, then the manual" separation, which is a judgement call about the printed
   * artefact rather than a straightforward win.
   */
  mergeTocIntoContent?: boolean;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const GOOGLE_FONT_IMPORTS: Record<string, string> = {
  Inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
  Roboto: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  'Open Sans': 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap',
  Lato: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap',
  Montserrat: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap',
  'Source Serif 4': 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&display=swap',
  'Noto Sans': 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&display=swap',
};

// The default font stack is Inter (see getFontStack), so an absent/unknown family must
// still import Inter — otherwise every default-font PDF silently rendered in Arial.
const getFontImport = (fontFamily?: string): string => {
  const key = fontFamily && GOOGLE_FONT_IMPORTS[fontFamily] ? fontFamily : 'Inter';
  return `@import url('${GOOGLE_FONT_IMPORTS[key]}');`;
};

const getFontStack = (fontFamily?: string): string =>
  !fontFamily || fontFamily === 'Inter' ? 'Inter, Arial, sans-serif' : `'${fontFamily}', Arial, sans-serif`;

/**
 * Every string that could reach the page, used to decide which Inter subsets to inline.
 *
 * Serialising the manuals is deliberately crude: over-including a subset costs a few KB of
 * request payload, whereas missing one would put a fallback typeface on the page — the exact
 * failure this replaced.
 */
const documentTextOf = (manuals: PrintManual[]): string => JSON.stringify(manuals);

/**
 * Font CSS for the print stylesheet.
 *
 * Inter — the default, and the family every profile currently uses — is inlined as @font-face
 * data URIs by interFontFaceCss, so the render no longer depends on a fonts.googleapis.com
 * fetch that PDFShift is never told to wait for. The other whitelisted families are still
 * fetched remotely and remain subject to that race; anything unrecognised falls through to the
 * embedded Inter rather than to a remote request.
 */
const buildFontCss = (fontFamily: string | undefined, documentText: string): string =>
  fontFamily && fontFamily !== 'Inter' && GOOGLE_FONT_IMPORTS[fontFamily]
    ? getFontImport(fontFamily)
    : interFontFaceCss(documentText);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Keep in sync with IM_LANGUAGES (src/config/im-languages.ts) — a missing entry makes the
// language divider print the raw code ("BG") instead of the native name.
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano',
  nl: 'Nederlands', pt: 'Português', pl: 'Polski', cs: 'Čeština', sv: 'Svenska',
  da: 'Dansk', fi: 'Suomi', no: 'Norsk', ro: 'Română', hu: 'Magyar',
  bg: 'Български', hr: 'Hrvatski', et: 'Eesti', el: 'Ελληνικά',
  lv: 'Latviešu', lt: 'Lietuvių', sk: 'Slovenčina', sl: 'Slovenščina',
};
const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code.toUpperCase();

/** "Instruction Manual" per language — used for the multilingual cover subtitle. */
// Every language in src/config/im-languages.ts (IM_LANGUAGES) must have an entry here —
// a missing one falls back to the raw code (e.g. "BG" instead of a translated phrase),
// which is exactly the bug this map exists to prevent. Keep the two lists in sync.
const INSTRUCTION_MANUAL_NAMES: Record<string, string> = {
  en: 'INSTRUCTION MANUAL', de: 'BEDIENUNGSANLEITUNG', fr: "MODE D'EMPLOI",
  es: 'MANUAL DE INSTRUCCIONES', it: 'MANUALE DI ISTRUZIONI', nl: 'GEBRUIKSAANWIJZING',
  pt: 'MANUAL DE INSTRUÇÕES', pl: 'INSTRUKCJA OBSŁUGI', cs: 'NÁVOD K POUŽITÍ',
  sv: 'BRUKSANVISNING', da: 'BRUGSANVISNING', fi: 'KÄYTTÖOHJE', no: 'BRUKSANVISNING',
  ro: 'MANUAL DE UTILIZARE', hu: 'HASZNÁLATI ÚTMUTATÓ',
  bg: 'ИНСТРУКЦИЯ ЗА УПОТРЕБА', hr: 'UPUTE ZA UPORABU', et: 'KASUTUSJUHEND',
  el: 'ΟΔΗΓΙΕΣ ΧΡΗΣΗΣ', lv: 'LIETOŠANAS INSTRUKCIJA', lt: 'NAUDOJIMO INSTRUKCIJA',
  sk: 'NÁVOD NA POUŽITIE', sl: 'NAVODILA ZA UPORABO',
};

/** "Instruction Manual" rendered in each printed language (deduped, in order). */
const multilingualSubtitle = (languages: string[]): string => {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const l of languages) {
    const name = INSTRUCTION_MANUAL_NAMES[l] ?? INSTRUCTION_MANUAL_NAMES.en;
    if (!seen.has(name)) {
      seen.add(name);
      parts.push(name);
    }
  }
  return parts.join(' · ');
};

const PAGE_DIMS: Record<PrintPageSize, { h: number; css: string }> = {
  a4: { h: 297, css: 'A4' },
  a5: { h: 210, css: 'A5' },
};

/**
 * Height (mm) a full-bleed page block (cover / language divider / back page) must claim to
 * fill its page. Derived from the configured margins rather than hardcoded, so changing the
 * page margins in the admin settings can't leave the cover short or overflowing onto a second
 * page. The 8mm slack is what the old hardcoded values (A4 255, A5 168 against 16+18mm
 * margins) carried, and keeps a rounding-up renderer from spilling one line over.
 */
const fillHeightMm = (pageSize: PrintPageSize, typography: PrintTypography): number =>
  Math.max(40, PAGE_DIMS[pageSize].h - typography.margins.top - typography.margins.bottom - 8);

// ---------------------------------------------------------------------------
// ISO 7010 callout icons (ported from src/modules/im-viewer/html.ts).
// ---------------------------------------------------------------------------

const ISO_W001 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><rect x="46.5" y="30" width="7" height="31" rx="2.5" fill="#231F20"/><circle cx="50" cy="73" r="5.5" fill="#231F20"/></svg>`;
const ISO_W012 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><path d="M57,24 L39,55 L51,55 L44,78 L62,47 L50,47 Z" fill="#231F20"/></svg>`;
const ISO_M002 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><circle cx="50" cy="50" r="46" fill="#0066B2"/><circle cx="50" cy="26" r="7" fill="white"/><rect x="43" y="40" width="14" height="36" rx="4" fill="white"/></svg>`;
// ISO 7010 W021 — Flammable material
const ISO_W021 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 525" style="display:block;width:100%;height:100%;"><path d="M 597.6,499.6 313.8,8 C 310.9,3 305.6,0 299.9,0 294.2,0 288.9,3.1 286,8 L 2.2,499.6 c -2.9,5 -2.9,11.1 0,16 2.9,5 8.2,8 13.9,8 h 567.6 c 5.7,0 11,-3.1 13.9,-8 2.9,-5 2.9,-11.1 0,-16 z" fill="#231F20"/><polygon points="43.875,491.5 299.875,48.2 555.875,491.5" transform="matrix(1,0,0,0.99591458,0.125,2.0332437)" fill="#FFDA00"/><path d="m 254.20599,412.70348 c -23.76019,-10.34209 -33.09455,-30.39188 -35.71706,-76.71863 -1.06141,-18.75 -1.13418,-34.09091 -0.16169,-34.09091 0.97249,0 4.29519,1.35243 7.38379,3.00539 4.98824,2.66964 5.99798,1.23079 9.03804,-12.87878 1.88233,-8.7363 4.23436,-21.75719 5.22673,-28.9353 l 1.80431,-13.05112 9.88246,9.57846 9.88247,9.57846 2.12479,-22.67469 c 1.16864,-12.47108 1.16355,-27.05119 -0.0112,-32.40024 -2.00776,-9.14129 -1.75819,-9.52331 4.15445,-6.35896 3.45979,1.85162 7.7334,6.06261 9.4969,9.35775 5.94987,11.11759 9.05366,6.09812 9.05366,-14.64178 0,-13.03057 1.58382,-22.79895 4.2985,-26.51149 4.12866,-5.64628 4.38304,-5.54174 6.43797,2.64577 1.17671,4.68838 8.03213,15.42775 15.23426,23.86526 7.20212,8.43751 13.64618,18.9181 14.32012,23.29019 l 1.22533,7.94926 0.45403,-8.33333 c 0.57982,-10.64199 4.12382,-10.5344 13.32837,0.4046 6.66394,7.91962 10.13451,17.48588 16.069,44.29237 1.93451,8.73845 2.1136,8.82656 4.61879,2.27273 3.3383,-8.7334 6.86421,-8.63774 11.65621,0.31623 4.67369,8.73288 5.39436,24.48257 2.30806,50.44134 -2.07621,17.46282 -1.84452,19.07567 2.04276,14.21936 4.04869,-5.05797 4.53933,-4.56179 6.4043,6.47691 2.55164,15.10294 -2.7687,35.42364 -12.71633,48.56921 -9.97903,13.18712 -34.5024,24.60594 -52.92676,24.6443 -17.95679,0.0373 -20.42284,-3.76866 -7.41467,-11.44366 11.92246,-7.03443 24.03985,-22.06988 30.77215,-38.18258 4.52855,-10.83827 4.49197,-11.358 -0.68324,-9.71542 -4.83224,1.53367 -5.35055,0.0658 -4.4593,-12.62848 l 1.00842,-14.36388 -7.91642,11.36363 c -10.00264,14.35834 -14.15034,14.55197 -10.26464,0.47915 3.75124,-13.58587 0.74797,-33.0383 -7.09173,-45.93369 -3.29306,-5.41667 -6.46488,-9.84849 -7.04853,-9.84849 -0.58364,0 -1.01554,11.25 -0.95978,25 0.0994,24.51621 -3.69021,41.66667 -9.20685,41.66667 -1.52966,0 -4.90224,-5.11364 -7.49462,-11.36364 l -4.71341,-11.36363 -0.46317,10.60606 c -0.25472,5.83333 -0.22051,15.03788 0.076,20.45454 0.29655,5.41667 -0.85159,9.84849 -2.55145,9.84849 -5.08631,0 -12.55008,-12.86679 -14.502,-25 -2.00506,-12.46355 -6.84316,-15.36643 -7.57568,-4.54546 -0.9802,14.47946 -1.44911,15.88549 -5.04602,15.13052 -8.24799,-1.73121 3.85695,30.08491 17.24971,45.33839 5.20849,5.93215 9.46999,11.62842 9.46999,12.65842 0,3.31249 -16.373,1.76328 -26.09704,-2.4693 z M 185,455 l 0,-25 230,0 0,25 z" fill="#231F20"/></svg>`;

// ISO 7010 W017 — Hot surface
const ISO_W017 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 525" style="display:block;width:100%;height:100%;"><path d="M597.6,499.6,313.8,8c-2.9-5-8.2-8-13.9-8s-11,3.1-13.9,8l-283.8,491.6c-2.9,5-2.9,11.1,0,16,2.9,5,8.2,8,13.9,8h567.6c5.7,0,11-3.1,13.9-8,2.9-5,2.9-11.1,0-16z" fill="#231F20"/><polygon points="43.875,491.5,299.88,48.2,555.88,491.5" transform="matrix(1,0,0,0.99591458,0.125,2.0332437)" fill="#FFDA00"/><rect x="175" y="437" width="250" height="25" fill="#231F20"/><path d="M242.68,415c56.86-81.3-60.68-104.16-2.68-185" stroke="#231F20" stroke-width="16" fill="none"/><path d="m303.78,414.51c56.86-81.3-60.561-103.43-2.561-184.27" stroke="#231F20" stroke-width="16" fill="none"/><path d="M365,415c56.86-81.3-59.23-104.65-1.22-185.49" stroke="#231F20" stroke-width="16" fill="none"/></svg>`;

type CalloutVariant = 'warning' | 'danger' | 'caution' | 'electric' | 'flammable' | 'hot_surface' | 'info';
const ISO_ICONS: Record<CalloutVariant, string> = {
  warning: ISO_W001, danger: ISO_W001, caution: ISO_W001, electric: ISO_W012, flammable: ISO_W021, hot_surface: ISO_W017, info: ISO_M002,
};
const wrapCallout = (variant: CalloutVariant, contentHtml: string, lang: string): string => {
  if (!contentHtml) return contentHtml;
  const icon = ISO_ICONS[variant] ?? ISO_M002;
  const title = getCalloutTitle(variant, lang);
  return `<div class="imv-block-wrapper imv-block-${variant}"><div class="imv-block-icon">${icon}</div><div class="imv-block-content"><strong class="imv-block-title">${title}</strong>${contentHtml}</div></div>`;
};

// ---------------------------------------------------------------------------
// Node rendering — mirrors src/modules/im-viewer/NodeRenderer.tsx output.
// ---------------------------------------------------------------------------

const renderAnnotatedImage = (img: PrintAnnotatedImage, lang: string): string => {
  const markers = img.annotations
    .map((a) => `<span class="imv-marker" style="left:${a.x * 100}%;top:${a.y * 100}%">${a.number}</span>`)
    .join('');
  const captionText = pickLang(img.caption, lang);
  const caption = captionText ? `<div class="imv-caption">${escapeHtml(captionText)}</div>` : '';
  const legend = img.annotations.length
    ? `<ul class="imv-legend">${[...img.annotations]
        .sort((a, b) => a.number - b.number)
        .map(
          (a) =>
            `<li><span class="imv-legend-num">${a.number}</span><span>${escapeHtml(pickLang(a.label, lang))}</span></li>`,
        )
        .join('')}</ul>`
    : '';
  return `<div class="imv-annotated-item"><div class="imv-annotated-frame"><img src="${img.url}" alt="${escapeHtml(
    pickLang(img.alt, lang),
  )}" />${markers}</div>${caption}${legend}</div>`;
};

const DATA_ALIGN_RE = /\bdata-align\s*=\s*"([a-z]+)"/i;

/**
 * Does the tag carry an explicit width? `max-width` deliberately does not count — the pattern
 * anchors `width` to the start of a declaration, so `max-width:` never matches.
 */
const WIDTH_DECL_RE = /(^|;)\s*width\s*:/i;
const WIDTH_ATTR_RE = /\swidth\s*=/i;

/** The default full-width band, for an image that asks for no placement of its own. */
type PrintImageAlign = ImageAlign | 'block';

/**
 * The placement an image asks for, defaulting to a band of its own.
 *
 * The decision itself lives in im-image-align so the editor and this renderer cannot disagree
 * about what a given image means; only the parsing differs, since here the style is still a
 * string rather than a parsed CSSStyleDeclaration.
 */
const printAlignOf = (tag: string): PrintImageAlign => {
  const style = styleOf(tag).toLowerCase();
  const declaration = (name: string) =>
    style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1]?.trim() ?? null;
  return (
    inferImageAlign(tag.match(DATA_ALIGN_RE)?.[1], {
      cssFloat: declaration('float'),
      display: declaration('display'),
      margin: declaration('margin') ?? declaration('margin-left'),
    }) ?? 'block'
  );
};

/**
 * Author HTML, repaired and then annotated for the print stylesheet.
 *
 * sanitizeAuthorHtml applies the same repairs the editor now makes on ingress, so an export is
 * correct even for content saved before that existed. The annotation is print-only: it records
 * the placement each image asked for, and whether the author gave it a width, so the stylesheet
 * can float it and cap only the unsized ones.
 */
const normalizeAuthorHtmlForPrint = (html: string): string =>
  sanitizeAuthorHtml(html).replace(IMG_TAG_RE, (tag) => {
    const align = printAlignOf(tag);
    const sized = WIDTH_DECL_RE.test(styleOf(tag)) || WIDTH_ATTR_RE.test(tag);
    return tag.replace(
      TAG_END_RE,
      ` data-print-align="${align}" data-print-width="${sized ? 'set' : 'auto'}"$1`,
    );
  });

const renderNode = (node: PrintNode, lang: string): string => {
  switch (node.type) {
    case 'html':
      return `<div class="imv-node imv-content">${normalizeAuthorHtmlForPrint(node.html)}</div>`;
    case 'callout':
      return `<div class="imv-node imv-content">${wrapCallout(node.variant as CalloutVariant, normalizeAuthorHtmlForPrint(node.html), lang)}</div>`;
    case 'annotated_image_set':
      return `<div class="imv-node imv-annotated">${node.images.map((img) => renderAnnotatedImage(img, lang)).join('')}</div>`;
    case 'legend_table':
      return `<div class="imv-node"><table class="imv-legend-table"><tbody>${[...node.rows]
        .sort((a, b) => a.number - b.number)
        .map((r) => `<tr><td>${r.number}</td><td>${escapeHtml(r.label)}</td></tr>`)
        .join('')}</tbody></table></div>`;
    case 'step_sequence':
      return `<ol class="imv-node imv-steps">${node.steps
        .map(
          (s) =>
            `<li class="imv-step"><span class="imv-step-num" aria-hidden="true"></span><div class="imv-step-body"><div>${escapeHtml(
              s.text,
            )}</div>${s.image?.url ? `<img class="imv-step-img" src="${s.image.url}" alt="" />` : ''}</div></li>`,
        )
        .join('')}</ol>`;
    default:
      return '';
  }
};

// ---------------------------------------------------------------------------
// Page builders
// ---------------------------------------------------------------------------

const markRow = (urls?: string[]): string =>
  urls && urls.length
    ? `<div class="im-marks">${urls.map((u) => `<img class="im-mark" src="${u}" alt="" />`).join('')}</div>`
    : '';

/** Cover language directory: one row per language — code · localized name · start page. */
const buildLanguageIndex = (entries: NonNullable<PrintCoverOptions['languageIndex']>): string => `
  <div class="im-cover-index">
    ${entries
      .map(
        (e) =>
          `<div class="im-cover-index-row"><span class="im-cix-code">${escapeHtml(e.code)}</span>` +
          `<span class="im-cix-name">${escapeHtml(e.name)}</span>` +
          `<span class="im-cix-pg">${e.page != null ? e.page : ''}</span></div>`,
      )
      .join('')}
  </div>`;

/**
 * Compact leaflet header — a logo-only bar shown at the top of the first page of each language
 * (the Warning Leaflet has no cover page). Empty when no logo is available.
 */
const buildLeafletHeader = (logoUrl?: string): string =>
  logoUrl
    ? `<header class="im-leaflet-header"><img src="${logoUrl}" alt="Logo" class="im-leaflet-logo" /></header>`
    : '';

const buildCoverPage = (opts: PrintCoverOptions, languages: string[]): string => {
  const coverImage = opts.coverImageUrl
    ? `<div class="im-cover-image" style="background-image:url('${opts.coverImageUrl}')"></div>`
    : '';
  const logo = opts.logoUrl ? `<img src="${opts.logoUrl}" alt="Logo" class="im-cover-logo" />` : '';
  // Subtitle: explicit override wins; otherwise "Instruction Manual" in every printed language.
  const subtitle = opts.subtitle && opts.subtitle.trim() ? opts.subtitle : multilingualSubtitle(languages);
  const skus = (opts.skus ?? []).filter(Boolean);
  const skuLine = skus.length
    ? `<div class="im-cover-skus">${skus.length > 1 ? 'Art. Nos.' : 'Art. No.'}: ${escapeHtml(skus.join(' · '))}</div>`
    : '';
  const imNameLine = opts.imName ? `<div class="im-cover-imname">${escapeHtml(opts.imName)}</div>` : '';
  return `
    <section class="im-page im-page-cover">
      <div class="im-cover-body">
        <div>
          ${logo}
          <h1 class="im-cover-title">${escapeHtml(opts.title || '')}</h1>
          ${opts.languageIndex && opts.languageIndex.length > 1
            ? buildLanguageIndex(opts.languageIndex)
            : `<p class="im-cover-subtitle">${escapeHtml(subtitle)}</p>`}
        </div>
        ${coverImage}
        <div class="im-cover-footer">
          ${markRow(opts.markUrls)}
          <div><strong>${escapeHtml(opts.companyName || '')}</strong></div>
          ${imNameLine}
          ${skuLine}
        </div>
      </div>
    </section>
  `;
};

/**
 * Order sections in per-parent DFS reading order — the same order the resolver emits and the
 * live preview shows. `order` is assigned per sibling-group (10/20/30 within each parent), so a
 * flat global sort would interleave children of different parents and break the hierarchy.
 */
const flattenInReadingOrder = (sections: PrintSection[]): PrintSection[] => {
  const byParent = new Map<string | null, PrintSection[]>();
  for (const s of sections) {
    const p = s.parentId ?? null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(s);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);
  const out: PrintSection[] = [];
  const walk = (parent: string | null) => {
    for (const s of byParent.get(parent) ?? []) { out.push(s); walk(s.id); }
  };
  walk(null);
  return out;
};

const buildTocPage = (manual: PrintManual, band = ''): string => {
  const ordered = flattenInReadingOrder(manual.sections);
  const rows = ordered
    .map((s) => `<a class="im-toc-row${s.parentId ? ' im-toc-sub' : ''}" href="#sec-${s.id}">${escapeHtml(s.title)}</a>`)
    .join('');
  return `
    <section class="im-page im-break im-page-toc">
      ${band}
      <h2 class="im-toc-title">${escapeHtml(getContentsLabel(manual.language))}</h2>
      <nav class="im-toc">${rows}</nav>
    </section>
  `;
};

// Sections flow continuously within a single content page (matching the live preview), instead
// of forcing a new page per section. Only the content block as a whole starts on a fresh page
// (im-break); individual sections break naturally on overflow.
const buildSectionPages = (manual: PrintManual, startOnNewPage = true): string => {
  const ordered = flattenInReadingOrder(manual.sections);
  const inner = ordered
    .map((section) => {
      const body = section.nodes.map((n) => renderNode(n, manual.language)).join('');
      return `
        <section id="sec-${section.id}" class="im-section">
          <h2 class="im-section-title">${escapeHtml(section.title)}</h2>
          <div class="im-section-content">${body}</div>
        </section>
      `;
    })
    .join('');
  // Dropping im-break lets the block continue on the TOC page; the sections inside still
  // break naturally on overflow either way.
  const cls = startOnNewPage ? 'im-page im-break im-page-content' : 'im-page im-page-content';
  return `<div class="${cls}">${inner}</div>`;
};

/**
 * The language's name as a band at the top of its own TOC page.
 *
 * This used to be a standalone page ("im-page im-break im-page-divider" plus a min-height
 * that filled the sheet) carrying three lines. On a five-language booklet that was five
 * whole sheets spent on wayfinding the colour-coded edge tabs already provide, so the name
 * now rides above that language's table of contents instead.
 */
const buildLanguageBand = (code: string): string => `
    <div class="im-lang-band">
      <span class="im-lang-band-name">${escapeHtml(languageName(code))}</span>
      <span class="im-lang-band-code">${escapeHtml(code.toUpperCase())}</span>
    </div>
`;

const buildBackPage = (opts: PrintBackOptions, companyName: string, versionLabel: string): string => {
  const logo = opts.logoUrl ? `<img src="${opts.logoUrl}" alt="Logo" class="im-end-logo" />` : '';
  const year = new Date().getFullYear();
  return `
    <section class="im-page im-break im-page-end">
      ${logo}
      ${opts.contentHtml ? `<div class="im-end-content imv-content">${opts.contentHtml}</div>` : ''}
      ${markRow(opts.markUrls)}
      <div class="im-end-copyright">© ${year} ${escapeHtml(
        companyName || '',
      )}. All rights reserved.${versionLabel ? ` · ${versionLabel}` : ''}</div>
    </section>
  `;
};

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

// Light, faded colors so the flags stay legible in B&W (and don't hog toner). The
// language's staggered VERTICAL slot is the primary index; color is a secondary cue.
export const TAB_PALETTE = [
  '#bfdbfe', '#bbf7d0', '#fde68a', '#fecaca', '#ddd6fe', '#a5f3fc',
  '#fbcfe8', '#d9f99d', '#fed7aa', '#99f6e4', '#c7d2fe', '#e2e8f0',
];

export interface TabLayout {
  topMm: number;
  heightMm: number;
  widthMm: number;
  color: string;
}

/**
 * Geometry + color for language `index`'s edge thumb-tab. Tabs step DOWN the page (one
 * vertical slot per language) so a fanned booklet reads as a thumb-index. The tab is
 * drawn onto the MERGED pdf by the print function (see render-print-pdf), which also
 * alternates the outer edge per page (recto=right, verso=left) for the bound booklet.
 */
export const getTabLayout = (index: number, total: number, pageSize: PrintPageSize): TabLayout => {
  const pageH = PAGE_DIMS[pageSize].h;
  const topStart = 30;                 // clear of the running header band
  const bandH = pageH - topStart - 30; // clear of the footer band
  const slot = bandH / Math.max(total, 1);
  const heightMm = Math.min(slot * 0.72, 26);
  const widthMm = pageSize === 'a5' ? 7 : 8;
  const topMm = topStart + index * slot + (slot - heightMm) / 2;
  return { topMm, heightMm, widthMm, color: TAB_PALETTE[index % TAB_PALETTE.length] };
};

/**
 * Compact-leaflet CSS overrides, appended AFTER the shared rules (so the full-IM path stays
 * byte-identical). Removes filler heights and tightens spacing to squeeze the leaflet into as
 * few pages as possible while staying readable, and styles the logo-only header.
 *
 * Sizes come from the leaflet's own global profile (Admin → IM Print), which is why leaflets
 * and full manuals can share one settings table without one of them becoming unreadable: a
 * leaflet must fit a few pages at ~6pt, a manual is set at ~10.8pt.
 */
const compactOverrides = (primaryColor: string, textPt: number, headingPt: number, lineHeight: number): string => `
    /* --- Warning Leaflet compact overrides --- */
    .im-leaflet-header { display: flex; align-items: center; margin: 0 0 3mm; padding-bottom: 1.5mm; border-bottom: 0.5mm solid ${primaryColor}; }
    .im-leaflet-logo { height: 8mm; width: auto; object-fit: contain; }
    /* Each language is its own render part, so the content block must NOT force a page break —
       otherwise the logo header would sit alone on page 1 and content would start on page 2. */
    .im-page-content { padding: 0; break-before: auto; page-break-before: auto; }

    /* Uniform typography: EVERY element in the leaflet content uses the chosen body size, and
       every heading the chosen heading size — no per-element exceptions. Numeric badges use em
       units below so they scale with the text instead of overflowing their circles. */
    .im-page-content, .im-page-content * { font-size: ${textPt}pt; line-height: ${lineHeight}; }
    .im-section-title,
    .im-section-content h1, .im-section-content h2, .im-section-content h3,
    .imv-block-title { font-size: ${headingPt}pt; line-height: 1.2; }

    .im-section { margin: 0 0 2.5mm; }
    .im-section-title { margin: 0 0 1.5mm; padding-bottom: 1mm; }
    .im-section-content h1, .im-section-content h2, .im-section-content h3 { margin: 1.5mm 0 1mm; }

    /* ISO-symbol callout boxes — tighter padding / margin / gap and a smaller icon. */
    .imv-block-wrapper { gap: 0.4rem; padding: 0.35rem 0.5rem; margin: 0.4rem 0; border-left-width: 3px; border-radius: 4px; }
    .imv-block-icon { width: 22px; height: 22px; }
    .imv-block-title { margin-bottom: 0.1rem; }
    .imv-block-content p { margin: 0 0 0.2em; }
    .imv-block-content p:last-child { margin-bottom: 0; }

    .imv-annotated, .imv-steps, .imv-legend-table { margin: 0.5rem 0; }
    .imv-annotated-item { margin-bottom: 0.5rem; }
    .imv-step { margin-bottom: 6px; gap: 10px; }
    /* Numeric badges scale with the text so they never overflow at larger sizes. */
    .imv-marker { width: 1.9em; height: 1.9em; }
    .imv-legend-num { min-width: 1.7em; height: 1.7em; }
    .imv-step-num { width: 2.1em; height: 2.1em; }
`;

/**
 * The shared stylesheet.
 *
 * Two distinct scales are at work here, on purpose:
 *   - RUNNING TEXT (body copy, section titles, TOC rows, the back page's content) is sized in
 *     POINTS from the global typography profile, because that is the thing an operator sets in
 *     Admin → IM Print and expects to hold for every manual regardless of category.
 *   - PAGE FURNITURE (cover title, the language-divider display type, cover logo/mark sizes)
 *     stays on the mm-based `mm()` scale below, which shrinks by 0.82 on A5. That type is
 *     laid out against the sheet, not read as prose, so it must track the paper rather than
 *     the reader's font-size setting.
 * Everything derived from `headingPt` uses the ratios the old hardcoded mm values had
 * (title 6.2 : h1 5.5 : h2 5.0 : h3 4.5), so one heading number still yields the same
 * hierarchy.
 */
const buildStyles = (
  pageSize: PrintPageSize,
  primaryColor: string,
  typography: PrintTypography,
  compact = false,
  fontCss = '',
): string => {
  const dims = PAGE_DIMS[pageSize];
  const s = pageSize === 'a5' ? A5_FURNITURE_SCALE : 1; // page furniture only (see above)
  const mm = (base: number) => `${(base * s).toFixed(2)}mm`;
  const fillH = fillHeightMm(pageSize, typography);
  const { bodyPt, headingPt, lineHeight, tableCellPaddingMm, cellImageMaxHeightMm, blockSpacingMm, paragraphSpacingEm, tableFontScale, tableBorderMm } = typography;
  // Table/image density is an absolute per-profile setting: each (template, page size) pair
  // has its own row, so it must NOT go through mm() and pick up the A5 furniture scale.
  const absMm = (value: number) => `${Number(value.toFixed(2))}mm`;
  // Vertical rhythm between content blocks, plus the half step used for tighter pairings
  // (a caption under its image, a callout title above its body).
  const gap = absMm(blockSpacingMm);
  const halfGap = absMm(blockSpacingMm / 2);
  // Paragraph and list rhythm. List items sit tighter than paragraphs — they are already
  // visually grouped by their markers — so they take a fraction of the same setting rather
  // than a second knob that could contradict it.
  const paraGap = `${Number(paragraphSpacingEm.toFixed(3))}em`;
  const itemGap = `${Number((paragraphSpacingEm * 0.3).toFixed(3))}em`;
  const pt = (value: number) => `${Number(value.toFixed(2))}pt`;
  // Tabular text runs a step below body by convention, but this is safety content: the scale
  // is floored so no setting can shrink it without limit.
  const tablePt = pt(effectiveTablePt(bodyPt, tableFontScale));
  // A table rule is furniture supporting the text, not a box around it: 1px (0.75pt) read as
  // heavy against 6.65pt cell text. Absolute mm, so it does not pick up the A5 furniture scale
  // and quietly become a different weight per page size.
  const tableRule = `${absMm(tableBorderMm)} solid #cbd5e1`;
  return `
    ${fontCss}
    :root { color-scheme: light only; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: ${getFontStack(typography.fontFamily)}; color: #1f2937; }

    /* Page size only — the engine owns margins (so its footer/page-numbers sit in the bottom
       margin). No bleed/crop marks (Chromium engine = screen-grade output). */
    @page { size: ${dims.css}; }

    /* Flow-based pagination: the cover is the first page; every following block starts a new page,
       and long sections flow naturally across pages (no clipping). */
    .im-page { position: relative; }
    .im-break { break-before: page; page-break-before: always; }

    /* Cover (shared) */
    .im-page-cover { min-height: ${fillH}mm; display: flex; flex-direction: column; }
    .im-cover-body { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
    /* Cover image: centered in the page's middle band, scaled to FIT (never cropped or
       stretched), capped so it can't crowd the title above or the footer below. */
    .im-cover-image { flex: 1; min-height: 0; max-height: ${mm(150)}; margin: ${mm(12)} 0; background-size: contain; background-position: center; background-repeat: no-repeat; }
    /* Logo and the two cover headers are intentionally half-size (per brand spec). */
    .im-cover-logo { height: ${mm(9)}; object-fit: contain; margin-bottom: ${mm(16)}; }
    .im-cover-title { margin: 0 0 ${mm(6)}; color: ${primaryColor}; font-size: ${mm(8)}; line-height: 1.1; }
    .im-cover-subtitle { margin: 0; color: #475569; font-size: ${mm(3)}; letter-spacing: 0.2em; text-transform: uppercase; line-height: 1.4; }
    /* Cover language directory — jump-to-your-language index (2 columns for compactness). */
    .im-cover-index { columns: 2; column-gap: ${mm(8)}; margin: ${mm(1)} 0 0; font-size: ${mm(3)}; }
    .im-cover-index-row { display: flex; align-items: baseline; gap: ${mm(2)}; break-inside: avoid; margin-bottom: ${mm(1.2)}; color: #334155; }
    .im-cix-code { font-weight: 800; color: ${primaryColor}; min-width: ${mm(7)}; }
    .im-cix-name { flex: 1; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .im-cix-pg { font-weight: 700; color: ${primaryColor}; font-variant-numeric: tabular-nums; }
    .im-cover-footer { border-top: 1.5mm solid ${primaryColor}; padding-top: ${mm(6)}; font-size: ${mm(3.4)}; color: #334155; }
    .im-cover-imname { margin-top: ${mm(1.5)}; color: #475569; }
    .im-cover-skus { margin-top: ${mm(1.5)}; font-weight: 600; letter-spacing: 0.02em; color: #334155; }

    /* Certification / brand marks */
    .im-marks { display: flex; flex-wrap: wrap; gap: ${mm(4)}; align-items: center; margin-bottom: ${mm(6)}; }
    .im-mark { height: ${mm(12)}; width: auto; object-fit: contain; }

    /* Language divider */
    .im-lang-band { display: flex; align-items: baseline; justify-content: space-between; gap: ${mm(3)}; margin: 0 0 ${mm(3)}; }
    .im-lang-band-name { color: ${primaryColor}; font-size: ${mm(5)}; font-weight: 700; line-height: 1.1; }
    .im-lang-band-code { color: #64748b; letter-spacing: 0.3em; font-size: ${mm(2.6)}; }

    /* TOC — clickable links. Page numbers are stamped into each row's link rectangle at
       merge time (stampTocPageNumbers), so the row reserves right padding for them: a long
       title must not run under the stamped number. */
    .im-page-toc .im-toc-title { color: ${primaryColor}; font-size: ${mm(7)}; border-bottom: 0.6mm solid ${primaryColor}; margin: 0 0 ${mm(6)}; padding-bottom: ${mm(2)}; }
    .im-toc { display: block; }
    .im-toc-row { display: block; text-decoration: none; color: #1f2937; padding: ${mm(1.6)} ${mm(10)} ${mm(1.6)} 0; border-bottom: 1px solid #f1f5f9; font-size: ${pt(bodyPt)}; }
    .im-toc-row.im-toc-sub { padding-left: ${mm(6)}; color: #475569; font-size: ${pt(bodyPt * 0.92)}; }

    /* Section content — sections flow continuously (like the preview); the whole content block
       is the only forced page. A title never sits orphaned at the foot of a page. */
    .im-section { margin: 0 0 ${mm(8)}; }
    .im-section-title { margin: 0 0 ${mm(5)}; padding-bottom: ${mm(2)}; border-bottom: 0.6mm solid ${primaryColor}; color: ${primaryColor}; font-size: ${pt(headingPt)}; break-after: avoid; }
    .im-section-content { font-size: ${pt(bodyPt)}; line-height: ${lineHeight}; color: #1f2937; }
    .im-section-content h1, .im-section-content h2, .im-section-content h3 { color: ${primaryColor}; margin: ${mm(4)} 0 ${mm(2)}; break-after: avoid; }
    /* h1/h2/h3 keep the ratios the old hardcoded mm sizes had (5.5/5.0/4.5 against a 6.2
       section title), so one heading setting still yields the same hierarchy. */
    .im-section-content h1 { font-size: ${pt(headingPt * 0.887)}; }
    .im-section-content h2 { font-size: ${pt(headingPt * 0.806)}; }
    .im-section-content h3 { font-size: ${pt(headingPt * 0.726)}; }

    /* Rich content (ported from im-viewer.css) */
    .imv-content { line-height: ${lineHeight}; color: #374151; }
    .imv-content ul { list-style: disc; padding-left: 1.5em; margin: 0 0 ${paraGap}; }
    .imv-content ol { list-style: decimal; padding-left: 1.5em; margin: 0 0 ${paraGap}; }
    .imv-content li { display: list-item; margin-bottom: ${itemGap}; }
    .imv-content p { margin: 0 0 ${paraGap}; }
    .imv-content b, .imv-content strong { font-weight: 700; }
    .imv-content i, .imv-content em { font-style: italic; }
    .imv-content u { text-decoration: underline; }
    .imv-content a { color: ${primaryColor}; text-decoration: underline; }
    /* Images. The author picks the placement in the editor (Align: inline / left / right /
       centered) and normalizeAuthorHtmlForPrint hoists that choice to data-print-align, having
       stripped the inline margins the editor bakes in - an inline style beats this stylesheet,
       so a 1rem (8.47mm) margin was otherwise frozen onto every image whatever the page size.
       object-fit preserves the aspect ratio when max-height binds on a width-pinned image. */
    .imv-content img { max-width: 100%; max-height: ${absMm(cellImageMaxHeightMm)}; height: auto; object-fit: contain; border-radius: 4px; }
    .imv-content img[data-print-align="block"] { display: block; margin: ${gap} 0; }
    .imv-content img[data-print-align="center"] { display: block; margin: ${gap} auto; }
    .imv-content img[data-print-align="left"] { float: left; margin: 0 ${gap} ${halfGap} 0; }
    .imv-content img[data-print-align="right"] { float: right; margin: 0 0 ${halfGap} ${gap}; }
    /* An unsized float would fill the column at max-width:100% and leave room for exactly one
       line beside it — the worst of both layouts. An author width is respected instead. */
    .imv-content img[data-print-align="left"][data-print-width="auto"],
    .imv-content img[data-print-align="right"][data-print-width="auto"] { max-width: ${FLOAT_MAX_WIDTH_PCT}%; }
    .imv-content img[data-print-align="inline"] { display: inline; vertical-align: middle; margin: 0 ${halfGap}; }
    /* A float must not escape its node and drag into the next section: the layout is
       flow-based, so an uncleared float would shift pagination downstream. */
    .imv-node.imv-content::after { content: ""; display: table; clear: both; }
    .imv-content table { width: 100%; border-collapse: collapse; margin: ${gap} 0; font-size: ${tablePt}; }
    /* Author-chosen width mode: data-table-fit="content" shrinks the table to its content
       instead of stretching across the column — for icon/label pairs and narrow specs that
       full-width layout was padding with empty space. Mirrors im-content.css exactly. */
    .imv-content table[data-table-fit="content"] { width: auto; }
    /* Author column widths (a <colgroup> of % widths). \`fixed\` makes the engine honour the
       percentages exactly; only for full-width tables, where \`fixed\` has a width to fix to. */
    .imv-content table[data-col-widths]:not([data-table-fit="content"]) { table-layout: fixed; }
    .imv-content th, .imv-content td { border: ${tableRule}; padding: ${absMm(tableCellPaddingMm)}; vertical-align: top; }
    /* A paragraph is often used just to hold a cell's text; its trailing margin then adds to the
       cell padding and inflates the row. The callout body already did this for the same reason. */
    .imv-content td > p:last-child, .imv-content th > p:last-child { margin-bottom: 0; }
    .imv-content td > p:first-child, .imv-content th > p:first-child { margin-top: 0; }
    /* Image cells. An icon column's row height was set almost entirely by things that have
       nothing to do with the icon: the block margins that space images in FLOWING TEXT (5mm at
       the current setting, and meaningless between a cell wall and an icon), plus the cell's
       line-height, which reserves a whole text line under an inline image even when no text sits
       beside it. Together those came to ~7.6mm on A5 — nearly three body lines — on every row,
       which is why a small icon still produced a tall row. What remains is the cell padding,
       which is a deliberate setting. */
    /* Matched on the attribute deliberately. The placement rules above are (0,2,1) — one class
       plus one attribute — so a plain \`td img\` at (0,1,2) LOSES to them, and an earlier version
       of this reset was silently ineffective: every image in a cell kept its 5mm of block margin,
       which on a small icon is more row height than the icon itself. Every image the renderer
       emits carries data-print-align, so this one selector at (0,2,2) covers all of them. */
    .imv-content td img[data-print-align], .imv-content th img[data-print-align] { margin-top: 0; margin-bottom: 0; }
    .imv-content td:has(> img:only-child), .imv-content th:has(> img:only-child),
    .imv-content td:has(> p:only-child > img:only-child) { line-height: 0; vertical-align: middle; }
    /* display:block removes the baseline strut entirely; auto side margins keep the icon centred
       now that the cell's own text-align no longer applies to a block. */
    .imv-content td:has(> img:only-child) > img,
    .imv-content th:has(> img:only-child) > img,
    .imv-content td:has(> p:only-child > img:only-child) > p > img {
      display: inline-block; vertical-align: middle;
    }
    .imv-content th { background: #f1f5f9; font-weight: 700; text-align: left; }

    /* Callouts */
    .imv-block-wrapper { display: flex; align-items: flex-start; gap: ${gap}; padding: ${gap}; margin: ${gap} 0; border-radius: 6px; border-left: 6px solid; background: #fff; break-inside: avoid; }
    .imv-block-icon { flex-shrink: 0; width: ${mm(8)}; height: ${mm(8)}; }
    .imv-block-content { flex: 1; min-width: 0; }
    .imv-block-content p:last-child { margin-bottom: 0; }
    /* Callout titles are headings too — 0.62 of the section title matches the 0.9rem this
       rule used to hardcode at the default heading size. */
    .imv-block-title { display: block; font-weight: 800; text-transform: uppercase; font-size: ${pt(headingPt * 0.62)}; margin-bottom: ${halfGap}; letter-spacing: 0.05em; }
    .imv-block-warning { background: #fff7ed; border-left-color: #f97316; } .imv-block-warning .imv-block-title { color: #c2410c; }
    .imv-block-danger { background: #fee2e2; border-left-color: #b91c1c; } .imv-block-danger .imv-block-title { color: #7f1d1d; }
    .imv-block-caution { background: #fefce8; border-left-color: #eab308; } .imv-block-caution .imv-block-title { color: #854d0e; }
    .imv-block-electric { background: #fef2f2; border-left-color: #dc2626; } .imv-block-electric .imv-block-title { color: #b91c1c; }
    .imv-block-flammable { background: #fff1f2; border-left-color: #ea580c; } .imv-block-flammable .imv-block-title { color: #c2410c; }
    .imv-block-hot_surface { background: #fffbeb; border-left-color: #f59e0b; } .imv-block-hot_surface .imv-block-title { color: #b45309; }
    .imv-block-info { background: #eff6ff; border-left-color: #3b82f6; } .imv-block-info .imv-block-title { color: #1d4ed8; }

    /* Annotated images */
    .imv-annotated { margin: ${gap} 0; }
    .imv-annotated-item { margin-bottom: ${gap}; break-inside: avoid; }
    .imv-annotated-frame { position: relative; display: inline-block; max-width: 100%; }
    .imv-annotated-frame img { max-width: 100%; max-height: ${absMm(cellImageMaxHeightMm)}; object-fit: contain; height: auto; display: block; border-radius: 4px; }
    .imv-marker { position: absolute; transform: translate(-50%, -50%); width: 22px; height: 22px; border-radius: 50%; background: ${primaryColor}; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; }
    .imv-caption { font-size: ${pt(bodyPt * 0.92)}; color: #6b7280; margin-top: ${halfGap}; font-style: italic; }
    .imv-legend { list-style: none; padding: 0; margin: ${gap} 0 0; }
    .imv-legend li { display: flex; gap: ${mm(2)}; align-items: baseline; margin-bottom: ${halfGap}; }
    .imv-legend-num { flex-shrink: 0; min-width: ${mm(4)}; height: ${mm(4)}; border-radius: 50%; background: ${primaryColor}; color: #fff; font-size: ${pt(bodyPt * 0.85)}; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }

    /* Legend table */
    .imv-legend-table { width: 100%; border-collapse: collapse; margin: ${gap} 0; font-size: ${tablePt}; }
    .imv-legend-table td { border: ${tableRule}; padding: ${absMm(tableCellPaddingMm)}; text-align: left; }
    .imv-legend-table td:first-child { width: ${mm(10)}; text-align: center; font-weight: 700; }

    /* Step sequence */
    .imv-steps { counter-reset: imv-step; list-style: none; padding: 0; margin: ${gap} 0; }
    .imv-step { display: flex; gap: ${mm(3)}; margin-bottom: ${gap}; align-items: flex-start; break-inside: avoid; }
    .imv-step-num { counter-increment: imv-step; flex-shrink: 0; width: ${mm(5)}; height: ${mm(5)}; border-radius: 50%; background: ${primaryColor}; color: #fff; font-size: ${pt(bodyPt * 0.9)}; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .imv-step-num::before { content: counter(imv-step); }
    .imv-step-body { flex: 1; }
    .imv-step-img { max-width: 60mm; max-height: ${absMm(cellImageMaxHeightMm)}; height: auto; object-fit: contain; margin-top: ${halfGap}; border-radius: 4px; }

    /* Back page */
    .im-page-end { min-height: ${fillH}mm; background: #f8fafc; padding: ${mm(8)}; }
    .im-end-logo { height: ${mm(16)}; object-fit: contain; margin-bottom: ${mm(8)}; }
    .im-end-content { font-size: ${pt(bodyPt)}; color: #1e293b; }
    .im-end-copyright { margin-top: ${mm(10)}; font-size: ${pt(bodyPt * 0.85)}; color: #64748b; text-align: center; }
    ${compact ? compactOverrides(primaryColor, bodyPt, headingPt, lineHeight) : ''}
  `;
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The typography this render must use: the global profile the caller passed in, or the
 * built-in default for this template type and page size. Note what is NOT consulted here —
 * the manual's own metadata. Font family used to come from there, and template metadata is
 * per product category, so the same booklet program printed in a different font per
 * category; typography is now one house-wide setting (Admin → IM Print).
 */
const resolveTypography = (opts: PrintHtmlOptions): PrintTypography =>
  opts.typography ?? defaultTypographyFor(opts.compact ? 'warning_leaflet' : 'im', opts.pageSize);

/** Resolve the cover options (explicit values win, else template metadata defaults). */
const resolveCoverOpts = (opts: PrintHtmlOptions, base: PrintManual['metadata']): PrintCoverOptions => ({
  title: opts.cover.title,
  subtitle: opts.cover.subtitle,
  // `||` (not `??`): published manifests carry normalized metadata where a missing
  // companyLogoUrl is '', which must still fall through to the standard default.
  logoUrl: opts.cover.logoUrl || base?.companyLogoUrl || DEFAULT_IM_LOGO_URL,
  coverImageUrl: opts.cover.coverImageUrl ?? base?.coverImageUrl,
  markUrls: opts.cover.markUrls,
  skus: opts.cover.skus,
  imName: opts.cover.imName,
  companyName: opts.cover.companyName ?? base?.companyName,
});

/** Resolve the back-page options (explicit values win, else template metadata defaults). */
const resolveBackOpts = (opts: PrintHtmlOptions, base: PrintManual['metadata']): PrintBackOptions => ({
  contentHtml: opts.back.contentHtml ?? base?.backPageContent,
  logoUrl: opts.back.logoUrl,
  markUrls: opts.back.markUrls,
});

/**
 * Build a single combined print HTML document for one or more resolved manuals.
 * Structure: shared front cover → (per language: divider, TOC, sections) → shared back cover.
 * Page numbers are added by the rendering engine's footer, not here.
 *
 * @param manuals  Ordered resolved manuals (one per selected language). Must be non-empty.
 * @param opts     Page size and shared cover/back customization.
 */
export const buildPrintHtml = (manuals: PrintManual[], opts: PrintHtmlOptions): string => {
  if (!manuals.length) throw new Error('buildPrintHtml requires at least one resolved manual.');

  const base = manuals[0].metadata;
  const primaryColor = base?.primaryColor || '#0f172a';
  const multi = manuals.length > 1;
  const versionLabel = opts.version ? `v${opts.version}` : '';
  const languages = manuals.map((m) => m.language);

  const cover = buildCoverPage(resolveCoverOpts(opts, base), languages);

  const body = manuals
    .map((manual) => {
      const band = multi ? buildLanguageBand(manual.language) : '';
      return buildTocPage(manual, band) + buildSectionPages(manual, !opts.mergeTocIntoContent);
    })
    .join('');

  const back = buildBackPage(
    resolveBackOpts(opts, base),
    opts.cover.companyName ?? base?.companyName ?? '',
    versionLabel,
  );

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>${buildStyles(opts.pageSize, primaryColor, resolveTypography(opts), false, buildFontCss(resolveTypography(opts).fontFamily, documentTextOf(manuals)))}</style>
  </head>
  <body>
    ${cover}
    ${body}
    ${back}
  </body>
</html>`;
};

/**
 * Build the booklet as SEPARATE standalone HTML documents — one per PDFShift render —
 * so each language body can carry its own color-coded edge thumb-tab (a `position: fixed`
 * bar repeats reliably on every page of a single-language render; it cannot vary per
 * language within one combined document). Returned order is the merge order:
 *   [ front cover, language₁ body, language₂ body, …, back cover ].
 *
 * Every part is rendered with the profile's full page margins (render-print-part passes
 * marginFor(typography) to PDFShift); the edge tabs are DRAWN onto the merged PDF within
 * the margin band by render-print-merge, so no per-part margin tricks are needed.
 * Page numbers are stamped onto the MERGED pdf afterwards (not per part).
 */
export interface PrintPart {
  html: string;
  /** Edge thumb-tab spec for a language body; null for the shared cover/back parts. */
  tab: { index: number; total: number; code: string } | null;
}

/** Wrap section HTML into a standalone print document with the shared stylesheet. */
const wrapStandalone = (inner: string, styles: string): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>${styles}</style>
  </head>
  <body>${inner}</body>
</html>`;

const partStyles = (manuals: PrintManual[], opts: PrintHtmlOptions): string => {
  const base = manuals[0].metadata;
  const typography = resolveTypography(opts);
  return buildStyles(
    opts.pageSize,
    base?.primaryColor || '#0f172a',
    typography,
    opts.compact,
    buildFontCss(typography.fontFamily, documentTextOf(manuals)),
  );
};

/**
 * Build ONLY the front-cover part. `pages` gives each language's start page in the final
 * booklet (index-aligned to `manuals`); pass nulls when unknown — the print function renders
 * once to measure page counts, then calls this again with real numbers. Multi-language only:
 * the cover then shows the jump-to-your-language directory in place of the plain subtitle.
 */
export const buildCoverPartHtml = (
  manuals: PrintManual[],
  opts: PrintHtmlOptions,
  pages: (number | null)[],
): string => {
  if (!manuals.length) throw new Error('buildCoverPartHtml requires at least one resolved manual.');
  const base = manuals[0].metadata;
  const languageIndex = manuals.length > 1
    ? manuals.map((m, i) => ({
        code: m.language.toUpperCase(),
        name: INSTRUCTION_MANUAL_NAMES[m.language] ?? m.language.toUpperCase(),
        page: pages[i] ?? null,
      }))
    : undefined;
  const coverOpts = { ...resolveCoverOpts(opts, base), languageIndex };
  return wrapStandalone(buildCoverPage(coverOpts, manuals.map((m) => m.language)), partStyles(manuals, opts));
};

export const buildPrintPartsHtml = (manuals: PrintManual[], opts: PrintHtmlOptions): PrintPart[] => {
  if (!manuals.length) throw new Error('buildPrintPartsHtml requires at least one resolved manual.');

  const base = manuals[0].metadata;
  const primaryColor = base?.primaryColor || '#0f172a';
  const versionLabel = opts.version ? `v${opts.version}` : '';
  const multi = manuals.length > 1;
  const styles = partStyles(manuals, opts);

  // Compact Warning Leaflet: no cover / TOC / dividers / back page. Each language is a single part
  // (a logo-only header + its sections) so it still carries the same edge thumb-tab as the main
  // manual. The last-page copyright line is stamped onto the merged PDF by the print function.
  if (opts.compact) {
    // Leaflets fall back to their own standard logo (not the full-manual DEFAULT_IM_LOGO_URL).
    // `||` (not `??`): normalized metadata stores a missing companyLogoUrl as '', which must
    // still fall through to the default so the header logo is always prelinked.
    const logoUrl = opts.cover.logoUrl || base?.companyLogoUrl || DEFAULT_LEAFLET_LOGO_URL;
    return manuals.map((manual, i) => ({
      html: wrapStandalone(buildLeafletHeader(logoUrl) + buildSectionPages(manual), styles),
      tab: multi ? { index: i, total: manuals.length, code: manual.language } : null,
    }));
  }

  const parts: PrintPart[] = [];
  // Cover with a PLACEHOLDER directory (page numbers unknown until every part is rendered).
  parts.push({ html: buildCoverPartHtml(manuals, opts, manuals.map(() => null)), tab: null });
  manuals.forEach((manual, i) => {
    const band = multi ? buildLanguageBand(manual.language) : '';
    parts.push({
      html: wrapStandalone(
        buildTocPage(manual, band) + buildSectionPages(manual, !opts.mergeTocIntoContent),
        styles,
      ),
      // Only tag with an edge tab when the booklet actually spans multiple languages.
      tab: multi ? { index: i, total: manuals.length, code: manual.language } : null,
    });
  });
  parts.push({ html: wrapStandalone(buildBackPage(resolveBackOpts(opts, base), opts.cover.companyName ?? base?.companyName ?? '', versionLabel), styles), tab: null });
  return parts;
};
