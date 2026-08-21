/**
 * IMRegulatoryCheckModal — run the AI regulatory check for one template, read the report,
 * triage each finding, and fix the offending block without leaving the report.
 *
 * States: report (the default whenever a past run exists), pre-run, running, and history.
 *
 * Four things here are deliberate and should not be "tidied":
 *
 *  1. THE CHECK IS NOT GATED ON `isFinalized`. It is read-only, and a released template
 *     is exactly the thing you most want to audit. Every other action in the editor
 *     toolbar is disabled when the template is FINAL; this one is not, on purpose. FIXING
 *     a block from here IS gated, because that writes to the template.
 *
 *  2. A VERBATIM FINDING CAN ONLY BE REGISTERED WHEN IT VERIFIES AS 'exact'. The phrase
 *     the model returns comes from tag-stripped text, and `freezeVerbatims` only
 *     substitutes a phrase that sits inside a single plain-prose run — so a phrase
 *     crossing <strong> or an &nbsp; would sit in translation_verbatims looking protective
 *     while translation rewrites the text anyway. `verifyVerbatimPhrase` runs the real
 *     freeze implementation; anything but 'exact' is disabled with a reason.
 *
 *  3. THE MOST RECENT REPORT OPENS BY DEFAULT. Reopening this dialog to re-read what was
 *     found is far more common than starting a new run, and a run costs minutes and real
 *     money — so landing on a pre-run screen with a big Run button was the wrong default.
 *
 *  4. TRIAGE IS NOT STORED IN THE REPORT. `im_regulatory_checks` has no UPDATE policy by
 *     design (the report is immutable evidence), so decisions live in
 *     `im_regulatory_finding_status`, content-keyed so they survive a re-run. See
 *     src/services/regulatory/regulation-finding-status.ts.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, Download, Loader2,
  Lock, Pencil, RotateCcw, Scale, ShieldCheck, SkipForward, ThumbsDown, X, XCircle,
} from 'lucide-react';
import {
  getRegulatoryCheckHistory,
  getTemplateRegulations,
  registerVerbatimFinding,
  runRegulatoryCheck,
  buildRegCheckDocument,
  chunkRegCheckDocument,
  getTranslationVerbatims,
  findingKey,
  getFindingStatuses,
  setFindingStatus,
} from '../../services';
import type { FindingStatus, FindingStatusEntry } from '../../services';
import type {
  BlockRef, CategoryAttribute, IMSection, IMTemplate, InlineBlockRef, RegCheckSeverity,
  RegulatoryCheckRun, RegulatoryFinding, RegulatoryVerbatim, TemplateRegulation,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import { TemplateRegulationsPanel } from './IMTemplateRegulations';
import { InlineBlockEditor } from './editor/InlineBlockEditor';

const SEVERITY_STYLE: Record<RegCheckSeverity, string> = {
  critical: 'bg-rose-100 text-rose-700 border-rose-200',
  major: 'bg-amber-100 text-amber-800 border-amber-200',
  minor: 'bg-gray-100 text-gray-600 border-gray-200',
  info: 'bg-sky-100 text-sky-700 border-sky-200',
};

const STATUS_META: Record<FindingStatus, { label: string; Icon: typeof CheckCircle2; chip: string }> = {
  solved: { label: 'Solved', Icon: CheckCircle2, chip: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  skipped: { label: 'Skipped', Icon: SkipForward, chip: 'bg-gray-100 text-gray-600 border-gray-200' },
  wrong: { label: 'Wrong', Icon: ThumbsDown, chip: 'bg-violet-100 text-violet-700 border-violet-200' },
};

const STATUS_ORDER: FindingStatus[] = ['solved', 'skipped', 'wrong'];

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
// Locating the block a finding points at
// ---------------------------------------------------------------------------

interface BlockLocation {
  section: IMSection;
  /** Index into the section's blockRefs, or -1 for a legacy section that has none. */
  index: number;
  ref: BlockRef | null;
}

/**
 * Resolve a finding's `refId` back to the live block it names.
 *
 * Two id shapes exist, because the serializer emits a positional fallback for refs that
 * predate id backfill: a real `BlockRef.id`, or `${sectionId}#${index}` / `#legacy`. Both
 * are handled, so an older template is still fixable from the report rather than silently
 * offering nothing.
 */
