/**
 * Project supplier-draft diff import dialog
 *
 * Layers a supplier draft's reviewed JSON on top of a project's ALREADY BOUND category
 * template. Unlike ProjectImImportDialog (which rebinds to the blank template and
 * replaces 100% of the project's content), this never changes the project's template
 * and only imports the delta the reviewer flagged as new/adjust-template — sections
 * marked matches-template are skipped, since the template already covers them. See
 * docs/im-import/schema.md#diffing-against-an-existing-template.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  validateImImport, exportTemplateForReview, importSupplierDraftIntoProject,
} from '../../services';
import type { ImImportDoc, ImSupplierDiffImportResult } from '../../services';
import { IMTemplateType, IM_TEMPLATE_TYPE_LABELS } from '../../types';
import {
  Upload, X, AlertTriangle, CheckCircle2, FileJson, Image as ImageIcon,
  GitBranch, Copy, Check, Loader2,
} from 'lucide-react';

interface Props {
  projectId: string;
  templateId: string;
  templateType: IMTemplateType;
  onClose: () => void;
  onImported: (result: ImSupplierDiffImportResult) => void;
}

type Step = 'export' | 'upload' | 'done';

export const ProjectSupplierDiffImportDialog: React.FC<Props> = ({
  projectId, templateId, templateType, onClose, onImported,
}) => {
  const [step, setStep] = useState<Step>('export');
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<ImImportDoc | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImSupplierDiffImportResult | null>(null);

  const counts = useMemo(() => {
    if (!doc) return null;
    let matches = 0, adjust = 0, fresh = 0;
    for (const s of doc.sections) {
      const status = s.matchStatus ?? 'new';
      if (status === 'matches-template') matches++;
      else if (status === 'adjust-template') adjust++;
      else fresh++;
    }
    const imageNeedCount = doc.sections.reduce((n, s) => n + s.blocks.filter(b => b.type === 'image').length, 0);
    return { matches, adjust, fresh, imageNeedCount };
  }, [doc]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await exportTemplateForReview(templateId);
      setExportJson(JSON.stringify(data, null, 2));
    } catch (e: any) {
      alert(`Could not export the template: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async () => {
    if (!exportJson) return;
    try {
      await navigator.clipboard.writeText(exportJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access denied — the textarea is still selectable/copyable by hand
    }
  };

  const loadText = (text: string) => {
    const res = validateImImport(text);
    setErrors(res.errors);
    setDoc(res.doc ?? null);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { loadText(await f.text()); }
    catch (err) {
      setDoc(null);
      setErrors([`Could not read the file: ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  const canImport = !!doc && !importing;

  const handleImport = async () => {
    if (!doc || !canImport) return;
    setImporting(true);
    try {
      const res = await importSupplierDraftIntoProject(projectId, templateId, doc);
      setResult(res);
      setStep('done');
    } catch (e: any) {
      setImporting(false);
      alert(`Import failed: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <GitBranch size={18} className="text-indigo-600" /> Import supplier draft (diff)
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {step === 'export' && (
          <>
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs text-gray-500">
                Keeps this project's {IM_TEMPLATE_TYPE_LABELS[templateType]} template exactly as
                it is. Step 1: export the template's current content to give the Claude Chat
                review prompt something to compare the supplier draft against.
              </p>
              {!exportJson ? (
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg py-5 text-sm text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors disabled:opacity-60"
                >
                  {exporting ? <Loader2 size={16} className="animate-spin" /> : <FileJson size={16} />}
                  {exporting ? 'Exporting…' : 'Export template for review'}
                </button>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-gray-600">Paste this into the review prompt</span>
                    <button onClick={handleCopy} className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700">
                      {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value={exportJson}
                    rows={8}
                    className="w-full text-[11px] font-mono border border-gray-200 rounded-lg p-2 bg-light text-gray-700"
                    onFocus={e => e.currentTarget.select()}
                  />
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    See <code>docs/im-import/review-prompt.md</code> — paste this as the
                    "EXISTING TEMPLATE EXPORT" input, alongside the supplier draft.
                  </p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => setStep('upload')}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Next: upload reviewed JSON
              </button>
            </div>
          </>
        )}

        {step === 'upload' && (
          <>
            <div className="px-5 py-4 space-y-4">
              <div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg py-6 text-sm text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                >
                  <Upload size={16} /> {doc ? 'Choose a different .import.json file' : 'Choose an .import.json file'}
                </button>
                <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
                <p className="text-[11px] text-gray-400 mt-1.5">
                  The reviewed JSON from Claude Chat, with matchStatus set against the template
                  export from step 1.
                </p>
              </div>

              {errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-red-700 flex items-center gap-1.5 mb-1"><AlertTriangle size={13} /> Cannot import — fix the file:</p>
                  <ul className="list-disc pl-5 text-[11px] text-red-600 space-y-0.5 max-h-40 overflow-y-auto">
                    {errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              {doc && counts && (
                <div className="bg-light border border-gray-100 rounded-lg p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">Product</span><span className="font-semibold text-gray-800">{doc.product.name}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Already in template (skipped)</span><span className="font-medium text-gray-700">{counts.matches}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Needs adjusting (added to template section)</span><span className="font-medium text-gray-700">{counts.adjust}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">New (added as project section)</span><span className="font-medium text-gray-700">{counts.fresh}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500 flex items-center gap-1"><ImageIcon size={11} /> Images to source</span><span className="font-medium text-gray-700">{counts.imageNeedCount}</span></div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setStep('export')} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Back</button>
              <button
                onClick={handleImport}
                disabled={!canImport}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {importing ? 'Importing…' : <><CheckCircle2 size={14} /> Merge into this project</>}
              </button>
            </div>
          </>
        )}

        {step === 'done' && result && (
          <>
            <div className="px-5 py-4 space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-700 flex items-start gap-1.5">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                Merged: {result.newCount} new section(s), {result.adjustedCount} adjusted, {result.matchedCount} already
                covered by the template (skipped). The template itself was not changed.
              </div>

              {(result.reviewNotes?.openQuestions?.length ?? 0) > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-amber-800 mb-1">Open questions — consider before finalizing:</p>
                  <ul className="list-disc pl-5 text-[11px] text-amber-700 space-y-0.5">
                    {result.reviewNotes!.openQuestions!.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}
              {(result.reviewNotes?.corrections?.length ?? 0) > 0 && (
                <div className="bg-light border border-gray-100 rounded-lg p-3">
                  <p className="text-xs font-bold text-gray-700 mb-1">Corrections made to the draft:</p>
                  <ul className="list-disc pl-5 text-[11px] text-gray-600 space-y-0.5">
                    {result.reviewNotes!.corrections!.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
              {(result.excludedStandardized?.length ?? 0) > 0 && (
                <div className="bg-light border border-gray-100 rounded-lg p-3">
                  <p className="text-xs font-bold text-gray-700 mb-1">Standardized content excluded (added by the platform):</p>
                  <ul className="list-disc pl-5 text-[11px] text-gray-600 space-y-0.5">
                    {result.excludedStandardized!.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button
                onClick={() => onImported(result)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ProjectSupplierDiffImportDialog;
