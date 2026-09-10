/**
 * Deciding which conditional TCF requirements apply, and which questions have to be asked to
 * decide it (migration 174).
 *
 * Pure. No database, no React — because the rule below is the one piece of this feature that,
 * if it is quietly wrong, causes a supplier not to be asked for evidence somebody needed.
 *
 * ── THE FAILURE DIRECTION, which is the whole point of this module ──────────────────────
 *
 * A condition can be UNRESOLVABLE: its question was deleted, or it is still flagged
 * `needsReview`. The old behaviour, inherited from gating on category attributes, was that an
 * unresolvable condition read as "answer absent", the gate failed, and the requirement was
 * EXCLUDED — silently. That is exactly what happened when all 172 category attributes were
 * deleted in Aug 2026: three real obligations (RED, Energy Labelling, Ecodesign) stopped being
 * asked for on every Beverage Coolers request, with nothing anywhere saying so.
 *
 * So the rule is inverted here and stated once:
 *
 *   AN UNRESOLVABLE CONDITION INCLUDES THE REQUIREMENT, AND FLAGS IT.
 *
 * Over-asking a supplier is recoverable in one email. Under-asking is discovered by an
 * auditor. Every inclusion of that kind is reported in `unresolved` so the UI can say why,
 * rather than the operator having to notice an absence.
 *
 * An UNANSWERED condition is different from an unresolvable one: the question is fine, nobody
 * has answered it yet. That is what the wizard is for, and it is reported separately.
 */

import type { ComplianceQuestion, ComplianceRequirement, FeatureConditionFields } from '../../types';
import { passesFeatureGate } from '../../utils/attribute-condition.utils';

/** The answers captured by the wizard, keyed by question id. */
export type TcfAnswers = Record<string, string>;

/** The question id a condition gates on, or null when the condition gates on nothing. */
export const conditionQuestionId = (
  condition: FeatureConditionFields | null | undefined,
): string | null => {
  if (!condition) return null;
  return condition.requires_feature ?? condition.requires_feature_absent ?? null;
};

/** Whether a requirement is gated at all. An unset-but-enabled condition counts as ungated. */
export const isConditional = (req: Pick<ComplianceRequirement, 'condition'>): boolean =>
  conditionQuestionId(req.condition) !== null;

/**
 * The questions that must be asked to decide this set of requirements — and only those.
 *
 * "Only those" is the requirement the wizard lives or dies on: a wizard that asks the whole
 * question library to place three requirements will not be filled in honestly, and a
 * dishonestly filled wizard is worse than none. Returned in the library's own order so two
 * runs of the same wizard ask in the same sequence.
 *
 * A referenced question that no longer exists is NOT returned — there is nothing to ask —
 * and its requirement surfaces through `unresolved` instead.
 */
export const questionsForRequirements = (
  requirements: readonly Pick<ComplianceRequirement, 'condition'>[],
  questions: readonly ComplianceQuestion[],
): ComplianceQuestion[] => {
  const needed = new Set(
    requirements.map(r => conditionQuestionId(r.condition)).filter((id): id is string => !!id),
  );
  return questions
    .filter(q => needed.has(q.id))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
};

/** Why a requirement ended up in the set it did. */
export type ApplicabilityReason =
  /** No condition — it always applies. */
  | 'unconditional'
  /** Condition evaluated and passed. */
  | 'condition-met'
  /** Condition evaluated and failed. */
  | 'condition-not-met'
  /** Its question is unanswered, so the condition could not be evaluated yet. */
  | 'unanswered'
  /** Its question no longer exists. Included and flagged — never silently dropped. */
  | 'question-missing'
  /** Its question is still flagged `needsReview`. Included and flagged. */
  | 'question-needs-review';

export interface ApplicabilityVerdict {
  requirement: ComplianceRequirement;
  applies: boolean;
  reason: ApplicabilityReason;
  /** The question behind the verdict, when there is one and it still exists. */
  question: ComplianceQuestion | null;
}

export interface ApplicabilityResult {
  /** Everything that will be asked of the supplier. */
  included: ComplianceRequirement[];
  /** Every verdict, included or not — for a UI that explains the set rather than just showing it. */
  verdicts: ApplicabilityVerdict[];
  /**
   * Requirements included ONLY because their condition could not be evaluated
   * (`question-missing` / `question-needs-review`). These are the ones somebody has to fix in
   * the library; until then they are over-asked rather than dropped.
   */
  unresolved: ApplicabilityVerdict[];
  /** Questions that are referenced, exist, and have no answer yet — what the wizard must ask. */
  unanswered: ComplianceQuestion[];
}

