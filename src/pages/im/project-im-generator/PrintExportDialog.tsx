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

import React, { useState } from 'react';
import { X, Upload, Loader2, Download, CheckSquare, Square, Trash2, FileDown } from 'lucide-react';
import { IMTemplate, IMTemplateType } from '../../../types';
import { requestPrintPdf, PrintPdfResult } from '../../../services';
import { uploadIMAsset } from '../../../services/im/im-asset.service';

interface PrintExportDialogProps {
  projectId: string;
  templateType: IMTemplateType;
  projectName: string;
  template: IMTemplate | null;
  formData: Record<string, string>;
  /** Published languages available for export. */
  languages: string[];
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
  const [subtitle, setSubtitle] = useState(formData['__cover_subtitle'] ?? 'INSTRUCTION MANUAL');
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
          subtitle,
          logoUrl: logoUrl || undefined,
          coverImageUrl: coverImageUrl || undefined,
          markUrls: coverMarks.length ? coverMarks : undefined,
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Print render failed.');
    } finally {
      setBusy(false);
    }
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
                  className="w-full text-sm border rounded px-2 py-1.5 mt-1"
                />
              </div>
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
            disabled={busy || !selected.length}
            className="text-sm px-4 py-2 bg-primary text-white rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            {busy ? 'Rendering…' : 'Generate print PDF'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintExportDialog;
