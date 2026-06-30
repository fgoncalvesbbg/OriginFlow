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
import { X, Upload, Loader2, Download, CheckSquare, Square, Trash2, FileDown, AlertCircle, History } from 'lucide-react';
import { IMTemplate, IMTemplateType } from '../../../types';
import { requestPrintPdf, getPrintRenders, PrintPdfResult, PrintRender } from '../../../services';
import { uploadIMAsset } from '../../../services/im/im-asset.service';

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
  onClose: () => void;
}

const PrintExportDialog: React.FC<PrintExportDialogProps> = ({
  projectId,
  templateType,
  projectName,
  template,
  formData,
  languages,
  skus,
  version,
  onClose,
}) => {
  const meta = template?.metadata;

  // Language selection — all on by default, preserving the published order.
  const [selected, setSelected] = useState<string[]>(languages);

  const [pageSize, setPageSize] = useState<'a4' | 'a5'>(
    meta?.pageSize === 'a5' ? 'a5' : 'a4',
  );

  // Shared cover, prefilled from existing override hooks + template metadata.
  const [title, setTitle] = useState(formData['__cover_title'] ?? projectName);
  // Empty subtitle → builder auto-fills "Instruction Manual" in every printed language.
  const [subtitle, setSubtitle] = useState(formData['__cover_subtitle'] ?? '');
  const [skuText, setSkuText] = useState(skus.join(', '));
  const [logoUrl, setLogoUrl] = useState(formData['__custom_logo'] ?? meta?.companyLogoUrl ?? '');
  const [coverImageUrl, setCoverImageUrl] = useState(
    formData['__custom_cover_image'] ?? meta?.coverImageUrl ?? '',
  );
  const [coverMarks, setCoverMarks] = useState<string[]>([]);

  // Shared back cover.
  const [backContent, setBackContent] = useState(meta?.backPageContent ?? '');
  const [backLogoUrl, setBackLogoUrl] = useState('');
  const [backMarks, setBackMarks] = useState<string[]>([]);

  const [uploading, setUploading] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrintPdfResult | null>(null);

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
  const canGenerate = !!selected.length && !busy && (!needsConfirm || confirmCredit);

  // Re-evaluate confirmation whenever the selection (and thus the match) changes.
  useEffect(() => {
    setConfirmCredit(false);
  }, [pageSize, selected.join(',')]);

  const toggleLang = (lang: string) =>
    setSelected((prev) =>
      prev.includes(lang)
        ? prev.filter((l) => l !== lang)
        : languages.filter((l) => prev.includes(l) || l === lang),
    );

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

  const uploadMark = async (slot: string, file: File, add: (url: string) => void) => {
    setUploading(slot);
    try {
      const url = await uploadIMAsset(file, 'cover');
      add(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(null);
    }
  };

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await requestPrintPdf({
        projectId,
        templateType,
        languages: selected,
        pageSize,
        version,
        cover: {
          title,
          subtitle: subtitle.trim() || undefined,
          logoUrl: logoUrl || undefined,
          coverImageUrl: coverImageUrl || undefined,
          markUrls: coverMarks.length ? coverMarks : undefined,
          skus: skuText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          imName: template?.name,
          companyName: meta?.companyName,
          footerText: formData['__custom_footer'] ?? meta?.footerText,
        },
        back: {
          contentHtml: backContent || undefined,
          logoUrl: backLogoUrl || undefined,
          markUrls: backMarks.length ? backMarks : undefined,
        },
      });
      setResult(res);
      if (res.render) setRenders((prev) => [res.render as PrintRender, ...prev]);
      setConfirmCredit(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Print render failed.');
    } finally {
      setBusy(false);
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

  const MarkList: React.FC<{
    label: string;
    slot: string;
    marks: string[];
    setMarks: React.Dispatch<React.SetStateAction<string[]>>;
  }> = ({ label, slot, marks, setMarks }) => (
    <div>
      <label className="text-xs font-semibold text-gray-500 uppercase">{label}</label>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {marks.map((m, i) => (
          <div key={i} className="relative">
            <img src={m} alt="" className="h-10 w-10 object-contain border rounded bg-white" />
            <button
              onClick={() => setMarks((prev) => prev.filter((_, j) => j !== i))}
              className="absolute -top-2 -right-2 bg-white border rounded-full text-gray-400 hover:text-red-600"
              title="Remove mark"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <label className="text-xs px-2 py-1.5 border rounded hover:bg-gray-50 cursor-pointer flex items-center gap-1">
          {uploading === slot ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Add mark
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) =>
              e.target.files?.[0] && uploadMark(slot, e.target.files[0], (url) => setMarks((p) => [...p, url]))
            }
          />
        </label>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <FileDown size={18} /> Export print PDF
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 overflow-auto space-y-5">
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

          {/* Front cover */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-700">Front cover</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full text-sm border rounded px-2 py-1.5 mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase">Subtitle</label>
                <input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder='Auto: "Instruction Manual" in all selected languages'
                  className="w-full text-sm border rounded px-2 py-1.5 mt-1"
                />
              </div>
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
            <MarkList label="Marks (CE, UKCA, WEEE…)" slot="cover-mark" marks={coverMarks} setMarks={setCoverMarks} />
          </div>

          {/* Back cover */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-700">Back cover</div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Content (HTML)</label>
              <textarea
                value={backContent}
                onChange={(e) => setBackContent(e.target.value)}
                rows={3}
                className="w-full text-sm border rounded px-2 py-1.5 mt-1 font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ImgField
                label="Logo"
                slot="back-logo"
                value={backLogoUrl}
                onSet={setBackLogoUrl}
                onClear={() => setBackLogoUrl('')}
              />
            </div>
            <MarkList label="Marks" slot="back-mark" marks={backMarks} setMarks={setBackMarks} />
          </div>

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
              <div className="divide-y border-t max-h-40 overflow-auto">
                {renders.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="text-gray-600">
                      <span className="font-medium uppercase">{r.languages.join(', ')}</span> · {r.pageSize.toUpperCase()}
                      {r.imVersion != null && <> · v{r.imVersion}</>} · {fmtDate(r.createdAt)}
                      {r.createdBy && <> · {r.createdBy}</>}
                    </span>
                    <a href={r.url} target="_blank" rel="noreferrer" className="px-2 py-1 border rounded hover:bg-gray-50">
                      Download
                    </a>
                  </div>
                ))}
              </div>
            </details>
          )}

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

          {result && (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded px-3 py-2.5">
              <span className="text-sm text-emerald-800">Print PDF ready.</span>
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm px-3 py-1.5 bg-emerald-600 text-white rounded hover:opacity-90 flex items-center gap-1.5"
              >
                <Download size={14} /> Download
              </a>
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
            title={!selected.length ? 'Select at least one language' : needsConfirm && !confirmCredit ? 'This selection already exists — confirm to spend a credit' : ''}
            className="text-sm px-4 py-2 bg-primary text-white rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {busy ? 'Rendering…' : status === 'outdated' ? 'Generate updated PDF' : 'Generate print PDF'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintExportDialog;
