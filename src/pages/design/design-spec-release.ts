/**
 * The Design Spec RELEASE STAGES — one vocabulary for every surface that names a version.
 *
 *   Internal Review  →  Initial Release  →  Final Release
 *
 * These are the only names the UI may use for a version: the upload picker, the version
 * rows, the viewer's switcher and compare headers, the board's version column, the stamp
 * printed on the reviewer's PDF and the supplier's own portal all read from here. This is
 * the same rule, and the same reason, as `design-spec-status.ts` next door — two screens
 * describing the same file with different words is the confusion this module prevents.
 *
 * WHAT EACH STAGE MEANS, and it is a rule and not a hint:
 *
 *   internal  Ours only. The pass we make before the supplier has ever seen the spec.
 *             A version at this stage can NEVER be published to a supplier's portal —
 *             `review_shares.supplier_id` is refused on it by a trigger (migration 171),
 *             not merely hidden here.
 *   initial   The first version the supplier sees. Their comments land against this one.
 *   final     The version that applies those comments. Only a Final Release may be ISSUED,
 *             and issuing is what locks the spec.
 *
 * FORWARD ONLY. A spec never walks back down this list: once an Initial Release exists, an
 * "Internal Review v.02" would claim the supplier has not seen the spec yet, which is false.
 * Re-checking work internally is done with a review LINK on the current version instead.
 * `allowedStagesFor` is what the picker offers; the database refuses the rest regardless.
 *
 * TWO NUMBERS, AND THEY ARE NOT THE SAME NUMBER.
 *
 *   version   the spec-wide upload counter — v1, v2, v3, never reused. This is the IDENTITY
 *             of a version and it is what the review layer pins notes to
 *             (`review_comments.subject_version`), what the compare view orders panes by,
 *             and what a ghost pin is matched on. It is not shown as a headline any more,
 *             but it has not gone anywhere.
 *   revision  the count WITHIN a stage — "Final Release v.02" is the second final.
 *
 * So one row is both "v7" and "Final Release v.02" at once. Both are assigned server-side in
 * the same insert, so they cannot disagree.
 */

import type { DesignSpecStage, DesignSpecVersion } from '../../types/design-spec.types';

export type { DesignSpecStage };

/** The workflow, in order. Index+1 is the stage's rank — mirrors `design_spec_stage_rank`. */
export const DESIGN_SPEC_STAGE_ORDER: readonly DesignSpecStage[] = [
  'internal',
  'initial',
  'final',
];

export interface DesignSpecStageMeta {
  /** The business name. Mirrors `design_spec_stage_label()` in the database, exactly. */
  label: string;
  /** The name with the revision left to follow it — "Initial", as in "Initial v.02". */
  short: string;
  /** Badge classes, following the project's tinted-pill vocabulary. */
  classes: string;
  /** One line: what this stage is for. Shown under the upload picker. */
  hint: string;
  /**
   * May a version at this stage be published in the supplier's portal?
   *
   * False for `internal` — and the UI honouring this is a convenience, not the guarantee.
   * The guarantee is `trg_review_shares_internal_stage` in migration 171.
   */
  supplierVisible: boolean;
  /** Is the reviewer's copy stamped, and what does the stamp say? */
  stamp: { banner: string; watermark: string } | null;
}

/**
 * Stage colour is a MEANING and not decoration, and the meanings here are about REACH —
 * deliberately a different question from the board's five statuses, which are about
 * PROGRESS. The two badges sit next to each other, so they must not be read as the same
 * scale:
 *
 *   gray     inside the building only
 *   indigo   the supplier has it, and is commenting on it
 *   emerald  the released document — the same green the Final status uses, because it is
 *            the same fact
 *
 * Every label is carried in text as well (DESIGN.md's Color-Plus-Shape Rule).
 */
