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
 *   - the TOC lists clickable section links (internal anchors) without printed page numbers;
 *   - pagination is flow-based (`break-before: page` per page-block) so long sections flow across
 *     pages instead of being clipped.
 *
 * Framework-agnostic and dependency-free (pure string building). The resolved HTML comes from our
 * own resolver/publish pipeline and is trusted server-side, so it is injected verbatim.
 */

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
  fontFamily?: string;
}

export interface PrintManual {
  language: string;
  metadata: PrintManualMetadata;
  sections: PrintSection[];
}

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
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const GOOGLE_FONT_IMPORTS: Record<string, string> = {
  Roboto: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  'Open Sans': 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap',
  Lato: 'https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap',
  Montserrat: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap',
  'Source Serif 4': 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&display=swap',
  'Noto Sans': 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;700&display=swap',
};

const getFontImport = (fontFamily?: string): string =>
  fontFamily && GOOGLE_FONT_IMPORTS[fontFamily] ? `@import url('${GOOGLE_FONT_IMPORTS[fontFamily]}');` : '';

const getFontStack = (fontFamily?: string): string =>
  !fontFamily || fontFamily === 'Inter' ? 'Inter, Arial, sans-serif' : `'${fontFamily}', Arial, sans-serif`;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano',
  nl: 'Nederlands', pt: 'Português', pl: 'Polski', cs: 'Čeština', sv: 'Svenska',
  da: 'Dansk', fi: 'Suomi', no: 'Norsk', ro: 'Română', hu: 'Magyar',
};
const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code.toUpperCase();