/**
 * Evaluate a requirement set against a set of answers.
 *
 * `appliesByDefault` governs only the UNCONDITIONAL requirements, matching the behaviour every
 * screen already had: a requirement with no gate is included when it is marked as applying by
 * default. A gated requirement is decided by its gate; its `appliesByDefault` is not consulted,
 * because the gate IS the decision and consulting both would make one of them a lie.
 *
 * An unanswered question excludes its requirement — that is what "not yet decided" looks like
 * mid-wizard — but the caller is told via `unanswered`, and the wizard refuses to finish while
 * any remain. That is different from an UNRESOLVABLE condition, which includes and flags.
 */
export const evaluateRequirementApplicability = (
  requirements: readonly ComplianceRequirement[],
  questions: readonly ComplianceQuestion[],
  answers: TcfAnswers,
): ApplicabilityResult => {
  const questionById = new Map(questions.map(q => [q.id, q]));
  const verdicts: ApplicabilityVerdict[] = [];
  const unansweredIds = new Set<string>();

  for (const requirement of requirements) {
    const qid = conditionQuestionId(requirement.condition);

    if (!qid) {
      verdicts.push({
        requirement,
        applies: requirement.appliesByDefault !== false,
        reason: 'unconditional',
        question: null,
      });
      continue;
    }

    const question = questionById.get(qid) ?? null;

    // Unresolvable, both branches: include and flag. See the header — this is the rule.
    if (!question) {
      verdicts.push({ requirement, applies: true, reason: 'question-missing', question: null });
      continue;
    }
    if (question.needsReview) {
      verdicts.push({ requirement, applies: true, reason: 'question-needs-review', question });
      continue;
    }

    const answer = answers[qid];
    // An `absent` gate is SATISFIED by a blank answer, so "no answer" cannot mean "unanswered"
    // for it — leaving the box empty IS the answer. Only a `requires_feature` gate needs one.
    const needsAnAnswer = !!requirement.condition?.requires_feature;
    if (needsAnAnswer && !(answer ?? '').trim()) {
      unansweredIds.add(qid);
      verdicts.push({ requirement, applies: false, reason: 'unanswered', question });
      continue;
    }

    const met = passesFeatureGate(requirement.condition!, answers, {});
    verdicts.push({
      requirement,
      applies: met,
      reason: met ? 'condition-met' : 'condition-not-met',
      question,
    });
  }

  return {
    included: verdicts.filter(v => v.applies).map(v => v.requirement),
    verdicts,
    unresolved: verdicts.filter(
      v => v.reason === 'question-missing' || v.reason === 'question-needs-review',
    ),
    unanswered: questions.filter(q => unansweredIds.has(q.id)),
  };
};

/**
 * "Applies if …" in words, for the library row and the request detail.
 *
 * Replaces the old attribute-based description. Says so plainly when the question is gone
 * rather than rendering "attribute: has value" over a dangling id — the previous wording made
 * a broken gate look like a working one, which is how this went unnoticed for weeks.
 */
export const describeQuestionCondition = (
  condition: FeatureConditionFields | null | undefined,
  questions: readonly ComplianceQuestion[],
): string | null => {
  const qid = conditionQuestionId(condition);
  if (!qid || !condition) return null;

  const question = questions.find(q => q.id === qid);
  if (!question) return 'condition broken — its question was deleted';

  const name = question.label;
  if (condition.requires_feature_absent) return `${name}: no`;
  if (condition.requires_feature_label) {
    const values = condition.requires_feature_label.split(',').map(s => s.trim()).filter(Boolean);
    if (question.dataType === 'boolean') return `${name}: ${values[0] ?? 'yes'}`;
    return values.length > 1 ? `${name} is one of ${values.join(', ')}` : `${name}: ${values[0]}`;
  }

  const unit = question.unit ? ` ${question.unit}` : '';
  const { requires_feature_num_min: min, requires_feature_num_max: max } = condition;
  if (min && max) return `${name}: ${min}–${max}${unit}`;
  if (min) return `${name} ≥ ${min}${unit}`;
  if (max) return `${name} ≤ ${max}${unit}`;
  return `${name}: answered`;
};

/**
 * How many requirements each question decides. Shown beside a question in the library so
 * nobody edits or deletes one without seeing what depends on it.
 */
export const questionUsageCounts = (
  requirements: readonly Pick<ComplianceRequirement, 'condition'>[],
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const r of requirements) {
    const qid = conditionQuestionId(r.condition);
    if (qid) counts[qid] = (counts[qid] ?? 0) + 1;
  }
  return counts;
};
