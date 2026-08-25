/**
 * Derived display status for a project manual in the All Manuals overview.
 *
 * The stored state is two independent things — `status` ('draft' | 'generated') and
 * `isFinalized` — plus a third computed elsewhere (staleness: published output no longer
 * matches its sources). The overview needs ONE mutually-exclusive status per row so it can
 * badge it and group by it, which means committing to a precedence.
 *
 * Precedence, strongest claim first:
 *
 *  1. `final`           signed off and locked. Overrides everything: once a PM marks a manual
 *                       final, that is the fact about it that matters most.
 *  2. `needs_republish`  published, but a template or shared block changed since. The only
 *                       status that implies an action, so it outranks plain `published`.
 *  3. `in_review`        published and up to date, and the current version is out with a
 *                       supplier collecting feedback (see IMReviewPortal). Below
 *                       `needs_republish` on purpose: if the sources drifted, the manual
 *                       being reviewed is already outdated — the more actionable fact.
 *  4. `published`        published and up to date.
 *  5. `draft`            never published — or published, then edited again ("in progress"):
 *                       a draft save flips the stored status back to 'draft', which is also
 *                       what ends `in_review` when editing resumes.
 *
 * A final manual can also be stale; the row keeps showing the "Needs re-publish" chip as a
 * secondary signal, it just groups under Final.
 */

export type ManualStatus = 'final' | 'needs_republish' | 'unknown' | 'review_done' | 'in_review' | 'published' | 'draft';

/** The fields this module needs. Kept structural so tests don't build a whole summary. */
export interface ManualStatusInput {
  status: 'draft' | 'generated';
  isFinalized: boolean;
  /** Publish counter + supplier review round (migration 111 columns, stamped by
   *  setProjectIMReviewRequested). Optional: rows that predate the feature (or callers
   *  that don't track reviews) derive as before. */
  version?: number | null;
  reviewRequestedAt?: string | null;
  reviewVersion?: number | null;
  /**
   * Whether the round is finished: the reviewer submitted AND nothing is still outstanding.
   * Derived from im_shares.submitted_at and the open note count (see getReviewRoundsByManual),
   * not stored on the manual. Null/absent = unknown, which reads as still in review.
   */
  reviewDone?: boolean | null;
}

/**
 * True while the manual's CURRENT published version is out with a supplier for review.
 * Editing (stored status back to 'draft') or republishing (version bump past
 * reviewVersion) ends it implicitly — nothing is ever cleared. A null reviewVersion
 * (a legacy round without a stamped version) counts as current.
 */
export const isInReview = (
  im: Pick<ManualStatusInput, 'status' | 'version' | 'reviewRequestedAt' | 'reviewVersion'>,
): boolean =>
  im.status === 'generated' &&
  im.reviewRequestedAt != null &&
  (im.reviewVersion == null || im.version == null || im.reviewVersion === im.version);

/**
 * `isStale`: true = out of date, false = up to date, null = THE CHECK FAILED. The null
 * case exists so a failed staleness check renders as "Status unknown" instead of a green
 * "Published" — an error must never be displayed as a clean bill of health.
 */
export const manualStatusOf = (im: ManualStatusInput, isStale: boolean | null): ManualStatus => {
  if (im.isFinalized) return 'final';
  if (im.status === 'generated') {
    if (isStale === null) return 'unknown';
    if (isStale) return 'needs_republish';
    // The review round splits by its outcome: submitted with nothing outstanding → the next
    // action is sign-off; anything else → still waiting on reviewers or on the PM's triage.
    if (isInReview(im)) return im.reviewDone ? 'review_done' : 'in_review';
    return 'published';
  }
  return 'draft';
};

/**
 * Derived display status for the PRINTED IM (the project's language-subset print run,
 * shipped with the product) — reuses the exact same `ManualStatus` vocabulary as
 * `manualStatusOf` above, so the badge/group UI doesn't need a second set of colors/labels.
 *
 * The Printed IM is not a separate document with its own sign-off: it is the Digital IM's
 * own content, exported for fewer languages, so there is nothing to lock independently.
 * "Final" is therefore fully DERIVED, never a stored flag: the Digital IM itself is final
 * AND a print PDF exists for exactly the currently-selected printed languages AND that PDF
 * matches the manual's current version. `hasRender` = such a PDF exists at all; `isStale`
 * mirrors the Digital IM's own staleness check (null = check failed/unknown).
 */
export const printedManualStatusOf = (
  digitalIsFinalized: boolean,
  hasRender: boolean,
  isStale: boolean | null,
): ManualStatus => {
  if (!hasRender) return 'draft';
  if (isStale === null) return 'unknown';
  if (isStale) return 'needs_republish';
  return digitalIsFinalized ? 'final' : 'published';
};

export type StatusTone = 'indigo' | 'emerald' | 'amber' | 'orange';

export interface ManualStatusMeta {
  label: string;
  /** Badge classes, following the project's tinted-pill status vocabulary. */
  classes: string;
  /** Group heading blurb: what this group means and what to do about it. */
  hint: string;
}

