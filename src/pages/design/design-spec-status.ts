/**
 * The Design Spec workflow — one vocabulary for every surface that shows "where is this spec".
 *
 *   Backlog → In Progress → In Review → Final          (and Cancelled, from anywhere)
 *
 * These are the ONLY step names the UI may use: the board columns, the table's group
 * headings, the project tab's chip and the detail header all read from here. Two screens
 * describing the same spec with different words is the confusion this module exists to
 * prevent — the same rule, and the same reason, as src/pages/im/im-manual-status.ts.
 *
 * ONLY THE TWO ENDS ARE STORED. `design_specs.state` carries 'backlog' and 'cancelled'
 * because nothing in the data can imply either: a spec with no upload yet is indistinguishable
 * from one nobody has started, and "we abandoned this" is a decision, not a fact about files.
 * Everything between is DERIVED from things that already had to be true, so a step can never
 * disagree with the spec it describes and nobody can drag a card into a state the files do
 * not support.
 *
 * The derivation, strongest claim first:
 *
 *  1. `cancelled`   state = 'cancelled'. A decision, and it outranks everything — a cancelled
 *                   spec that also happens to have an issued final is still cancelled.
 *  2. `final`       finalVersionId is set. Issued and locked; the database refuses further
 *                   versions while it is.
 *  3. `backlog`     state = 'backlog'. Nothing uploaded yet.
 *  4. `in_review`   a live review round exists for the CURRENT version. Deliberately ABOVE
 *                   nothing else, but note what it is NOT above: `final`. Once the final is
 *                   issued the round is history, even if a link is somehow still live.
 *  5. `in_progress` everything else — a version exists, no live round. The "work the notes,
 *                   or upload the first draft" step.
 *
 * `unknown` is not a step. It exists for the one case where the round data failed to load,
 * because an error must never render as a healthy step.
 */

import type { DesignSpec, DesignSpecVersion } from '../../types/design-spec.types';

export type DesignSpecStatus =
  | 'backlog'
  | 'in_progress'
  | 'in_review'
  | 'final'
  | 'cancelled'
  | 'unknown';

/**
 * The round facts this module needs, as the shared review layer reports them.
 *
 * `null` means THE ROUND DATA DID NOT LOAD, and is not the same as "no round" — see
 * `unknown` above. Absent/undefined means the caller does not track rounds at all, in which
 * case the spec derives as if there were none rather than being reported as broken.
 */
export interface DesignSpecRoundInput {
  /** A minted, unrevoked review link exists for the current version. */
  hasLiveLink: boolean;
  /** Every live link has been submitted. False while any reviewer still holds the ball. */
  allSubmitted: boolean;
  /** Notes still to be handled. */
  openCount: number;
}

export interface DesignSpecStatusInput {
  state: DesignSpec['state'];
  finalVersionId: string | null;
  /** Newest first or oldest first does not matter; only emptiness and the max version do. */
  versions: readonly Pick<DesignSpecVersion, 'version' | 'kind'>[];
}

/** The current version number, or null when nothing has been uploaded. */
export const currentVersionOf = (
  versions: readonly Pick<DesignSpecVersion, 'version'>[],
): number | null =>
  versions.length === 0 ? null : Math.max(...versions.map(v => v.version));

/**
 * True while the current version is out with a reviewer.
 *
 * A round belongs to a VERSION here, unlike the IM where it belongs to the manual: uploading
 * v3 ends v2's round implicitly, because the caller looks up the round for the current
 * version and finds none.
 */
export const isInReview = (round: DesignSpecRoundInput | null | undefined): boolean =>
  !!round && round.hasLiveLink && !round.allSubmitted;

/** True once every live link on the current version has come back. */
export const isReviewClosed = (round: DesignSpecRoundInput | null | undefined): boolean =>
  !!round && round.hasLiveLink && round.allSubmitted;

export const designSpecStatusOf = (
  spec: DesignSpecStatusInput,
  round: DesignSpecRoundInput | null | undefined,
): DesignSpecStatus => {
  if (spec.state === 'cancelled') return 'cancelled';
  if (spec.finalVersionId) return 'final';
  if (spec.state === 'backlog') return 'backlog';
  // Round data was asked for and failed. Never render an error as a healthy step.
  if (round === null) return 'unknown';
  if (isInReview(round) || isReviewClosed(round)) return 'in_review';
  return 'in_progress';
};

export interface DesignSpecStatusMeta {
  label: string;
  /** Badge classes, following the project's tinted-pill status vocabulary. */
  classes: string;
  /** Group heading blurb: what this step means and what to do about it. */
  hint: string;
  /** True when the ball is in someone else's court — the designer is waiting, not working. */
  waiting?: boolean;
}

/**
 * Step colour is a MEANING, not decoration, and each hue is used for one meaning only —
 * the same five meanings as the IM board, so the two modules read the same way:
 *
 *   gray     nothing has started, or the status could not be determined
 *   amber    the design team has work to do
 *   sky      out with a reviewer, waiting
 *   emerald  finished — issued and locked
 *   rose     abandoned
 *
 * Every label is also carried in text (DESIGN.md's Color-Plus-Shape Rule), so the hue only
 * ever has to say which of those it is.
 */
