/**
 * The regulation editor — one modal for the whole brain.
 *
 * This is where the two libraries actually merged (migration 139). Before it, an operator
 * described "EMC Directive 2014/30/EU" twice: once in the IM's regulation library (summary,
 * checklist, categories) and once as a TCF requirement (what the supplier must send), with
 * neither aware of the other. The four content fields below are deliberately labelled by
 * WHO CONSUMES THEM, because that is the only thing that distinguishes them and getting it
 * wrong is silent:
 *
 *   Summary          -> a PERSON scanning the library.
 *   TCF description  -> the TECHNICAL FILE. What evidence a supplier owes.
 *   IM requirements  -> the pre-publish CHECKLIST. What a person verifies in the manual.
 *   Notes            -> the AI CHECK's prompt. Scope narrowing, fed to the model.
 *   Markdown summary -> the AI CHECK's evidence. The only text the model is given.
 *
 * Split into its own file rather than living inside the library page: it is ~500 lines of
 * form on its own, and the detail page opens the same editor, so a shared component is the
 * only way both surfaces stay in step.
 */

import React, { useState } from 'react';
import {
  AlertTriangle, Ban, CheckSquare, ChevronDown, ChevronUp, ExternalLink, FileText, Link2, Loader2,
  Scale, ShieldCheck, Upload, Trash2, X,
} from 'lucide-react';

import {
  MAX_SUMMARY_BYTES,
  SUMMARY_WARN_BYTES,
  deriveCelex,
  eurLexUrl,
  isValidCelex,
  parseRegulationChecklist,
  parseRegulationNotes,
  summaryByteLength,
} from '../../services';
import type { CategoryL3, Regulation, RegulationInput, RegulationStatus } from '../../types';

export interface RegulationDraft extends RegulationInput {
  id?: string;
}

