/**
 * IMRegulatoryCheckModal — run the AI regulatory check for one template and read the report.
 *
 * Four states in one modal: pre-run (assigned regulations + what will be examined),
 * running (per-unit progress), report, and history (past immutable runs).
 *
 * Two things here are deliberate and should not be "tidied":
 *
 *  1. THE CHECK IS NOT GATED ON `isFinalized`. It is read-only, and a released template
 *     is exactly the thing you most want to audit. Every other action in the editor
 *     toolbar is disabled when the template is FINAL; this one is not, on purpose.
 *
 *  2. A VERBATIM FINDING CAN ONLY BE REGISTERED WHEN IT VERIFIES AS 'exact'. The
 *     phrase the model returns comes from tag-stripped text, and `freezeVerbatims` only
 *     substitutes a phrase that sits inside a single plain-prose run — so a phrase
 *     crossing <strong> or an &nbsp; would sit in translation_verbatims looking
 *     protective while translation rewrites the text anyway. `verifyVerbatimPhrase`
 *     runs the real freeze implementation; anything but 'exact' is disabled with a
 *     reason rather than hidden.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, Download, Loader2,
  Lock, Scale, ShieldCheck, X, XCircle,
} from 'lucide-react';
import {
  getRegulatoryCheckHistory,
  getTemplateRegulations,
  registerVerbatimFinding,
  runRegulatoryCheck,
  buildRegCheckDocument,
  chunkRegCheckDocument,
  getTranslationVerbatims,
} from '../../services';
import type {
  IMSection, IMTemplate, RegCheckSeverity, RegulatoryCheckRun, RegulatoryFinding,
  RegulatoryVerbatim, TemplateRegulation,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import { TemplateRegulationsPanel } from './IMTemplateRegulations';

const SEVERITY_STYLE: Record<RegCheckSeverity, string> = {
  critical: 'bg-rose-100 text-rose-700 border-rose-200',
  major: 'bg-amber-100 text-amber-800 border-amber-200',
  minor: 'bg-gray-100 text-gray-600 border-gray-200',
  info: 'bg-sky-100 text-sky-700 border-sky-200',
};

const downloadJson = (name: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

const FindingRow: React.FC<{
  finding: RegulatoryFinding;
  onGoToSection?: (sectionId: string) => void;
}> = ({ finding, onGoToSection }) => (
  <div className="border border-gray-200 rounded-lg p-3 bg-white">
    <div className="flex flex-wrap items-center gap-2">
      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border uppercase ${SEVERITY_STYLE[finding.severity]}`}>
        {finding.severity}
      </span>
      <span className="text-[10px] font-semibold text-gray-400 uppercase">{finding.kind}</span>
      <span className="font-mono text-[10px] text-gray-500">
        {finding.regulationReference}{finding.clause ? ` · ${finding.clause}` : ''}
      </span>
      {finding.sectionId ? (
        <button
          onClick={() => onGoToSection?.(finding.sectionId!)}
          className="ml-auto text-[11px] font-medium text-indigo-600 hover:text-indigo-800 truncate max-w-[16rem]"
          title={finding.sectionTitle}
        >
          {finding.sectionPath} — {finding.sectionTitle}
        </button>
      ) : (
        <span className="ml-auto text-[10px] text-gray-400">
          {finding.unresolvedAnchor ? 'not anchored' : 'template-wide'}
        </span>
      )}
    </div>

    <p className="text-xs text-gray-700 mt-2"><strong>Required:</strong> {finding.requirement}</p>
    <p className="text-xs text-gray-700 mt-1"><strong>Issue:</strong> {finding.issue}</p>
    {finding.suggestedChange && (
      <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded p-2 mt-2">
        <strong>Change:</strong> {finding.suggestedChange}
      </p>
    )}
    {finding.quote && (
      <pre className="text-[11px] text-gray-500 bg-light border rounded p-2 mt-2 whitespace-pre-wrap max-h-24 overflow-auto">
        {finding.quote}
      </pre>
    )}
  </div>
);

const VerbatimRow: React.FC<{
  entry: RegulatoryVerbatim;
  registered: boolean;
  busy: boolean;
  onRegister: (entry: RegulatoryVerbatim) => void;
}> = ({ entry, registered, busy, onRegister }) => {
  const blockedReason = entry.exactness === 'near'
    ? 'The template wording differs from the mandated wording, so protecting it would freeze the wrong text. Correct the wording first.'
    : entry.verification === 'stripped-only'
      ? 'This phrase crosses formatting or an HTML entity in the template, so it cannot be frozen as written. Simplify the markup or protect a shorter run.'
      : entry.verification === 'absent'
        ? 'This exact phrase was not found in the template source, so there is nothing to freeze.'
        : '';

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      <pre className="text-xs text-gray-800 bg-light border rounded p-2 whitespace-pre-wrap">{entry.phrase}</pre>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <span className="font-mono text-[10px] text-gray-500">
          {entry.regulationReferences.join(', ')}{entry.clause ? ` · ${entry.clause}` : ''}
        </span>
        {entry.sectionPath && <span className="text-[10px] text-gray-400">§{entry.sectionPath}</span>}
        {entry.exactness === 'near' && (
          <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
            WORDING DIFFERS
          </span>
        )}
      </div>
      {entry.rationale && <p className="text-xs text-gray-600 mt-1.5">{entry.rationale}</p>}

      <div className="mt-2">
        {registered ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
            <ShieldCheck size={12} /> Registered — translation will not rewrite this
          </span>
        ) : blockedReason ? (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 cursor-help"
            title={blockedReason}
          >
            <Lock size={12} /> Can&apos;t register
          </span>
        ) : (
          <button
            onClick={() => onRegister(entry)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />} Register as verbatim
          </button>
        )}
        {blockedReason && !registered && (
          <p className="text-[10px] text-gray-400 mt-1">{blockedReason}</p>
        )}
      </div>
    </div>
  );
};

const ReportView: React.FC<{
  run: RegulatoryCheckRun;
  registeredPhrases: Set<string>;
  registeringPhrase: string | null;
  onRegister: (entry: RegulatoryVerbatim) => void;
  onGoToSection?: (sectionId: string) => void;
}> = ({ run, registeredPhrases, registeringPhrase, onRegister, onGoToSection }) => {
  const { report } = run;
  const byRegulation = useMemo(() => {
    const groups = new Map<string, RegulatoryFinding[]>();
    for (const f of report.findings) {
      const list = groups.get(f.regulationReference) ?? [];
      list.push(f);
      groups.set(f.regulationReference, list);
    }
    return [...groups.entries()];
  }, [report.findings]);

  const banner =
    run.status === 'complete'
      ? { icon: <CheckCircle2 size={16} className="text-emerald-600" />, text: 'Check complete', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' }
      : run.status === 'partial'
        ? { icon: <AlertTriangle size={16} className="text-amber-600" />, text: 'Check partially complete', cls: 'bg-amber-50 border-amber-200 text-amber-800' }
        : { icon: <XCircle size={16} className="text-rose-600" />, text: 'Check failed', cls: 'bg-rose-50 border-rose-200 text-rose-800' };

  return (
    <div className="space-y-4">
      <div className={`border rounded-lg p-3 ${banner.cls}`}>
        <div className="flex flex-wrap items-center gap-2">
          {banner.icon}
          <span className="text-sm font-bold">{banner.text}</span>
          <span className="text-[11px] opacity-80">
            {new Date(run.createdAt).toLocaleString()} · {run.regulationCount} regulation
            {run.regulationCount === 1 ? '' : 's'} · {report.sectionCount} sections in {report.chunkCount} part
            {report.chunkCount === 1 ? '' : 's'} · {run.findingCount} finding
            {run.findingCount === 1 ? '' : 's'} · {run.verbatimCount} verbatim
            {run.verbatimCount === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => downloadJson(`regulatory-check-${run.id || 'run'}.json`, run)}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
          >
            <Download size={11} /> Download log
          </button>
        </div>
        {report.model && (
          <p className="text-[10px] opacity-70 mt-1">Model: {report.model}</p>
        )}
      </div>

      {report.failures.length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="font-bold mb-1">
            {report.failures.length} part{report.failures.length === 1 ? '' : 's'} did not come back —
            findings from {report.failures.length === 1 ? 'it' : 'them'} are missing:
          </p>
          <ul className="list-disc pl-4 space-y-0.5">
            {report.failures.map((f, i) => (
              <li key={i}>
                <span className="font-mono">{f.referenceCode}</span> (part {f.chunkIndex + 1}) — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(report.dropped > 0 || report.truncatedResponses > 0) && (
        <p className="text-[11px] text-gray-400">
          {report.dropped > 0 && `${report.dropped} malformed item(s) discarded. `}
          {report.truncatedResponses > 0 && `${report.truncatedResponses} response(s) hit the output limit, so their findings may be incomplete.`}
        </p>
      )}

      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">
          Required changes ({report.findings.length})
        </h4>
        {report.findings.length === 0 ? (
          <p className="text-xs text-gray-400 bg-light border border-dashed border-gray-200 rounded-lg p-4 text-center">
            No required changes were reported.
            {run.status !== 'complete' && ' Note the failed parts above — this is not a clean pass.'}
          </p>
        ) : (
          <div className="space-y-4">
            {byRegulation.map(([reference, findings]) => (
              <div key={reference}>
                <p className="font-mono text-[11px] font-bold text-primary mb-1.5">{reference}</p>
                <div className="space-y-2">
                  {findings.map((f, i) => (
                    <FindingRow key={i} finding={f} onGoToSection={onGoToSection} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">
          Must stay word-for-word ({report.verbatims.length})
        </h4>
        {report.verbatims.length === 0 ? (
          <p className="text-xs text-gray-400 bg-light border border-dashed border-gray-200 rounded-lg p-4 text-center">
            No mandated verbatim wording was identified.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-gray-400">
              Registering a phrase adds it to the translation verbatim list, so translation
              substitutes the approved wording instead of translating it.
            </p>
            {report.verbatims.map((v, i) => (
              <VerbatimRow
                key={i}
                entry={v}
                registered={registeredPhrases.has(v.phrase)}
                busy={registeringPhrase === v.phrase}
                onRegister={onRegister}
              />
            ))}
          </div>
        )}
      </div>

      {Object.keys(report.notesByRegulation).length > 0 && (
        <div>
          <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Reviewer notes</h4>
          <div className="space-y-1.5">
            {report.regulations.map((r) => {
              const note = report.notesByRegulation[r.id];
              if (!note) return null;
              return (
                <p key={r.id} className="text-xs text-gray-600 bg-light border rounded p-2">
                  <span className="font-mono font-bold">{r.referenceCode}</span> — {note}
                </p>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The modal
// ---------------------------------------------------------------------------

interface Props {
  template: IMTemplate;
  /** The editor already holds these — passing them avoids re-reading a large table. */
  sections?: IMSection[];
  categoryName?: string;
  onClose: () => void;
  onGoToSection?: (sectionId: string) => void;
}