export const DESIGN_SPEC_STAGE_META: Record<DesignSpecStage, DesignSpecStageMeta> = {
  internal: {
    label: 'Internal Review',
    short: 'Internal',
    classes: 'bg-gray-100 text-gray-700 border-gray-200',
    hint: 'Ours only — the pass before the supplier has ever seen it. It can never appear in a supplier portal.',
    supplierVisible: false,
    stamp: { banner: 'INTERNAL REVIEW', watermark: 'INTERNAL' },
  },
  initial: {
    label: 'Initial Release',
    short: 'Initial',
    classes: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    hint: 'The first version the supplier sees. Their comments land against this one.',
    supplierVisible: true,
    stamp: { banner: 'INITIAL RELEASE', watermark: 'DRAFT' },
  },
  final: {
    label: 'Final Release',
    short: 'Final',
    classes: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    hint: 'The version applying the supplier’s comments. Served exactly as you made it, and issuing it locks the spec.',
    supplierVisible: true,
    // Not stamped, by design: a Final Release IS the released document, and the whole point
    // of the stamp is to say "this one is not it yet".
    stamp: null,
  },
};

/** Position in the workflow, 1-based. Mirrors `design_spec_stage_rank()`. */
export const stageRank = (stage: DesignSpecStage): number =>
  DESIGN_SPEC_STAGE_ORDER.indexOf(stage) + 1;

/**
 * The revision, as it is written everywhere: `v.01`, `v.02`, `v.10`.
 *
 * Two digits because that is how the design team writes it, and because zero-padding keeps a
 * column of them aligned. Past 99 it simply grows rather than truncating.
 */
export const formatRevision = (revision: number): string =>
  `v.${String(Math.max(1, Math.trunc(revision))).padStart(2, '0')}`;

/** The full name: `Initial Release v.02`. */
export const releaseLabel = (v: Pick<DesignSpecVersion, 'stage' | 'revision'>): string =>
  `${DESIGN_SPEC_STAGE_META[v.stage].label} ${formatRevision(v.revision)}`;

/** The short name for a badge or a table cell: `Initial v.02`. */
export const releaseShort = (v: Pick<DesignSpecVersion, 'stage' | 'revision'>): string =>
  `${DESIGN_SPEC_STAGE_META[v.stage].short} ${formatRevision(v.revision)}`;

/** The furthest stage this spec has reached, or null when nothing is uploaded. */
export const highestStage = (
  versions: readonly Pick<DesignSpecVersion, 'stage'>[],
): DesignSpecStage | null => versions.reduce<DesignSpecStage | null>(
  (best, v) => best == null || stageRank(v.stage) > stageRank(best) ? v.stage : best,
  null,
);

/**
 * The stages the next upload may use — the current one and everything after it.
 *
 * Never empty: a spec already at Final Release can still add another Final Release, which is
 * what "Final Release v.02" is.
 */
export const allowedStagesFor = (
  versions: readonly Pick<DesignSpecVersion, 'stage'>[],
): DesignSpecStage[] => {
  const highest = highestStage(versions);
  if (highest == null) return [...DESIGN_SPEC_STAGE_ORDER];
  return DESIGN_SPEC_STAGE_ORDER.filter(s => stageRank(s) >= stageRank(highest));
};

/**
 * The revision the next upload at `stage` will get.
 *
 * Computed on the client only so the stamp can be printed BEFORE the row exists — the
 * database assigns the real number in the same insert, exactly as it does for `version`, and
 * the unique constraint is what settles a race. A stamp one number out is a cosmetic loss on
 * a losing upload; letting the client own the number would be a correctness one.
 */
export const nextRevisionFor = (
  versions: readonly Pick<DesignSpecVersion, 'stage' | 'revision'>[],
  stage: DesignSpecStage,
): number => versions.reduce(
  (max, v) => v.stage === stage && v.revision > max ? v.revision : max,
  0,
) + 1;

/**
 * The release name of the version carrying upload number `n`.
 *
 * For the places that hold a bare `version` number rather than a row — a note's
 * `subjectVersion`, a triage verdict's `checkedSubjectVersion`. Falls back to `v7` when the
 * version is not in the list, which happens for a note written against a version the caller
 * did not load; a wrong name would be worse than an honest number.
 */
export const releaseShortByNumber = (
  versions: readonly Pick<DesignSpecVersion, 'version' | 'stage' | 'revision'>[],
  n: number | null | undefined,
): string => {
  if (n == null) return 'an earlier version';
  const found = versions.find(v => v.version === n);
  return found ? releaseShort(found) : `v${n}`;
};