export const emptyRegulationDraft = (): RegulationDraft => ({
  title: '',
  referenceCode: '',
  jurisdiction: '',
  summary: '',
  tcfDescription: '',
  notes: '',
  checklist: '',
  version: '',
  applicableCategories: [],
  status: 'active',
});

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} kB`;

const LABEL = 'text-xs font-semibold text-gray-500 uppercase';
const INPUT = 'w-full text-sm border rounded px-2 py-1.5 mt-1';
const HINT = 'text-[11px] text-gray-400 mt-1';

interface Props {
  draft: RegulationDraft;
  categories: CategoryL3[];
  /**
   * The rest of the library, for the replacement picker. Required whenever a regulation can
   * be expired: without it there is no way to record the successor, which is the ONLY thing
   * that lifts the block.
   */
  library?: Regulation[];
  saving: boolean;
  error: string;
  onChange: (d: RegulationDraft) => void;
  onSave: () => void;
  onClose: () => void;
}

const RegulationEditor: React.FC<Props> = ({
  draft, categories, library = [], saving, error, onChange, onSave, onClose,
}) => {
  const [showPreview, setShowPreview] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const noteLines = parseRegulationNotes(draft.notes);
  const checklistLines = parseRegulationChecklist(draft.checklist);
  const summaryBytes = draft.summaryMd ? summaryByteLength(draft.summaryMd) : 0;
  const tooBig = summaryBytes > MAX_SUMMARY_BYTES;
  const large = summaryBytes > SUMMARY_WARN_BYTES && !tooBig;

  // Offered, never applied on its own — a wrong CELEX would make the version check report
  // confidently about the wrong law, so an operator has to accept it.
  const suggestedCelex = deriveCelex(draft.referenceCode)?.celex ?? null;
  const celexClean = (draft.celexId ?? '').trim();
  const celexInvalid = celexClean !== '' && !isValidCelex(celexClean);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    try {
      const text = await file.text();
      if (!text.trim()) { setUploadError('That file is empty.'); return; }
      const bytes = summaryByteLength(text);
      if (bytes > MAX_SUMMARY_BYTES) {
        setUploadError(
          `That summary is ${kb(bytes)}; the limit is ${kb(MAX_SUMMARY_BYTES)}. Trim it to ` +
          `the clauses that actually govern the manual.`,
        );
        return;
      }
      onChange({ ...draft, summaryMd: text, summaryFileName: file.name });
    } catch {
      setUploadError('That file could not be read.');
    }
  };

  const toggleCategory = (id: string) => {
    const current = draft.applicableCategories ?? [];
    onChange({
      ...draft,
      applicableCategories: current.includes(id)
        ? current.filter(c => c !== id)
        : [...current, id],
    });
  };

  // Candidates for "replaced by": anything but this row. A superseded successor is allowed
  // — retiring it from the picker says nothing about whether it is still the law — but an
  // expired one is flagged, because chaining onto another dead regulation does not unblock.
  const replacementOptions = library
    .filter(r => r.id !== draft.id)
    .sort((a, b) => a.referenceCode.localeCompare(b.referenceCode));
  const replacement = draft.supersededById
    ? library.find(r => r.id === draft.supersededById) ?? null
    : null;
  const expiredNoReplacement = draft.status === 'expired' && !replacement;
  const expiredDeadReplacement = draft.status === 'expired' && replacement?.status === 'expired';

  const canSave =
    draft.title.trim() !== '' && draft.referenceCode.trim() !== '' && !tooBig && !celexInvalid && !saving;

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Scale size={16} /> {draft.id ? 'Edit regulation' : 'Add regulation'}
          </h3>
          <button onClick={() => !saving && onClose()} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-5 text-sm overflow-y-auto">
          {/* --- Identity ------------------------------------------------- */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className={LABEL}>Reference code *</label>
              <input
                value={draft.referenceCode}
                onChange={e => onChange({ ...draft, referenceCode: e.target.value })}
                placeholder="Directive 2014/35/EU"
                className={`${INPUT} font-mono`}
              />
              <p className={HINT}>Exactly as it is cited in a manual. Must be unique.</p>
            </div>
            <div>
              <label className={LABEL}>Jurisdiction</label>
              <input
                value={draft.jurisdiction ?? ''}
                onChange={e => onChange({ ...draft, jurisdiction: e.target.value })}
                placeholder="EU"
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label className={LABEL}>Title *</label>
            <input
              value={draft.title}
              onChange={e => onChange({ ...draft, title: e.target.value })}
              placeholder="Harmonisation of the laws of the Member States relating to electrical equipment…"
              className={INPUT}
            />
          </div>

          {/* --- Version identity (migration 139) -------------------------- */}
          <div className="border rounded-lg p-3 bg-light/50 space-y-3">
            <span className="text-xs font-semibold text-gray-600 uppercase flex items-center gap-1.5">
              <Link2 size={13} /> Version &amp; source
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL}>Version</label>
                <input
                  value={draft.version ?? ''}
                  onChange={e => onChange({ ...draft, version: e.target.value })}
                  placeholder="Ed. 6.1 / A11:2020"
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>Edition year</label>
                <input
                  type="number"
                  value={draft.editionYear ?? ''}
                  onChange={e => onChange({
                    ...draft,
                    editionYear: e.target.value === '' ? null : Number(e.target.value),
                  })}
                  placeholder="2021"
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>Issued</label>
                <input
                  type="date"
                  value={draft.issuedAt ?? ''}
                  onChange={e => onChange({ ...draft, issuedAt: e.target.value })}
                  className={INPUT}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Last change</label>
                <input
                  type="date"
                  value={draft.lastAmendedAt ?? ''}
                  onChange={e => onChange({ ...draft, lastAmendedAt: e.target.value })}
                  className={INPUT}
                />
                <p className={HINT}>
                  The most recent amendment you have accounted for. The version check compares
                  against this date, so leaving it empty makes any consolidation count as new.
                </p>
              </div>
              <div>
                <label className={LABEL}>Re-verify by</label>
                <input
                  type="date"
                  value={draft.reviewDueAt ?? ''}
                  onChange={e => onChange({ ...draft, reviewDueAt: e.target.value })}
                  className={INPUT}
                />
                <p className={HINT}>
                  For EN/IEC/ISO standards this is the <strong>only</strong> version signal —
                  they have no free catalogue API, so a person has to look.
                </p>
              </div>
            </div>

            <div>
              <label className={LABEL}>Source link</label>
              <input
                value={draft.sourceUrl ?? ''}
                onChange={e => onChange({ ...draft, sourceUrl: e.target.value })}
                placeholder="https://eur-lex.europa.eu/…"
                className={INPUT}
              />
            </div>

            <div>
              <label className={LABEL}>CELEX number</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  value={draft.celexId ?? ''}
                  onChange={e => onChange({ ...draft, celexId: e.target.value.toUpperCase() })}
                  placeholder="32014L0035"
                  className="flex-1 text-sm border rounded px-2 py-1.5 font-mono"
                />
                {suggestedCelex && celexClean !== suggestedCelex && (
                  <button
                    type="button"
                    onClick={() => onChange({
                      ...draft,
                      celexId: suggestedCelex,
                      sourceUrl: draft.sourceUrl?.trim() ? draft.sourceUrl : eurLexUrl(suggestedCelex),
                    })}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 shrink-0"
                  >
                    Use {suggestedCelex}
                  </button>
                )}
                {celexClean && isValidCelex(celexClean) && (
                  <a
                    href={eurLexUrl(celexClean)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-indigo-600 shrink-0"
                    title="Open on EUR-Lex"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
              {celexInvalid ? (
                <p className="text-[11px] text-rose-600 mt-1">
                  That is not a CELEX number. It looks like 32014L0035 — sector digit, year,
                  act letter, number.
                </p>
              ) : (
                <p className={HINT}>
                  Only EU legal acts have one, and it is what makes the automatic
                  &ldquo;is there a newer version?&rdquo; check possible. Leave it empty for
                  EN, IEC and ISO standards — those are tracked by the link and review date above.
                </p>
              )}
            </div>
          </div>

          {/* --- Summary (for people) -------------------------------------- */}
          <div>
            <label className={LABEL}>Summary</label>
            <textarea
              value={draft.summary ?? ''}
              onChange={e => onChange({ ...draft, summary: e.target.value })}
              rows={3}
              placeholder="What this regulation is for, in a few sentences."
              className={INPUT}
            />
            <p className={HINT}>
              For a person scanning the library. Not sent to the AI check — that reads the
              Markdown summary further down.
            </p>
          </div>

          {/* --- TCF description ------------------------------------------- */}
          <div className="border border-sky-200 rounded-lg p-3 bg-sky-50/40">
            <label className="text-xs font-semibold text-sky-800 uppercase flex items-center gap-1.5">
              <ShieldCheck size={13} /> TCF description
            </label>
            <textarea
              value={draft.tcfDescription ?? ''}
              onChange={e => onChange({ ...draft, tcfDescription: e.target.value })}
              rows={3}
              placeholder="LVD test report and certificate for the main unit, and for an external adaptor if one is included."
              className={INPUT}
            />
            <p className={HINT}>
              What this regulation obliges on the <strong>technical file</strong> — the evidence
              a supplier has to provide. Shown on the internal TCF, and used to fill in a new
              requirement&apos;s description when one is created from this regulation.
            </p>
            <p className={HINT}>
              Editing it never rewrites a request a supplier is already answering: the portal
              renders the requirement&apos;s own description, not this text.
            </p>
          </div>

          {/* --- IM requirements (the checklist) ---------------------------- */}
          <div className="border border-emerald-200 rounded-lg p-3 bg-emerald-50/40">
            <label className="text-xs font-semibold text-emerald-800 uppercase flex items-center gap-1.5">
              <CheckSquare size={13} /> IM requirements
            </label>
            <textarea
              value={draft.checklist ?? ''}
              onChange={e => onChange({ ...draft, checklist: e.target.value })}
              rows={4}
              placeholder={'What the manual must contain, one per line.\n'
                + 'Energy label is enclosed with the appliance\n'
                + 'WEEE crossed-out bin symbol is on the rating plate\n'
                + 'Declaration of conformity is included in the box'}
              className={INPUT}
            />
            <p className={HINT}>
              One item per line. Every regulation applying to a template contributes its items
              to <strong>one combined checklist</strong> shown before a manual is published,
              where each can be ticked or marked not applicable. Ticking never blocks a publish.
            </p>
            <p className={HINT}>
              These are <strong>not</strong> sent to the AI check — it reads the template text,
              so it can never see the rating plate or what is in the box.
            </p>
            {checklistLines.length > 0 && (
              <ul className="mt-2 space-y-0.5 bg-white border rounded p-2">
                {checklistLines.map((line, i) => (
                  <li key={i} className="text-[11px] text-gray-600 flex gap-1.5">
                    <CheckSquare size={11} className="text-gray-400 shrink-0 mt-0.5" />
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* --- Notes (for the model) ------------------------------------- */}
          <div>
            <label className={LABEL}>Scope notes for the AI check</label>
            <textarea
              value={draft.notes ?? ''}
              onChange={e => onChange({ ...draft, notes: e.target.value })}
              rows={3}
              placeholder={'Applies to built-in models only\nAnnex IV is out of scope for this family'}
              className={INPUT}
            />
            <p className={HINT}>
              One per line. These <strong>are</strong> interpolated into the check&apos;s prompt —
              use them to narrow scope, not to describe the regulation.
            </p>
            {noteLines.length > 1 && (
              <ul className="mt-2 space-y-0.5 bg-light border rounded p-2">
                {noteLines.map((line, i) => (
                  <li key={i} className="text-[11px] text-gray-600 flex gap-1.5">
                    <span className="text-gray-400 shrink-0">&bull;</span>
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* --- Markdown summary (the model's evidence) -------------------- */}
          <div className="border rounded-lg p-3 bg-light/50">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-600 uppercase flex items-center gap-1.5">
                <FileText size={13} /> Markdown summary
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 cursor-pointer">
                <Upload size={12} /> {draft.summaryMd ? 'Replace .md' : 'Upload .md'}
                <input
                  type="file"
                  accept="text/markdown,text/plain,.md,.markdown"
                  className="hidden"
                  onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>
            </div>

            <p className="text-[11px] text-gray-500 mt-2">
              This is the <strong>only</strong> thing the AI check is told about the regulation,
              so its quality is the ceiling on the quality of the check.
            </p>

            {draft.summaryMd ? (
              <div className="mt-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-600 truncate">
                    {draft.summaryFileName || 'summary.md'} · {kb(summaryBytes)}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setShowPreview(v => !v)}
                      className="text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
                    >
                      {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Preview
                    </button>
                    <button
                      onClick={() => onChange({ ...draft, summaryMd: null, summaryFileName: null })}
                      className="text-gray-400 hover:text-rose-600"
                      title="Remove the summary"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                {tooBig && (
                  <p className="text-[11px] text-rose-600 mt-1.5">
                    Too large to save ({kb(summaryBytes)} of {kb(MAX_SUMMARY_BYTES)}).
                  </p>
                )}
                {large && (
                  <p className="text-[11px] text-amber-600 mt-1.5">
                    This is large — every check call sends the whole summary, so runs will be
                    slower and dearer.
                  </p>
                )}
                {showPreview && (
                  // Raw source on purpose: it is Markdown, there is no Markdown renderer in
                  // the dependency list, and showing the source is honest and safe.
                  <pre className="mt-2 max-h-56 overflow-auto text-[11px] leading-relaxed bg-white border rounded p-2 whitespace-pre-wrap">
                    {draft.summaryMd}
                  </pre>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-amber-600 mt-2 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                No summary yet — a regulatory check against this regulation will be refused.
              </p>
            )}

            {uploadError && <p className="text-[11px] text-rose-600 mt-1.5">{uploadError}</p>}
          </div>

          {/* --- Status + categories --------------------------------------- */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Status</label>
              <select
                value={draft.status ?? 'active'}
                onChange={e => {
                  const status = e.target.value as RegulationStatus;
                  onChange({
                    ...draft,
                    status,
                    // Stamp today the first time it is expired, so the block message can say
                    // when this became true. Never cleared on the way back out — an expiry
                    // date that was right yesterday is still a fact about yesterday.
                    expiredAt: status === 'expired' && !draft.expiredAt
                      ? new Date().toISOString().slice(0, 10)
                      : draft.expiredAt,
                  });
                }}
                className={`${INPUT} bg-white`}
              >
                <option value="active">Active</option>
                <option value="superseded">Superseded — retire it quietly</option>
                <option value="expired">Expired — stop work using it</option>
              </select>
              <p className={HINT}>
                <strong>Superseded</strong> hides it from the assignment picker without
                stopping anything; existing assignments, TCF links and past reports stay
                intact. <strong>Expired</strong> is a hard stop: no manual citing it can be
                published and no new TCF request can be created, until a replacement still in
                force is recorded below.
              </p>
            </div>
            <div>
              <label className={LABEL}>Applies to categories</label>
              <div className="mt-1 max-h-28 overflow-y-auto border rounded p-2 space-y-1 bg-white">
                {categories.length === 0 && (
                  <p className="text-[11px] text-gray-400">No categories defined.</p>
                )}
                {categories.map(c => (
                  <label key={c.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={(draft.applicableCategories ?? []).includes(c.id)}
                      onChange={() => toggleCategory(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-indigo-600 mt-1">
                Ticking a category makes this regulation apply to that category&apos;s manual and
                warning-leaflet templates automatically — a regulatory check there will include it.
              </p>
            </div>
          </div>

          {/* --- Expiry (migration 140) ------------------------------------
              Only shown once a status implies a successor. Recording the replacement is the
              single edit that unblocks every manual and request citing this regulation, so
              it sits directly under the status that caused the block. */}
          {(draft.status === 'expired' || draft.status === 'superseded') && (
            <div className={`border rounded-lg p-3 space-y-3 ${
              draft.status === 'expired' ? 'border-rose-200 bg-rose-50/40' : 'border-gray-200 bg-light/50'
            }`}>
              <span className={`text-xs font-semibold uppercase flex items-center gap-1.5 ${
                draft.status === 'expired' ? 'text-rose-800' : 'text-gray-600'
              }`}>
                <Ban size={13} /> {draft.status === 'expired' ? 'Expiry' : 'Retirement'}
              </span>

              <div>
                <label className={LABEL}>Replaced by</label>
                <select
                  value={draft.supersededById ?? ''}
                  onChange={e => onChange({ ...draft, supersededById: e.target.value || null })}
                  className={`${INPUT} bg-white`}
                >
                  <option value="">— Nothing recorded —</option>
                  {replacementOptions.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.referenceCode} — {r.title.length > 60 ? `${r.title.slice(0, 60)}…` : r.title}
                      {r.status === 'expired' ? ' (expired)' : r.status === 'superseded' ? ' (superseded)' : ''}
                    </option>
                  ))}
                </select>
                {draft.status === 'expired' && expiredNoReplacement && (
                  <p className="text-[11px] text-rose-700 mt-1 flex items-start gap-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    Nothing is recorded, so saving this <strong>blocks every manual and new TCF
                    request</strong> that answers for it. Pick the regulation that replaces it,
                    or set the status back to Active.
                  </p>
                )}
                {expiredDeadReplacement && (
                  <p className="text-[11px] text-rose-700 mt-1 flex items-start gap-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    That replacement is expired too. The chain is followed, so this only
                    unblocks if it eventually reaches a regulation still in force.
                  </p>
                )}
                {draft.status === 'expired' && replacement && replacement.status !== 'expired' && (
                  <p className="text-[11px] text-emerald-700 mt-1">
                    Blocked work is released: everything citing this regulation answers for{' '}
                    <strong>{replacement.referenceCode}</strong> instead.
                  </p>
                )}
              </div>

              {draft.status === 'expired' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>Expired on</label>
                    <input
                      type="date"
                      value={draft.expiredAt ?? ''}
                      onChange={e => onChange({ ...draft, expiredAt: e.target.value })}
                      className={INPUT}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Reason</label>
                    <input
                      value={draft.expiredReason ?? ''}
                      onChange={e => onChange({ ...draft, expiredReason: e.target.value })}
                      placeholder="repealed by ESPR (EU) 2024/1781"
                      className={INPUT}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} disabled={saving} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1.5"
          >
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegulationEditor;
