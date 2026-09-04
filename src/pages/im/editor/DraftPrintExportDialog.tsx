/**
 * DraftPrintExportDialog — a throwaway print PDF of the template you are editing.
 *
 * The template editor's on-screen preview shows content, not pages. Whether a template is
 * actually publishable is a question about the PRINTED sheet: where chapters break, how a
 * 6pt table sets, whether the leaflet still fits. Answering it used to mean creating a
 * project, generating an IM, publishing it and exporting — so templates were tuned against
 * the HTML preview and the page-level surprises arrived last.
 *
 * This renders through the SAME pipeline as the production export (same HTML builder, same
 * admin-owned typography, same stamping/merging, same page size), fed from manuals resolved
 * in the browser from the editor's LIVE sections — unsaved edits included. Nothing is
 * persisted: no render history, no project, no stored PDF. The result is an in-browser blob
 * that dies with the tab, which is what makes it discardable by construction.
 *
 * What it is not: a compliance artifact. A draft can (and normally will) contain unresolved
 * {{tokens}} that a project fills in — the production export refuses those, this one lists
 * them as warnings.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, Download, FileDown, AlertCircle, AlertTriangle, ExternalLink, CheckSquare, Square, BookMarked } from 'lucide-react';
import { IMTemplateType, IMTemplateMetadata } from '../../../types';
import {
  DEFAULT_IM_BRAND,
  IM_BRANDS,
  IM_BRAND_ORDER,
  brandForLogoUrl,
  brandLogoUrl,
} from '../../../config/im.constants';
import { requestDraftPrintPdf, type DraftPrintPdfResult } from '../../../services';
import { getPrintTypography, defaultTypographyFor, type PrintTypography, type PrintLeafletLayout } from '../../../services/im/im-print-settings.service';
import { orderIMLanguages } from '../../../config/im-languages';
import { TypographySummary } from './TypographySummary';
import { useDocCode } from './useDocCode';

/** One language's resolved manual, plus whatever the resolver complained about. */
export interface DraftResolveResult {
  json: string;
  warnings: string[];
}

interface DraftPrintExportDialogProps {
  templateId: string;
  templateType: IMTemplateType;
  /** The template's L3 category — the document code is built from it. */
  categoryId: string | null;
  /** Template metadata as it stands in the editor — including unsaved changes. */
  metadata: IMTemplateMetadata;
  /** Cover-title default (the category name); still editable, since the real one is per project. */
  defaultTitle: string;
  /** Languages this template carries. */
  languages: string[];
  /** Ticked on open — the language being edited, so one click gives the fastest useful answer. */
  initialLanguage: string;
  /**
   * Resolve one language from the editor's live sections. Called per selected language when
   * the render starts (not on open) so opening the dialog costs nothing.
   */
  resolveDraft: (language: string) => DraftResolveResult;
  /**
   * What this draft structurally cannot show (conditional sections with no attribute values,
   * placeholder sections). Shown BEFORE rendering, not after: they change how the resulting
   * page count should be read, and the operator deserves to know that before spending a
   * conversion. Language-independent, hence a prop rather than a per-manual warning.
   */
  limitations: string[];
  onClose: () => void;
}

