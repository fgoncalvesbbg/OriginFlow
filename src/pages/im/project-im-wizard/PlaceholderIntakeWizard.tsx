/**
 * PlaceholderIntakeWizard — the guided, section-grouped question-and-answer pass over a
 * manual's registered placeholders (migrations 142/143). See
 * C:\Users\f.goncalves\.claude\plans\originflow-im-rippling-fog.md, "Phase 1" and its §8
 * for the full design.
 *
 * A full-screen overlay owned by `ProjectIMGenerator`, not a second route: it is handed the
 * SAME `formData`/`setFormData`/`conditions`/`setConditions` state ProjectIMGenerator already
 * owns (so every wizard edit flows through the existing autosave/local-backup pipeline for
 * free) plus a `buildCandidateData` callback wrapping its existing `buildPlaceholderData`.
 *
 * State design note — the LOCAL ANSWER OVERLAY: `getWizardQuestions` is an async DB round
 * trip, so refetching the whole question list after every keystroke (to pick up the new
 * `currentAnswer`) would make the wizard feel laggy and would fight the debounced save below.
 * Instead this component fetches the question list ONCE per (templateId, projectId, skuScope)
 * and keeps a local `{ [key]: { status, value, source } }` overlay that is merged onto each
 * question's `currentAnswer` on every render (`effectiveQuestions`) — so
 * `computeVisibleQuestions`/`completionOf`/the section nav all react immediately to an answer,
 * with no round trip. The overlay is cleared whenever the underlying fetch re-runs (scope
 * change), since a fresh fetch's `currentAnswer`s are authoritative again at that point.
 *
 * WHY THIS FILE NEVER CALLS `setConditions`: a wizard question corresponds to an
 * `.im-placeholder` chip or a `{{attrId}}` token — `SectionItem.kind === 'placeholder'` in
 * `im-content.utils.ts` — never to an `.im-condition` chip (`kind === 'condition'`), which is
 * what the separate `conditions` map / `cond_` prefix drives (see the "Fill values" tab's
 * `handleConditionToggle`). `conditions` is accepted as a prop only so the signature matches
 * what a future ad-hoc boolean-type question (not possible under the current
 * `im_adhoc_placeholders` schema, which only allows `type IN ('text','image')`) could need.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Loader2, ListChecks, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { getWizardQuestions, saveWizardAnswer } from '../../../services';
import {
  CategoryAttribute, IMBlock, IMSection, IMTemplate, IMTemplateType, ProjectIM, ProjectSku,
  PlaceholderAnswerSource, PlaceholderAnswerStatus, WizardQuestion, localizedSectionTitle,
} from '../../../types';
import { fillAnchors } from '../project-im-generator/publish-issues';
import { completionOf, computeVisibleQuestions, groupBySection, nextUnansweredKey, WizardSectionGroup } from './wizard-questions.utils';
import { PendingItem } from './pending-items.utils';
import QuestionPanel from './QuestionPanel';
import LivePreviewPane from './LivePreviewPane';
import SkipControls from './SkipControls';
import OpenItemsList from './OpenItemsList';
import { useWizardKeyboardNav } from './useWizardKeyboardNav';

interface AnswerOverlayEntry {
  status: PlaceholderAnswerStatus;
  value: string;
  source: PlaceholderAnswerSource;
}

export interface PlaceholderIntakeWizardProps {
  templateId: string;
  templateType: IMTemplateType;
  projectId: string;
  projectImId: string | undefined;
  sections: IMSection[];
  blocksById: Record<string, IMBlock>;
  attributesById: Record<string, CategoryAttribute>;
  template: IMTemplate;
  projectSkus: ProjectSku[];
  boundSkuIds: string[];
  /** The last-SAVED manual row (may be null for a brand-new project) — read-only here, used
   *  to seed LivePreviewPane's content overlays. See that component's doc comment. */
  instance: ProjectIM | null;
  activeLang: string;
  formData: Record<string, string>;
  setFormData: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  conditions: Record<string, boolean>;
  setConditions: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  buildCandidateData: (overrideKey: string, overrideValue: string) => Record<string, string>;
  /**
   * Guarantees a `project_ims` row exists before the first answer write, returning its id.
   * `saveWizardAnswer` throws when no such row exists yet (the very-first-generation case),
   * so this wraps ProjectIMGenerator's existing draft-save path (`persistDraft`) rather than
   * this file reimplementing "create the first draft" — see the wizard plan's "no ProjectIM
   * row yet" risk note.
   */
  ensureProjectImId: () => Promise<string | undefined>;
  onClose: () => void;
}

