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
import { X, Upload, Loader2, Download, CheckSquare, Square, Trash2, FileDown, AlertCircle, History, Send, ExternalLink, Type } from 'lucide-react';
import { IMTemplate, IMTemplateType } from '../../../types';
import { DEFAULT_IM_LOGO_URL, DEFAULT_LEAFLET_LOGO_URL } from '../../../config/im.constants';
import { requestPrintPdf, getPrintRenders, getIMMarkets, checkPrintImageWeights, sendRenderToMarkup, isMarkupReviewAvailable, PrintPdfResult, PrintRender, IMMarket, PrintImageReport, MarkupReviewResult } from '../../../services';
import { uploadIMAsset } from '../../../services/im/im-asset.service';
import { getPrintTypography, defaultTypographyFor, type PrintTypography } from '../../../services/im/im-print-settings.service';

interface PrintExportDialogProps {
  projectId: string;
  templateType: IMTemplateType;
  projectName: string;
  template: IMTemplate | null;
  formData: Record<string, string>;
  /** Published languages available for export. */
  languages: string[];
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
  /**
   * Called after a PDF was successfully sent to Markup.io for review, so the caller
   * can refresh the manual's review state (badge + link) without re-fetching.
   */
  onReviewSent?: (result: MarkupReviewResult) => void;
  onClose: () => void;
}

/**
 * Read-only view of the global print typography this export will use.
 *
 * Deliberately not editable here. Typography used to vary by product category (the font
 * family came from the category's IM template) and the leaflet's point sizes were typed in
 * per export, so two booklets from the same program could be set differently. It is now one
 * admin-owned setting per page size, and this panel exists so the operator can see what they
 * are about to get — and where to change it — without being able to diverge from it.
 */
const TypographySummary: React.FC<{ typography: PrintTypography; pageSize: 'a4' | 'a5' }> = ({
  typography,
  pageSize,
}) => {
  const { fontFamily, bodyPt, headingPt, lineHeight, margins } = typography;
  const row = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-700 tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="border rounded-lg p-4 space-y-2 bg-gray-50/60">
      <div className="flex items-center gap-2">
        <Type size={14} className="text-gray-400" />
        <span className="text-sm font-semibold text-gray-700">Typography ({pageSize.toUpperCase()})</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 pt-1">
        {row('Font', fontFamily)}
        {row('Body', `${bodyPt} pt`)}
        {row('Headings', `${headingPt} pt`)}
        {row('Line spacing', `${lineHeight}×`)}
        {row('Margins T/B', `${margins.top} / ${margins.bottom} mm`)}
        {row('Margins L/R', `${margins.left} / ${margins.right} mm`)}
      </div>
      <p className="text-[11px] text-gray-400">
        One global house style per page size — the same for every product category. Admins change
        it in the Admin console → IM Print.
      </p>
    </div>
  );
};

