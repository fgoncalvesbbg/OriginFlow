import { describe, it, expect } from 'vitest';
import {
  conditionQuestionId,
  describeQuestionCondition,
  evaluateRequirementApplicability,
  isConditional,
  questionUsageCounts,
  questionsForRequirements,
} from './tcf-condition';
import type { ComplianceQuestion, ComplianceRequirement } from '../../types';

const q = (over: Partial<ComplianceQuestion> & { id: string; label: string }): ComplianceQuestion => ({
  dataType: 'boolean',
  options: [],
  sortOrder: 0,
  needsReview: false,
  ...over,
});

const req = (over: Partial<ComplianceRequirement> & { id: string; title: string }): ComplianceRequirement => ({
  categoryId: 'cat',
  assignedCategoryIds: [],
  description: '',
  isMandatory: true,
  appliesByDefault: true,
  ...over,
});

const RADIO = q({ id: 'radio', label: 'Does it transmit radio?', dataType: 'boolean' });
const POWER = q({ id: 'power', label: 'Rated power', dataType: 'number', unit: 'W', sortOrder: 1 });
const PLUG  = q({ id: 'plug', label: 'Plug type', dataType: 'enum', options: ['CEE 7/7', 'BS 1363'], sortOrder: 2 });
const QUESTIONS = [RADIO, POWER, PLUG];

const ALWAYS = req({ id: 'always', title: 'Test Report' });
const RED    = req({ id: 'red', title: 'RED Directive', condition: { requires_feature: 'radio', requires_feature_label: 'Yes' } });
const ERP    = req({ id: 'erp', title: 'Ecodesign', condition: { requires_feature: 'power', requires_feature_num_min: '10', requires_feature_num_max: '1500' } });

describe('conditionQuestionId / isConditional', () => {
  it('reads the id from either half of the condition', () => {
    expect(conditionQuestionId({ requires_feature: 'radio' })).toBe('radio');
    expect(conditionQuestionId({ requires_feature_absent: 'radio' })).toBe('radio');
  });

  it('treats an enabled-but-unset condition as ungated', () => {
    // The editor writes `{}` the moment the toggle flips on, before a question is picked.
    expect(conditionQuestionId({})).toBeNull();
    expect(isConditional(req({ id: 'x', title: 'x', condition: {} }))).toBe(false);
  });

  it('treats null and undefined as ungated', () => {
    expect(conditionQuestionId(null)).toBeNull();
    expect(conditionQuestionId(undefined)).toBeNull();
  });
});

describe('questionsForRequirements — asks only what is needed', () => {
  it('returns just the questions these requirements gate on', () => {
    expect(questionsForRequirements([ALWAYS, RED], QUESTIONS).map(x => x.id)).toEqual(['radio']);
  });

  it('does not ask a question nothing references, however many exist', () => {
    expect(questionsForRequirements([ALWAYS], QUESTIONS)).toEqual([]);
  });

  it('asks a shared question once, not once per requirement', () => {
    const other = req({ id: 'other', title: 'Other', condition: { requires_feature: 'radio' } });
    expect(questionsForRequirements([RED, other], QUESTIONS).map(x => x.id)).toEqual(['radio']);
  });

  it('returns them in library order so two runs ask in the same sequence', () => {
    expect(questionsForRequirements([ERP, RED], QUESTIONS).map(x => x.id)).toEqual(['radio', 'power']);
  });

  it('omits a referenced question that no longer exists — there is nothing to ask', () => {
    const ghost = req({ id: 'g', title: 'Ghost', condition: { requires_feature: 'deleted' } });
    expect(questionsForRequirements([ghost], QUESTIONS)).toEqual([]);
  });
});

