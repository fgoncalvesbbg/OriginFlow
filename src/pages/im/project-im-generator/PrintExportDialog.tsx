/**
 * PrintExportDialog — configures and requests a print-shop-ready PDF of a published IM.
 *
 * Lets the user pick which published languages to include (combined into one booklet with a shared
 * front/back cover), the page size (A4/A5), and customize the shared covers (logo, cover image,
 * title/subtitle, certification/brand marks, back-cover content). Calls the dedicated render service
 * (services/im-print-render) via requestPrintPdf and surfaces a download link.
 *
 * Decoupled and additive: opened from the publish-result modal only when VITE_PRINT_RENDER_URL is
 * configured; never blocks Generate/Publish.
 */

import React, { useEffect, useState } from 'react';
import { X, Upload, Loader2, Download, CheckSquare, Square, Trash2, FileDown, AlertCircle, History, BookMarked } from 'lucide-react';
import { IMTemplate, IMTemplateType } from '../../../types';
import {
  DEFAULT_IM_LOGO_URL,
  DEFAULT_LEAFLET_LOGO_URL,
  IM_BRANDS,
  IM_BRAND_ORDER,
  brandForLogoUrl,
  brandLogoUrl,
} from '../../../config/im.constants';
import { requestPrintPdf, getPrintRenders, getIMMarkets, checkPrintImageWeights, PrintPdfResult, PrintRender, IMMarket, PrintImageReport } from '../../../services';
import {
  getLeafletPolicies,
  getLeafletIssues,
  issueCategoryLeaflet,
  issueLeafletForSkus,
  type LeafletIssue,
  type LeafletMode,
} from '../../../services/im/leaflet-coverage.service';
import { useAuth } from '../../../context/AuthContext';
import { PrintExportReport } from './PrintExportReport';
import { uploadIMAsset } from '../../../services/im/im-asset.service';
import { getPrintTypography, defaultTypographyFor, type PrintTypography, type PrintLeafletLayout } from '../../../services/im/im-print-settings.service';
import { TypographySummary } from '../editor/TypographySummary';
import { useDocCode } from '../editor/useDocCode';

interface PrintExportDialogProps {
  projectId: string;
  templateType: IMTemplateType;
  /**
   * The project's L3 category. Needed to record which SKUs a rendered leaflet answers for
   * (migration 132) — the leaflet is a property of the CATEGORY, not of this one project.
   * Null disables the "issue as leaflet" action rather than guessing.
   */
  categoryId: string | null;
  projectName: string;
  template: IMTemplate | null;
  formData: Record<string, string>;
  /** Published languages available for export. */
  languages: string[];
  /**
   * Which of `languages` start ticked. Defaults to all of them (a Full IM booklet).
   * The caller passes the printed subset when the operator asked for a Print Version, but
   * the POOL stays the full published set either way — the scope chips below flip between
   * the two without reopening the dialog, so one PDF trip can produce either book.
   */
  initialSelection?: string[];
  /**
   * The project's configured Printed IM language subset. Only powers the "Print Version"
   * scope chip; when it equals the full pool the chips are pointless and are not rendered.
   */
  printedLanguages?: string[];
  /** SKU / article numbers this IM covers (one IM can cover several). */
  skus: string[];
  version?: number;
  /**
   * Called after a successful render to persist the PDF into the project's documents
   * (the print render is the ONLY PDF saved on the project — publish itself stores none).
   * Failures are surfaced as a non-fatal warning; the PDF stays downloadable regardless.
   */
  onRendered?: (result: PrintPdfResult, languages: string[], pageSize: 'a4' | 'a5') => Promise<void>;
  /**
   * Called after a successful render with the cover choices made in this dialog, so the
   * caller can remember them as the IM's defaults for next time (logo always; cover image
   * omitted for leaflets, which have no cover). Fire-and-forget.
   */
  onCoverPrefs?: (prefs: { logoUrl: string; coverImageUrl?: string }) => void;
  onClose: () => void;
}