export const RegulatoryCheckModal: React.FC<Props> = ({
  template, sections, categoryName, onClose, onGoToSection,
}) => {
  const { user } = useAuth();

  const [assignments, setAssignments] = useState<TemplateRegulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<{ sections: number; chunks: number } | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [runError, setRunError] = useState('');
  const [run, setRun] = useState<RegulatoryCheckRun | null>(null);

  const [history, setHistory] = useState<RegulatoryCheckRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showAssignments, setShowAssignments] = useState(false);

  const [registeredPhrases, setRegisteredPhrases] = useState<Set<string>>(new Set());
  const [registeringPhrase, setRegisteringPhrase] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState('');

  const loadContext = useCallback(async () => {
    const [assigned, past, verbatims] = await Promise.all([
      getTemplateRegulations(template.id, template.categoryId),
      getRegulatoryCheckHistory(template.id),
      getTranslationVerbatims(),
    ]);
    setAssignments(assigned);
    setHistory(past);
    setRegisteredPhrases(new Set(verbatims.map((v) => v.phrase)));
    try {
      const doc = await buildRegCheckDocument(template, sections);
      setPlan({ sections: doc.sections.length, chunks: chunkRegCheckDocument(doc).length });
    } catch (e) {
      console.warn('[RegulatoryCheck] could not build the plan preview', e);
    }
    setLoading(false);
  }, [template, sections]);

  useEffect(() => { loadContext(); }, [loadContext]);

  const missingSummary = assignments.filter((a) => (a.regulation?.summaryBytes ?? 0) === 0);
  const canRun = assignments.length > 0 && missingSummary.length === 0 && !running;

  const handleRun = async () => {
    setRunning(true);
    setRunError('');
    setRun(null);
    setProgress({ done: 0, total: assignments.length * (plan?.chunks ?? 1), label: 'Starting…' });
    try {
      const result = await runRegulatoryCheck({
        template,
        sections,
        assignments,
        runBy: user?.email,
        onProgress: (p) => setProgress(p),
      });
      setRun(result);
      setHistory(await getRegulatoryCheckHistory(template.id));
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const handleRegister = async (entry: RegulatoryVerbatim) => {
    setRegisteringPhrase(entry.phrase);
    setRegisterError('');
    try {
      const confirmed = window.confirm(
        `Protect this phrase from translation?\n\n${entry.phrase}\n\n` +
        `It will be added to the translation verbatim list with the note ` +
        `"${entry.regulationReferences.join(', ')}${entry.clause ? ` ${entry.clause}` : ''} — ` +
        `registered from the regulatory check of ${new Date().toISOString().slice(0, 10)}."`,
      );
      if (!confirmed) return;
      await registerVerbatimFinding(entry, user?.email);
      setRegisteredPhrases((prev) => new Set(prev).add(entry.phrase));
    } catch (e) {
      setRegisterError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegisteringPhrase(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => !running && onClose()}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <div>
            <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <Scale size={16} /> Regulatory check
            </h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {categoryName ? `${categoryName} · ` : ''}{template.name}
            </p>
          </div>
          <button
            onClick={() => !running && onClose()}
            disabled={running}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto text-sm">
          {loading ? (
            <div className="text-center py-10 text-gray-400">Loading…</div>
          ) : run ? (
            <>
              {registerError && (
                <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                  {registerError}
                </div>
              )}
              <ReportView
                run={run}
                registeredPhrases={registeredPhrases}
                registeringPhrase={registeringPhrase}
                onRegister={handleRegister}
                onGoToSection={onGoToSection}
              />
            </>
          ) : running ? (
            <div className="py-8">
              <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Loader2 size={15} className="animate-spin text-indigo-600" />
                Checking… {progress ? `${progress.done} of ${progress.total}` : ''}
              </p>
              <div className="w-full h-2 bg-gray-100 rounded-full mt-3 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all"
                  style={{ width: progress && progress.total ? `${(progress.done / progress.total) * 100}%` : '4%' }}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-2">{progress?.label}</p>
              <p className="text-[11px] text-gray-400 mt-3">
                Each regulation is reviewed part by part on the server, so this takes minutes
                rather than seconds. A part that fails is reported in the result rather than
                losing the whole run.
              </p>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Keep this tab open. You can close this dialog — the run carries on and the
                finished report appears under Past checks.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Each assigned regulation is checked against this template&apos;s English content,
                producing a list of required changes and the wording that must stay word-for-word.
                The template is never modified.
              </p>

              <div className="bg-light border rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-600 uppercase">
                    {assignments.length} regulation{assignments.length === 1 ? '' : 's'} assigned
                  </span>
                  <button
                    onClick={() => setShowAssignments((v) => !v)}
                    className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
                  >
                    {showAssignments ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {showAssignments ? 'Hide' : 'Manage'}
                  </button>
                </div>
                {!showAssignments && assignments.length > 0 && (
                  <p className="font-mono text-[11px] text-gray-500 mt-1.5">
                    {assignments.map((a) => a.regulation?.referenceCode ?? '?').join(' · ')}
                  </p>
                )}
                {plan && (
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    Will examine {plan.sections} section{plan.sections === 1 ? '' : 's'} in{' '}
                    {plan.chunks} part{plan.chunks === 1 ? '' : 's'} —{' '}
                    {assignments.length * plan.chunks} model call
                    {assignments.length * plan.chunks === 1 ? '' : 's'}.
                  </p>
                )}
                {showAssignments && (
                  <div className="mt-3 pt-3 border-t">
                    <TemplateRegulationsPanel
                      template={template}
                      onChanged={async () => {
                        setAssignments(await getTemplateRegulations(template.id, template.categoryId));
                      }}
                    />
                  </div>
                )}
              </div>

              {assignments.length === 0 && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  No regulations are assigned to this template yet. Add them above, or from the
                  Category Templates tab.
                </p>
              )}

              {missingSummary.length > 0 && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  These assigned regulations have no Markdown summary, so there is nothing to
                  check against:{' '}
                  <span className="font-mono">
                    {missingSummary.map((a) => a.regulation?.referenceCode ?? a.regulationId).join(', ')}
                  </span>
                  . Upload a summary in the Regulations library first.
                </p>
              )}

              {runError && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                  {runError}
                </div>
              )}

              {history.length > 0 && (
                <div className="border-t pt-3">
                  <button
                    onClick={() => setShowHistory((v) => !v)}
                    className="text-xs font-semibold text-gray-500 uppercase inline-flex items-center gap-1.5 hover:text-gray-700"
                  >
                    {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    <Clock size={12} /> Past checks ({history.length})
                  </button>
                  {showHistory && (
                    <div className="mt-2 space-y-1.5">
                      {history.map((h) => (
                        <button
                          key={h.id}
                          onClick={() => setRun(h)}
                          className="w-full text-left text-[11px] border rounded-lg px-2.5 py-2 hover:bg-light flex flex-wrap items-center gap-2"
                        >
                          <span className="font-medium text-gray-700">
                            {new Date(h.createdAt).toLocaleString()}
                          </span>
                          <span className="text-gray-400">
                            {h.regulationCount} regulation{h.regulationCount === 1 ? '' : 's'} ·{' '}
                            {h.findingCount} finding{h.findingCount === 1 ? '' : 's'} ·{' '}
                            {h.verbatimCount} verbatim{h.verbatimCount === 1 ? '' : 's'}
                          </span>
                          <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                            h.status === 'complete' ? 'bg-emerald-100 text-emerald-700'
                              : h.status === 'partial' ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-700'
                          }`}>
                            {h.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t">
          {run ? (
            <button
              onClick={() => setRun(null)}
              className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              Back
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={running}
              className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Close
            </button>
            {!run && (
              <button
                onClick={handleRun}
                disabled={!canRun}
                title={!canRun && assignments.length === 0 ? 'Assign at least one regulation first' : undefined}
                className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {running
                  ? <><Loader2 size={14} className="animate-spin" /> Checking…</>
                  : <><Scale size={14} /> Run check</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegulatoryCheckModal;