export const DESIGN_SPEC_STATUS_META: Record<DesignSpecStatus, DesignSpecStatusMeta> = {
  backlog: {
    label: 'Backlog',
    classes: 'bg-gray-100 text-gray-600 border-gray-200',
    hint: 'Not started. Upload a draft to begin.',
  },
  in_progress: {
    label: 'In Progress',
    classes: 'bg-amber-100 text-amber-700 border-amber-200',
    hint: 'Being drafted, or the supplier’s notes are being worked. Send a review when ready.',
  },
  in_review: {
    label: 'In Review',
    classes: 'bg-sky-100 text-sky-700 border-sky-200',
    hint: 'Out with a reviewer. Turns green once every reviewer has submitted.',
    waiting: true,
  },
  final: {
    label: 'Final',
    classes: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    hint: 'Issued and locked. Unlock the spec before adding another version.',
  },
  cancelled: {
    label: 'Cancelled',
    classes: 'bg-rose-100 text-rose-700 border-rose-200',
    hint: 'Abandoned. The versions and the review history are kept for the record.',
  },
  unknown: {
    label: 'Status unknown',
    classes: 'bg-gray-100 text-gray-600 border-gray-200',
    hint: 'The review round could not be loaded — this may or may not be out with a reviewer.',
  },
};

/**
 * The workflow, in order. ONE order, used by the board columns, the table's groups and the
 * status filter alike — a board reading left-to-right and a table reading by urgency would
 * be two mental models of the same five steps.
 *
 * `unknown` trails the five because it is not a step; it appears only while the round data
 * is broken.
 */
export const DESIGN_SPEC_STATUS_ORDER: readonly DesignSpecStatus[] = [
  'backlog',
  'in_progress',
  'in_review',
  'final',
  'cancelled',
  'unknown',
];

/**
 * A review step means two different things to the design team and must not look the same:
 *
 *   sky      still out with the reviewer — nothing to do but wait
 *   emerald  every reviewer submitted; the round is CLOSED and the next step is unblocked
 *
 * "Closed" is the reviewers pressing Submit, and nothing else. Deliberately NOT "submitted
 * with zero open notes": triaging the notes is the design team's own work, so gating the
 * green on it would hide the one fact the board exists to surface — that the ball has come
 * back.
 */
export const designSpecStatusClasses = (
  status: DesignSpecStatus,
  round?: DesignSpecRoundInput | null,
): string => status === 'in_review' && isReviewClosed(round)
  ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
  : DESIGN_SPEC_STATUS_META[status].classes;

/** Badge text for any step. A closed review says so — "In Review · closed". */
export const designSpecStatusLabel = (
  status: DesignSpecStatus,
  round?: DesignSpecRoundInput | null,
): string => status === 'in_review' && isReviewClosed(round)
  ? 'In Review · closed'
  : DESIGN_SPEC_STATUS_META[status].label;

/**
 * The one-line "what do I do with this card" hint that turns the board into a work queue.
 * Deliberately quiet when there is nothing to do (null), and silent about what the badge
 * already says.
 */
export interface DesignSpecNextActionInput extends DesignSpecStatusInput {
  issuedAt?: string | null;
}

const daysSince = (iso: string, now: number): number =>
  Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));

const notesFragment = (open: number | null | undefined): string | null =>
  typeof open === 'number' && open > 0 ? `${open} open note${open === 1 ? '' : 's'}` : null;

export const designSpecNextAction = (
  spec: DesignSpecNextActionInput,
  round: DesignSpecRoundInput | null | undefined,
  sentAt?: string | null,
  now: number = Date.now(),
): string | null => {
  const status = designSpecStatusOf(spec, round);
  const version = currentVersionOf(spec.versions);

  switch (status) {
    case 'backlog':
      return 'no draft uploaded yet';
    case 'in_progress': {
      const notes = notesFragment(round?.openCount);
      if (notes) return `${notes} to handle, then upload the next version`;
      return version == null
        ? 'upload the first draft'
        : `v${version} uploaded — send it for review`;
    }
    case 'in_review': {
      if (isReviewClosed(round)) {
        const notes = notesFragment(round?.openCount);
        return `review closed${notes ? ` · ${notes}` : ''} — work the notes, then issue the final`;
      }
      const parts: string[] = [];
      if (sentAt) {
        const d = daysSince(sentAt, now);
        parts.push(d === 0 ? 'sent today' : `out ${d} day${d === 1 ? '' : 's'}`);
      }
      const notes = notesFragment(round?.openCount);
      if (notes) parts.push(notes);
      return parts.join(' · ') || null;
    }
    default:
      // final and cancelled are settled; unknown carries its own hint.
      return null;
  }
};

/**
 * Bucket specs by derived step, preserving the incoming order within each group and dropping
 * empty groups. The round lookup is passed in because it is loaded asynchronously for the
 * whole board rather than carried on the row.
 */
export const groupByDesignSpecStatus = <T extends DesignSpecStatusInput>(
  specs: readonly T[],
  round: (spec: T) => DesignSpecRoundInput | null | undefined,
): Array<{ status: DesignSpecStatus; items: T[] }> => {
  const buckets = new Map<DesignSpecStatus, T[]>();
  for (const spec of specs) {
    const status = designSpecStatusOf(spec, round(spec));
    const bucket = buckets.get(status);
    if (bucket) bucket.push(spec); else buckets.set(status, [spec]);
  }
  return DESIGN_SPEC_STATUS_ORDER
    .filter(status => buckets.has(status))
    .map(status => ({ status, items: buckets.get(status)! }));
};