const PrintExportDialog: React.FC<PrintExportDialogProps> = ({
  projectId,
  templateType,
  categoryId,
  projectName,
  template,
  formData,
  languages,
  initialSelection,
  printedLanguages,
  skus,
  version,
  onRendered,
  onCoverPrefs,
  onClose,
}) => {
  const meta = template?.metadata;

  // Warning Leaflets render as a compact PDF with no cover/back — so the dialog only needs the
  // logo (which feeds the per-language header), languages, and page size. The backend ignores
  // the other cover/back inputs for leaflets regardless; hiding them avoids confusion.
  const isLeaflet = templateType === 'warning_leaflet';

  // The Printed IM subset, intersected with what is actually published and kept in published
  // order. Empty (or identical to the pool) means there is no meaningful second scope.
  const printedScope = React.useMemo(
    () => (printedLanguages ? languages.filter((l) => printedLanguages.includes(l)) : []),
    [languages, printedLanguages],
  );

  // Language selection — the caller's scope, else all of them, preserving the published order.
  const [selected, setSelected] = useState<string[]>(() =>
    initialSelection ? languages.filter((l) => initialSelection.includes(l)) : languages,
  );
  // Admin-configured markets (im_markets): one-click language presets. Selecting one sets
  // the languages to the market's list and stamps the market code onto the render history
  // row, so "which booklet went to which market" is answerable later. Cleared when the
  // languages are then changed by hand (the selection no longer IS that market's set).
  const [markets, setMarkets] = useState<IMMarket[]>([]);
  const [marketCode, setMarketCode] = useState<string>('');

  useEffect(() => {
    let alive = true;
    getIMMarkets().then((m) => { if (alive) setMarkets(m); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const applyMarket = (code: string) => {
    setMarketCode(code);
    if (!code) return;
    const market = markets.find((m) => m.code === code);
    if (!market) return;
    // The market's languages, restricted to what is actually published, in published order.
    setSelected(languages.filter((l) => market.languages.includes(l)));
  };

  const [pageSize, setPageSize] = useState<'a4' | 'a5'>(
    // A5 is the house default for every document type; only a template that explicitly
    // chose A4 defaults to the larger sheet.
    isLeaflet ? 'a5' : meta?.pageSize === 'a4' ? 'a4' : 'a5',
  );

  /**
   * Which LAYOUT to set a Warning Leaflet in. Defaults to classic, so an operator who does
   * nothing gets exactly the leaflet they get today.
   *
   * A layout is not a document type — same template, same content, same translations, same
   * coverage issue — so it is a per-export choice here rather than a second template kind.
   */
  const [leafletLayout, setLeafletLayout] = useState<PrintLeafletLayout>('classic');

  // Save a page per language by letting the first section continue on the TOC page.
  // Default ON: the operator's standing goal is fewer printed pages; unticking restores
  // the classic "contents, then the manual on a fresh page" separation. Leaflets have
  // no TOC, so the choice is only shown (and only sent) for full manuals.
  const [mergeToc, setMergeToc] = useState(true);

  // Shared cover, prefilled from existing override hooks + template metadata. Subtitle and
  // the cover-footer manual name are intentionally NOT configurable — the subtitle always
  // auto-fills and the manual-name line is always empty (see handleGenerate).
  const [title, setTitle] = useState(formData['__cover_title'] ?? projectName);
  const [skuText, setSkuText] = useState(skus.join(', '));
  // `||` (not `??`): normalizeIMTemplateMetadata coerces a missing companyLogoUrl to '',
  // which must still fall through to the standard default so the logo is prelinked.
  const [logoUrl, setLogoUrl] = useState(
    formData['__custom_logo'] || meta?.companyLogoUrl || (isLeaflet ? DEFAULT_LEAFLET_LOGO_URL : DEFAULT_IM_LOGO_URL),
  );
  const [coverImageUrl, setCoverImageUrl] = useState(
    formData['__custom_cover_image'] ?? meta?.coverImageUrl ?? '',
  );

  /**
   * Print typography for this template type + page size. It is a GLOBAL, admin-owned setting
   * (Admin console → IM Print), not something chosen per export and not derived from the
   * product category's template — so the booklet program reads the same house style whichever
   * category or project it was generated from. Shown read-only below; re-read when the page
   * size changes because A4 and A5 have their own profiles.
   */
  const [typography, setTypography] = useState<PrintTypography>(() => defaultTypographyFor(templateType, pageSize));

  // Required change note for this generation — every new PDF must say what changed. Shown
  // (per render) in the export history so the render log doubles as a changelog.
  // Prefilled in review mode so the required-change-note guard doesn't block the
  // one-click "render & send"; still editable, and still saved to the history row.
  const [comment, setComment] = useState('');

  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Per-part render progress ("Rendering DE… 3/12") — large multi-language books render
  // one part per Netlify call, so this is real progress, not a guess.
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrintPdfResult | null>(null);
  // Saving the rendered PDF into the project's documents (via onRendered).
  const [attachState, setAttachState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  // What the last successful render attached (or failed to): kept so a failed attach can
  // be retried for free — re-generating just to retry the attach would burn a credit.
  const [attachParams, setAttachParams] = useState<{ res: PrintPdfResult; langs: string[]; pageSize: 'a4' | 'a5' } | null>(null);

  // Advisory image-weight preflight over ALL published languages (run once per open;
  // warnings below are filtered to the current selection). Never blocks generating.
  const [imageReport, setImageReport] = useState<PrintImageReport | null>(null);

  useEffect(() => {
    let alive = true;
    checkPrintImageWeights(projectId, templateType, languages)
      .then((r) => { if (alive) setImageReport(r); })
      .catch(() => {});
    return () => { alive = false; };
    // languages is stable for a dialog instance (published set) — run once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, templateType]);

  // Load the active global typography profile for the current template type + page size.
  // Never blocks the dialog: the service falls back to the built-in defaults when the
  // settings table is unreachable, which is what the renderer used before it existed.
  useEffect(() => {
    let alive = true;
    getPrintTypography(templateType, pageSize)
      .then((t) => { if (alive) setTypography(t); })
      .catch(() => {});
    return () => { alive = false; };
  }, [templateType, pageSize]);

  // Render history (for "already exists" + version comparison + credit guard).
  const [renders, setRenders] = useState<PrintRender[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [confirmCredit, setConfirmCredit] = useState(false);

  useEffect(() => {
    let alive = true;
    getPrintRenders(projectId, templateType)
      .then((r) => alive && setRenders(r))
      .finally(() => alive && setLoadingHistory(false));
    return () => {
      alive = false;
    };
  }, [projectId, templateType]);

  // ---------------------------------------------------------------------------------
  // "Which SKUs does this PDF answer for?" — recorded here, on the render history, because
  // this is where the operator is already comparing renders and deciding which one is THE
  // one to hand out. See db_migrations/132_create_im_leaflet_issues.sql.
  //
  // Only leaflets: a full IM is per-project by construction, whereas a leaflet answers for
  // a category (generically) or for the SKU group whose data is inside it.
  // ---------------------------------------------------------------------------------
  const { user } = useAuth();
  const canIssue = isLeaflet && !!categoryId;
  const [leafletMode, setLeafletMode] = useState<LeafletMode>('category');
  const [issues, setIssues] = useState<LeafletIssue[]>([]);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  /** Open per-SKU picker: which render, and which of this manual's SKUs to attach to it. */
  const [skuPicker, setSkuPicker] = useState<{ renderId: string; selected: string[] } | null>(null);

  const loadIssues = React.useCallback(async () => {
    if (!categoryId) return;
    const [policies, all] = await Promise.all([getLeafletPolicies(), getLeafletIssues()]);
    setLeafletMode(policies.find((p) => p.categoryId === categoryId)?.mode ?? 'category');
    // A per-SKU issue's category_id is always set, so one filter covers both kinds.
    setIssues(all.filter((i) => i.categoryId === categoryId));
  }, [categoryId]);

  useEffect(() => {
    if (!canIssue) return;
    let alive = true;
    loadIssues().catch(() => { if (alive) setIssueError('Could not load leaflet assignments.'); });
    return () => { alive = false; };
  }, [canIssue, loadIssues]);

  /** The render currently issued for the WHOLE category, if any. */
  const categoryIssueRenderId = issues.find((i) => i.skuNumber === null)?.renderId ?? null;

  /** How many SKUs each render is individually assigned to. */
  const skuCountByRender = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) {
      if (!i.skuNumber || !i.renderId) continue;
      m.set(i.renderId, (m.get(i.renderId) ?? 0) + 1);
    }
    return m;
  }, [issues]);

  /**
   * SKU-specific issues standing in a GENERIC category. Not stale and not ignored — a per-SKU
   * issue outranks the category-wide one at resolve time whatever the mode says (migration 132,
   * decision 2), so these SKUs keep their own PDF even after issuing for the whole category.
   * Worth saying out loud, because "Issue for category" otherwise reads as covering everything.
   */
  const exceptionCount =
    leafletMode === 'category' ? issues.filter((i) => i.skuNumber !== null).length : 0;

  const runIssue = async (fn: () => Promise<unknown>, renderId: string) => {
    setIssuing(renderId);
    setIssueError(null);
    try {
      await fn();
      await loadIssues();
      setSkuPicker(null);
    } catch (e) {
      setIssueError(e instanceof Error ? e.message : 'Could not record the assignment.');
    } finally {
      setIssuing(null);
    }
  };

  // Tick an elapsed-seconds counter while a render is in flight, so a slow/stuck
  // render visibly progresses instead of showing a static spinner.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

  // The most recent render matching the currently selected languages + page size + layout.
  // Layout is part of the identity: without it, generating the first compact leaflet would
  // match the existing classic render, report "current" and demand a credit confirmation for
  // a PDF that has never been produced.
  const activeLayout: PrintLeafletLayout = isLeaflet ? leafletLayout : 'classic';

  // The document code identifies the DOCUMENT, so it is keyed on the TEMPLATE's category — a
  // leaflet is a property of the category, not of this one project — falling back to the
  // project's category when no template is loaded.
  const docCode = useDocCode(templateType, pageSize, template?.categoryId ?? categoryId);

  const match =
    renders.find(
      (r) => r.pageSize === pageSize && r.layout === activeLayout && sameSet(r.languages, selected),
    ) ?? null;

  // Compare the matching render's IM version against the IM's current version.
  type RegenStatus = 'new' | 'outdated' | 'current' | 'unknown';
  const status: RegenStatus = !match
    ? 'new'
    : version != null && match.imVersion != null
      ? version > match.imVersion
        ? 'outdated'
        : 'current'
      : 'unknown';

  // Generating the SAME version again wastes a credit → require explicit confirmation.
  const needsConfirm = status === 'current' || status === 'unknown';
  const hasComment = comment.trim().length > 0;
  const canGenerate = !!selected.length && hasComment && !busy && (!needsConfirm || confirmCredit);

  // Re-evaluate confirmation whenever the selection (and thus the match) changes.
  useEffect(() => {
    setConfirmCredit(false);
  }, [pageSize, activeLayout, selected.join(',')]);

  const toggleLang = (lang: string) => {
    // A hand-edited selection is no longer the market's set — drop the stamp.
    setMarketCode('');
    setSelected((prev) =>
      prev.includes(lang)
        ? prev.filter((l) => l !== lang)
        : languages.filter((l) => prev.includes(l) || l === lang),
    );
  };

  const uploadTo = async (slot: string, file: File, set: (url: string) => void) => {
    setUploading(slot);
    try {
      const url = await uploadIMAsset(file, 'cover');
      set(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(null);
    }
  };

  // Attach the (already rendered, already paid-for) PDF to the project's documents.
  const doAttach = async (res: PrintPdfResult, langs: string[], size: 'a4' | 'a5') => {
    if (!onRendered) return;
    setAttachState('saving');
    try {
      await onRendered(res, langs, size);
      setAttachState('saved');
    } catch (attachErr) {
      console.error('[print-export] Saving the PDF to the project failed:', attachErr);
      setAttachState('failed');
    }
  };

  // Retrying the attach costs nothing — the PDF is already rendered.
  const retryAttach = () => {
    if (attachParams) void doAttach(attachParams.res, attachParams.langs, attachParams.pageSize);
  };

  /** Renders the PDF. Returns the new history row, or null on failure. */
  const handleGenerate = async (): Promise<PrintRender | null> => {
    setBusy(true);
    setElapsed(0);
    setProgress(null);
    setError(null);
    setResult(null);
    setAttachState('idle');
    setAttachParams(null);
    try {
      const res = await requestPrintPdf({
        projectId,
        templateType,
        languages: selected,
        pageSize,
        version,
        comment: comment.trim(),
        market: marketCode || undefined,
        onProgress: (label, done, total) => setProgress({ label, done, total }),
        typography,
        mergeToc: isLeaflet ? undefined : mergeToc,
        leafletLayout: isLeaflet ? leafletLayout : undefined,
        docCode: docCode || undefined,
        cover: {
          title,
          // Subtitle is never configured here — always left empty so the builder
          // auto-fills "Instruction Manual" in every selected language.
          logoUrl: logoUrl || undefined,
          coverImageUrl: coverImageUrl || undefined,
          skus: skuText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          // imName intentionally omitted — the cover footer manual-name line is always empty.
          companyName: meta?.companyName,
          footerText: formData['__custom_footer'] ?? meta?.footerText,
        },
        // Back cover is always empty — no content, logo, or marks are configured.
        back: {},
      });
      setResult(res);
      if (res.render) setRenders((prev) => [res.render as PrintRender, ...prev]);
      setConfirmCredit(false);
      setComment('');

      // Remember the chosen logo/cover as this IM's defaults for next time.
      onCoverPrefs?.(isLeaflet ? { logoUrl } : { logoUrl, coverImageUrl });

      // Persist the render as the project's "Generated …" document. Non-fatal: the PDF
      // is already rendered and downloadable — a failure here only shows a warning
      // (with a free retry; see retryAttach).
      if (onRendered) {
        setAttachParams({ res, langs: selected, pageSize });
        await doAttach(res, selected, pageSize);
      }
      return (res.render as PrintRender | undefined) ?? null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Print render failed.');
      return null;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  /**
   * Brand picker — the ONLY difference between brands is the wordmark (IM cover / leaflet
   * header), so this just swaps `logoUrl`. The selected brand is DERIVED from that URL rather
   * than held as its own state: uploading a custom logo therefore deselects both chips by
   * itself, and a project that remembered a Blumfeldt logo reopens on Blumfeldt, with no
   * second source of truth to keep in sync. Klarstein is what an unset IM prefills to.
   */
  const selectedBrand = brandForLogoUrl(logoUrl);

  const BrandPicker: React.FC = () => (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase">Brand</label>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {IM_BRAND_ORDER.map((brand) => {
          const on = selectedBrand === brand;
          return (
            <button
              key={brand}
              onClick={() => setLogoUrl(brandLogoUrl(brand, isLeaflet))}
              className={`text-sm px-3 py-1.5 border rounded font-medium ${
                on ? 'bg-primary/10 border-primary text-primary' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {IM_BRANDS[brand].label}
            </button>
          );
        })}
        {!selectedBrand && <span className="text-[11px] text-gray-400">Custom logo</span>}
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        Swaps the {isLeaflet ? 'header' : 'cover'} logo only — the content is identical. Klarstein unless
        you change it; uploading a logo below overrides both.
      </p>
    </div>
  );

  const ImgField: React.FC<{
    label: string;
    slot: string;
    value: string;
    onSet: (url: string) => void;
    onClear: () => void;
  }> = ({ label, slot, value, onSet, onClear }) => (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase">{label}</label>
      <div className="flex items-center gap-2 mt-1">
        {value && <img src={value} alt="" className="h-8 w-8 object-contain border rounded bg-white" />}
        <label className="text-xs px-2 py-1.5 border rounded hover:bg-gray-50 cursor-pointer flex items-center gap-1">
          {uploading === slot ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {value ? 'Replace' : 'Upload'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadTo(slot, e.target.files[0], onSet)}
          />
        </label>
        {value && (
          <button onClick={onClear} className="text-xs text-gray-400 hover:text-red-600" title="Remove">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <FileDown size={18} /> {isLeaflet ? 'Export leaflet PDF' : 'Export print PDF'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 overflow-auto space-y-5">
          {/* Scope — Full IM (every published language) vs the project's Printed IM subset.
              Both books render from the SAME published content; they differ only in which
              languages go in. Having both here is deliberate: the operator arrives at this
              dialog from a publish, from Export, or from the Printed IM panel, and must
              never have to close it and hunt for a second entry point to get the other PDF.
              Hidden when the printed subset IS the full set — two identical chips help nobody. */}
          {printedScope.length > 0 && !sameSet(printedScope, languages) && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Scope</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {([
                  { key: 'full', label: 'Full IM', langs: languages, hint: 'Every published language' },
                  { key: 'printed', label: 'Print Version', langs: printedScope, hint: 'The languages that ship in the printed booklet' },
                ] as const).map((sc) => {
                  const on = sameSet(selected, sc.langs);
                  return (
                    <button
                      key={sc.key}
                      onClick={() => { setMarketCode(''); setSelected(sc.langs); }}
                      title={`${sc.hint} — ${sc.langs.map((l) => l.toUpperCase()).join(', ')}`}
                      className={`text-sm px-3 py-1.5 border rounded font-medium ${
                        on ? 'bg-primary/10 border-primary text-primary' : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {sc.label} <span className="text-xs font-normal opacity-70">· {sc.langs.length}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Market preset — admin-configured market → language sets (Admin panel → Markets).
              One click selects the market's languages and stamps the market on the render. */}
          {markets.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Market (preset)</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {markets.map((m) => {
                  const available = languages.filter((l) => m.languages.includes(l));
                  const missing = m.languages.filter((l) => !languages.includes(l));
                  const on = marketCode === m.code;
                  return (
                    <button
                      key={m.code}
                      onClick={() => applyMarket(on ? '' : m.code)}
                      disabled={!available.length}
                      title={`${m.name} → ${m.languages.map((l) => l.toUpperCase()).join(', ')}${
                        missing.length ? ` — NOT published yet: ${missing.map((l) => l.toUpperCase()).join(', ')}` : ''
                      }`}
                      className={`text-sm px-3 py-1.5 border rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed ${
                        on ? 'bg-primary/10 border-primary text-primary' : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {m.code}
                      {missing.length > 0 && <span className="ml-1 text-[10px] text-amber-600 font-bold" title={`Not published: ${missing.map((l) => l.toUpperCase()).join(', ')}`}>!</span>}
                    </button>
                  );
                })}
              </div>
              {marketCode && (() => {
                const m = markets.find((x) => x.code === marketCode);
                const missing = m ? m.languages.filter((l) => !languages.includes(l)) : [];
                return missing.length ? (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2">
                    {marketCode} requires {missing.map((l) => l.toUpperCase()).join(', ')}, which {missing.length === 1 ? 'is' : 'are'} not
                    published for this manual yet — the booklet will be produced without {missing.length === 1 ? 'it' : 'them'}.
                  </p>
                ) : null;
              })()}
            </div>
          )}

          {/* Languages */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">
              Languages (combined into one booklet)
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {languages.map((lang) => {
                const on = selected.includes(lang);
                return (
                  <button
                    key={lang}
                    onClick={() => toggleLang(lang)}
                    className={`flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded ${
                      on ? 'bg-primary/10 border-primary text-primary' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {on ? <CheckSquare size={14} /> : <Square size={14} />}
                    {lang.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Page size */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Page size</label>
            <div className="flex gap-2 mt-2">
              {(['a4', 'a5'] as const).map((sz) => (
                <button
                  key={sz}
                  onClick={() => setPageSize(sz)}
                  className={`text-sm px-4 py-1.5 border rounded ${
                    pageSize === sz ? 'bg-primary/10 border-primary text-primary' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {sz.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Document code — what identifies this PDF once it is off the screen. */}
          {docCode && (
            <div className="border rounded-lg px-4 py-3 bg-gray-50/60">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Document code</span>
                <span className="text-sm font-semibold text-gray-800 font-mono tabular-nums">
                  {docCode}
                  {version != null && <span className="text-gray-400"> · v{version}</span>}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Printed in the footer and used in the filename. The code names the document (type,
                category, page size) and the version names the revision — together they identify
                exactly one PDF, and both are the same for every render of this leaflet.
              </p>
            </div>
          )}

          {/* Leaflet layout — leaflets only. */}
          {isLeaflet && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Layout</label>
              <div className="flex gap-2 mt-2">
                {([
                  { key: 'classic' as const, label: 'Classic', hint: 'One column, as printed today' },
                  { key: 'compact2col' as const, label: 'Compact 2-column', hint: '7pt, two columns, no tinted panels' },
                ]).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setLeafletLayout(opt.key)}
                    title={opt.hint}
                    className={`text-sm px-4 py-1.5 border rounded text-left ${
                      leafletLayout === opt.key
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {leafletLayout === 'compact2col'
                  ? 'Two columns, justified and hyphenated. Hazard blocks print as a coloured severity band with the ISO 7010 sign inline — no tinted panels and no icon gutter, so body text keeps the full column. Type sizes, line spacing and margins are the same Admin → IM Print leaflet profile the classic layout uses.'
                  : 'One full-measure column with tinted hazard panels. Same Admin → IM Print leaflet profile as the compact layout.'}
              </p>
            </div>
          )}

          {/* Page economy — full manuals only (leaflets have no TOC). */}
          {!isLeaflet && (
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mergeToc}
                onChange={(e) => setMergeToc(e.target.checked)}
                className="mt-0.5 accent-indigo-600"
              />
              <span className="text-sm text-gray-700">
                Start content on the contents page
                <span className="block text-[11px] text-gray-400">
                  Saves one page per language. Untick to keep the manual starting on a fresh page after the table of contents.
                </span>
              </span>
            </label>
          )}

          {/* Front cover — leaflets have no cover, so only the header logo is shown. */}
          {isLeaflet ? (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="text-sm font-semibold text-gray-700">Header logo</div>
              <p className="text-[11px] text-gray-400 -mt-1">
                Shown at the top of the first page of each language. Leaflets have no cover, table of
                contents, or back page — content is rendered compactly.
              </p>
              <BrandPicker />
              <ImgField label="Logo" slot="cover-logo" value={logoUrl} onSet={setLogoUrl} onClear={() => setLogoUrl('')} />
              <TypographySummary typography={typography} pageSize={pageSize} />
            </div>
          ) : (
            <>
              <div className="border rounded-lg p-4 space-y-3">
                <div className="text-sm font-semibold text-gray-700">Front cover</div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full text-sm border rounded px-2 py-1.5 mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">SKU / Article number(s)</label>
                  <input
                    value={skuText}
                    onChange={(e) => setSkuText(e.target.value)}
                    placeholder="Comma-separated, e.g. 10045123, 10045124"
                    className="w-full text-sm border rounded px-2 py-1.5 mt-1"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Shown on the cover. Prefilled from the SKUs bound to this manual.</p>
                </div>
                <BrandPicker />
                <div className="grid grid-cols-2 gap-3">
                  <ImgField label="Logo" slot="cover-logo" value={logoUrl} onSet={setLogoUrl} onClear={() => setLogoUrl('')} />
                  <ImgField
                    label="Cover image"
                    slot="cover-image"
                    value={coverImageUrl}
                    onSet={setCoverImageUrl}
                    onClear={() => setCoverImageUrl('')}
                  />
                </div>
              </div>
              <TypographySummary typography={typography} pageSize={pageSize} />
            </>
          )}

          {/* Required change note — captured per generation, shown in the history below. */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">
              Change note <span className="text-red-500">*</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="What changed in this version? (required)"
              className={`w-full text-sm border rounded px-2 py-1.5 mt-1 resize-y ${
                hasComment ? '' : 'border-red-300 focus:border-red-400'
              }`}
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Required. Saved with this PDF and shown in the export history below.
            </p>
          </div>

          {/* Advisory image-weight warning (preflight over the published JSONs). Heavy
              images slow PDFShift (or time it out) and bloat the booklet — flag them
              with the sections they live in so they can be re-exported smaller. */}
          {imageReport && (() => {
            const relevant = imageReport.heavy.filter((img) => img.languages.some((l) => selected.includes(l.toLowerCase())));
            if (!relevant.length) return null;
            const fmtMb = (b: number) => `${(b / 1_000_000).toFixed(1)} MB`;
            const fileName = (u: string) => decodeURIComponent(u.split('/').pop()?.split('?')[0] ?? u);
            return (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <strong>{relevant.length} large image{relevant.length > 1 ? 's' : ''}</strong> in the selected languages
                    {' '}(≥ 1 MB) — rendering may be slow and the PDF unnecessarily big. Consider re-uploading them smaller.
                    <ul className="mt-1.5 space-y-0.5 text-xs">
                      {relevant.slice(0, 5).map((img) => (
                        <li key={img.url} className="truncate" title={`${img.url} — used in: ${img.sections.join(', ')}`}>
                          <span className="font-semibold">{fmtMb(img.bytes ?? 0)}</span> · {fileName(img.url)} · {img.sections.join(', ')}
                        </li>
                      ))}
                      {relevant.length > 5 && <li className="italic">…and {relevant.length - 5} more</li>}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Existing-version / regeneration guard for the current selection */}
          {!loadingHistory && match && (
            <div
              className={`rounded border px-3 py-2.5 text-sm ${
                status === 'outdated'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-blue-50 border-blue-200 text-blue-800'
              }`}
            >
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div className="flex-1">
                  {status === 'outdated' ? (
                    <>
                      A PDF for this selection exists (built from <strong>v{match.imVersion}</strong>, {fmtDate(match.createdAt)}),
                      but the manual has since been updated to <strong>v{version}</strong>. Generating will include the changes.
                    </>
                  ) : status === 'current' ? (
                    <>
                      A PDF for this selection already exists for the current version (<strong>v{match.imVersion}</strong>,
                      {' '}{fmtDate(match.createdAt)}). Nothing has changed since — regenerating will spend a render credit.
                    </>
                  ) : (
                    <>
                      A PDF for this selection already exists ({fmtDate(match.createdAt)}). Regenerating will spend a render credit.
                    </>
                  )}
                  <div className="mt-1.5">
                    <a href={match.url} target="_blank" rel="noreferrer" className="underline font-medium inline-flex items-center gap-1">
                      <Download size={13} /> Download existing
                    </a>
                  </div>
                  {needsConfirm && (
                    <label className="mt-2 flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={confirmCredit} onChange={(e) => setConfirmCredit(e.target.checked)} />
                      <span>Generate a new one anyway (uses a credit)</span>
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Full render history */}
          {!loadingHistory && renders.length > 0 && (
            <details className="border rounded">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700 flex items-center gap-2">
                <History size={14} /> Previous exports ({renders.length})
              </summary>
              {/* Recording which SKUs a render answers for lives here, on the history, because
                  this is where the operator already compares renders and decides which one is
                  THE one to hand out. Generic categories issue once for everything; per-SKU
                  categories attach the render to the SKU group whose data is inside it. */}
              {canIssue && (
                <div className="px-3 py-2 border-t bg-gray-50 text-[11px] text-gray-600 flex items-center gap-1.5 flex-wrap">
                  <BookMarked size={12} className="text-gray-400" />
                  {leafletMode === 'category'
                    ? 'This category uses ONE generic leaflet — issuing covers every SKU in it, now and in future.'
                    : "This category's leaflet carries SKU data — issue each render to the SKUs it was built from."}
                  {exceptionCount > 0 && (
                    <span className="text-amber-700">
                      · {exceptionCount} SKU{exceptionCount === 1 ? '' : 's'} keep their own
                      leaflet and will override it
                    </span>
                  )}
                </div>
              )}
              {issueError && (
                <div className="px-3 py-2 border-t bg-red-50 text-[11px] text-red-700">{issueError}</div>
              )}
              <div className="divide-y border-t max-h-56 overflow-auto">
                {renders.map((r) => {
                  const isCategoryIssued = canIssue && r.id === categoryIssueRenderId;
                  const skuCount = skuCountByRender.get(r.id) ?? 0;
                  const picking = skuPicker?.renderId === r.id;
                  return (
                  <div key={r.id} className="px-3 py-2 text-xs">
                   <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="text-gray-600">
                        {r.market && <span className="inline-block mr-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 font-bold">{r.market}</span>}
                        <span className="font-medium uppercase">{r.languages.join(', ')}</span> · {r.pageSize?.toUpperCase()}
                        {/* NULL on rows written before migration 124 — omit rather than print 0pp. */}
                        {r.pages != null && <> · {r.pages}pp</>}
                        {r.imVersion != null && <> · v{r.imVersion}</>} · {fmtDate(r.createdAt)}
                        {r.createdBy && <> · {r.createdBy}</>}
                      </span>
                      {isCategoryIssued && (
                        <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold">
                          Issued · all SKUs
                        </span>
                      )}
                      {skuCount > 0 && (
                        <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold">
                          Issued · {skuCount} SKU{skuCount === 1 ? '' : 's'}
                        </span>
                      )}
                      {r.comment && (
                        <p className="text-gray-500 mt-0.5 whitespace-pre-wrap break-words">{r.comment}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {canIssue && leafletMode === 'category' && !isCategoryIssued && (
                        <button
                          type="button"
                          disabled={issuing === r.id}
                          onClick={() => runIssue(
                            () => issueCategoryLeaflet(categoryId as string, r.id, { by: user?.email ?? null }),
                            r.id,
                          )}
                          className="px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          {issuing === r.id ? 'Issuing…' : 'Issue for category'}
                        </button>
                      )}
                      {canIssue && leafletMode === 'sku' && (
                        <button
                          type="button"
                          disabled={issuing === r.id || skus.length === 0}
                          onClick={() => setSkuPicker(picking ? null : { renderId: r.id, selected: skus })}
                          title={skus.length === 0 ? 'This manual has no bound SKUs to assign.' : undefined}
                          className="px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          {picking ? 'Cancel' : 'Issue for SKUs (' + skus.length + ')'}
                        </button>
                      )}
                      <a href={r.url} target="_blank" rel="noreferrer" className="px-2 py-1 border rounded hover:bg-gray-50">
                        Download
                      </a>
                    </div>
                   </div>
                   {/* Pre-filled with this manual's bound SKUs — precisely the group whose data
                       the PDF contains — but adjustable, since one export can legitimately be
                       handed to a subset. */}
                   {picking && skuPicker && (
                     <div className="mt-2 border rounded bg-gray-50 p-2">
                       <div className="flex flex-wrap gap-1.5 mb-2">
                         {skus.map((n) => {
                           const on = skuPicker.selected.includes(n);
                           return (
                             <button
                               key={n}
                               type="button"
                               onClick={() => setSkuPicker({
                                 renderId: r.id,
                                 selected: on
                                   ? skuPicker.selected.filter((x) => x !== n)
                                   : [...skuPicker.selected, n],
                               })}
                               className={on
                                 ? 'px-1.5 py-0.5 rounded border font-medium bg-emerald-50 border-emerald-200 text-emerald-700'
                                 : 'px-1.5 py-0.5 rounded border font-medium bg-white border-gray-200 text-gray-400'}
                             >
                               {on
                                 ? <CheckSquare size={10} className="inline mr-1" />
                                 : <Square size={10} className="inline mr-1" />}
                               {n}
                             </button>
                           );
                         })}
                       </div>
                       <button
                         type="button"
                         disabled={issuing === r.id || skuPicker.selected.length === 0}
                         onClick={() => runIssue(
                           () => issueLeafletForSkus(
                             categoryId as string,
                             r.id,
                             skuPicker.selected,
                             { by: user?.email ?? null },
                           ),
                           r.id,
                         )}
                         className="px-2 py-1 rounded bg-primary text-white font-medium disabled:opacity-50"
                       >
                         {issuing === r.id
                           ? 'Issuing…'
                           : 'Confirm — this PDF covers ' + skuPicker.selected.length + ' SKU'
                             + (skuPicker.selected.length === 1 ? '' : 's')}
                       </button>
                     </div>
                   )}
                  </div>
                  );
                })}
              </div>
            </details>
          )}

          {busy && (
            <div>
              <div className="flex justify-between text-xs text-muted mb-1">
                <span>{progress ? progress.label : 'Starting…'}</span>
                <span>{progress ? `${progress.done} / ${progress.total} · ` : ''}{elapsed}s</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress?.total ? Math.round((progress.done / progress.total) * 100) : 8}%` }}
                />
              </div>
              <p className="text-[11px] text-muted mt-1">
                Large books render one part per language — this can take a while but has no size limit.
              </p>
            </div>
          )}

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          {result && (
            <div className="bg-emerald-50 border border-emerald-200 rounded px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-emerald-800 flex items-center gap-1.5">
                  Print PDF ready.
                  {attachState === 'saving' && (
                    <span className="text-emerald-700/80 flex items-center gap-1">
                      <Loader2 size={12} className="animate-spin" /> Saving to project documents…
                    </span>
                  )}
                  {attachState === 'saved' && <span className="text-emerald-700/80">Saved to project documents.</span>}
                </span>
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-sm px-3 py-1.5 bg-emerald-600 text-white rounded hover:opacity-90 flex items-center gap-1.5"
                >
                  <Download size={14} /> Download
                </a>
              </div>
            </div>
          )}

          {/* Page budget + preflight for the render just produced. Warn-only: it never gates
              the download above, which is already in the operator's hands by this point. */}
          {result && <PrintExportReport result={result} renders={renders} pageSize={pageSize} />}

          {/* Non-fatal server-side warning (e.g. the render-history row could not be recorded). */}
          {result?.warning && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              {result.warning}
            </div>
          )}

          {attachState === 'failed' && (
            <div className="flex items-center justify-between gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <span>
                The PDF was rendered, but saving it to the project's documents failed. The file
                itself is fine — download it above, or retry the save (free — no new render).
              </span>
              <button
                onClick={retryAttach}
                className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded border border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
              >Retry save</button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <button onClick={onClose} className="text-sm px-3 py-2 border rounded hover:bg-gray-50">
            Close
          </button>
          <button
            onClick={() => void handleGenerate()}
            disabled={!canGenerate}
            title={!selected.length ? 'Select at least one language' : !hasComment ? 'Add a change note first' : needsConfirm && !confirmCredit ? 'This selection already exists — confirm to spend a credit' : ''}
            className="text-sm px-4 py-2 bg-primary text-white rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {busy ? `Rendering… ${elapsed}s` : status === 'outdated' ? 'Generate updated PDF' : 'Generate print PDF'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintExportDialog;