export const MANUAL_STATUS_META: Record<ManualStatus, ManualStatusMeta> = {
  needs_republish: {
    label: 'Needs re-publish',
    classes: 'bg-orange-100 text-orange-700 border-orange-200',
    hint: 'A template or shared block changed after these were published.',
  },
  draft: {
    label: 'Draft',
    classes: 'bg-amber-100 text-amber-700 border-amber-200',
    hint: 'Not published yet.',
  },
  published: {
    label: 'Published',
    classes: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    hint: 'Published and up to date with their sources.',
  },
  review_done: {
    label: 'Review done',
    classes: 'bg-teal-100 text-teal-700 border-teal-200',
    hint: 'The supplier submitted their review and every note has been handled. Mark the manual FINAL.',
  },
  in_review: {
    label: 'In Review',
    classes: 'bg-sky-100 text-sky-700 border-sky-200',
    hint: 'The published manual is out with a supplier collecting feedback. Editing it returns the manual to In Progress.',
  },
  unknown: {
    label: 'Status unknown',
    classes: 'bg-gray-100 text-gray-600 border-gray-200',
    hint: 'The up-to-date check failed — these may or may not need a re-publish. Retry the check.',
  },
  final: {
    label: 'Final',
    classes: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    hint: 'Signed off and locked. Unlock a manual in its editor before changing it.',
  },
};

/**
 * Display order for the grouped table: work to do first, locked/archived last. An operational
 * overview should open on what needs attention, not on what is already finished.
 */
export const MANUAL_STATUS_ORDER: readonly ManualStatus[] = [
  'needs_republish',
  'unknown',
  'draft',
  // Review done before In Review: a finished review has a concrete next action
  // (sign off), while an open one is waiting on other people.
  'review_done',
  'in_review',
  'published',
  'final',
];

// ---------------------------------------------------------------------------
// Next action — the one-line "what do I do with this row" hint that turns the
// status overview into a work queue. Deliberately quiet when there is nothing
// to do (null), and silent about things the status badge/group hint already
// says (a draft is obviously unpublished; a stale row already lists languages).
// ---------------------------------------------------------------------------

export interface NextActionInput {
  status: ManualStatus;
  /** Publish counter (0 = never published). */
  version?: number | null;
  reviewRequestedAt?: string | null;
  /** Supplier notes still to be handled; null/undefined = count unknown. */
  reviewActiveThreads?: number | null;
  /**
   * im_version of the manual's NEWEST print render. undefined = render data not
   * loaded (say nothing); null = never printed.
   */
  printedVersion?: number | null;
}

/** Days between an ISO instant and now, floored at 0. */
const daysSince = (iso: string, now: number): number =>
  Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));

/** Print-freshness fragment shared by published/final rows. Null = fine or unknown. */
const printHint = (version: number | null | undefined, printedVersion: number | null | undefined): string | null => {
  if (printedVersion === undefined) return null;             // render data not loaded
  if (printedVersion === null) return 'no print PDF yet';
  if (version != null && printedVersion < version) return `print PDF is v${printedVersion} — regenerate for v${version}`;
  return null;
};

export const nextActionOf = (im: NextActionInput, now: number = Date.now()): string | null => {
  switch (im.status) {
    case 'draft':
      // Published before, edited since: the useful distinction over the group hint.
      return (im.version ?? 0) > 0 ? `edited after v${im.version} — publish to update` : null;
    case 'in_review': {
      const parts: string[] = [];
      if (im.reviewRequestedAt) {
        const d = daysSince(im.reviewRequestedAt, now);
        parts.push(d === 0 ? 'review sent today' : `review out ${d} day${d === 1 ? '' : 's'}`);
      }
      if (typeof im.reviewActiveThreads === 'number') {
        parts.push(`${im.reviewActiveThreads} open note${im.reviewActiveThreads === 1 ? '' : 's'}`);
      }
      return parts.join(' · ') || null;
    }
    case 'review_done':
      return 'review finished — mark FINAL';
    case 'published':
    case 'final':
      return printHint(im.version, im.printedVersion);
    default:
      // needs_republish carries its own stale-language line; unknown has its hint.
      return null;
  }
};

/**
 * Bucket manuals by derived status, preserving the incoming order within each group and
 * dropping empty groups. `isStale` is passed in because staleness is computed asynchronously
 * by the dashboard, not carried on the row.
 */
export const groupByStatus = <T extends ManualStatusInput>(
  ims: readonly T[],
  isStale: (im: T) => boolean | null,
): Array<{ status: ManualStatus; items: T[] }> => {
  const buckets = new Map<ManualStatus, T[]>();
  for (const im of ims) {
    const status = manualStatusOf(im, isStale(im));
    const bucket = buckets.get(status);
    if (bucket) bucket.push(im); else buckets.set(status, [im]);
  }
  return MANUAL_STATUS_ORDER
    .filter(status => buckets.has(status))
    .map(status => ({ status, items: buckets.get(status)! }));
};