describe('evaluateRequirementApplicability — the normal path', () => {
  it('includes an unconditional requirement that applies by default', () => {
    const r = evaluateRequirementApplicability([ALWAYS], QUESTIONS, {});
    expect(r.included.map(x => x.id)).toEqual(['always']);
    expect(r.verdicts[0].reason).toBe('unconditional');
  });

  it('excludes an unconditional requirement that does NOT apply by default', () => {
    const opt = req({ id: 'opt', title: 'Optional', appliesByDefault: false });
    expect(evaluateRequirementApplicability([opt], QUESTIONS, {}).included).toEqual([]);
  });

  it('includes a gated requirement when the answer matches', () => {
    const r = evaluateRequirementApplicability([RED], QUESTIONS, { radio: 'Yes' });
    expect(r.included.map(x => x.id)).toEqual(['red']);
    expect(r.verdicts[0].reason).toBe('condition-met');
  });

  it('excludes it when the answer does not match', () => {
    const r = evaluateRequirementApplicability([RED], QUESTIONS, { radio: 'No' });
    expect(r.included).toEqual([]);
    expect(r.verdicts[0].reason).toBe('condition-not-met');
  });

  it('honours a numeric range', () => {
    expect(evaluateRequirementApplicability([ERP], QUESTIONS, { power: '800' }).included).toHaveLength(1);
    expect(evaluateRequirementApplicability([ERP], QUESTIONS, { power: '5' }).included).toHaveLength(0);
    expect(evaluateRequirementApplicability([ERP], QUESTIONS, { power: '2000' }).included).toHaveLength(0);
  });

  it('does NOT consult appliesByDefault on a gated requirement — the gate is the decision', () => {
    // Both flags disagree on purpose: the gate must win, or one of the two is a lie.
    const gated = req({
      id: 'gated', title: 'Gated', appliesByDefault: false,
      condition: { requires_feature: 'radio', requires_feature_label: 'Yes' },
    });
    expect(evaluateRequirementApplicability([gated], QUESTIONS, { radio: 'Yes' }).included).toHaveLength(1);
  });
});

describe('evaluateRequirementApplicability — unanswered is not a verdict', () => {
  it('reports the question as unanswered and excludes for now', () => {
    const r = evaluateRequirementApplicability([RED], QUESTIONS, {});
    expect(r.unanswered.map(x => x.id)).toEqual(['radio']);
    expect(r.verdicts[0].reason).toBe('unanswered');
    expect(r.included).toEqual([]);
  });

  it('treats whitespace as unanswered', () => {
    expect(evaluateRequirementApplicability([RED], QUESTIONS, { radio: '   ' }).unanswered).toHaveLength(1);
  });

  it('does NOT call an `absent` gate unanswered — a blank IS the answer', () => {
    const absent = req({ id: 'a', title: 'Only without radio', condition: { requires_feature_absent: 'radio' } });
    const r = evaluateRequirementApplicability([absent], QUESTIONS, {});
    expect(r.unanswered).toEqual([]);
    expect(r.included.map(x => x.id)).toEqual(['a']);
    expect(r.verdicts[0].reason).toBe('condition-met');
  });

  it('excludes an `absent` gate once the question IS answered', () => {
    const absent = req({ id: 'a', title: 'Only without radio', condition: { requires_feature_absent: 'radio' } });
    expect(evaluateRequirementApplicability([absent], QUESTIONS, { radio: 'Yes' }).included).toEqual([]);
  });
});

