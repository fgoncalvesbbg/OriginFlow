/**
 * Pure question-list helpers for the placeholder intake wizard (migrations 142/143).
 *
 * `computeVisibleQuestions` is re-run on every answer change rather than computed once:
 * a dependsOn gate (`wizard_depends_on_attribute_id`) can reveal a question the moment its
 * driver is answered, exactly like `requires_feature` already does for section/block
 * visibility elsewhere in this app (see `attribute-condition.utils.ts`). Registry order
 * guarantees a dependsOn never points forward (same invariant `requires_feature` relies on
 * for chapter visibility), so a single flat pass — no graph, no topological sort — is
 * enough (see the wizard plan, "Dependency-graph sequencing needs no graph library").
 */
import { PlaceholderAnswerStatus, WizardQuestion } from '../../../types';
import { passesFeatureGate } from '../../../utils/attribute-condition.utils';

/** Every question whose `condition` (if any) currently passes the shared feature gate. */
export const computeVisibleQuestions = (
  questions: WizardQuestion[],
  answers: Record<string, string>,
  conditions: Record<string, boolean | string>,
): WizardQuestion[] =>
  questions.filter((q) => !q.condition || passesFeatureGate(q.condition, answers, conditions));

/** Whether an answer status counts as "done" for progress/next-question purposes. */
const isSettled = (status: PlaceholderAnswerStatus | undefined): boolean =>
  status === 'answered' || status === 'not_applicable';

/**
 * The first VISIBLE question strictly after `currentKey` (or from the front of the list
 * when `currentKey` is null) whose current answer isn't settled yet. Deliberately does NOT
 * wrap back around to the start — the section nav and "Skip all remaining" cover jumping
 * anywhere else; this is only "what's the next thing to look at from here."
 */
export const nextUnansweredKey = (
  visible: WizardQuestion[],
  currentKey: string | null,
): string | null => {
  const startIndex = currentKey ? visible.findIndex((q) => q.key === currentKey) : -1;
  for (let i = startIndex + 1; i < visible.length; i++) {
    if (!isSettled(visible[i].currentAnswer?.status)) return visible[i].key;
  }
  return null;
};

export interface WizardCompletion {
  answered: number;
  total: number;
  /** Rounded percentage, 0-100. 100 for an empty visible list (nothing left to answer). */
  pct: number;
}

/** Progress against the CURRENTLY VISIBLE list, not a frozen initial count — a revealed
 *  dependent question grows the denominator the moment its gate opens. */
export const completionOf = (visible: WizardQuestion[]): WizardCompletion => {
  const total = visible.length;
  const answered = visible.filter((q) => isSettled(q.currentAnswer?.status)).length;
  return { answered, total, pct: total === 0 ? 100 : Math.round((answered / total) * 100) };
};

export interface WizardSectionGroup {
  sectionId: string;
  sectionTitle: string;
  questions: WizardQuestion[];
}

/**
 * Groups visible questions by chapter for the wizard's section nav.
 *
 * A question can reference more than one section (`sectionIds`, e.g. a bound spec token
 * repeated in two chapters) — it is grouped under the FIRST section id only. This is an
 * arbitrary but stable choice (registry/section authoring order), not a claim that the
 * question "belongs" to that section over the others; documented here rather than
 * silently duplicating the question into every section it touches, which would double-
 * count it in the progress nav.
 */
export const groupBySection = (
  visible: WizardQuestion[],
  sectionTitleById: Record<string, string>,
): WizardSectionGroup[] => {
  const groups: WizardSectionGroup[] = [];
  const bySectionId = new Map<string, WizardSectionGroup>();
  for (const q of visible) {
    const sectionId = q.sectionIds[0] ?? '__unsectioned__';
    let group = bySectionId.get(sectionId);
    if (!group) {
      group = { sectionId, sectionTitle: sectionTitleById[sectionId] ?? 'Other', questions: [] };
      bySectionId.set(sectionId, group);
      groups.push(group);
    }
    group.questions.push(q);
  }
  return groups;
};
