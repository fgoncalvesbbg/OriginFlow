import { describe, it, expect } from 'vitest';
import { completionOf, computeVisibleQuestions, groupBySection, nextUnansweredKey } from './wizard-questions.utils';
import type { PlaceholderAnswer, PlaceholderAnswerStatus, WizardQuestion } from '../../../types';

const answer = (status: PlaceholderAnswerStatus): PlaceholderAnswer => ({ status } as PlaceholderAnswer);

const q = (overrides: Partial<WizardQuestion> = {}): WizardQuestion => ({
  key: 'k1',
  origin: 'attribute',
  label: 'Label',
  type: 'text',
  tier: 'optional',
  sectionIds: ['sec-1'],
  currentAnswer: null,
  ...overrides,
});

describe('computeVisibleQuestions', () => {
  it('keeps every question with no condition', () => {
    const qs = [q({ key: 'a' }), q({ key: 'b' })];
    expect(computeVisibleQuestions(qs, {}, {})).toHaveLength(2);
  });

  it('hides a question whose dependsOn condition is not satisfied', () => {
    const qs = [q({ key: 'a', condition: { requires_feature: 'gate' } })];
    expect(computeVisibleQuestions(qs, {}, {})).toHaveLength(0);
    expect(computeVisibleQuestions(qs, { gate: 'true' }, {})).toHaveLength(1);
  });

  it('reveals a dependent question once its "must be absent" driver is cleared', () => {
    const qs = [q({ key: 'a', condition: { requires_feature_absent: 'gate' } })];
    expect(computeVisibleQuestions(qs, { gate: 'true' }, {})).toHaveLength(0);
    expect(computeVisibleQuestions(qs, {}, {})).toHaveLength(1);
  });
});

describe('nextUnansweredKey', () => {
  it('finds the first unanswered question from the start when currentKey is null', () => {
    const qs = [q({ key: 'a', currentAnswer: answer('answered') }), q({ key: 'b' }), q({ key: 'c' })];
    expect(nextUnansweredKey(qs, null)).toBe('b');
  });

  it('finds the first unanswered question strictly AFTER currentKey', () => {
    const qs = [q({ key: 'a' }), q({ key: 'b', currentAnswer: answer('not_applicable') }), q({ key: 'c' })];
    expect(nextUnansweredKey(qs, 'a')).toBe('c');
  });

  it('does not wrap around — returns null when nothing after currentKey is unanswered', () => {
    const qs = [q({ key: 'a' }), q({ key: 'b', currentAnswer: answer('answered') })];
    expect(nextUnansweredKey(qs, 'b')).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(nextUnansweredKey([], null)).toBeNull();
  });

  it('treats a pending answer as still unanswered', () => {
    const qs = [q({ key: 'a' }), q({ key: 'b', currentAnswer: answer('pending') })];
    expect(nextUnansweredKey(qs, 'a')).toBe('b');
  });
});

describe('completionOf', () => {
  it('counts answered + not_applicable as done, against the visible total', () => {
    const qs = [
      q({ key: 'a', currentAnswer: answer('answered') }),
      q({ key: 'b', currentAnswer: answer('not_applicable') }),
      q({ key: 'c' }),
    ];
    expect(completionOf(qs)).toEqual({ answered: 2, total: 3, pct: 67 });
  });

  it('reports 100% for an empty visible list', () => {
    expect(completionOf([])).toEqual({ answered: 0, total: 0, pct: 100 });
  });

  it('does not count a pending answer as done', () => {
    expect(completionOf([q({ currentAnswer: answer('pending') })])).toEqual({ answered: 0, total: 1, pct: 0 });
  });
});

describe('groupBySection', () => {
  it('groups by the FIRST sectionId a question references', () => {
    const qs = [
      q({ key: 'a', sectionIds: ['s1', 's2'] }),
      q({ key: 'b', sectionIds: ['s1'] }),
      q({ key: 'c', sectionIds: ['s2'] }),
    ];
    const groups = groupBySection(qs, { s1: 'Safety', s2: 'Cleaning' });
    expect(groups).toEqual([
      { sectionId: 's1', sectionTitle: 'Safety', questions: [qs[0], qs[1]] },
      { sectionId: 's2', sectionTitle: 'Cleaning', questions: [qs[2]] },
    ]);
  });

  it('falls back to a placeholder title for an unmapped section id', () => {
    const qs = [q({ key: 'a', sectionIds: ['unknown'] })];
    expect(groupBySection(qs, {})[0].sectionTitle).toBe('Other');
  });

  it('returns [] for an empty list', () => {
    expect(groupBySection([], {})).toEqual([]);
  });
});
