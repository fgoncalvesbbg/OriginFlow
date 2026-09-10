/**
 * The TCF question wizard (migration 174).
 *
 * Opens when a PM creates a compliance request, asks ONLY the questions the candidate
 * requirements actually gate on, and then shows the requirement set those answers produce
 * before anything is sent.
 *
 * ── WHY ONE QUESTION PER STEP ────────────────────────────────────────────────────────────
 * A grid of eight fields gets skimmed and half-filled; these answers decide what a supplier is
 * legally asked to provide, so the wizard trades clicks for attention. Each step shows the
 * question, its guidance, and — this is the part that makes it feel worth answering — which
 * requirements hang on it.
 *
 * ── WHY IT ENDS ON A REVIEW STEP ─────────────────────────────────────────────────────────
 * The last step is the formulated set: what will be asked, what was excluded and by which
 * answer, and anything included because its condition could not be evaluated. The PM is
 * accountable for that list, so they see it before it exists, not afterwards in a detail view.
 *
 * The wizard never writes. It hands back answers plus the requirement ids, and
 * `CreateComplianceRequest` freezes both onto the request — so the set the supplier sees is
 * the set shown here, even if the library changes tomorrow.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, HelpCircle, Loader2,
  ListChecks, X, XCircle,
} from 'lucide-react';
import {
  evaluateRequirementApplicability, getComplianceQuestionsOrThrow, questionsForRequirements,
} from '../../services';
import type { ApplicabilityVerdict, TcfAnswers } from '../../services';
import type { ComplianceQuestion, ComplianceRequirement } from '../../types';

interface Props {
  /** Every requirement that reaches the chosen category (owned, global and shared). */
  candidates: ComplianceRequirement[];
  categoryName: string;
  /** Answers to start from, so re-opening the wizard does not discard what was typed. */
  initialAnswers?: TcfAnswers;
  onClose: () => void;
  onComplete: (result: { answers: TcfAnswers; requirementIds: string[] }) => void;
}

/** Whether an answer counts as given. A blank string is not an answer. */
const isAnswered = (v: string | undefined): boolean => !!(v ?? '').trim();

const AnswerInput: React.FC<{
  question: ComplianceQuestion;
  value: string;
  onChange: (v: string) => void;
}> = ({ question, value, onChange }) => {
  if (question.dataType === 'boolean') {
    // "Yes"/"No" as stored values, matching what the condition editor writes into
    // `requires_feature_label` — the gate is a string comparison, so the two must agree.
    return (
      <div className="flex gap-3">
        {['Yes', 'No'].map(v => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`flex-1 py-3 rounded-lg border-2 font-medium text-sm transition-colors ${
              value === v
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 hover:border-gray-300 text-gray-600'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    );
  }

  if (question.dataType === 'enum') {
    return (
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {question.options.length === 0 && (
          <p className="text-xs text-rose-600">
            This question has no options defined yet. Add them in the TCF Questions library.
          </p>
        )}
        {question.options.map(opt => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border-2 text-sm transition-colors ${
              value === opt
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-medium'
                : 'border-gray-200 hover:border-gray-300 text-gray-700'
            }`}
          >
            {value === opt && <Check size={13} className="inline mr-1.5" />}
            {opt}
          </button>
        ))}
      </div>
    );
  }

  if (question.dataType === 'number') {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Enter a value…"
          className="flex-1 border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {question.unit && <span className="text-sm text-muted font-medium">{question.unit}</span>}
      </div>
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Type the answer…"
      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
    />
  );
};

