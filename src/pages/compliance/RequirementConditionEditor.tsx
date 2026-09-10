/**
 * "This requirement only applies if…" — authored against a TCF QUESTION (migration 174).
 *
 * Replaces the version that picked a `category_attributes` row. Same `FeatureConditionFields`
 * shape on the wire (`passesFeatureGate` is id-agnostic), a different and library-owned thing
 * on the other end of the id. The reason is in the migration header: the attributes were all
 * deleted in Aug 2026 and every condition here has been dangling since.
 *
 * Two details are load-bearing rather than cosmetic:
 *
 *  - A BROKEN condition says so. If the referenced question is gone, this renders a warning
 *    instead of a plausible-looking "attribute: has value". The old wording made a dead gate
 *    look like a working one, which is exactly why nobody noticed for weeks.
 *
 *  - The boolean answer is stored as the literal strings "Yes"/"No", matching what the
 *    wizard's boolean input writes. The gate is a string comparison, so the author's side and
 *    the answerer's side have to agree on the vocabulary or the condition never matches.
 */

import React from 'react';
import { AlertTriangle, GitBranch, Plus } from 'lucide-react';
import type { ComplianceQuestion, FeatureConditionFields } from '../../types';

interface Props {
  condition: FeatureConditionFields | null;
  onChange: (next: FeatureConditionFields | null) => void;
  questions: ComplianceQuestion[];
  /** Opens the questions manager, so authoring a condition never dead-ends on a missing question. */
  onManageQuestions: () => void;
}

const RequirementConditionEditor: React.FC<Props> = ({
  condition, onChange, questions, onManageQuestions,
}) => {
  const enabled = condition != null;
  const mode: 'present' | 'absent' = condition?.requires_feature_absent ? 'absent' : 'present';
  const questionId = condition?.requires_feature ?? condition?.requires_feature_absent ?? '';
  const question = questions.find(q => q.id === questionId);
  const isBroken = !!questionId && !question;

  const selected = condition?.requires_feature_label
    ? condition.requires_feature_label.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  return (
    <div className="bg-light border border-gray-200 p-4 rounded-xl shadow space-y-4">
      <div className="flex items-center justify-between border-b pb-2 border-gray-200">
        <h4 className="font-bold text-sm text-gray-800 flex items-center gap-2">
          <GitBranch size={14} className="text-indigo-600" /> Conditional Applicability
        </h4>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
            checked={enabled}
            onChange={e => onChange(e.target.checked ? {} : null)}
          />
          <span className="text-xs font-medium text-gray-700">Only if a question is answered a certain way</span>
        </label>
      </div>

      {!enabled && (
        <p className="text-xs text-gray-500">
          This requirement always applies. Enable the toggle to gate it on a TCF question — the
          request wizard will ask it and decide.
        </p>
      )}

      {enabled && (
        <>
          {isBroken && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5 leading-relaxed flex gap-2">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                This condition points at a question that no longer exists, so it cannot be
                evaluated. The requirement is currently included in every request and flagged.
                Pick a question below to fix it.
              </span>
            </p>
          )}

          {questions.length === 0 && (
            <div className="text-xs text-gray-600 bg-white border border-gray-200 rounded-md p-3">
              <p>No TCF questions defined yet.</p>
              <button
                type="button"
                onClick={onManageQuestions}
                className="mt-2 inline-flex items-center gap-1.5 text-indigo-600 font-medium hover:underline"
              >
                <Plus size={13} /> Create the first question
              </button>
            </div>
          )}

          <div className="flex gap-2">
            {(['present', 'absent'] as const).map(m => (
              <button
                type="button"
                key={m}
                onClick={() => onChange(
                  m === 'absent'
                    ? { requires_feature_absent: questionId || undefined }
                    : { requires_feature: questionId || undefined },
                )}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  mode === m
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-gray-200 text-gray-500 hover:border-gray-400'
                }`}
              >
                {m === 'present' ? 'The answer matches' : 'The question is left unanswered'}
              </button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] font-bold text-muted uppercase">Question</label>
              <button
                type="button"
                onClick={onManageQuestions}
                className="text-[10px] font-medium text-indigo-600 hover:underline"
              >
                Manage questions
              </button>
            </div>
            <select
              className="w-full border rounded-lg p-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={question ? questionId : ''}
              onChange={e => onChange(
                mode === 'absent'
                  ? { requires_feature_absent: e.target.value }
                  : { requires_feature: e.target.value },
              )}
            >
              <option value="">— select a question —</option>
              {questions.map(q => (
                <option key={q.id} value={q.id}>
                  {q.label} ({q.dataType}){q.needsReview ? ' · needs review' : ''}
                </option>
              ))}
            </select>
            {question?.helpText && (
              <p className="text-[11px] text-muted mt-1">{question.helpText}</p>
            )}
          </div>

          {/* The expected answer. Only meaningful for `present` — an `absent` gate is
              satisfied by there being no answer at all, so there is nothing to compare. */}
          {mode === 'present' && question && (
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-2">
                {question.dataType === 'enum' ? 'Applies when the answer is any of'
                  : question.dataType === 'number' ? 'Applies when the answer is in range'
                  : question.dataType === 'boolean' ? 'Applies when the answer is'
                  : 'Applies when the answer is exactly'}
              </label>

              {question.dataType === 'enum' && (
                <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                  {question.options.length === 0 && (
                    <p className="text-xs text-amber-700 col-span-2">
                      This question has no options yet — add them under Manage questions.
                    </p>
                  )}
                  {question.options.map(opt => (
                    <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.includes(opt)}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...selected, opt]
                            : selected.filter(v => v !== opt);
                          onChange({
                            requires_feature: questionId,
                            requires_feature_label: next.length ? next.join(', ') : undefined,
                          });
                        }}
                        className="rounded text-indigo-600"
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              )}

              {question.dataType === 'number' && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Min"
                    value={condition?.requires_feature_num_min ?? ''}
                    onChange={e => onChange({
                      ...condition,
                      requires_feature: questionId,
                      requires_feature_num_min: e.target.value || undefined,
                    })}
                    className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-gray-400">–</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={condition?.requires_feature_num_max ?? ''}
                    onChange={e => onChange({
                      ...condition,
                      requires_feature: questionId,
                      requires_feature_num_max: e.target.value || undefined,
                    })}
                    className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {question.unit && <span className="text-xs text-gray-500">{question.unit}</span>}
                  <p className="sr-only">Leave a bound blank for an open-ended range.</p>
                </div>
              )}

              {question.dataType === 'boolean' && (
                <div className="flex gap-4">
                  {(['Yes', 'No'] as const).map(v => (
                    <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="reqCondBool"
                        value={v}
                        checked={(condition?.requires_feature_label ?? 'Yes') === v}
                        onChange={() => onChange({
                          requires_feature: questionId,
                          requires_feature_label: v,
                        })}
                        className="text-indigo-600"
                      />
                      {v}
                    </label>
                  ))}
                </div>
              )}

              {question.dataType === 'text' && (
                <input
                  type="text"
                  placeholder="Exact answer to match…"
                  value={condition?.requires_feature_label ?? ''}
                  onChange={e => onChange({
                    requires_feature: questionId,
                    requires_feature_label: e.target.value || undefined,
                  })}
                  className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RequirementConditionEditor;
