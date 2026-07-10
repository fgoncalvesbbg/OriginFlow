/**
 * IM Import dialog
 *
 * Imports an `OriginFlow IM Import v1` JSON (produced by the Claude Chat review
 * prompt — see docs/im-import/) into a new category template. The created
 * template feeds the normal project IM generation flow unchanged.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  validateImImport, importIMTemplate, getIMTemplateByCategoryId,
} from '../../services';
import type { ImImportDoc, ImImportResult } from '../../services';
import { CategoryL3, IM_TEMPLATE_TYPE_LABELS } from '../../types';
import { Upload, X, AlertTriangle, CheckCircle2, FileJson, Image as ImageIcon } from 'lucide-react';

interface Props {
  categories: CategoryL3[];
  onClose: () => void;
  onImported: (result: ImImportResult) => void;
}

/** Best-effort match of the doc's category label to an existing category row. */
const guessCategory = (label: string, categories: CategoryL3[]): string => {
  const l = label.trim().toLowerCase();
  if (!l) return categories[0]?.id ?? '';
  const exact = categories.find(c => c.name.trim().toLowerCase() === l);
  if (exact) return exact.id;
  const partial = categories.find(c => {
    const n = c.name.trim().toLowerCase();
    return !!n && (n.includes(l) || l.includes(n));
  });
  return partial?.id ?? categories[0]?.id ?? '';
};

export const ImImportDialog: React.FC<Props> = ({ categories, onClose, onImported }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<ImImportDoc | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [existingWarning, setExistingWarning] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  // Monotonic token so a slow existence-check for a previously selected category
  // can't clobber the result for the currently selected one.
  const checkToken = useRef(0);

  const imageNeedCount = useMemo(
    () => doc?.sections.reduce((n, s) => n + s.blocks.filter(b => b.type === 'image').length, 0) ?? 0,
    [doc],
  );
  const modelSpecificCount = useMemo(
    () => doc?.sections.reduce(
      (n, s) => n + (s.scope === 'model-specific' ? 1 : 0) + s.blocks.filter(b => b.scope === 'model-specific').length,
      0,
    ) ?? 0,
    [doc],
  );

  const checkExisting = async (catId: string, kind: ImImportDoc['kind']) => {
    const token = ++checkToken.current;
    setExistingWarning(null);
    if (!catId) { setChecking(false); return; }
    setChecking(true);
    const existing = await getIMTemplateByCategoryId(catId, kind).catch(() => undefined);
    if (token !== checkToken.current) return; // a newer check superseded this one
    if (existing) {
      const cat = categories.find(c => c.id === catId);
      setExistingWarning(
        `${cat?.name ?? 'This category'} already has a ${IM_TEMPLATE_TYPE_LABELS[kind]} template. ` +
        `Delete it first, or import into a different category.`,
      );
    }
    setChecking(false);
  };

  const loadText = async (text: string) => {
    const res = validateImImport(text);
    setErrors(res.errors);
    setWarnings(res.warnings);
    if (res.doc) {
      setDoc(res.doc);
      const catId = guessCategory(res.doc.category, categories);
      setCategoryId(catId);
      setTemplateName(`${res.doc.category} ${res.doc.kind === 'im' ? 'Manual Template' : 'Warning Leaflet'}`);
      await checkExisting(catId, res.doc.kind);
    } else {
      setDoc(null);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await loadText(await f.text());
    } catch (err) {
      setDoc(null);
      setWarnings([]);
      setErrors([`Could not read the file: ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  const handleCategoryChange = async (catId: string) => {
    setCategoryId(catId);
    if (doc) await checkExisting(catId, doc.kind);
  };

  const canImport = !!doc && !!categoryId && !!templateName.trim() && !existingWarning && !checking && !importing;

  const handleImport = async () => {
    if (!doc || !canImport) return;
    setImporting(true);
    try {
      const result = await importIMTemplate(doc, categoryId, templateName.trim());
      onImported(result);
    } catch (e: any) {
      setImporting(false);
      alert(`Import failed: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <FileJson size={18} className="text-indigo-600" /> Import IM from JSON
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* File picker */}
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg py-6 text-sm text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              <Upload size={16} /> {doc ? 'Choose a different .import.json file' : 'Choose an .import.json file'}
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
            <p className="text-[11px] text-gray-400 mt-1.5">
              Produced by the Claude Chat review prompt (see docs/im-import/). Standardized content
              (company info, WEEE, conformity) is added by the platform and should not be in the file.
            </p>
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-bold text-red-700 flex items-center gap-1.5 mb-1">
                <AlertTriangle size={13} /> Cannot import — fix the file:
              </p>
              <ul className="list-disc pl-5 text-[11px] text-red-600 space-y-0.5 max-h-40 overflow-y-auto">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {/* Summary + target */}
          {doc && (
            <>
              <div className="bg-light border border-gray-100 rounded-lg p-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Product</span><span className="font-semibold text-gray-800">{doc.product.name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="font-medium text-gray-700">{IM_TEMPLATE_TYPE_LABELS[doc.kind]}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Languages</span><span className="font-medium text-gray-700">{doc.languages.join(', ')}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Sections</span><span className="font-medium text-gray-700">{doc.sections.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 flex items-center gap-1"><ImageIcon size={11} /> Images to source</span><span className="font-medium text-gray-700">{imageNeedCount}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Model-specific (placeholders)</span><span className="font-medium text-gray-700">{modelSpecificCount}</span></div>
              </div>
              <p className="text-[11px] text-gray-400 -mt-1">
                Generic content becomes standard, reusable template content for this category;
                model-specific parts are flagged as placeholders to re-author per project.
              </p>

              {(doc.reviewNotes?.openQuestions?.length ?? 0) > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-[11px] font-bold text-amber-700 mb-1">Open questions from the reviewer:</p>
                  <ul className="list-disc pl-5 text-[11px] text-amber-700 space-y-0.5">
                    {doc.reviewNotes!.openQuestions!.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </div>
              )}

              {/* Target category */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Target category</label>
                <select
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={categoryId}
                  onChange={e => handleCategoryChange(e.target.value)}
                >
                  {categories.length === 0 && <option value="">No categories defined</option>}
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Template name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Template name</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                />
              </div>

              {existingWarning && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-[11px] text-orange-700 flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {existingWarning}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleImport}
            disabled={!canImport}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {importing ? 'Importing…' : <><CheckCircle2 size={14} /> Create template</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImImportDialog;
