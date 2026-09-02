/**
 * Importing a researched regulation.
 *
 * Two stages, and the split is the point: VALIDATE and PREVIEW before anything is written.
 * The document comes out of an AI research pass, so the operator is the last line of defence
 * against a confident, well-formed, wrong clause number — and they can only be that if they
 * are shown what the import would change BEFORE it changes it.
 *
 * Expiry gets its own confirmation. `status: "expired"` blocks every manual and new TCF
 * request citing the regulation (migration 140); a paste must not be able to do that without
 * somebody reading the sentence and ticking the box.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Ban, CheckCircle2, FileJson, Loader2, Sparkles, Upload, X,
} from 'lucide-react';

import {
  applyRegulationImport,
  planRegulationImport,
  validateRegulationImport,
} from '../../services';
import type {
  RegulationImportDoc,
  RegulationImportPlan,
  RegulationImportResult,
} from '../../services/regulatory/regulation-import.service';
import type { CategoryL3, Regulation } from '../../types';
import { RESEARCH_PROMPT } from './research-prompt';

interface Props {
  library: Regulation[];
  categories: CategoryL3[];
  actor?: string;
  onClose: () => void;
  onImported: (result: RegulationImportResult) => void;
}

const Pill: React.FC<{ tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
    tone === 'ok' ? 'bg-emerald-100 text-emerald-700'
      : tone === 'warn' ? 'bg-amber-100 text-amber-800'
        : 'bg-rose-100 text-rose-700'
  }`}>{children}</span>
);

const RegulationImportDialog: React.FC<Props> = ({
  library, categories, actor, onClose, onImported,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [doc, setDoc] = useState<RegulationImportDoc | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);

  const [allowExpiry, setAllowExpiry] = useState(false);
  const [tcfCategoryId, setTcfCategoryId] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<RegulationImportResult | null>(null);

  const plan: RegulationImportPlan | null = useMemo(
    () => (doc ? planRegulationImport(doc, library, categories) : null),
    [doc, library, categories],
  );

  const validate = (raw: string) => {
    setResult(null);
    const v = validateRegulationImport(raw);
    setErrors(v.errors);
    setWarnings(v.warnings);
    setDoc(v.doc ?? null);
    // A fresh document must not inherit the previous one's expiry confirmation.
    setAllowExpiry(false);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    validate(content);
  };

  const handleImport = async () => {
    if (!doc || !plan) return;
    setImporting(true);
    try {
      const outcome = await applyRegulationImport(doc, plan, {
        allowExpiry,
        tcfCategoryId: tcfCategoryId || null,
        actor,
      });
      setResult(outcome);
      onImported(outcome);
    } catch (e) {
      setErrors([`Import failed: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setImporting(false);
    }
  };

  const copyPrompt = () => { void navigator.clipboard?.writeText(RESEARCH_PROMPT); };

  const blockedByExpiry = plan?.wouldExpire && !allowExpiry;

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => !importing && onClose()}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <FileJson size={16} /> Import a researched regulation
          </h3>
          <button onClick={() => !importing && onClose()} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm overflow-y-auto">
          {result ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold">
                    {result.action === 'create' ? 'Regulation created.' : 'Regulation updated.'}
                  </p>
                  <p className="mt-0.5">
                    {result.clausesCreated} clause(s) added, {result.clausesUpdated} updated,{' '}
                    {result.obligationsCreated} obligation(s) added
                    {result.tcfRequirementsCreated > 0
                      ? `, ${result.tcfRequirementsCreated} TCF requirement(s) created`
                      : ''}.
                  </p>
                </div>
              </div>
              {result.problems.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-900 mb-1">
                    {result.problems.length} thing(s) did not go in:
                  </p>
                  <ul className="space-y-0.5">
                    {result.problems.map((p, i) => (
                      <li key={i} className="text-[11px] text-amber-800">• {p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* --- The prompt that produces the document -------------------- */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs text-indigo-900">
                    <Sparkles size={13} className="inline mr-1" />
                    Paste the research prompt into an AI with web search, attach whatever you have
                    on the standard, and it returns the JSON below plus a Markdown dossier.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={copyPrompt} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      Copy prompt
                    </button>
                    <button onClick={() => setShowPrompt(v => !v)} className="text-xs text-indigo-500 hover:text-indigo-700">
                      {showPrompt ? 'Hide' : 'View'}
                    </button>
                  </div>
                </div>
                {showPrompt && (
                  <pre className="mt-2 max-h-56 overflow-auto text-[10px] leading-relaxed bg-white border rounded p-2 whitespace-pre-wrap">
                    {RESEARCH_PROMPT}
                  </pre>
                )}
              </div>

              {/* --- Input --------------------------------------------------- */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-500 uppercase">Import JSON</label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 cursor-pointer">
                    <Upload size={12} /> Choose .json
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
                    />
                  </label>
                </div>
                <textarea
                  value={text}
                  onChange={e => { setText(e.target.value); }}
                  onBlur={() => text.trim() && validate(text)}
                  rows={6}
                  placeholder='{ "importSchemaVersion": 1, "regulation": { … } }'
                  className="w-full text-[11px] font-mono border rounded px-2 py-1.5"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Validated when you click away. Nothing is written until you press Import.
                </p>
              </div>

              {errors.length > 0 && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                  <p className="text-xs font-semibold text-rose-900 mb-1">
                    {errors.length} problem(s) — nothing can be imported until these are fixed:
                  </p>
                  <ul className="space-y-0.5">
                    {errors.map((e, i) => <li key={i} className="text-[11px] text-rose-800">• {e}</li>)}
                  </ul>
                  <p className="text-[11px] text-rose-700 mt-1.5">
                    Paste this list back to the researcher — the messages name the exact field.
                  </p>
                </div>
              )}

              {warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-900 mb-1">Worth reading first:</p>
                  <ul className="space-y-0.5">
                    {warnings.map((w, i) => <li key={i} className="text-[11px] text-amber-800">• {w}</li>)}
                  </ul>
                </div>
              )}

              {/* --- The preview -------------------------------------------- */}
              {doc && plan && (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="px-3 py-2 bg-light flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-primary">
                      {doc.regulation.referenceCode}
                    </span>
                    <Pill tone={plan.action === 'create' ? 'ok' : 'warn'}>
                      {plan.action === 'create' ? 'NEW' : 'UPDATES AN EXISTING ROW'}
                    </Pill>
                    <span className="text-[11px] text-gray-500 truncate">{doc.regulation.title}</span>
                  </div>
                  <div className="p-3 space-y-2 text-[11px] text-gray-700">
                    <p>
                      <strong>{plan.newClauses.length}</strong> new clause(s)
                      {plan.updatedClauses.length > 0 && <>, <strong>{plan.updatedClauses.length}</strong> updated</>}
                      {' · '}
                      <strong>{plan.newObligations}</strong> new obligation(s)
                      {plan.existingObligations > 0 && <> (<strong>{plan.existingObligations}</strong> already present, left alone)</>}
                    </p>

                    {plan.fieldChanges.length > 0 && (
                      <div>
                        <p className="font-semibold text-gray-600 mb-1">
                          {plan.fieldChanges.length} field(s) would change:
                        </p>
                        <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                          {plan.fieldChanges.map(c => (
                            <li key={c.field} className="text-gray-600">
                              <span className="font-mono font-semibold">{c.field}</span>{': '}
                              <span className="text-rose-600 line-through">{c.from || '(empty)'}</span>{' → '}
                              <span className="text-emerald-700">{c.to}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="text-gray-400 mt-1">
                          Nothing is ever deleted by an import — obligations not mentioned here stay.
                        </p>
                      </div>
                    )}

                    {plan.unmatchedCategories.length > 0 && (
                      <p className="text-amber-700">
                        No category matches {plan.unmatchedCategories.map(c => `"${c}"`).join(', ')} — those
                        will be skipped. Tick them by hand in the editor if they should apply.
                      </p>
                    )}

                    {doc.research?.sources && doc.research.sources.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-gray-500">
                          {doc.research.sources.length} source(s) cited
                        </summary>
                        <ul className="mt-1 space-y-0.5">
                          {doc.research.sources.map((s, i) => (
                            <li key={i} className="truncate">
                              {s.url
                                ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{s.title || s.url}</a>
                                : (s.title ?? '(untitled)')}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>

                  {/* Expiry needs its own consent — it stops work. */}
                  {plan.wouldExpire && (
                    <div className="px-3 py-2 border-t border-rose-200 bg-rose-50">
                      <label className="flex items-start gap-2 text-[11px] text-rose-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowExpiry}
                          onChange={e => setAllowExpiry(e.target.checked)}
                          className="mt-0.5 shrink-0"
                        />
                        <span>
                          <Ban size={11} className="inline mr-1" />
                          This document marks the regulation <strong>expired</strong>. Applying that
                          will <strong>block every manual and new TCF request</strong> citing it until
                          a replacement is recorded. Tick to allow it; leave unticked to import
                          everything else and set the status by hand later.
                        </span>
                      </label>
                    </div>
                  )}

                  {/* TCF requirements are per category, so they need one chosen. */}
                  {doc.tcfRequirements && doc.tcfRequirements.length > 0 && (
                    <div className="px-3 py-2 border-t border-gray-200 bg-sky-50/50">
                      <label className="text-[11px] font-semibold text-sky-900">
                        Create {doc.tcfRequirements.length} TCF requirement(s) for:
                      </label>
                      <select
                        value={tcfCategoryId}
                        onChange={e => setTcfCategoryId(e.target.value)}
                        className="w-full text-xs border rounded px-2 py-1.5 mt-1 bg-white"
                      >
                        <option value="">— Do not create them —</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <p className="text-[11px] text-gray-500 mt-1">
                        A TCF requirement belongs to one category, so it cannot be imported without
                        picking one. A requirement whose title already exists there is skipped.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} disabled={importing} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={!doc || importing || !!blockedByExpiry}
              title={blockedByExpiry ? 'Confirm the expiry above, or remove it from the document' : undefined}
              className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {importing
                ? <><Loader2 size={14} className="animate-spin" /> Importing…</>
                : <>Import{plan?.action === 'update' ? ' & update' : ''}</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default RegulationImportDialog;