const VerdictRow: React.FC<{ verdict: ApplicabilityVerdict }> = ({ verdict }) => {
  const { requirement, applies, reason, question } = verdict;
  const why = (() => {
    switch (reason) {
      case 'unconditional':          return 'always applies';
      case 'condition-met':          return question ? `${question.label} — matched` : 'condition met';
      case 'condition-not-met':      return question ? `${question.label} — did not match` : 'condition not met';
      case 'question-missing':       return 'its question was deleted — included to be safe';
      case 'question-needs-review':  return 'its question still needs review — included to be safe';
      case 'unanswered':             return 'unanswered';
    }
  })();
  const flagged = reason === 'question-missing' || reason === 'question-needs-review';

  return (
    <li className="flex items-start gap-2.5 py-1.5">
      {applies
        ? <CheckCircle2 size={14} className={`mt-0.5 flex-shrink-0 ${flagged ? 'text-amber-500' : 'text-emerald-500'}`} />
        : <XCircle size={14} className="mt-0.5 flex-shrink-0 text-gray-300" />}
      <div className="min-w-0">
        <span className={`text-sm ${applies ? 'text-primary font-medium' : 'text-gray-400 line-through'}`}>
          {requirement.title}
        </span>
        <span className={`block text-[11px] ${flagged ? 'text-amber-700' : 'text-muted'}`}>{why}</span>
      </div>
    </li>
  );
};

