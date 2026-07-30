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
 *  3. `published`        published and up to date.
 *  4. `draft`            never published.
 *
 * A final manual can also be stale; the row keeps showing the "Needs re-publish" chip as a
 * secondary signal, it just groups under Final.
 */

export type ManualStatus = 'final' | 'needs_republish' | 'published' | 'draft';

/** The fields this module needs. Kept structural so tests don't build a whole summary. */
export interface ManualStatusInput {
  status: 'draft' | 'generated';
  isFinalized: boolean;
}

export const manualStatusOf = (im: ManualStatusInput, isStale: boolean): ManualStatus => {
  if (im.isFinalized) return 'final';
  if (im.status === 'generated') return isStale ? 'needs_republish' : 'published';
  return 'draft';
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
  'draft',
  'published',
  'final',
];

/**
 * Bucket manuals by derived status, preserving the incoming order within each group and
 * dropping empty groups. `isStale` is passed in because staleness is computed asynchronously
 * by the dashboard, not carried on the row.
 */
export const groupByStatus = <T extends ManualStatusInput>(
  ims: readonly T[],
  isStale: (im: T) => boolean,
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