const PrintExportDialog: React.FC<PrintExportDialogProps> = ({
  projectId,
  templateType,
  projectName,
  template,
  formData,
  languages,
  skus,
  version,
  onRendered,
  onCoverPrefs,
  onReviewSent,
  onClose,
}) => {
  const meta = template?.metadata;

  // Warning Leaflets render as a compact PDF with no cover/back — so the dialog only needs the
  // logo (which feeds the per-language header), languages, and page size. The backend ignores
  // the other cover/back inputs for leaflets regardless; hiding them avoids confusion.
  const isLeaflet = templateType === 'warning_leaflet';

  // Language selection — all on by default, preserving the published order.
  const [selected, setSelected] = useState<string[]>(languages);
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
    // Leaflets default to A5 (compact); full manuals honor the template's page size.
    isLeaflet ? 'a5' : meta?.pageSize === 'a5' ? 'a5' : 'a4',
  );

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

  // Tick an elapsed-seconds counter while a render is in flight, so a slow/stuck
  // render visibly progresses instead of showing a static spinner.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

  // The most recent render matching the currently selected languages + page size.
  const match = renders.find((r) => r.pageSize === pageSize && sameSet(r.languages, selected)) ?? null;

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
  }, [pageSize, selected.join(',')]);

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

  // --- Markup.io supplier review -------------------------------------------------
  // Sends an ALREADY-rendered PDF (fresh result or any history row) to Markup.io.
  // Each send creates a new markup, so earlier review rounds keep their links and
  // supplier comments; a row that was already sent shows its link instead of the button.
  const markupEnabled = isMarkupReviewAvailable();
  const [sendingReviewId, setSendingReviewId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // Non-fatal server-side warning (the markup exists but recording it failed).
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [copiedReviewId, setCopiedReviewId] = useState<string | null>(null);

  const markupNameFor = (r: PrintRender) =>
    `${projectName} – ${isLeaflet ? 'Warning Leaflet' : 'Instruction Manual'}` +
    `${r.imVersion != null ? ` v${r.imVersion}` : ''} (${r.languages.map((l) => l.toUpperCase()).join(', ')})`;

  const sendForReview = async (r: PrintRender) => {
    if (sendingReviewId) return;
    setSendingReviewId(r.id);
    setReviewError(null);
    setReviewNotice(null);
    try {
      const res = await sendRenderToMarkup({ projectId, templateType, renderId: r.id, name: markupNameFor(r) });
      setRenders((prev) => prev.map((x) => (x.id === r.id ? { ...x, markupUrl: res.markupUrl, markupId: res.markupId } : x)));
      if (res.warning) setReviewNotice(res.warning);
      onReviewSent?.(res);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : 'Sending to Markup.io failed.');
    } finally {
      setSendingReviewId(null);
    }
  };

  const copyReviewLink = (r: PrintRender) => {
    if (!r.markupUrl) return;
    navigator.clipboard.writeText(r.markupUrl).then(() => {
      setCopiedReviewId(r.id);
      setTimeout(() => setCopiedReviewId((cur) => (cur === r.id ? null : cur)), 2000);
    }).catch(() => {});
  };

  const handleGenerate = async () => {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Print render failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

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

          {/* Front cover — leaflets have no cover, so only the header logo is shown. */}
          {isLeaflet ? (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="text-sm font-semibold text-gray-700">Header logo</div>
              <p className="text-[11px] text-gray-400 -mt-1">
                Shown at the top of the first page of each language. Leaflets have no cover, table of
                contents, or back page — content is rendered compactly.
              </p>
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

          {/* Supplier review (Markup.io) — ALWAYS visible when the feature is enabled, so
              the review round is findable without expanding the history. Acts on the
              NEWEST rendered PDF; per-row send/links remain in the history below. */}
          {markupEnabled && !loadingHistory && (() => {
            const latest = renders[0] ?? null;
            return (
              <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <Send size={14} className="text-sky-600 shrink-0" />
                  <span className="text-sm font-semibold text-sky-900">Supplier review (Markup.io)</span>
                </div>
                {!latest ? (
                  <p className="text-xs text-sky-800/80">
                    Reviews work on a rendered PDF — generate one below, then send it to Markup.io from here.
                  </p>
                ) : latest.markupUrl ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-sky-800/80">
                      The latest PDF{latest.imVersion != null ? <> (<strong>v{latest.imVersion}</strong>)</> : null} is on
                      Markup.io — share this link with the reviewers:
                    </p>
                    <div className="flex items-center gap-2">
                      <input readOnly value={latest.markupUrl} className="flex-1 min-w-0 text-xs border border-sky-200 rounded px-2 py-1 bg-white text-gray-700" />
                      <button onClick={() => copyReviewLink(latest)} className="text-xs px-2 py-1 border border-sky-200 text-sky-700 rounded hover:bg-sky-100 whitespace-nowrap">
                        {copiedReviewId === latest.id ? 'Copied!' : 'Copy'}
                      </button>
                      <a href={latest.markupUrl} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 border border-sky-200 text-sky-700 rounded hover:bg-sky-100 flex items-center gap-1">
                        <ExternalLink size={11} /> Open
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-sky-800/80 flex-1">
                      Upload the latest PDF{latest.imVersion != null ? <> (<strong>v{latest.imVersion}</strong>, {latest.languages.join(', ').toUpperCase()})</> : null} to
                      Markup.io — reviewers comment directly on the pages, and the manual shows as <strong>In Review</strong>.
                    </p>
                    <button
                      onClick={() => void sendForReview(latest)}
                      disabled={sendingReviewId !== null}
                      className="shrink-0 text-sm px-3 py-1.5 bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 flex items-center gap-1.5 font-medium"
                    >
                      {sendingReviewId === latest.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Send for review
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Full render history */}
          {!loadingHistory && renders.length > 0 && (
            <details className="border rounded">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-700 flex items-center gap-2">
                <History size={14} /> Previous exports ({renders.length})
              </summary>
              <div className="divide-y border-t max-h-40 overflow-auto">
                {renders.map((r) => (
                  <div key={r.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <span className="text-gray-600">
                        {r.market && <span className="inline-block mr-1 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 font-bold">{r.market}</span>}
                        <span className="font-medium uppercase">{r.languages.join(', ')}</span> · {r.pageSize?.toUpperCase()}
                        {r.imVersion != null && <> · v{r.imVersion}</>} · {fmtDate(r.createdAt)}
                        {r.createdBy && <> · {r.createdBy}</>}
                      </span>
                      {r.comment && (
                        <p className="text-gray-500 mt-0.5 whitespace-pre-wrap break-words">{r.comment}</p>
                      )}
                      {r.markupUrl && (
                        <p className="mt-0.5 flex items-center gap-1.5 text-sky-700">
                          <ExternalLink size={11} className="shrink-0" />
                          <a href={r.markupUrl} target="_blank" rel="noreferrer" className="underline truncate" title={r.markupUrl}>
                            Markup.io review
                          </a>
                          <button onClick={() => copyReviewLink(r)} className="shrink-0 underline text-sky-600 hover:text-sky-800">
                            {copiedReviewId === r.id ? 'Copied!' : 'Copy link'}
                          </button>
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {markupEnabled && !r.markupUrl && (
                        <button
                          onClick={() => void sendForReview(r)}
                          disabled={sendingReviewId !== null}
                          title="Upload this PDF to Markup.io and put the manual In Review"
                          className="px-2 py-1 border border-sky-200 text-sky-700 rounded hover:bg-sky-50 disabled:opacity-50 flex items-center gap-1"
                        >
                          {sendingReviewId === r.id ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                          Send for review
                        </button>
                      )}
                      <a href={r.url} target="_blank" rel="noreferrer" className="px-2 py-1 border rounded hover:bg-gray-50">
                        Download
                      </a>
                    </div>
                  </div>
                ))}
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

          {result && (() => {
            // The freshly rendered PDF's history row (carries the markup link once sent).
            // Sending needs the row's id, so the button only shows when the row was recorded.
            const fresh = result.render ? renders.find((x) => x.id === (result.render as PrintRender).id) ?? null : null;
            return (
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
                  <div className="flex items-center gap-2 shrink-0">
                    {markupEnabled && fresh && !fresh.markupUrl && (
                      <button
                        onClick={() => void sendForReview(fresh)}
                        disabled={sendingReviewId !== null}
                        title="Upload this PDF to Markup.io and put the manual In Review"
                        className="text-sm px-3 py-1.5 border border-sky-300 bg-white text-sky-700 rounded hover:bg-sky-50 disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {sendingReviewId === fresh.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        Send for review
                      </button>
                    )}
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded hover:opacity-90 flex items-center gap-1.5"
                    >
                      <Download size={14} /> Download
                    </a>
                  </div>
                </div>
                {fresh?.markupUrl && (
                  <div className="flex items-center gap-2 border-t border-emerald-200/70 pt-2">
                    <span className="text-xs font-semibold text-sky-800 shrink-0 flex items-center gap-1">
                      <ExternalLink size={12} /> Review link
                    </span>
                    <input readOnly value={fresh.markupUrl} className="flex-1 min-w-0 text-xs border border-sky-200 rounded px-2 py-1 bg-white text-gray-700" />
                    <button onClick={() => copyReviewLink(fresh)} className="text-xs px-2 py-1 border border-sky-200 text-sky-700 rounded hover:bg-sky-50 whitespace-nowrap">
                      {copiedReviewId === fresh.id ? 'Copied!' : 'Copy'}
                    </button>
                    <a href={fresh.markupUrl} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 border border-sky-200 text-sky-700 rounded hover:bg-sky-50">
                      Open
                    </a>
                  </div>
                )}
              </div>
            );
          })()}

          {reviewError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{reviewError}</div>
          )}
          {reviewNotice && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">{reviewNotice}</div>
          )}

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
            onClick={handleGenerate}
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
