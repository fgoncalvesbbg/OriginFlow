/**
 * QuestionPanel — one wizard question: hint, field, pre-fill provenance, an expandable
 * note, and a "not applicable" toggle.
 *
 * Renders the field via the EXISTING `AttributeInput.tsx`, unmodified. An attribute-bound
 * question (`origin === 'attribute'`) passes its `CategoryAttribute` straight through; an
 * ad-hoc question (a template-authored `.im-placeholder` chip with no attribute binding)
 * gets a small synthetic `CategoryAttribute` shim so `AttributeInput` never has to learn
 * about a second question shape. Ad-hoc placeholders only ever carry `type: 'text' | 'image'`
 * (`im_adhoc_placeholders` schema, migration 143), so the shim only needs to choose between
 * those two `dataType`s.
 */
import React from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import AttributeInput from '../../../components/common/AttributeInput';
import { CategoryAttribute, PlaceholderAnswerSource, PlaceholderAnswerStatus, WizardQuestion } from '../../../types';
import { FILL_ANCHOR_ATTR, fillAnchors } from '../project-im-generator/publish-issues';

const SOURCE_LABELS: Record<Exclude<PlaceholderAnswerSource, 'manual'>, string> = {
  pim: 'PIM',
  eprel: 'EPREL',
  supplier: 'Supplier submission',
  carried_over: 'Existing value',
};

const adhocAttributeShim = (q: WizardQuestion): CategoryAttribute => ({
  id: q.key,
  categoryId: null,
  name: q.label,
  dataType: q.type === 'image' ? 'image' : 'text',
  validationRules: {},
});

interface QuestionPanelProps {
  question: WizardQuestion;
  value: string;
  onChange: (value: string) => void;
  status: PlaceholderAnswerStatus;
  onStatusChange: (status: PlaceholderAnswerStatus) => void;
  disabled?: boolean;
  /** Controlled from the wizard shell (not local state) — the shell needs to know a note
   *  is open so it can disable Enter-to-advance while it's expanded. */
  noteExpanded: boolean;
  onToggleNote: () => void;
}

const QuestionPanel: React.FC<QuestionPanelProps> = ({
  question, value, onChange, status, onStatusChange, disabled, noteExpanded, onToggleNote,
}) => {
  const attribute = question.attribute ?? adhocAttributeShim(question);
  const prefillSource = question.currentAnswer?.source;
  const showPrefillBadge = !!prefillSource && prefillSource !== 'manual';
  const notApplicable = status === 'not_applicable';

  return (
    <div {...{ [FILL_ANCHOR_ATTR]: fillAnchors.value(question.key) }} className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <label className="block text-sm font-bold text-gray-800">{question.label}</label>
        {question.tier === 'regulatory' && (
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded flex items-center gap-1">
            <AlertCircle size={11} /> Regulatory
          </span>
        )}
      </div>

      {/* Always-visible one-line hint, above the field. */}
      {question.hint && <p className="text-xs text-muted -mt-1.5">{question.hint}</p>}

      {showPrefillBadge && (
        <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded px-2 py-1">
          <Sparkles size={11} /> Pre-filled from {SOURCE_LABELS[prefillSource as Exclude<PlaceholderAnswerSource, 'manual'>]}
        </div>
      )}

      {/* Suggested default is shown, never auto-committed — the user has to explicitly
          accept it (a real onChange call) for it to become an answer. */}
      {!value && question.defaultValue && (
        <div className="flex items-center gap-2 text-[11px] text-gray-500 bg-light border border-gray-200 rounded px-2 py-1">
          <span className="flex-1 min-w-0 truncate">Suggested: {question.defaultValue}</span>
          <button
            type="button"
            onClick={() => onChange(question.defaultValue as string)}
            className="shrink-0 font-medium text-indigo-600 hover:text-indigo-800"
          >
            Use
          </button>
        </div>
      )}

      <AttributeInput
        attribute={attribute}
        value={value}
        onChange={onChange}
        mode="fixed"
        disabled={disabled || notApplicable}
      />

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onStatusChange(notApplicable ? 'pending' : 'not_applicable')}
          className="text-[11px] text-gray-400 hover:text-gray-600 underline"
        >
          {notApplicable ? 'Undo — mark as pending again' : 'Not applicable to this product'}
        </button>
        {status === 'answered' && <span className="text-[11px] font-medium text-emerald-600">Answered</span>}
      </div>

      {question.note && (
        <div>
          <button
            type="button"
            onClick={onToggleNote}
            className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
          >
            {noteExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {noteExpanded ? 'Hide guidance' : 'Show more guidance'}
          </button>
          {noteExpanded && (
            <p className="text-xs text-gray-600 mt-1 leading-relaxed bg-light border border-gray-100 rounded p-2">
              {question.note}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionPanel;
