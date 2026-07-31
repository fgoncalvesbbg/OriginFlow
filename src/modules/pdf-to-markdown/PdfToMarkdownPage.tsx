/**
 * PDF → Markdown: a standalone, stateless conversion tool. Manuals dropped
 * here are parsed entirely in the browser (see usePdfToMarkdownConverter and
 * workers/pdf-parse.worker.ts) and never leave it — no upload, no
 * localStorage/IndexedDB, no analytics. Reloading the page clears everything;
 * that's by design, not a bug.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Layout from '../../components/Layout';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { Badge, BadgeTone } from '../../components/common/Badge';
import {
  Archive,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Loader2,
  Lock,
  Trash2,
  AlertTriangle,
  UploadCloud,
  X,
} from 'lucide-react';
import { usePdfToMarkdownConverter } from './usePdfToMarkdownConverter';
import { FileEntry, FileStatus } from './types';

const IMAGE_ONLY_WARNING_RATIO = 0.2;

function toMarkdownFileName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, '')}.md`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function imageOnlyRatio(entry: FileEntry): number {
  if (!entry.result || entry.result.meta.pageCount === 0) return 0;
  return entry.result.meta.imageOnlyPageCount / entry.result.meta.pageCount;
}

const STATUS_BADGE: Record<FileStatus, { tone: BadgeTone; label: string }> = {
  queued: { tone: 'gray', label: 'Queued' },
  processing: { tone: 'indigo', label: 'Processing' },
  done: { tone: 'emerald', label: 'Done' },
  error: { tone: 'rose', label: 'Error' },
};

const PdfToMarkdownPage: React.FC = () => {
  const { entries, detectColumns, setDetectColumns, addFiles, removeFile, clearAll } = usePdfToMarkdownConverter();
  const [isDragging, setIsDragging] = useState(false);
  const [rejectedNames, setRejectedNames] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copyTimeoutRef.current), []);

  const handleFiles = useCallback(
    (fileList: FileList | File[]) => {
      const { rejected } = addFiles(Array.from(fileList));
      setRejectedNames(rejected);
    },
    [addFiles],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onBrowseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = '';
  };

  const pendingEntries = entries.filter((e) => e.status === 'queued' || e.status === 'processing');
  const finishedEntries = entries.filter((e) => e.status === 'done' || e.status === 'error');
  const doneEntries = entries.filter((e) => e.status === 'done');

  const totalFiles = entries.length;
  const completedFiles = finishedEntries.length;
  const processingEntry = entries.find((e) => e.status === 'processing');
  const overallFraction =
    totalFiles === 0
      ? 0
      : (completedFiles +
          (processingEntry && processingEntry.totalPages > 0
            ? processingEntry.currentPage / processingEntry.totalPages
            : 0)) /
        totalFiles;

  const scannedFiles = doneEntries.filter((e) => imageOnlyRatio(e) > IMAGE_ONLY_WARNING_RATIO);

  const handleDownload = (entry: FileEntry) => {
    if (!entry.result) return;
    downloadBlob(new Blob([entry.result.markdown], { type: 'text/markdown' }), toMarkdownFileName(entry.file.name));
  };

  const handleCopy = async (entry: FileEntry) => {
    if (!entry.result) return;
    await navigator.clipboard.writeText(entry.result.markdown);
    setCopiedId(entry.id);
    window.clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = window.setTimeout(() => setCopiedId(null), 1500);
  };

  const handleDownloadAll = async () => {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const entry of doneEntries) {
      if (entry.result) zip.file(toMarkdownFileName(entry.file.name), entry.result.markdown);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'pdf-to-markdown-export.zip');
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-primary tracking-tight">PDF → Markdown</h1>
          <p className="text-sm text-secondary mt-1">
            Convert instruction manuals to LLM-ready Markdown — entirely in your browser.
          </p>
        </div>

        <div className="flex items-start gap-2 text-xs text-secondary bg-light border border-border rounded-lg px-3 py-2.5">
          <Lock size={14} className="mt-0.5 shrink-0 text-muted" />
          <span>
            Files are processed in your browser. Nothing is uploaded or stored — reloading this page clears
            everything, with no recovery.
          </span>
        </div>

        <Card className="p-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              isDragging ? 'border-accent bg-indigo-50' : 'border-gray-300 hover:border-gray-400'
            }`}
          >
            <UploadCloud size={28} className={isDragging ? 'text-accent' : 'text-muted'} />
            <p className="text-sm font-medium text-primary">Drop PDF files here, or click to browse</p>
            <p className="text-xs text-muted">Multiple files supported. PDFs only.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={onBrowseChange}
            />
          </div>

          {rejectedNames.length > 0 && (
            <p className="mt-3 text-xs text-danger">
              Skipped {rejectedNames.length === 1 ? 'file' : 'files'} that {rejectedNames.length === 1 ? "isn't" : "aren't"} a
              PDF: {rejectedNames.join(', ')}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-primary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={detectColumns}
                onChange={(e) => setDetectColumns(e.target.checked)}
                className="rounded border-gray-300 text-accent focus:ring-accent"
              />
              Detect columns
            </label>
            {entries.length > 0 && (
              <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} />} onClick={clearAll}>
                Clear all
              </Button>
            )}
          </div>
        </Card>

        {entries.length > 0 && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-primary">Progress</h2>
              <span className="text-xs text-muted">
                {completedFiles} / {totalFiles} files
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.round(overallFraction * 100)}%` }}
              />
            </div>

            {pendingEntries.length > 0 && (
              <ul className="mt-4 space-y-2">
                {pendingEntries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 text-sm">
                    {entry.status === 'processing' ? (
                      <Loader2 size={14} className="animate-spin text-accent shrink-0" />
                    ) : (
                      <FileText size={14} className="text-muted shrink-0" />
                    )}
                    <span className="truncate flex-1 text-primary">{entry.file.name}</span>
                    <span className="text-xs text-muted whitespace-nowrap">
                      {entry.status === 'processing' && entry.totalPages > 0
                        ? `Page ${entry.currentPage} / ${entry.totalPages}`
                        : 'Queued'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {scannedFiles.length > 0 && (
          <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              {scannedFiles.length === 1 ? 'One file' : `${scannedFiles.length} files`} — {scannedFiles.map((e) => e.file.name).join(', ')} —{' '}
              {scannedFiles.length === 1 ? 'is' : 'are'} more than {Math.round(IMAGE_ONLY_WARNING_RATIO * 100)}% scanned
              pages with no text layer. Plain extraction won't capture that content — it needs an OCR pass instead.
            </span>
          </div>
        )}

        {finishedEntries.length > 0 && (
          <Card className="p-0 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-primary">Results</h2>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Archive size={14} />}
                onClick={handleDownloadAll}
                disabled={doneEntries.length === 0}
              >
                Download all (.zip)
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-secondary uppercase tracking-wide bg-light">
                    <th className="px-6 py-2.5">File</th>
                    <th className="px-3 py-2.5">Pages</th>
                    <th className="px-3 py-2.5">Est. tokens</th>
                    <th className="px-3 py-2.5">Image-only pages</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-6 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {finishedEntries.map((entry) => {
                    const badge = STATUS_BADGE[entry.status];
                    const scanned = imageOnlyRatio(entry) > IMAGE_ONLY_WARNING_RATIO;
                    return (
                      <tr key={entry.id} className="border-t border-border">
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText size={14} className="text-muted shrink-0" />
                            <span className="truncate text-primary font-medium">{entry.file.name}</span>
                            {scanned && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
                          </div>
                          {entry.status === 'error' && <p className="text-xs text-danger mt-1">{entry.error}</p>}
                        </td>
                        <td className="px-3 py-3 text-secondary">{entry.result?.meta.pageCount ?? '—'}</td>
                        <td className="px-3 py-3 text-secondary">
                          {entry.result ? entry.result.meta.estimatedTokens.toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-3 text-secondary">
                          {entry.result ? `${entry.result.meta.imageOnlyPageCount} / ${entry.result.meta.pageCount}` : '—'}
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={badge.tone} icon={entry.status === 'done' ? <CheckCircle2 size={12} /> : undefined}>
                            {badge.label}
                          </Badge>
                        </td>
                        <td className="px-6 py-3">
                          {entry.status === 'done' && (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button variant="ghost" size="sm" onClick={() => handleCopy(entry)} title="Copy Markdown to clipboard">
                                {copiedId === entry.id ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                              </Button>
                              <Button variant="secondary" size="sm" leftIcon={<Download size={14} />} onClick={() => handleDownload(entry)}>
                                Download
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => removeFile(entry.id)} aria-label="Remove">
                                <X size={14} />
                              </Button>
                            </div>
                          )}
                          {entry.status === 'error' && (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button variant="ghost" size="sm" onClick={() => removeFile(entry.id)} aria-label="Remove">
                                <X size={14} />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
};

export default PdfToMarkdownPage;