/** "Instruction Manual" per language — used for the multilingual cover subtitle. */
const INSTRUCTION_MANUAL_NAMES: Record<string, string> = {
  en: 'INSTRUCTION MANUAL', de: 'BEDIENUNGSANLEITUNG', fr: "MODE D'EMPLOI",
  es: 'MANUAL DE INSTRUCCIONES', it: 'MANUALE DI ISTRUZIONI', nl: 'GEBRUIKSAANWIJZING',
  pt: 'MANUAL DE INSTRUÇÕES', pl: 'INSTRUKCJA OBSŁUGI', cs: 'NÁVOD K POUŽITÍ',
  sv: 'BRUKSANVISNING', da: 'BRUGSANVISNING', fi: 'KÄYTTÖOHJE', no: 'BRUKSANVISNING',
  ro: 'MANUAL DE UTILIZARE', hu: 'HASZNÁLATI ÚTMUTATÓ',
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

// Page content height (mm) minus the ~36mm of @page margins — used so cover/divider fill the page.
const PAGE_DIMS: Record<PrintPageSize, { w: number; h: number; css: string; fillH: number }> = {
  a4: { w: 210, h: 297, css: 'A4', fillH: 255 },
  a5: { w: 148, h: 210, css: 'A5', fillH: 168 },
};

// ---------------------------------------------------------------------------
// ISO 7010 callout icons (ported from src/modules/im-viewer/html.ts).
// ---------------------------------------------------------------------------

const ISO_W001 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><rect x="46.5" y="30" width="7" height="31" rx="2.5" fill="#231F20"/><circle cx="50" cy="73" r="5.5" fill="#231F20"/></svg>`;
const ISO_W012 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><path d="M57,24 L39,55 L51,55 L44,78 L62,47 L50,47 Z" fill="#231F20"/></svg>`;
const ISO_M002 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><circle cx="50" cy="50" r="46" fill="#0066B2"/><circle cx="50" cy="26" r="7" fill="white"/><rect x="43" y="40" width="14" height="36" rx="4" fill="white"/></svg>`;

type CalloutVariant = 'warning' | 'caution' | 'electric' | 'info';
const ISO_ICONS: Record<CalloutVariant, string> = {
  warning: ISO_W001, caution: ISO_W001, electric: ISO_W012, info: ISO_M002,
};
const CALLOUT_TITLES: Record<CalloutVariant, string> = {
  warning: 'WARNING', caution: 'CAUTION', electric: 'ELECTRIC HAZARD', info: 'INFO',
};

const wrapCallout = (variant: CalloutVariant, contentHtml: string): string => {
  if (!contentHtml) return contentHtml;
  const icon = ISO_ICONS[variant] ?? ISO_M002;
  const title = CALLOUT_TITLES[variant] ?? variant.toUpperCase();
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

const renderNode = (node: PrintNode, lang: string): string => {
  switch (node.type) {
    case 'html':
      return `<div class="imv-node imv-content">${node.html}</div>`;
    case 'callout':
      return `<div class="imv-node imv-content">${wrapCallout(node.variant as CalloutVariant, node.html)}</div>`;
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
      ${coverImage}
      <div class="im-cover-body">
        <div>
          ${logo}
          <h1 class="im-cover-title">${escapeHtml(opts.title || '')}</h1>
          <p class="im-cover-subtitle">${escapeHtml(subtitle)}</p>
        </div>
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

const buildTocPage = (manual: PrintManual): string => {
  const ordered = [...manual.sections].sort((a, b) => a.order - b.order);
  const rows = ordered
    .map((s) => `<a class="im-toc-row${s.parentId ? ' im-toc-sub' : ''}" href="#sec-${s.id}">${escapeHtml(s.title)}</a>`)
    .join('');
  return `
    <section class="im-page im-break im-page-toc">
      <h2 class="im-toc-title">Contents</h2>
      <nav class="im-toc">${rows}</nav>
    </section>
  `;
};

const buildSectionPages = (manual: PrintManual): string => {
  const ordered = [...manual.sections].sort((a, b) => a.order - b.order);
  return ordered
    .map((section) => {
      const body = section.nodes.map((n) => renderNode(n, manual.language)).join('');
      return `
        <section id="sec-${section.id}" class="im-page im-break im-page-content">
          <h2 class="im-section-title">${escapeHtml(section.title)}</h2>
          <div class="im-section-content">${body}</div>
        </section>
      `;
    })
    .join('');
};

const buildLanguageDivider = (code: string, primaryColor: string): string => `
  <section class="im-page im-break im-page-divider">
    <div class="im-divider-inner">
      <div class="im-divider-bar" style="background:${primaryColor}"></div>
      <h2 class="im-divider-title">${escapeHtml(languageName(code))}</h2>
      <p class="im-divider-code">${escapeHtml(code.toUpperCase())}</p>
    </div>
  </section>
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

const buildStyles = (
  pageSize: PrintPageSize,
  primaryColor: string,
  fontImport: string,
  fontStack: string,
): string => {
  const dims = PAGE_DIMS[pageSize];
  const s = pageSize === 'a5' ? 0.82 : 1; // A5 type scale
  const mm = (base: number) => `${(base * s).toFixed(2)}mm`;
  return `
    ${fontImport}
    :root { color-scheme: light only; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: ${fontStack}; color: #1f2937; }

    /* Page size only — the engine owns margins (so its footer/page-numbers sit in the bottom
       margin). No bleed/crop marks (Chromium engine = screen-grade output). */
    @page { size: ${dims.css}; }

    /* Flow-based pagination: the cover is the first page; every following block starts a new page,
       and long sections flow naturally across pages (no clipping). */
    .im-page { position: relative; }
    .im-break { break-before: page; page-break-before: always; }

    /* Cover (shared) */
    .im-page-cover { min-height: ${dims.fillH}mm; display: flex; flex-direction: column; }
    .im-cover-image { height: ${mm(90)}; background-size: cover; background-position: center; margin-bottom: ${mm(12)}; }
    .im-cover-body { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
    /* Logo and the two cover headers are intentionally half-size (per brand spec). */
    .im-cover-logo { height: ${mm(9)}; object-fit: contain; margin-bottom: ${mm(16)}; }
    .im-cover-title { margin: 0 0 ${mm(6)}; color: ${primaryColor}; font-size: ${mm(8)}; line-height: 1.1; }
    .im-cover-subtitle { margin: 0; color: #475569; font-size: ${mm(3)}; letter-spacing: 0.2em; text-transform: uppercase; line-height: 1.4; }
    .im-cover-footer { border-top: 1.5mm solid ${primaryColor}; padding-top: ${mm(6)}; font-size: ${mm(3.4)}; color: #334155; }
    .im-cover-imname { margin-top: ${mm(1.5)}; color: #475569; }
    .im-cover-skus { margin-top: ${mm(1.5)}; font-weight: 600; letter-spacing: 0.02em; color: #334155; }

    /* Certification / brand marks */
    .im-marks { display: flex; flex-wrap: wrap; gap: ${mm(4)}; align-items: center; margin-bottom: ${mm(6)}; }
    .im-mark { height: ${mm(12)}; width: auto; object-fit: contain; }

    /* Language divider */
    .im-page-divider { min-height: ${dims.fillH}mm; display: flex; align-items: center; justify-content: center; text-align: center; }
    .im-divider-bar { width: ${mm(40)}; height: ${mm(2)}; margin: 0 auto ${mm(8)}; border-radius: 2px; }
    .im-divider-title { color: ${primaryColor}; font-size: ${mm(14)}; margin: 0; }
    .im-divider-code { color: #64748b; letter-spacing: 0.3em; margin: ${mm(2)} 0 0; }

    /* TOC — clickable links (no printed page numbers on a Chromium engine) */
    .im-page-toc .im-toc-title { color: ${primaryColor}; font-size: ${mm(7)}; border-bottom: 0.6mm solid ${primaryColor}; margin: 0 0 ${mm(6)}; padding-bottom: ${mm(2)}; }
    .im-toc { display: block; }
    .im-toc-row { display: block; text-decoration: none; color: #1f2937; padding: ${mm(1.6)} 0; border-bottom: 1px solid #f1f5f9; font-size: ${mm(3.8)}; }
    .im-toc-row.im-toc-sub { padding-left: ${mm(6)}; color: #475569; font-size: ${mm(3.5)}; }

    /* Section content */
    .im-section-title { margin: 0 0 ${mm(5)}; padding-bottom: ${mm(2)}; border-bottom: 0.6mm solid ${primaryColor}; color: ${primaryColor}; font-size: ${mm(6.2)}; }
    .im-section-content { font-size: ${mm(3.8)}; line-height: 1.6; color: #1f2937; }
    .im-section-content h1, .im-section-content h2, .im-section-content h3 { color: ${primaryColor}; margin: ${mm(4)} 0 ${mm(2)}; break-after: avoid; }
    .im-section-content h1 { font-size: ${mm(5.5)}; }
    .im-section-content h2 { font-size: ${mm(5)}; }
    .im-section-content h3 { font-size: ${mm(4.5)}; }

    /* Rich content (ported from im-viewer.css) */
    .imv-content { line-height: 1.65; color: #374151; }
    .imv-content ul { list-style: disc; padding-left: 1.5em; margin: 0 0 1em; }
    .imv-content ol { list-style: decimal; padding-left: 1.5em; margin: 0 0 1em; }
    .imv-content li { display: list-item; margin-bottom: 0.25em; }
    .imv-content p { margin: 0 0 1em; }
    .imv-content b, .imv-content strong { font-weight: 700; }
    .imv-content i, .imv-content em { font-style: italic; }
    .imv-content u { text-decoration: underline; }
    .imv-content a { color: ${primaryColor}; text-decoration: underline; }
    .imv-content img { max-width: 100%; height: auto; border-radius: 4px; }
    .imv-content table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    .imv-content th, .imv-content td { border: 1px solid #cbd5e1; padding: 0.5rem; vertical-align: top; }
    .imv-content th { background: #f1f5f9; font-weight: 700; text-align: left; }

    /* Callouts */
    .imv-block-wrapper { display: flex; align-items: flex-start; gap: 1.25rem; padding: 1.25rem; margin: 1.25rem 0; border-radius: 6px; border-left: 6px solid; background: #fff; break-inside: avoid; }
    .imv-block-icon { flex-shrink: 0; width: 48px; height: 48px; }
    .imv-block-content { flex: 1; min-width: 0; }
    .imv-block-content p:last-child { margin-bottom: 0; }
    .imv-block-title { display: block; font-weight: 800; text-transform: uppercase; font-size: 0.9rem; margin-bottom: 0.5rem; letter-spacing: 0.05em; }
    .imv-block-warning { background: #fff7ed; border-left-color: #f97316; } .imv-block-warning .imv-block-title { color: #c2410c; }
    .imv-block-caution { background: #fefce8; border-left-color: #eab308; } .imv-block-caution .imv-block-title { color: #854d0e; }
    .imv-block-electric { background: #fef2f2; border-left-color: #dc2626; } .imv-block-electric .imv-block-title { color: #b91c1c; }
    .imv-block-info { background: #eff6ff; border-left-color: #3b82f6; } .imv-block-info .imv-block-title { color: #1d4ed8; }

    /* Annotated images */
    .imv-annotated { margin: 1.25rem 0; }
    .imv-annotated-item { margin-bottom: 1.25rem; break-inside: avoid; }
    .imv-annotated-frame { position: relative; display: inline-block; max-width: 100%; }
    .imv-annotated-frame img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
    .imv-marker { position: absolute; transform: translate(-50%, -50%); width: 22px; height: 22px; border-radius: 50%; background: ${primaryColor}; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; }
    .imv-caption { font-size: 11pt; color: #6b7280; margin-top: 6px; font-style: italic; }
    .imv-legend { list-style: none; padding: 0; margin: 10px 0 0; }
    .imv-legend li { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }
    .imv-legend-num { flex-shrink: 0; min-width: 20px; height: 20px; border-radius: 50%; background: ${primaryColor}; color: #fff; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }

    /* Legend table */
    .imv-legend-table { width: 100%; border-collapse: collapse; margin: 1.25rem 0; }
    .imv-legend-table td { border: 1px solid #cbd5e1; padding: 0.5rem; text-align: left; }
    .imv-legend-table td:first-child { width: 56px; text-align: center; font-weight: 700; }

    /* Step sequence */
    .imv-steps { counter-reset: imv-step; list-style: none; padding: 0; margin: 1.25rem 0; }
    .imv-step { display: flex; gap: 16px; margin-bottom: 16px; align-items: flex-start; break-inside: avoid; }
    .imv-step-num { counter-increment: imv-step; flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: ${primaryColor}; color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .imv-step-num::before { content: counter(imv-step); }
    .imv-step-body { flex: 1; }
    .imv-step-img { max-width: 60mm; height: auto; margin-top: 8px; border-radius: 4px; }

    /* Back page */
    .im-page-end { min-height: ${dims.fillH}mm; background: #f8fafc; padding: ${mm(8)}; }
    .im-end-logo { height: ${mm(16)}; object-fit: contain; margin-bottom: ${mm(8)}; }
    .im-end-content { font-size: ${mm(3.5)}; color: #1e293b; }
    .im-end-copyright { margin-top: ${mm(10)}; font-size: ${mm(3.2)}; color: #64748b; text-align: center; }
  `;
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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
  const fontFamily = base?.fontFamily;
  const fontImport = getFontImport(fontFamily);
  const fontStack = getFontStack(fontFamily);
  const multi = manuals.length > 1;
  const versionLabel = opts.version ? `v${opts.version}` : '';
  const languages = manuals.map((m) => m.language);

  const cover = buildCoverPage(
    {
      title: opts.cover.title,
      subtitle: opts.cover.subtitle,
      logoUrl: opts.cover.logoUrl ?? base?.companyLogoUrl,
      coverImageUrl: opts.cover.coverImageUrl ?? base?.coverImageUrl,
      markUrls: opts.cover.markUrls,
      skus: opts.cover.skus,
      imName: opts.cover.imName,
      companyName: opts.cover.companyName ?? base?.companyName,
    },
    languages,
  );

  const body = manuals
    .map((manual) => {
      const divider = multi ? buildLanguageDivider(manual.language, primaryColor) : '';
      return divider + buildTocPage(manual) + buildSectionPages(manual);
    })
    .join('');

  const back = buildBackPage(
    {
      contentHtml: opts.back.contentHtml ?? base?.backPageContent,
      logoUrl: opts.back.logoUrl,
      markUrls: opts.back.markUrls,
    },
    opts.cover.companyName ?? base?.companyName ?? '',
    versionLabel,
  );

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>${buildStyles(opts.pageSize, primaryColor, fontImport, fontStack)}</style>
  </head>
  <body>
    ${cover}
    ${body}
    ${back}
  </body>
</html>`;
};