const TcfQuestionWizard: React.FC<Props> = ({
  candidates, categoryName, initialAnswers, onClose, onComplete,
}) => {
  const [questions, setQuestions] = useState<ComplianceQuestion[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<TcfAnswers>(initialAnswers ?? {});
  const [step, setStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Non-degrading: with an empty question list every conditional requirement would resolve
    // as "question deleted" and be included with a warning. That direction is safe but it
    // would turn a network blip into a request full of spurious obligations, so this fails
    // loudly instead of quietly over-asking.
    getComplianceQuestionsOrThrow()
      .then(qs => { if (!cancelled) setQuestions(qs); })
      .catch(err => { if (!cancelled) setLoadError(err?.message ?? 'Could not load the TCF questions.'); });
    return () => { cancelled = true; };
  }, []);

  /** Only the questions these requirements actually gate on. */
  const asked = useMemo(
    () => (questions ? questionsForRequirements(candidates, questions) : []),
    [candidates, questions],
  );

  const result = useMemo(
    () => (questions
      ? evaluateRequirementApplicability(candidates, questions, answers)
      : null),
    [candidates, questions, answers],
  );

  /** Which requirements hang on the question being asked — the reason to answer carefully. */
  const dependents = useMemo(() => {
    const q = asked[step];
    if (!q) return [];
    return candidates.filter(r =>
      (r.condition?.requires_feature ?? r.condition?.requires_feature_absent) === q.id);
  }, [asked, step, candidates]);

  if (loadError) {
    return (
      <Shell onClose={onClose} categoryName={categoryName}>
        <div className="p-6">
          <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-3">
            {loadError}
          </p>
        </div>
      </Shell>
    );
  }

  if (!questions || !result) {
    return (
      <Shell onClose={onClose} categoryName={categoryName}>
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading questions…
        </div>
      </Shell>
    );
  }

  const onReview = step >= asked.length;
  const current = asked[step];
  const total = asked.length + 1; // + the review step

  // An `absent`-only gate is satisfied by a blank, so leaving it empty IS an answer. Only a
  // question that some requirement gates on POSITIVELY has to be filled in to move on.
  const mustAnswerCurrent = !!current && candidates.some(
    r => r.condition?.requires_feature === current.id);
  const canAdvance = !mustAnswerCurrent || isAnswered(answers[current?.id ?? '']);

  const finish = () => onComplete({
    answers: Object.fromEntries(
      // Only answers to questions that were actually asked. A stale answer to a question no
      // requirement gates on any more would sit in the record implying it mattered.
      asked.filter(q => isAnswered(answers[q.id])).map(q => [q.id, answers[q.id].trim()]),
    ),
    requirementIds: result.included.map(r => r.id),
  });

  return (
    <Shell onClose={onClose} categoryName={categoryName}>
      {/* Progress */}
      <div className="px-6 pt-4">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < step ? 'bg-indigo-600' : i === step ? 'bg-indigo-400' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
        <p className="text-[11px] text-muted mt-1.5">
          {onReview ? 'Review' : `Question ${step + 1} of ${asked.length}`}
        </p>
      </div>

      <div className="overflow-y-auto flex-1 px-6 py-5">
        {/* No questions at all — nothing is conditional here, so say so and let them through
            rather than showing an empty wizard that looks broken. */}
        {asked.length === 0 && !onReview && (
          <div className="text-center py-10">
            <ListChecks size={28} className="mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-gray-600 font-medium">No questions needed</p>
            <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
              None of this category's requirements are conditional, so all of them apply.
              Continue to review the set.
            </p>
          </div>
        )}

        {current && (
          <div className="space-y-4">
            <div>
              <h4 className="text-base font-bold text-primary leading-snug">{current.label}</h4>
              {current.helpText && (
                <p className="text-xs text-muted mt-1.5 leading-relaxed flex gap-1.5">
                  <HelpCircle size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{current.helpText}</span>
                </p>
              )}
              {current.needsReview && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 mt-2 leading-relaxed">
                  This question has not been reviewed since it was migrated, so the
                  requirements below are included regardless of your answer. Someone should
                  re-word it in the TCF Questions library.
                </p>
              )}
            </div>

            <AnswerInput
              question={current}
              value={answers[current.id] ?? ''}
              onChange={v => setAnswers(prev => ({ ...prev, [current.id]: v }))}
            />

            {dependents.length > 0 && (
              <div className="bg-light border border-gray-200 rounded-lg p-3">
                <p className="text-[10px] font-bold text-muted uppercase tracking-wide mb-1.5">
                  This decides {dependents.length} requirement{dependents.length !== 1 ? 's' : ''}
                </p>
                <ul className="text-xs text-gray-600 space-y-0.5">
                  {dependents.map(r => <li key={r.id}>· {r.title}</li>)}
                </ul>
              </div>
            )}

            {!mustAnswerCurrent && (
              <p className="text-[11px] text-gray-400">
                Optional — leave it blank if the product does not have this.
              </p>
            )}
          </div>
        )}

        {onReview && (
          <div className="space-y-4">
            <div>
              <h4 className="text-base font-bold text-primary">
                {result.included.length} requirement{result.included.length !== 1 ? 's' : ''} will be requested
              </h4>
              <p className="text-xs text-muted mt-0.5">
                This is the exact set the supplier will see. It is frozen onto the request, so
                later changes to the library will not alter it.
              </p>
            </div>

            {result.unresolved.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-900 leading-relaxed">
                  <strong>{result.unresolved.length} requirement{result.unresolved.length !== 1 ? 's' : ''}</strong>{' '}
                  {result.unresolved.length !== 1 ? 'are' : 'is'} included because their condition
                  could not be evaluated — the question was deleted or still needs review.
                  Asking for one document too many is safer than missing one, but the library
                  should be fixed.
                </p>
              </div>
            )}

            <ul className="divide-y divide-slate-100 border border-gray-200 rounded-lg px-3 py-1">
              {result.verdicts.map(v => <VerdictRow key={v.requirement.id} verdict={v} />)}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 bg-white flex-shrink-0">
        <button
          type="button"
          onClick={step === 0 ? onClose : () => setStep(s => s - 1)}
          className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md font-medium flex items-center gap-1.5"
        >
          <ArrowLeft size={14} /> {step === 0 ? 'Cancel' : 'Back'}
        </button>

        {onReview ? (
          <button
            type="button"
            onClick={finish}
            className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium shadow flex items-center gap-2"
          >
            <Check size={14} /> Use these {result.included.length} requirements
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep(s => s + 1)}
            disabled={!canAdvance}
            className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-sm font-medium shadow flex items-center gap-2"
          >
            {step === asked.length - 1 || asked.length === 0 ? 'Review' : 'Next'} <ArrowRight size={14} />
          </button>
        )}
      </div>
    </Shell>
  );
};

const Shell: React.FC<{ categoryName: string; onClose: () => void; children: React.ReactNode }> = ({
  categoryName, onClose, children,
}) => (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
    <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
      <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-4 flex-shrink-0">
        <div>
          <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
            <ListChecks size={18} className="text-indigo-600" /> Which requirements apply?
          </h3>
          <p className="text-xs text-muted mt-0.5">{categoryName}</p>
        </div>
        <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full" title="Cancel">
          <X size={18} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

export default TcfQuestionWizard;