const isSettled = (q: WizardQuestion): boolean =>
  q.currentAnswer?.status === 'answered' || q.currentAnswer?.status === 'not_applicable';

const SAVE_DEBOUNCE_MS = 500;

const PlaceholderIntakeWizard: React.FC<PlaceholderIntakeWizardProps> = ({
  templateId, templateType, projectId, projectImId, sections, blocksById, attributesById, template,
  projectSkus, boundSkuIds, instance, activeLang, formData, setFormData, conditions, buildCandidateData,
  ensureProjectImId, onClose,
}) => {
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  const [questions, setQuestions] = useState<WizardQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(true);
  // Phase 1 has no UI to change scope yet (wizard plan §5 — "read/overlay only") — fixed at
  // project scope. Kept as state (not a constant) so the fetch effect and the answer-write
  // path are already shaped for the scope-picker Phase 2 adds.
  const [skuScope] = useState<'project' | string>('project');
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [expandedNoteKey, setExpandedNoteKey] = useState<string | null>(null);
  const [answerOverlay, setAnswerOverlay] = useState<Record<string, AnswerOverlayEntry>>({});
  const [resolvedProjectImId, setResolvedProjectImId] = useState<string | undefined>(projectImId);
  const [showOpenItems, setShowOpenItems] = useState(false);
  // Visible, non-blocking error surface for a failed answer write — `commitAnswer` used to
  // only `console.error` and drop the answer silently (the row stayed `pending` with no
  // visible sign anything went wrong). Auto-dismisses; a fresh attempt clears it early.
  const [answerError, setAnswerError] = useState<string | null>(null);
  const answerErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showAnswerError = (message: string) => {
    if (answerErrorTimerRef.current) clearTimeout(answerErrorTimerRef.current);
    setAnswerError(message);
    answerErrorTimerRef.current = setTimeout(() => setAnswerError(null), 6000);
  };

  useEffect(() => { setResolvedProjectImId(projectImId); }, [projectImId]);

  useEffect(() => {
    let alive = true;
    setLoadingQuestions(true);
    const skuId = skuScope === 'project' ? undefined : skuScope;
    getWizardQuestions(templateId, projectId, skuId)
      .then((qs) => { if (!alive) return; setQuestions(qs); setAnswerOverlay({}); })
      .catch((e) => console.error('[PlaceholderIntakeWizard] failed to load questions:', e))
      .finally(() => { if (alive) setLoadingQuestions(false); });
    return () => { alive = false; };
  }, [templateId, projectId, skuScope]);

  // Merge the local overlay onto each question's currentAnswer — see the module doc comment.
  const effectiveQuestions = useMemo<WizardQuestion[]>(() => questions.map((q) => {
    const overlay = answerOverlay[q.key];
    if (!overlay) return q;
    return {
      ...q,
      currentAnswer: {
        id: q.currentAnswer?.id ?? '',
        projectImId: resolvedProjectImId ?? '',
        placeholderKey: q.key,
        scope: skuScope === 'project' ? 'project' : 'sku',
        projectSkuId: skuScope === 'project' ? null : skuScope,
        status: overlay.status,
        value: overlay.value,
        source: overlay.source,
        skippedThenFilled: q.currentAnswer?.skippedThenFilled ?? false,
        answeredBy: q.currentAnswer?.answeredBy ?? null,
        answeredAt: q.currentAnswer?.answeredAt ?? null,
        createdAt: q.currentAnswer?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  }), [questions, answerOverlay, resolvedProjectImId, skuScope]);

  const visibleQuestions = computeVisibleQuestions(effectiveQuestions, buildCandidateData('', ''), conditions);
  const completion = completionOf(visibleQuestions);

  const sectionTitleById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of sections) map[s.id] = localizedSectionTitle(s, activeLang);
    return map;
  }, [sections, activeLang]);
  const sectionGroups: WizardSectionGroup[] = groupBySection(visibleQuestions, sectionTitleById);

  // Pick/repick the current question whenever the underlying data changes (fresh fetch or
  // an answer revealing/settling something) — but only when the current one is gone
  // (retired by a template edit) or was never set. Doesn't fight the user's own navigation.
  useEffect(() => {
    if (loadingQuestions) return;
    if (currentKey && visibleQuestions.some((q) => q.key === currentKey)) return;
    const next = nextUnansweredKey(visibleQuestions, null) ?? visibleQuestions[0]?.key ?? null;
    setCurrentKey(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingQuestions, questions]);

  const currentQuestion = visibleQuestions.find((q) => q.key === currentKey) ?? null;
  // Falls back to formData in case a value landed there (the old "Fill values" tab, or a
  // save that hasn't round-tripped into an answer row yet) before any wizard answer row
  // exists for this key.
  const currentValue = currentQuestion
    ? (currentQuestion.currentAnswer?.value ?? formData[currentQuestion.key] ?? '')
    : '';
  const currentStatus: PlaceholderAnswerStatus = currentQuestion?.currentAnswer?.status ?? 'pending';

  // ---- debounced, flushable answer writes --------------------------------------------
  const pendingWritesRef = useRef<Record<string, AnswerOverlayEntry>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const commitAnswer = async (key: string, entry: AnswerOverlayEntry) => {
    // `ensureProjectImId` → `persistDraft` now WAITS for and reuses an already-in-flight
    // save (the generator's own 4s autosave, most commonly — armed by this very wizard
    // edit) rather than bailing the moment one is running, so this await resolves to the
    // real id in the common case instead of undefined. It can still legitimately fail
    // (Publish/Translate/Finalize in progress, or the save itself erroring) — that must
    // surface visibly, never drop the answer with only a console log.
    const projId = resolvedProjectImId ?? (await ensureProjectImId());
    if (!projId) {
      const msg = `Could not save the answer for "${key}" — no manual is available to save against right now. Please try again in a moment.`;
      console.error('[PlaceholderIntakeWizard]', msg);
      showAnswerError(msg);
      return;
    }
    if (!resolvedProjectImId) setResolvedProjectImId(projId);
    try {
      await saveWizardAnswer(projId, key, {
        value: entry.value || null,
        status: entry.status,
        source: entry.source,
        scope: skuScope === 'project' ? 'project' : 'sku',
        projectSkuId: skuScope === 'project' ? undefined : skuScope,
        changedBy: user?.email ?? null,
        changedByName: user?.email ?? '',
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`[PlaceholderIntakeWizard] failed to save the answer for "${key}":`, e);
      showAnswerError(`Failed to save the answer for "${key}": ${detail}`);
    }
  };

  const flushKey = (key: string) => {
    const timer = timersRef.current[key];
    if (timer) { clearTimeout(timer); delete timersRef.current[key]; }
    const pending = pendingWritesRef.current[key];
    if (pending) { delete pendingWritesRef.current[key]; void commitAnswer(key, pending); }
  };

  const flushAll = () => { Object.keys(pendingWritesRef.current).forEach(flushKey); };

  const scheduleSave = (key: string, entry: AnswerOverlayEntry) => {
    pendingWritesRef.current[key] = entry;
    if (timersRef.current[key]) clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(() => flushKey(key), SAVE_DEBOUNCE_MS);
  };

  useEffect(() => () => flushAll(), []);
  useEffect(() => () => { if (answerErrorTimerRef.current) clearTimeout(answerErrorTimerRef.current); }, []);

  // ---- answer / status change handlers -----------------------------------------------
  const handleAnswerChange = (question: WizardQuestion, value: string) => {
    // (a) Mirror into the SAME formData ProjectIMGenerator already owns, so the existing
    // instant-localStorage backup + debounced saveProjectIM('draft', …) autosave pick this
    // edit up for free. See the module doc comment for why `conditions` is never touched.
    setFormData((prev) => ({ ...prev, [question.key]: value }));

    const status: PlaceholderAnswerStatus = value.trim() ? 'answered' : 'pending';
    const entry: AnswerOverlayEntry = { status, value, source: 'manual' };
    setAnswerOverlay((prev) => ({ ...prev, [question.key]: entry }));
    scheduleSave(question.key, entry);

    // Auto-advance only for single-choice controls (boolean/enum render as a native
    // <select>, so onChange fires once per discrete choice). Text/number/image fields
    // advance on Enter instead (useWizardKeyboardNav) — auto-advancing on every keystroke
    // of a free-typed field would yank focus away mid-word.
    if (status === 'answered' && (question.type === 'boolean' || question.type === 'enum')) {
      const next = nextUnansweredKey(visibleQuestions, question.key);
      setCurrentKey(next ?? question.key);
    }
  };

  const handleStatusChange = (question: WizardQuestion, status: PlaceholderAnswerStatus) => {
    const value = status === 'not_applicable' ? '' : (question.currentAnswer?.value ?? '');
    if (status === 'not_applicable') {
      setFormData((prev) => { const next = { ...prev }; delete next[question.key]; return next; });
    }
    const source = question.currentAnswer?.source ?? 'manual';
    const entry: AnswerOverlayEntry = { status, value, source };
    setAnswerOverlay((prev) => ({ ...prev, [question.key]: entry }));
    scheduleSave(question.key, entry);

    // Marking a question not applicable is a completing action (like answering it), so
    // move on — unlike "answer", this button click can't fight a keystroke. Reverting it
    // back to pending ("Undo") is deliberately NOT advanced past — that's a correction,
    // not a forward step.
    if (status === 'not_applicable') {
      const next = nextUnansweredKey(visibleQuestions, question.key);
      setCurrentKey(next ?? question.key);
    }
  };

  /** Skip => explicit `pending`. A no-op when it's already pending (never answered yet). */
  const applyPendingOverlay = (q: WizardQuestion) => {
    if (!q.currentAnswer || q.currentAnswer.status === 'pending') return;
    const value = q.currentAnswer.value ?? '';
    const source = q.currentAnswer.source;
    const entry: AnswerOverlayEntry = { status: 'pending', value, source };
    setAnswerOverlay((prev) => ({ ...prev, [q.key]: entry }));
    scheduleSave(q.key, entry);
  };

  const advance = () => {
    if (!currentQuestion) return;
    const next = nextUnansweredKey(visibleQuestions, currentQuestion.key);
    setCurrentKey(next ?? currentQuestion.key);
  };

  const handleSkip = () => {
    if (!currentQuestion) return;
    applyPendingOverlay(currentQuestion);
    const next = nextUnansweredKey(visibleQuestions, currentQuestion.key);
    setCurrentKey(next ?? currentQuestion.key);
  };

  const handleSkipRestOfSection = () => {
    if (!currentQuestion) return;
    const sectionId = currentQuestion.sectionIds[0] ?? '__unsectioned__';
    const targets = visibleQuestions.filter((q) => (q.sectionIds[0] ?? '__unsectioned__') === sectionId && !isSettled(q));
    targets.forEach(applyPendingOverlay);
    const remaining = visibleQuestions.find((q) => (q.sectionIds[0] ?? '__unsectioned__') !== sectionId && !isSettled(q));
    setCurrentKey(remaining?.key ?? currentQuestion.key);
  };

  const handleSkipAllRemaining = () => {
    visibleQuestions.filter((q) => !isSettled(q)).forEach(applyPendingOverlay);
  };

  const handleFinish = async () => {
    flushAll();
    // Skipping every question still produces a draft: guarantee a project_ims row exists
    // even if nothing was ever answered.
    if (!resolvedProjectImId) await ensureProjectImId();
    onClose();
  };

  // ---- keyboard nav ---------------------------------------------------------------------
  // Conservative: AttributeInput doesn't expose its own upload-in-progress state to the
  // parent (and this wizard must not modify AttributeInput), so keyboard nav is disabled for
  // the whole time an image question is active, not just mid-upload — never risks fighting a
  // file picker / upload. Also disabled while this question's note is expanded.
  const keyboardEnabled = !!currentQuestion
    && currentQuestion.type !== 'image'
    && expandedNoteKey !== currentQuestion.key;

  useWizardKeyboardNav({
    containerRef,
    onAdvance: advance,
    onEscape: () => { void handleFinish(); },
    enabled: keyboardEnabled,
  });

  // ---- "open items" list (also feeds the wizard's own progress chip) --------------------
  const pendingItems: PendingItem[] = visibleQuestions
    .filter((q) => !isSettled(q))
    .map((q) => ({
      key: q.key,
      label: q.label,
      sectionTitle: sectionTitleById[q.sectionIds[0] ?? ''] ?? 'Other',
      tier: q.tier,
      scope: q.currentAnswer?.scope ?? (skuScope === 'project' ? 'project' : 'sku'),
      skuNumber: skuScope !== 'project' ? projectSkus.find((s) => s.id === skuScope)?.skuNumber : undefined,
      target: { pane: 'fill', anchor: fillAnchors.value(q.key) },
    }));

  const activeSectionId = currentQuestion?.sectionIds[0] ?? null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[80] flex items-stretch justify-center p-0 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) void handleFinish(); }}>
      <div
        ref={containerRef}
        className="bg-white w-full sm:max-w-6xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-200">
          <div className="flex items-center gap-2 min-w-0">
            <ListChecks size={18} className="text-indigo-600 shrink-0" />
            <h2 className="text-base font-bold text-gray-800 truncate">Guided intake — {template.name}</h2>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium ${
              completion.pct === 100 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-orange-700 border-amber-200'
            }`}>
              {completion.pct === 100 ? <CheckCircle size={12} /> : <Loader2 size={12} />}
              {completion.answered}/{completion.total} answered ({completion.pct}%)
            </div>
            <span className="hidden sm:inline text-[11px] text-gray-400">Esc to close</span>
            <button type="button" onClick={() => { void handleFinish(); }} className="text-gray-400 hover:text-gray-700">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Visible, non-blocking error toast — see commitAnswer/showAnswerError. */}
        {answerError && (
          <div
            role="alert"
            className="mx-5 mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            <span className="flex-1">{answerError}</span>
            <button type="button" onClick={() => setAnswerError(null)} className="text-red-400 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Left: section nav / open items */}
          <div className="w-56 shrink-0 border-r border-gray-100 overflow-y-auto p-3 hidden md:block">
            <button
              type="button"
              onClick={() => setShowOpenItems((s) => !s)}
              className="w-full text-left text-[11px] font-bold uppercase tracking-wide text-indigo-600 hover:text-indigo-800 mb-2 px-1"
            >
              {showOpenItems ? '← Back to chapters' : `View all open items (${pendingItems.length})`}
            </button>
            {showOpenItems ? (
              <OpenItemsList items={pendingItems} onJump={(key) => { setCurrentKey(key); setShowOpenItems(false); }} />
            ) : (
              <div className="space-y-1">
                {sectionGroups.map((group) => {
                  const openCount = group.questions.filter((q) => !isSettled(q)).length;
                  return (
                    <button
                      key={group.sectionId}
                      type="button"
                      onClick={() => setCurrentKey(group.questions[0]?.key ?? null)}
                      className={`w-full flex items-center justify-between gap-2 text-left px-2.5 py-2 rounded-lg text-sm ${
                        activeSectionId === group.sectionId ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-light'
                      }`}
                    >
                      <span className="truncate">{group.sectionTitle}</span>
                      {openCount > 0
                        ? <span className="shrink-0 text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">{openCount}</span>
                        : <CheckCircle size={13} className="text-emerald-500 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Center: the active question */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5">
            {loadingQuestions ? (
              <div className="flex items-center gap-2 text-gray-400 py-10 justify-center">
                <Loader2 size={16} className="animate-spin" /> Loading this manual's questions…
              </div>
            ) : !currentQuestion ? (
              <div className="text-center py-10">
                <CheckCircle size={28} className="text-emerald-500 mx-auto mb-2" />
                <p className="text-sm text-gray-600">
                  {visibleQuestions.length === 0
                    ? 'This template has no registered placeholders to ask about yet.'
                    : 'Every visible question is answered or marked not applicable.'}
                </p>
              </div>
            ) : (
              <QuestionPanel
                key={currentQuestion.key}
                question={currentQuestion}
                value={currentValue}
                onChange={(v) => handleAnswerChange(currentQuestion, v)}
                status={currentStatus}
                onStatusChange={(status) => handleStatusChange(currentQuestion, status)}
                noteExpanded={expandedNoteKey === currentQuestion.key}
                onToggleNote={() => setExpandedNoteKey((k) => (k === currentQuestion.key ? null : currentQuestion.key))}
              />
            )}
          </div>

          {/* Right: live preview */}
          <div className="w-full max-w-md shrink-0 border-l border-gray-100 hidden lg:block">
            <LivePreviewPane
              template={template}
              sections={sections}
              blocksById={blocksById}
              attributesById={attributesById}
              projectSkus={projectSkus}
              boundSkuIds={boundSkuIds}
              instance={instance}
              templateType={templateType}
              activeLang={activeLang}
              activeQuestion={currentQuestion}
              activeValue={currentValue}
              buildCandidateData={buildCandidateData}
            />
          </div>
        </div>

        {/* Footer */}
        <SkipControls
          onSkip={handleSkip}
          onSkipRestOfSection={handleSkipRestOfSection}
          onSkipAllRemaining={handleSkipAllRemaining}
          onFinish={() => { void handleFinish(); }}
          canFinish
        />
      </div>
    </div>
  );
};

export default PlaceholderIntakeWizard;
