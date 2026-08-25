/**
 * In-app viewer for the Claude Chat review prompt that produces `OriginFlow IM Import v1`
 * JSON (see docs/im-import/). Lets a PM copy a ready-to-paste prompt without leaving the
 * app — the returned JSON drops straight into "Import from JSON" pre-formatted: correct
 * warning callouts, restricted/editable HTML, and standardized boilerplate already excluded.
 */
import React, { useMemo, useState } from 'react';
import { buildImImportPrompt } from '../../services';
import { IMTemplateType, IM_TEMPLATE_TYPE_LABELS } from '../../types';
import { X, Sparkles, ClipboardCopy, Check } from 'lucide-react';

interface Props {
  onClose: () => void;
  defaultKind?: IMTemplateType;
  /** Hide the kind toggle when the target type is fixed by context (e.g. a project route). */
  lockKind?: boolean;
}

export const ImportPromptGuide: React.FC<Props> = ({ onClose, defaultKind = 'im', lockKind = false }) => {
  const [kind, setKind] = useState<IMTemplateType>(defaultKind);
  const [category, setCategory] = useState('');
  const [languages, setLanguages] = useState('');
  const [copied, setCopied] = useState(false);

  const prompt = useMemo(
    () => buildImImportPrompt(kind, { category, languages }),
    [kind, category, languages],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable in this context — the text is still selectable below
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <Sparkles size={18} className="text-indigo-600" /> AI import prompt
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <p className="text-xs text-gray-500">
            Paste this into a Claude Chat conversation along with the supplier's draft (PDF, text,
            or figures). It returns a single <code className="text-[11px]">OriginFlow IM Import v1</code> JSON
            file — save that and drop it straight into <strong>Import from JSON</strong>, already
            formatted with the right warning callouts, editable text structure, and standardized
            boilerplate excluded. No reformatting needed after import.
          </p>

          {!lockKind && (
            <div className="flex items-center gap-2">
              {(['im', 'warning_leaflet'] as IMTemplateType[]).map(k => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                    kind === k
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  {IM_TEMPLATE_TYPE_LABELS[k]}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Category (optional)</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="e.g. Coffee Machines"
                value={category}
                onChange={e => setCategory(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Target languages (optional)</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="e.g. en, de"
                value={languages}
                onChange={e => setLanguages(e.target.value)}
              />
            </div>
          </div>

          <pre className="text-[10.5px] leading-relaxed bg-gray-900 text-gray-100 rounded-lg p-3 whitespace-pre-wrap max-h-[45vh] overflow-y-auto">
            {prompt}
          </pre>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Close</button>
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {copied ? <><Check size={14} /> Copied!</> : <><ClipboardCopy size={14} /> Copy prompt</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportPromptGuide;