const DraftPrintExportDialog: React.FC<DraftPrintExportDialogProps> = ({
  templateId,
  templateType,
  categoryId,
  metadata,
  defaultTitle,
  languages,
  initialLanguage,
  resolveDraft,
  limitations,
  onClose,
}) => {
  const isLeaflet = templateType === 'warning_leaflet';

  // Leaflet layout to proof. This dialog is where the compact layout gets iterated on — a
  // draft is one PDFShift part and leaves no history row — so it gets the same choice the
  // production dialog does.
  const [leafletLayout, setLeafletLayout] = React.useState<PrintLeafletLayout>('classic');


  // Every language the template carries, in house order; English first by convention.
  const pool = React.useMemo(() => orderIMLanguages(languages), [languages]);

  // Default to the language being edited alone. A draft answers "does this page work?", and
  // one language is one PDFShift part — the cheapest and fastest useful answer. Ticking more
  // is one click away, and only then does the booklet grow cover tabs and a language directory.
  const [selected, setSelected] = useState<string[]>(() =>
    pool.includes(initialLanguage) ? [initialLanguage] : pool.slice(0, 1),
  );

  const [pageSize, setPageSize] = useState<'a4' | 'a5'>(
    // Mirrors the production dialog: A5 is the house default, A4 only when the template says so.
    isLeaflet ? 'a5' : metadata.pageSize === 'a4' ? 'a4' : 'a5',
  );
  const [mergeToc, setMergeToc] = useState(true);

  // The same document code the production export stamps, so a draft proof is identifiable as
  // a proof OF that document rather than an anonymous PDF.
  const docCode = useDocCode(templateType, pageSize, categoryId);

  // The two cover strings a bare template cannot know: both are per-project in production, and
  // both change the cover's layout, so a draft needs stand-in values to show it honestly.
  const [title, setTitle] = useState(defaultTitle);
  const [skuText, setSkuText] = useState('');

  // Brand wordmark for this draft. A template carries no brand — the same category content is
  // issued under whichever brand the SKU ships as — so the brand is picked per export here,
  // exactly as in the production dialog. A template that pins its own companyLogoUrl still wins
  // on open; choosing a brand replaces it for this render only (nothing here is persisted).
  const [logoUrl, setLogoUrl] = useState(
    metadata.companyLogoUrl || brandLogoUrl(DEFAULT_IM_BRAND, isLeaflet),
  );
  const selectedBrand = brandForLogoUrl(logoUrl);

  const [typography, setTypography] = useState<PrintTypography>(() => defaultTypographyFor(templateType, pageSize));
  useEffect(() => {
    let alive = true;
    getPrintTypography(templateType, pageSize)
      .then((t) => { if (alive) setTypography(t); })
      .catch(() => {});
    return () => { alive = false; };
  }, [templateType, pageSize]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftPrintPdfResult | null>(null);
  /** Warnings the resolver produced client-side (unresolvable blocks, SKU slots with no project). */
  const [resolveWarnings, setResolveWarnings] = useState<string[]>([]);

  // The blob is the only copy of a draft, so it must be released exactly once — on replacement
  // and on unmount. Held in a ref as well as state because the unmount cleanup must not
  // re-run on every render.
  const blobUrlRef = useRef<string | null>(null);
  const setBlob = (next: DraftPrintPdfResult | null) => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = next?.blobUrl ?? null;
    setResult(next);
  };
  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  const toggle = (lang: string) =>
    setSelected((prev) => (prev.includes(lang) ? prev.filter((l) => l !== lang) : pool.filter((l) => l === lang || prev.includes(l))));

  const allSelected = selected.length === pool.length;

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    setBlob(null);
    setResolveWarnings([]);
    setProgress(null);
    try {
      // Resolve here, not on open: the editor's sections are live state, so a draft must be
      // built from whatever is on screen at the moment the operator asks for it.
      const warnings = new Set<string>();
      const manuals = selected.map((language) => {
        const { json, warnings: w } = resolveDraft(language);
        for (const warning of w) warnings.add(`${language.toUpperCase()}: ${warning}`);
        return { language, json };
      });
      setResolveWarnings([...warnings]);

      const res = await requestDraftPrintPdf({
        templateId,
        templateType,
        manuals,
        pageSize,
        typography,
        mergeToc: isLeaflet ? undefined : mergeToc,
        leafletLayout: isLeaflet ? leafletLayout : undefined,
        docCode: docCode || undefined,
        onProgress: (label, done, total) => setProgress({ label, done, total }),
        cover: {
          title,
          // Subtitle left empty so the builder auto-fills "Instruction Manual" per language,
          // exactly as the production export does.
          logoUrl: logoUrl || undefined,
          coverImageUrl: isLeaflet ? undefined : metadata.coverImageUrl || undefined,
          skus: skuText.split(',').map((s) => s.trim()).filter(Boolean),
          companyName: metadata.companyName,
          footerText: metadata.footerText,
        },
        back: {},
      });
      setBlob(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Draft render failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);
  const warnings = [...resolveWarnings, ...(result?.warnings ?? [])];

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <FileDown size={18} /> Draft PDF — {isLeaflet ? 'Warning Leaflet' : 'Instruction Manual'} template
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <div className="px-6 py-4 overflow-auto space-y-5">
          {/* The two things that must be understood before clicking, stated once, up front:
              this file is not kept, and it is not free. */}
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={13} /> Throwaway preview — nothing is saved</p>
            <p>
              This renders the template exactly as the real export would: same page size, same house
              typography, same page numbering and language tabs. It is <strong>not</strong> recorded in any
              export history, not attached to a project and not stored — you get a file in this tab only,
              and it is gone when you close it.
            </p>
            <p>
              It still uses one print-engine conversion per language, the same as a production export, so
              it is not free — render the languages you actually need to look at.
            </p>
          </div>

          {limitations.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-600 mb-1">What this draft leaves out</p>
              <ul className="text-[11px] text-gray-600 space-y-0.5 list-disc pl-4">
                {limitations.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          )}

          {/* LANGUAGES */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-500 uppercase">Languages</label>
              <button
                onClick={() => setSelected(allSelected ? pool.slice(0, 1) : pool)}
                className="text-xs text-indigo-600 hover:underline"
              >
                {allSelected ? 'Just one' : `All ${pool.length}`}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pool.map((lang) => {
                const on = selected.includes(lang);
                return (
                  <button
                    key={lang}
                    onClick={() => toggle(lang)}
                    className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium ${
                      on ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {on ? <CheckSquare size={12} /> : <Square size={12} />}
                    {lang.toUpperCase()}
                  </button>
                );
              })}
            </div>
            {selected.length > 1 && !isLeaflet && (
              <p className="text-[11px] text-gray-400 mt-1.5">
                {selected.length} languages — the booklet gets a shared cover with a language directory and
                edge tabs, as in production.
              </p>
            )}
          </div>

          {/* PAGE SIZE + TOC */}
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Page size</label>
              <div className="flex gap-2 mt-1">
                {(['a5', 'a4'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => setPageSize(size)}
                    className={`px-3 py-1.5 rounded border text-sm font-medium ${
                      pageSize === size ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {size.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {isLeaflet && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Layout</label>
                <div className="flex gap-2 mt-1">
                  {([
                    { key: 'classic' as const, label: 'Classic' },
                    { key: 'compact2col' as const, label: 'Compact 2-col' },
                  ]).map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setLeafletLayout(opt.key)}
                      className={`px-3 py-1.5 rounded border text-sm font-medium ${
                        leafletLayout === opt.key
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!isLeaflet && (
              <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer max-w-xs">
                <input type="checkbox" className="mt-0.5" checked={mergeToc} onChange={(e) => setMergeToc(e.target.checked)} />
                <span>
                  <span className="font-medium flex items-center gap-1"><BookMarked size={12} /> Continue content on the contents page</span>
                  Saves one page per language.
                </span>
              </label>
            )}
          </div>

          {/* COVER STAND-INS — only the strings a template genuinely cannot know. */}
          {!isLeaflet && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Cover title</label>
                <input
                  className="w-full border rounded p-2 text-sm mt-1"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Product name"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Article numbers</label>
                <input
                  className="w-full border rounded p-2 text-sm mt-1"
                  value={skuText}
                  onChange={(e) => setSkuText(e.target.value)}
                  placeholder="e.g. 10035765, 10035766"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Stand-ins for the cover only — a project supplies the real ones. Both fields change how
                  the cover sets, which is why they are here rather than left blank.
                </p>
              </div>
            </div>
          )}
          {/* BRAND — a template is brand-neutral; the wordmark on the cover / leaflet header is
              the only thing that differs, so it is chosen per export, as in production. */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Brand</label>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {IM_BRAND_ORDER.map((brand) => {
                const on = selectedBrand === brand;
                return (
                  <button
                    key={brand}
                    onClick={() => setLogoUrl(brandLogoUrl(brand, isLeaflet))}
                    className={`px-3 py-1.5 rounded border text-sm font-medium ${
                      on ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {IM_BRANDS[brand].label}
                  </button>
                );
              })}
              {!selectedBrand && <span className="text-[11px] text-gray-400">This template&apos;s own logo</span>}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Swaps the {isLeaflet ? 'header' : 'cover'} logo only — the content is identical. Klarstein
              unless this template pins its own logo or you change it here.
            </p>
          </div>

          <p className="text-[11px] text-gray-400">
            {isLeaflet ? 'Company name and footer come' : 'Cover image, company name and footer come'} from
            this template&apos;s settings — change them in Template settings, not here, so the draft shows
            what the template really carries.
          </p>

          <TypographySummary typography={typography} pageSize={pageSize} />

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5 mb-1">
                <AlertTriangle size={13} /> {warnings.length} thing{warnings.length === 1 ? '' : 's'} a project would fill in
              </p>
              <ul className="text-[11px] text-amber-900 space-y-0.5 list-disc pl-4 max-h-40 overflow-auto">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <p className="text-[11px] text-amber-800 mt-1.5">
                Expected in a template draft. The production export refuses to print unresolved values —
                this one shows them so you can see where they sit on the page.
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800 flex gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}

          {result && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 space-y-2">
              <p className="text-sm font-semibold text-emerald-900">
                Draft rendered — {result.pages ? `${result.pages} page${result.pages === 1 ? '' : 's'}, ` : ''}{kb(result.bytes)}
              </p>
              {result.pagesByLanguage && Object.keys(result.pagesByLanguage).length > 1 && (
                <p className="text-[11px] text-emerald-800">
                  {Object.entries(result.pagesByLanguage).map(([l, n]) => `${l.toUpperCase()} ${n}p`).join(' · ')}
                </p>
              )}
              {result.preflight?.nonEmbeddedFonts.length ? (
                <p className="text-[11px] text-amber-800">
                  Fonts not embedded: {result.preflight.nonEmbeddedFonts.join(', ')} — a print vendor&apos;s
                  preflight would reject this.
                </p>
              ) : null}
              <div className="flex gap-2 pt-1">
                <a
                  href={result.blobUrl}
                  download={result.filename}
                  className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-emerald-700"
                >
                  <Download size={13} /> Download
                </a>
                <button
                  onClick={() => window.open(result.blobUrl, '_blank', 'noopener')}
                  className="flex items-center gap-1.5 bg-white border border-emerald-300 text-emerald-800 px-3 py-1.5 rounded text-xs font-medium hover:bg-emerald-100"
                >
                  <ExternalLink size={13} /> Open in a tab
                </button>
              </div>
              <p className="text-[11px] text-emerald-800">
                Held in this tab only — the server copy is already deleted. Download it if you want to keep it.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t bg-gray-50">
          <span className="text-xs text-gray-500">
            {busy && progress
              ? `${progress.label} ${progress.total > 1 ? `(${progress.done}/${progress.total})` : ''}`
              : `${selected.length} language${selected.length === 1 ? '' : 's'} · ${pageSize.toUpperCase()}`}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Close</button>
            <button
              onClick={handleGenerate}
              disabled={busy || !selected.length}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
              {busy ? 'Rendering…' : result ? 'Render again' : 'Render draft PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DraftPrintExportDialog;
