/**
 * The three ways SKUs get into a category, absorbed from the SKU Catalog page.
 *
 *  - **Add one** — a single catalog SKU, number and title.
 *  - **Upload a values sheet** — a transposed sheet (SKU numbers across the top, attributes
 *    down the side), parsed in the browser. Three stages: scan → preview → apply, so a wrong
 *    file is caught before anything reaches the shared database, and the person applying it
 *    sees the counts they are about to commit for everyone.
 *  - **Paste a roster** — "these numbers belong to this category", with no values at all. This
 *    is what leaflet coverage is reported against, and it is a different act from filling in
 *    attributes, which is why it is a different dialog.
 *
 * Phase 3 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import React, { useState } from 'react';
import type { CategoryAttribute } from '../../types';
import type { SkuCsvParseResult } from '../../utils';
import { parseSkuCsv, parseSkuRoster } from '../../utils';
import { Button } from '../common/Button';
import { X, Upload, ListPlus, Plus, AlertTriangle } from 'lucide-react';

const Shell: React.FC<{
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, subtitle, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
    <div className="animate-scaleIn relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-primary">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────────────

export const AddSkuDialog: React.FC<{
  categoryName: string;
  onAdd: (skuNumber: string, skuTitle: string) => Promise<void>;
  onClose: () => void;
}> = ({ categoryName, onAdd, onClose }) => {
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!number.trim()) {
      setError('A SKU needs an item number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(number.trim(), title.trim());
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not add the SKU.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Add a SKU"
      subtitle={`Creates a catalog SKU in ${categoryName}, with no project attached.`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">
            Item number
          </label>
          <input
            value={number}
            onChange={e => setNumber(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="10046631"
            autoFocus
            className="w-full rounded border border-gray-300 p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {/* An item number is not unique here, so this is a warning rather than a block. */}
          <p className="mt-1 text-[11px] text-gray-400">
            An item number may already name another record; both are kept and shown separately.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-500">
            Title <span className="font-normal normal-case text-gray-400">(optional)</span>
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            className="w-full rounded border border-gray-300 p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <Button onClick={submit} loading={busy} leftIcon={<Plus size={14} />} disabled={busy}>
          Add SKU
        </Button>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────────────────────────────────────────────

export const SkuSheetUploadDialog: React.FC<{
  attributes: readonly CategoryAttribute[];
  onApply: (result: SkuCsvParseResult) => Promise<string>;
  onClose: () => void;
}> = ({ attributes, onApply, onClose }) => {
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<SkuCsvParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setDone(null);
    try {
      const parsed = parseSkuCsv(await file.arrayBuffer(), attributes as CategoryAttribute[]);
      setResult(parsed);
      setError(
        parsed.rows.length === 0
          ? 'No SKU columns found. The header row should list SKU numbers across the top, with attributes down the first column.'
          : null,
      );
    } catch (err: any) {
      setResult(null);
      setError(`Could not read the file: ${err.message}`);
    }
    e.target.value = '';
  };

  const apply = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await onApply(result));
      setResult(null);
    } catch (e: any) {
      setError(`Upload failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const matched = result?.attributes.filter(a => a.matched).length ?? 0;
  const unmatched = (result?.attributes.length ?? 0) - matched;

  return (
    <Shell
      title="Upload a values sheet"
      subtitle="SKU numbers across the top, attributes down the side. Parsed here in your browser — nothing is written until you apply it."
      onClose={onClose}
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 p-6 text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-600">
          <Upload size={16} />
          {fileName || 'Choose a .csv or .xlsx file'}
          <input type="file" accept=".csv,.xlsx,.xls" onChange={pick} className="hidden" />
        </label>

        {error && (
          <div className="flex items-start gap-2 rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {done && (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            {done}
          </div>
        )}

        {/* The preview is the whole point of the three-stage flow: the counts somebody is about
            to commit for everyone, shown before they commit them. */}
        {result && result.rows.length > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded border border-gray-200 p-2">
                <div className="text-lg font-bold tabular-nums text-primary">
                  {result.rows.length}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">SKUs</div>
              </div>
              <div className="rounded border border-gray-200 p-2">
                <div className="text-lg font-bold tabular-nums text-emerald-600">{matched}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">
                  attributes matched
                </div>
              </div>
              <div className="rounded border border-gray-200 p-2">
                <div
                  className={`text-lg font-bold tabular-nums ${unmatched > 0 ? 'text-amber-600' : 'text-gray-300'}`}
                >
                  {unmatched}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">
                  not recognised
                </div>
              </div>
            </div>

            {/* Named, not silently dropped: a row the sheet holds that this category has no
                attribute for is a definition to fix, not data to discard quietly. */}
            {unmatched > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="font-semibold">
                  {unmatched} row{unmatched === 1 ? '' : 's'} in the sheet match no attribute in
                  this category and will be ignored:
                </p>
                <ul className="mt-1 space-y-0.5">
                  {result.attributes
                    .filter(a => !a.matched)
                    .slice(0, 12)
                    .map((a, i) => (
                      <li key={i}>• {a.label}</li>
                    ))}
                  {unmatched > 12 && <li>• …and {unmatched - 12} more</li>}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-gray-500">
              Existing values for attributes not in this file are kept, not blanked. A SKU marked
              Final is skipped rather than overwritten.
            </p>

            <Button onClick={apply} loading={busy} disabled={busy} leftIcon={<Upload size={14} />}>
              Apply to {result.rows.length} SKU{result.rows.length === 1 ? '' : 's'}
            </Button>
          </div>
        )}
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────────────────────────────────────────────

export const SkuRosterDialog: React.FC<{
  categoryName: string;
  onApply: (text: string) => Promise<string>;
  onClose: () => void;
}> = ({ categoryName, onApply, onClose }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const preview = parseSkuRoster(text);

  const apply = async () => {
    if (preview.rows.length === 0) {
      setError('No SKU numbers found. Paste one per line.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setDone(await onApply(text));
      setText('');
    } catch (e: any) {
      setError(`Import failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Paste a SKU roster"
      subtitle={`Records that these item numbers belong to ${categoryName}. No attribute values — this is what leaflet coverage is reported against.`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <textarea
          value={text}
          onChange={e => {
            setText(e.target.value);
            setDone(null);
          }}
          rows={10}
          placeholder={'10046631\n10046632\n10047753'}
          className="w-full rounded border border-gray-300 p-2 font-mono text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />

        {/* Counted before anything is written, including what will be thrown away — a collapsed
            duplicate and an ignored line are both things somebody should know happened. */}
        {text.trim() !== '' && (
          <p className="text-[11px] text-gray-500">
            <strong className="tabular-nums">{preview.rows.length}</strong> number
            {preview.rows.length === 1 ? '' : 's'} found
            {preview.duplicates > 0 && `, ${preview.duplicates} duplicate line(s) collapsed`}
            {preview.skipped > 0 && `, ${preview.skipped} line(s) with no number ignored`}.
          </p>
        )}

        {error && <p className="text-xs text-rose-600">{error}</p>}
        {done && (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            {done}
          </div>
        )}

        <Button
          onClick={apply}
          loading={busy}
          disabled={busy || preview.rows.length === 0}
          leftIcon={<ListPlus size={14} />}
        >
          Import {preview.rows.length || ''} SKU{preview.rows.length === 1 ? '' : 's'}
        </Button>
      </div>
    </Shell>
  );
};
