/**
 * Project IM Import dialog
 *
 * Imports an `OriginFlow IM Import v1` JSON directly into THIS project as a 100%
 * project-based IM: it binds to the shared blank template and stores all content in
 * the project's overlay (extraSections). No category template is created. Overwrites
 * any existing IM for this project + template type.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  validateImImport, importProjectIMFromDoc, getProjectIM,
} from '../../services';
import type { ImImportDoc, ImProjectImportResult } from '../../services';
import { IMTemplateType, IM_TEMPLATE_TYPE_LABELS } from '../../types';
import { Upload, X, AlertTriangle, CheckCircle2, FileJson, Image as ImageIcon } from 'lucide-react';

interface Props {
  projectId: string;
  templateType: IMTemplateType;
  onClose: () => void;
  onImported: (result: ImProjectImportResult) => void;
}

export const ProjectImImportDialog: React.FC<Props> = ({ projectId, templateType, onClose, onImported }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<ImImportDoc | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [hasExisting, setHasExisting] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let active = true;
    getProjectIM(projectId, templateType).then(im => { if (active) setHasExisting(!!im); }).catch(() => {});
    return () => { active = false; };
  }, [projectId, templateType]);

  const imageNeedCount = useMemo(
    () => doc?.sections.reduce((n, s) => n + s.blocks.filter(b => b.type === 'image').length, 0) ?? 0,
    [doc],
  );

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
      const result = await importProjectIMFromDoc(projectId, doc, templateType);
      onImported(result);
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
            <FileJson size={18} className="text-indigo-600" /> Import {IM_TEMPLATE_TYPE_LABELS[templateType]} from JSON
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

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
              Creates a project-only manual — no category template. All content is editable here
              afterwards. Section headings use the source language only (block text is translatable).
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

          {doc && (
            <>
              <div className="bg-light border border-gray-100 rounded-lg p-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Product</span><span className="font-semibold text-gray-800">{doc.product.name}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Languages</span><span className="font-medium text-gray-700">{doc.languages.join(', ')}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Sections</span><span className="font-medium text-gray-700">{doc.sections.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 flex items-center gap-1"><ImageIcon size={11} /> Images to source</span><span className="font-medium text-gray-700">{imageNeedCount}</span></div>
              </div>

              {hasExisting && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-[11px] text-orange-700 flex items-start gap-1.5">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  This project already has a {IM_TEMPLATE_TYPE_LABELS[templateType]}. Importing will replace it. This cannot be undone.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={handleImport}
            disabled={!canImport}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {importing ? 'Importing…' : <><CheckCircle2 size={14} /> {hasExisting ? 'Replace with import' : 'Create from import'}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectImImportDialog;