export const locateBlock = (sections: IMSection[], refId?: string): BlockLocation | null => {
  if (!refId) return null;

  for (const section of sections) {
    const index = (section.blockRefs ?? []).findIndex((r) => (r as { id?: string }).id === refId);
    if (index >= 0) return { section, index, ref: section.blockRefs![index] };
  }

  const positional = /^(.+)#(\d+|legacy)$/.exec(refId);
  if (positional) {
    const section = sections.find((s) => s.id === positional[1]);
    if (section) {
      if (positional[2] === 'legacy') return { section, index: -1, ref: null };
      const index = Number(positional[2]);
      const ref = (section.blockRefs ?? [])[index];
      if (ref) return { section, index, ref };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Triage control
// ---------------------------------------------------------------------------

const StatusControl: React.FC<{
  current?: FindingStatus;
  busy: boolean;
  onSet: (status: FindingStatus | null) => void;
}> = ({ current, busy, onSet }) => (
  <div className="flex items-center gap-1">
    {STATUS_ORDER.map((status) => {
      const { label, Icon, chip } = STATUS_META[status];
      const active = current === status;
      return (
        <button
          key={status}
          // Clicking the active one clears the decision — untriaged is the absence of a
          // row, so there is no separate "reopen" action to hunt for.
          onClick={() => onSet(active ? null : status)}
          disabled={busy}
          title={active ? `Clear "${label}"` : `Mark as ${label.toLowerCase()}`}
          className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors disabled:opacity-50 ${
            active ? chip : 'bg-white text-gray-400 border-gray-200 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <Icon size={10} /> {label}
        </button>
      );
    })}
    {busy && <Loader2 size={11} className="animate-spin text-gray-400" />}
  </div>
);

// ---------------------------------------------------------------------------
// Inline fix panel — edits the offending block in place
// ---------------------------------------------------------------------------

interface FixPanelProps {
  location: BlockLocation;
  languages: { code: string; label: string }[];
  attributes: CategoryAttribute[];
  locked: boolean;
  onSave: (section: IMSection) => Promise<boolean>;
  onClose: () => void;
}

const FixPanel: React.FC<FixPanelProps> = ({
  location, languages, attributes, locked, onSave, onClose,
}) => {
  const original = location.ref;
  const inlineOriginal = original && original.kind === 'inline' ? original : null;
  const [draft, setDraft] = useState<InlineBlockRef | null>(
    inlineOriginal ? { ...inlineOriginal, content: { ...inlineOriginal.content } } : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Not every finding points at something editable here, and naming which case it is beats
  // showing an empty box.
  if (!original) {
    return (
      <div className="mt-2 text-[11px] text-gray-500 bg-light border rounded p-2">
        This finding points at a section whose content predates block references. Open
        &ldquo;{location.section.title}&rdquo; in the editor to change it.
      </div>
    );
  }
  if (original.kind === 'block') {
    return (
      <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
        This is a shared, approved block from the Block Library. Editing it here would change
        every template that uses it, so it is not offered — change it in the Block Library, or
        replace the reference in this section.
      </div>
    );
  }
  if (original.kind === 'sku_slot') {
    return (
      <div className="mt-2 text-[11px] text-gray-500 bg-light border rounded p-2">
        This is a per-product slot, filled per SKU when a manual is generated — there is no
        template text here to correct.
      </div>
    );
  }
  if (!draft) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(original);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const refs = [...(location.section.blockRefs ?? [])];
      refs[location.index] = draft;
      const ok = await onSave({ ...location.section, blockRefs: refs });
      if (!ok) {
        setError('The save was refused. If the template is marked FINAL, unlock it first.');
        return;
      }
      setSaved(true);
      // Left open on purpose: the point of fixing from here is to carry on down the
      // report, so the panel confirms and waits rather than yanking itself shut.
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 border border-indigo-200 rounded-lg bg-indigo-50/40 p-2">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-bold text-indigo-700 uppercase">
          Editing block in &ldquo;{location.section.title}&rdquo;
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Close editor">
          <X size={14} />
        </button>
      </div>

      {locked ? (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
          This template is marked FINAL, so its content is read-only. Unlock it to correct
          this block — the check itself stays available either way.
        </p>
      ) : (
        <>
          <div className="bg-white rounded border">
            <InlineBlockEditor
              content={draft.content}
              variant={draft.variant}
              languages={languages}
              attributes={attributes}
              rowKey={`regcheck-${location.section.id}-${location.index}`}
              onChange={(lang, html) =>
                setDraft((d) => (d ? { ...d, content: { ...d.content, [lang]: html } } : d))}
              onVariantChange={(variant) => setDraft((d) => (d ? { ...d, variant } : d))}
              enableTranslate
            />
          </div>

          {error && (
            <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 mt-1.5">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 mt-1.5">
            {saved && !dirty && (
              <span className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1">
                <CheckCircle2 size={11} /> Saved
              </span>
            )}
            <button
              onClick={() => setDraft({ ...inlineOriginal!, content: { ...inlineOriginal!.content } })}
              disabled={!dirty || saving}
              className="text-[11px] px-2 py-1 border rounded hover:bg-white disabled:opacity-40 inline-flex items-center gap-1"
            >
              <RotateCcw size={11} /> Revert
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="text-[11px] font-bold px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40 inline-flex items-center gap-1"
            >
              {saving ? <><Loader2 size={11} className="animate-spin" /> Saving…</> : 'Save block'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

interface FindingRowProps {
  finding: RegulatoryFinding;
  status?: FindingStatusEntry;
  statusBusy: boolean;
  onSetStatus: (status: FindingStatus | null) => void;
  location: BlockLocation | null;
  isEditing: boolean;
  onToggleEdit: () => void;
  languages: { code: string; label: string }[];
  attributes: CategoryAttribute[];
  locked: boolean;
  onSaveSection: (section: IMSection) => Promise<boolean>;
  onGoToSection?: (sectionId: string) => void;
}

const FindingRow: React.FC<FindingRowProps> = ({
  finding, status, statusBusy, onSetStatus, location, isEditing, onToggleEdit,
  languages, attributes, locked, onSaveSection, onGoToSection,
}) => {
  // A decided finding stays visible but recedes, so the undecided ones read first.
  const decided = Boolean(status);
  return (
    <div className={`border rounded-lg p-3 transition-colors ${
      decided ? 'border-gray-100 bg-light/40' : 'border-gray-200 bg-white'
    }`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border uppercase ${SEVERITY_STYLE[finding.severity]}`}>
          {finding.severity}
        </span>
        <span className="text-[10px] font-semibold text-gray-400 uppercase">{finding.kind}</span>
        <span className="font-mono text-[10px] text-gray-500">
          {finding.regulationReference}{finding.clause ? ` · ${finding.clause}` : ''}
        </span>
        {status && (
          <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border uppercase ${STATUS_META[status.status].chip}`}>
            {STATUS_META[status.status].label}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {location ? (
            <button
              onClick={onToggleEdit}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
            >
              <Pencil size={11} /> {isEditing ? 'Close' : 'Fix block'}
            </button>
          ) : finding.sectionId && onGoToSection ? (
            <button
              onClick={() => onGoToSection(finding.sectionId!)}
              className="text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
              title="Select this section in the editor behind this dialog"
            >
              Select section
            </button>
          ) : null}
        </span>
      </div>

      <div className={decided ? 'opacity-60' : undefined}>
        {finding.sectionPath && (
          <p className="text-[10px] text-gray-400 mt-1.5">
            §{finding.sectionPath} {finding.sectionTitle}
            {finding.unresolvedAnchor && ' · not anchored'}
          </p>
        )}
        {!finding.sectionPath && finding.unresolvedAnchor && (
          <p className="text-[10px] text-gray-400 mt-1.5">not anchored</p>
        )}

        <p className="text-xs text-gray-700 mt-1.5"><strong>Required:</strong> {finding.requirement}</p>
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

      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-gray-100">
        <StatusControl current={status?.status} busy={statusBusy} onSet={onSetStatus} />
        {status?.updatedBy && (
          <span className="text-[10px] text-gray-400">
            {STATUS_META[status.status].label.toLowerCase()} by {status.updatedBy}
          </span>
        )}
      </div>

      {isEditing && location && (
        <FixPanel
          location={location}
          languages={languages}
          attributes={attributes}
          locked={locked}
          onSave={onSaveSection}
          onClose={onToggleEdit}
        />
      )}
    </div>
  );
};

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

// ---------------------------------------------------------------------------
// The modal
// ---------------------------------------------------------------------------

interface Props {
  template: IMTemplate;
  /** The editor already holds these — passing them avoids re-reading a large table. */
  sections?: IMSection[];
  categoryName?: string;
  /** Language tabs offered by the inline fix editor. */
  languages?: { code: string; label: string }[];
  /** Category attributes, so placeholders and conditions can be inserted while fixing. */
  attributes?: CategoryAttribute[];
  /** Template is FINAL: the check still runs, but fixing a block is refused. */
  locked?: boolean;
  /** Persist an edited section. Returns false when the write was refused. */
  onSaveSection?: (section: IMSection) => Promise<boolean>;
  onClose: () => void;
  onGoToSection?: (sectionId: string) => void;
}

export const RegulatoryCheckModal: React.FC<Props> = ({
  template, sections, categoryName, languages, attributes, locked, onSaveSection,
  onClose, onGoToSection,
}) => {
  const { user } = useAuth();

  const [assignments, setAssignments] = useState<TemplateRegulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<{ sections: number; chunks: number } | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [runError, setRunError] = useState('');
  const [run, setRun] = useState<RegulatoryCheckRun | null>(null);
  /** True when the operator explicitly asked for the pre-run screen. */
  const [startingNew, setStartingNew] = useState(false);

  const [history, setHistory] = useState<RegulatoryCheckRun[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showAssignments, setShowAssignments] = useState(false);

  const [statuses, setStatuses] = useState<Record<string, FindingStatusEntry>>({});
  const [statusBusyKey, setStatusBusyKey] = useState<string | null>(null);
  const [statusError, setStatusError] = useState('');
  const [hideDecided, setHideDecided] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const [registeredPhrases, setRegisteredPhrases] = useState<Set<string>>(new Set());
  const [registeringPhrase, setRegisteringPhrase] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState('');

  const liveSections = sections ?? [];

  const loadContext = useCallback(async () => {
    const [assigned, past, verbatims, decisions] = await Promise.all([
      getTemplateRegulations(template.id, template.categoryId),
      getRegulatoryCheckHistory(template.id),
      getTranslationVerbatims(),
      getFindingStatuses(template.id),
    ]);
    setAssignments(assigned);
    setHistory(past);
    setRegisteredPhrases(new Set(verbatims.map((v) => v.phrase)));
    setStatuses(decisions);
    // Land on the most recent report: re-reading findings is the common reason to open
    // this, and a run costs minutes and real money, so it must be asked for explicitly.
    if (past.length) setRun(past[0]);
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
    setStartingNew(false);
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

  const handleSetStatus = async (finding: RegulatoryFinding, status: FindingStatus | null) => {
    const key = findingKey(finding);
    setStatusBusyKey(key);
    setStatusError('');
    // Optimistic: a triage click should feel instant, and a failure is recoverable by
    // clicking again — the row reverts and says why.
    const previous = statuses[key];
    setStatuses((prev) => {
      const next = { ...prev };
      if (status) {
        next[key] = { status, updatedBy: user?.email, updatedAt: new Date().toISOString() };
      } else {
        delete next[key];
      }
      return next;
    });
    try {
      await setFindingStatus(template.id, key, status, { actor: user?.email });
    } catch (e) {
      setStatuses((prev) => {
        const next = { ...prev };
        if (previous) next[key] = previous; else delete next[key];
        return next;
      });
      setStatusError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusBusyKey(null);
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

  /** Findings grouped by regulation, with their decision and target block resolved. */
  const grouped = useMemo(() => {
    if (!run) return [];
    const groups = new Map<string, Array<{
      finding: RegulatoryFinding; key: string; status?: FindingStatusEntry; location: BlockLocation | null;
    }>>();
    for (const finding of run.report.findings) {
      const key = findingKey(finding);
      const status = statuses[key];
      if (hideDecided && status) continue;
      const list = groups.get(finding.regulationReference) ?? [];
      list.push({ finding, key, status, location: locateBlock(liveSections, finding.refId) });
      groups.set(finding.regulationReference, list);
    }
    return [...groups.entries()];
  }, [run, statuses, hideDecided, liveSections]);

  const decidedCount = useMemo(() => {
    if (!run) return 0;
    return run.report.findings.filter((f) => statuses[findingKey(f)]).length;
  }, [run, statuses]);

  const banner = run && (
    run.status === 'complete'
      ? { icon: <CheckCircle2 size={16} className="text-emerald-600" />, text: 'Check complete', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' }
      : run.status === 'partial'
        ? { icon: <AlertTriangle size={16} className="text-amber-600" />, text: 'Check partially complete', cls: 'bg-amber-50 border-amber-200 text-amber-800' }
        : { icon: <XCircle size={16} className="text-rose-600" />, text: 'Check failed', cls: 'bg-rose-50 border-rose-200 text-rose-800' }
  );

  const showPreRun = !run || startingNew;

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => !running && onClose()}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col"
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
          ) : showPreRun ? (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Each regulation that applies is checked against this template&apos;s English
                content, producing a list of required changes and the wording that must stay
                word-for-word. The check itself never modifies the template.
              </p>

              <div className="bg-light border rounded-lg p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-600 uppercase">
                    {assignments.length} regulation{assignments.length === 1 ? '' : 's'} apply
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
                  No regulations apply to this template yet. Add them above, or tick this
                  category on a regulation in the Regulations library.
                </p>
              )}

              {missingSummary.length > 0 && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  These regulations have no Markdown summary, so there is nothing to check
                  against:{' '}
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
                          onClick={() => { setRun(h); setStartingNew(false); setEditingKey(null); }}
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
          ) : run && banner ? (
            <div className="space-y-4">
              <div className={`border rounded-lg p-3 ${banner.cls}`}>
                <div className="flex flex-wrap items-center gap-2">
                  {banner.icon}
                  <span className="text-sm font-bold">{banner.text}</span>
                  <span className="text-[11px] opacity-80">
                    {new Date(run.createdAt).toLocaleString()} · {run.regulationCount} regulation
                    {run.regulationCount === 1 ? '' : 's'} · {run.report.sectionCount} sections ·{' '}
                    {run.findingCount} finding{run.findingCount === 1 ? '' : 's'} · {run.verbatimCount} verbatim
                    {run.verbatimCount === 1 ? '' : 's'}
                  </span>
                  <button
                    onClick={() => downloadJson(`regulatory-check-${run.id || 'run'}.json`, run)}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
                  >
                    <Download size={11} /> Download log
                  </button>
                </div>
                {run.report.model && (
                  <p className="text-[10px] opacity-70 mt-1">Model: {run.report.model}</p>
                )}
              </div>

              {run.report.failures.length > 0 && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="font-bold mb-1">
                    {run.report.failures.length} part{run.report.failures.length === 1 ? '' : 's'} did not
                    come back — findings from {run.report.failures.length === 1 ? 'it' : 'them'} are missing:
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {run.report.failures.map((f, i) => (
                      <li key={i}>
                        <span className="font-mono">{f.referenceCode}</span> (part {f.chunkIndex + 1}) — {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(run.report.dropped > 0 || run.report.truncatedResponses > 0) && (
                <p className="text-[11px] text-gray-400">
                  {run.report.dropped > 0 && `${run.report.dropped} malformed item(s) discarded. `}
                  {run.report.truncatedResponses > 0 && `${run.report.truncatedResponses} response(s) hit the output limit, so their findings may be incomplete.`}
                </p>
              )}

              {statusError && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                  Could not save that decision: {statusError}
                </div>
              )}
              {registerError && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                  {registerError}
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h4 className="text-xs font-bold text-gray-500 uppercase">
                    Required changes ({run.report.findings.length})
                    {decidedCount > 0 && (
                      <span className="ml-1.5 font-medium normal-case text-gray-400">
                        · {decidedCount} decided
                      </span>
                    )}
                  </h4>
                  {decidedCount > 0 && (
                    <label className="text-[11px] text-gray-500 inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={hideDecided}
                        onChange={(e) => setHideDecided(e.target.checked)}
                      />
                      Hide decided
                    </label>
                  )}
                </div>

                {run.report.findings.length === 0 ? (
                  <p className="text-xs text-gray-400 bg-light border border-dashed border-gray-200 rounded-lg p-4 text-center">
                    No required changes were reported.
                    {run.status !== 'complete' && ' Note the failed parts above — this is not a clean pass.'}
                  </p>
                ) : grouped.length === 0 ? (
                  <p className="text-xs text-gray-400 bg-light border border-dashed border-gray-200 rounded-lg p-4 text-center">
                    Every finding has been decided. Untick &ldquo;Hide decided&rdquo; to review them.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {grouped.map(([reference, entries]) => (
                      <div key={reference}>
                        <p className="font-mono text-[11px] font-bold text-primary mb-1.5">{reference}</p>
                        <div className="space-y-2">
                          {entries.map(({ finding, key, status, location }) => (
                            <FindingRow
                              key={key}
                              finding={finding}
                              status={status}
                              statusBusy={statusBusyKey === key}
                              onSetStatus={(s) => handleSetStatus(finding, s)}
                              location={location}
                              isEditing={editingKey === key}
                              onToggleEdit={() => setEditingKey((k) => (k === key ? null : key))}
                              languages={languages ?? [{ code: 'en', label: 'EN' }]}
                              attributes={attributes ?? []}
                              locked={Boolean(locked)}
                              onSaveSection={onSaveSection ?? (async () => false)}
                              onGoToSection={onGoToSection}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">
                  Must stay word-for-word ({run.report.verbatims.length})
                </h4>
                {run.report.verbatims.length === 0 ? (
                  <p className="text-xs text-gray-400 bg-light border border-dashed border-gray-200 rounded-lg p-4 text-center">
                    No mandated verbatim wording was identified.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-gray-400">
                      Registering a phrase adds it to the translation verbatim list, so translation
                      substitutes the approved wording instead of translating it.
                    </p>
                    {run.report.verbatims.map((v, i) => (
                      <VerbatimRow
                        key={i}
                        entry={v}
                        registered={registeredPhrases.has(v.phrase)}
                        busy={registeringPhrase === v.phrase}
                        onRegister={handleRegister}
                      />
                    ))}
                  </div>
                )}
              </div>

              {Object.keys(run.report.notesByRegulation).length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">Reviewer notes</h4>
                  <div className="space-y-1.5">
                    {run.report.regulations.map((r) => {
                      const note = run.report.notesByRegulation[r.id];
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

              {history.length > 1 && (
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
                          onClick={() => { setRun(h); setEditingKey(null); }}
                          className={`w-full text-left text-[11px] border rounded-lg px-2.5 py-2 hover:bg-light flex flex-wrap items-center gap-2 ${
                            h.id === run.id ? 'border-indigo-300 bg-indigo-50/50' : ''
                          }`}
                        >
                          <span className="font-medium text-gray-700">
                            {new Date(h.createdAt).toLocaleString()}
                          </span>
                          <span className="text-gray-400">
                            {h.findingCount} finding{h.findingCount === 1 ? '' : 's'}
                          </span>
                          {h.id === run.id && (
                            <span className="text-[9px] font-bold text-indigo-600 uppercase">showing</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t">
          {run && !showPreRun ? (
            <span className="text-[11px] text-gray-400">
              Decisions save as you click, and carry over to the next run.
            </span>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={running}
              className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Close
            </button>
            {showPreRun ? (
              <>
                {run && (
                  <button
                    onClick={() => setStartingNew(false)}
                    className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    Back to report
                  </button>
                )}
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
              </>
            ) : (
              <button
                onClick={() => { setStartingNew(true); setEditingKey(null); }}
                className="text-sm px-4 py-2 border border-indigo-200 text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 flex items-center gap-1.5"
              >
                <Scale size={14} /> Run new check
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegulatoryCheckModal;