// ── The rule this whole module exists for ────────────────────────────────────
describe('evaluateRequirementApplicability — an unresolvable condition FAILS OPEN', () => {
  it('INCLUDES a requirement whose question was deleted, and flags it', () => {
    // This is the bug that shipped: with the question (previously the attribute) gone, the
    // old gate read "answer absent", failed, and silently dropped a real legal obligation.
    const ghost = req({ id: 'g', title: 'RED Directive', condition: { requires_feature: 'deleted' } });
    const r = evaluateRequirementApplicability([ghost], QUESTIONS, {});
    expect(r.included.map(x => x.id)).toEqual(['g']);
    expect(r.verdicts[0].reason).toBe('question-missing');
    expect(r.unresolved).toHaveLength(1);
  });

  it('INCLUDES a requirement whose question still needs review, and flags it', () => {
    const unreviewed = q({ id: 'tbd', label: 'Needs review - presence condition', needsReview: true });
    const gated = req({ id: 'x', title: 'Energy Label', condition: { requires_feature: 'tbd' } });
    const r = evaluateRequirementApplicability([gated], [unreviewed], {});
    expect(r.included.map(x => x.id)).toEqual(['x']);
    expect(r.verdicts[0].reason).toBe('question-needs-review');
    expect(r.unresolved).toHaveLength(1);
  });

  it('includes it regardless of the answer given, so a needs-review gate cannot exclude', () => {
    const unreviewed = q({ id: 'tbd', label: 'Needs review', needsReview: true });
    const gated = req({
      id: 'x', title: 'Energy Label',
      condition: { requires_feature: 'tbd', requires_feature_label: 'Yes' },
    });
    expect(evaluateRequirementApplicability([gated], [unreviewed], { tbd: 'No' }).included).toHaveLength(1);
  });

  it('does not report a merely-unanswered question as unresolved', () => {
    // `unresolved` is "somebody must fix the library". Unanswered is "the wizard is not done".
    expect(evaluateRequirementApplicability([RED], QUESTIONS, {}).unresolved).toEqual([]);
  });

  it('keeps every verdict, included or not, so a UI can explain the whole set', () => {
    const r = evaluateRequirementApplicability([ALWAYS, RED, ERP], QUESTIONS, { radio: 'No', power: '800' });
    expect(r.verdicts).toHaveLength(3);
    expect(r.verdicts.map(v => v.reason))
      .toEqual(['unconditional', 'condition-not-met', 'condition-met']);
  });
});

describe('describeQuestionCondition', () => {
  it('names the question, not the id', () => {
    expect(describeQuestionCondition(RED.condition, QUESTIONS)).toBe('Does it transmit radio?: Yes');
  });

  it('renders a numeric range with the unit', () => {
    expect(describeQuestionCondition(ERP.condition, QUESTIONS)).toBe('Rated power: 10–1500 W');
  });

  it('renders open-ended bounds', () => {
    expect(describeQuestionCondition({ requires_feature: 'power', requires_feature_num_min: '10' }, QUESTIONS))
      .toBe('Rated power ≥ 10 W');
    expect(describeQuestionCondition({ requires_feature: 'power', requires_feature_num_max: '1500' }, QUESTIONS))
      .toBe('Rated power ≤ 1500 W');
  });

  it('lists multiple enum values', () => {
    expect(describeQuestionCondition(
      { requires_feature: 'plug', requires_feature_label: 'CEE 7/7, BS 1363' }, QUESTIONS,
    )).toBe('Plug type is one of CEE 7/7, BS 1363');
  });

  it('describes an absent gate', () => {
    expect(describeQuestionCondition({ requires_feature_absent: 'radio' }, QUESTIONS))
      .toBe('Does it transmit radio?: no');
  });

  it('SAYS the condition is broken rather than inventing a plausible sentence', () => {
    // The old attribute version rendered "attribute: has value" over a dangling id, which is
    // how a dead gate passed for a working one for weeks.
    expect(describeQuestionCondition({ requires_feature: 'deleted' }, QUESTIONS))
      .toBe('condition broken — its question was deleted');
  });

  it('returns null when there is no condition to describe', () => {
    expect(describeQuestionCondition(null, QUESTIONS)).toBeNull();
    expect(describeQuestionCondition({}, QUESTIONS)).toBeNull();
  });
});

describe('questionUsageCounts', () => {
  it('counts the requirements each question decides', () => {
    const other = req({ id: 'o', title: 'Other', condition: { requires_feature: 'radio' } });
    expect(questionUsageCounts([ALWAYS, RED, ERP, other])).toEqual({ radio: 2, power: 1 });
  });

  it('counts an absent gate too', () => {
    const absent = req({ id: 'a', title: 'A', condition: { requires_feature_absent: 'radio' } });
    expect(questionUsageCounts([absent])).toEqual({ radio: 1 });
  });
});
