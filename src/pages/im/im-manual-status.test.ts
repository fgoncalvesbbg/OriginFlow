import { describe, it, expect } from 'vitest';
import {
  MANUAL_STATUS_META,
  MANUAL_STATUS_ORDER,
  PRINTED_STATUS_META,
  groupByStatus,
  hasBeenReviewed,
  isInReview,
  isReviewStep,
  manualFlagsOf,
  manualStatusOf,
  nextActionOf,
  nextReviewStageFor,
  printedManualStatusOf,
  reviewStepClasses,
  statusClasses,
  statusLabel,
  type ManualStatus,
  type PrintedStatus,
} from './im-manual-status';

const im = (status: 'draft' | 'generated', isFinalized = false) => ({ status, isFinalized });

/** A published manual sent out for supplier review at `reviewVersion`. */
const reviewed = (opts: {
  status?: 'draft' | 'generated';
  isFinalized?: boolean;
  version?: number | null;
  reviewVersion?: number | null;
  reviewRequestedAt?: string | null;
  reviewStage?: 'draft' | 'final' | null;
} = {}) => ({
  status: opts.status ?? 'generated' as const,
  isFinalized: opts.isFinalized ?? false,
  version: opts.version === undefined ? 3 : opts.version,
  reviewVersion: opts.reviewVersion === undefined ? 3 : opts.reviewVersion,
  reviewRequestedAt: opts.reviewRequestedAt === undefined ? '2026-08-18T09:00:00Z' : opts.reviewRequestedAt,
  reviewStage: opts.reviewStage === undefined ? ('draft' as const) : opts.reviewStage,
});

describe('manualStatusOf', () => {
  it('reports Done regardless of the underlying publish status', () => {
    expect(manualStatusOf(im('generated', true), false)).toBe('done');
    expect(manualStatusOf(im('draft', true), false)).toBe('done');
  });

  it('keeps Done ahead of staleness', () => {
    // A locked manual whose sources drifted is still, first and foremost, signed off.
    expect(manualStatusOf(im('generated', true), true)).toBe('done');
  });

  it('reports Republish Needed for a stale publish, In Progress for a clean one', () => {
    expect(manualStatusOf(im('generated'), true)).toBe('republish_needed');
    // Publishing is an ACTION, not a step: a published, never-reviewed manual is still work
    // in the PM's hands.
    expect(manualStatusOf(im('generated'), false)).toBe('in_progress');
  });

  it('reports In Progress when never published, and ignores staleness there', () => {
    expect(manualStatusOf(im('draft'), false)).toBe('in_progress');
    expect(manualStatusOf(im('draft'), true)).toBe('in_progress');
  });

  it('splits the two review steps by the round stage', () => {
    expect(manualStatusOf(reviewed({ reviewStage: 'draft' }), false)).toBe('draft_review');
    expect(manualStatusOf(reviewed({ reviewStage: 'final' }), false)).toBe('final_review');
  });

  it('reads a stage-less legacy round as the DRAFT review, never the final one', () => {
    // Claiming a final sign-off pass happened when we have no record of it is the one
    // direction this default must never fail in.
    expect(manualStatusOf(reviewed({ reviewStage: null }), false)).toBe('draft_review');
  });

  it('moves a reviewed manual to Adjust IM once the PM edits it', () => {
    expect(manualStatusOf(reviewed({ status: 'draft' }), false)).toBe('adjust_im');
  });

  it('moves a reviewed manual to Adjust IM once a newer version is published', () => {
    expect(manualStatusOf(reviewed({ version: 4, reviewVersion: 3 }), false)).toBe('adjust_im');
  });

  it('keeps a manual IN its review column when the sources drift underneath it', () => {
    // The supplier is still reading it. Yanking the card into Republish Needed would hide
    // the round that is actually in flight; the drift is reported as a flag instead.
    expect(manualStatusOf(reviewed(), true)).toBe('draft_review');
    expect(manualStatusOf(reviewed({ reviewStage: 'final' }), null)).toBe('final_review');
    expect(manualFlagsOf(reviewed(), true).map(f => f.key)).toContain('out_of_date');
  });

  it('keeps Done ahead of an open review round', () => {
    expect(manualStatusOf(reviewed({ isFinalized: true }), false)).toBe('done');
  });

  it('never reviewed → In Progress, and a legacy round with no stamped version counts as current', () => {
    expect(manualStatusOf(reviewed({ reviewRequestedAt: null }), false)).toBe('in_progress');
    expect(manualStatusOf(reviewed({ reviewVersion: null }), false)).toBe('draft_review');
  });

  it('reports Status unknown only for a published manual whose check failed', () => {
    expect(manualStatusOf(im('generated'), null)).toBe('unknown');
    // Never published: there is nothing for staleness to be about.
    expect(manualStatusOf(im('draft'), null)).toBe('in_progress');
  });
});

describe('nextReviewStageFor', () => {
  it('picks the review step that FOLLOWS where the manual stands', () => {
    expect(nextReviewStageFor('to_do', false)).toBe('draft');
    expect(nextReviewStageFor('in_progress', false)).toBe('draft');
    expect(nextReviewStageFor('adjust_im', true)).toBe('final');
  });

  it('re-sending during an open round keeps that round own stage', () => {
    expect(nextReviewStageFor('draft_review', true)).toBe('draft');
    expect(nextReviewStageFor('final_review', true)).toBe('final');
  });

  it('treats any manual that has already had a supplier pass as past the draft review', () => {
    expect(nextReviewStageFor('republish_needed', true)).toBe('final');
    expect(nextReviewStageFor('republish_needed', false)).toBe('draft');
    expect(nextReviewStageFor('done', true)).toBe('final');
    expect(nextReviewStageFor('unknown', false)).toBe('draft');
  });
});

describe('review step tone — green means the supplier closed it', () => {
  it('goes green on submission ALONE, not on the notes being triaged', () => {
    // Triaging is the PM's own work at Adjust IM. Gating the green on it would hide the one
    // fact the board exists to surface: that the ball has come back.
    expect(reviewStepClasses(true)).toContain('emerald');
    expect(reviewStepClasses(false)).toContain('sky');
  });

  it('reads an unknown outcome as still out with the supplier', () => {
    expect(reviewStepClasses(null)).toContain('sky');
    expect(reviewStepClasses(undefined)).toContain('sky');
  });

  it('says "closed" in words as well as in hue', () => {
    expect(statusLabel('draft_review', true)).toBe('Draft Review · closed');
    expect(statusLabel('final_review', true)).toBe('Final Review · closed');
    expect(statusLabel('draft_review', false)).toBe('Draft Review');
  });

  it('leaves every non-review step alone whatever the review flag says', () => {
    expect(statusLabel('adjust_im', true)).toBe('Adjust IM');
    expect(statusClasses('done', true)).toBe(MANUAL_STATUS_META.done.classes);
    expect(statusClasses('in_progress', false)).toBe(MANUAL_STATUS_META.in_progress.classes);
  });

  it('knows which steps are reviews', () => {
    expect(MANUAL_STATUS_ORDER.filter(isReviewStep)).toEqual(['draft_review', 'final_review']);
  });
});

describe('manualFlagsOf', () => {
  it('is silent on a healthy manual', () => {
    expect(manualFlagsOf({ ...im('generated'), version: 3 }, false)).toEqual([]);
  });

  it('flags a Done manual whose sources drifted, without moving it out of Done', () => {
    const row = { ...im('generated', true), version: 3 };
    expect(manualStatusOf(row, true)).toBe('done');
    expect(manualFlagsOf(row, true).map(f => f.key)).toEqual(['out_of_date']);
  });

  it('does not repeat what the step badge already says', () => {
    // The card is already sitting in Republish Needed.
    expect(manualFlagsOf({ ...im('generated'), version: 3 }, true)).toEqual([]);
  });

  it('flags edits made after a publish — the editor and the online manual disagree', () => {
    expect(manualFlagsOf({ ...im('draft'), version: 4 }, false).map(f => f.key)).toEqual(['unpublished_edits']);
    // Never published: nothing to disagree with.
    expect(manualFlagsOf({ ...im('draft'), version: 0 }, false)).toEqual([]);
  });

  it('flags a manual signed off without ever being published', () => {
    // Four live manuals are in exactly this state and used to render as a plain, healthy Done.
    expect(manualFlagsOf({ ...im('draft', true), version: 0 }, false).map(f => f.key))
      .toEqual(['never_published']);
  });

  it('reports several at once, worst first', () => {
    expect(manualFlagsOf({ ...im('draft', true), version: 0 }, true).map(f => f.key))
      .toEqual(['out_of_date', 'never_published']);
  });
});

describe('printedManualStatusOf', () => {
  it('reports Not printed when no render exists yet, regardless of the Digital IM', () => {
    expect(printedManualStatusOf(false, false, false)).toBe('not_printed');
    expect(printedManualStatusOf(true, false, null)).toBe('not_printed');
  });

  it('reports Status unknown when the staleness check failed', () => {
    expect(printedManualStatusOf(false, true, null)).toBe('unknown');
    expect(printedManualStatusOf(true, true, null)).toBe('unknown');
  });

  it('reports Out of date when the matching render predates the current manual', () => {
    expect(printedManualStatusOf(false, true, true)).toBe('out_of_date');
    expect(printedManualStatusOf(true, true, true)).toBe('out_of_date');
  });

  it('derives Done ONLY when the Digital IM is final AND the render is current', () => {
    expect(printedManualStatusOf(true, true, false)).toBe('done');
    expect(printedManualStatusOf(false, true, false)).toBe('printed');
  });

  it('has metadata for every printed status', () => {
    const all: PrintedStatus[] = ['not_printed', 'printed', 'out_of_date', 'done', 'unknown'];
    for (const status of all) {
      expect(PRINTED_STATUS_META[status]?.label).toBeTruthy();
      expect(PRINTED_STATUS_META[status]?.hint).toBeTruthy();
    }
    expect(Object.keys(PRINTED_STATUS_META).sort()).toEqual([...all].sort());
  });
});

describe('nextActionOf', () => {
  const NOW = new Date('2026-08-18T12:00:00Z').getTime();

  it('tells an unstarted project what it is', () => {
    expect(nextActionOf({ status: 'to_do' })).toBe('no manual yet — open the project to start one');
  });

  it('points a published, never-reviewed manual at its draft review', () => {
    expect(nextActionOf({ status: 'in_progress', version: 3 })).toBe('published v3 — send for draft review');
    expect(nextActionOf({ status: 'in_progress', version: 0 })).toBe('not published yet');
  });

  it('reports how long a review has been out, and how many notes are in', () => {
    expect(nextActionOf({ status: 'draft_review', reviewRequestedAt: '2026-08-13T09:00:00Z', reviewActiveThreads: 3 }, NOW))
      .toBe('out 5 days · 3 open notes');
    expect(nextActionOf({ status: 'final_review', reviewRequestedAt: '2026-08-18T09:00:00Z' }, NOW))
      .toBe('sent today');
  });

  it('names the NEXT step once the supplier has closed the round', () => {
    expect(nextActionOf({ status: 'draft_review', reviewSubmitted: true, reviewActiveThreads: 2 }, NOW))
      .toBe('review closed · 2 open notes — start adjusting');
    expect(nextActionOf({ status: 'final_review', reviewSubmitted: true, reviewActiveThreads: 0 }, NOW))
      .toBe('review closed — mark it Done');
  });

  it('points Adjust IM at the notes, then at the final review', () => {
    expect(nextActionOf({ status: 'adjust_im', reviewActiveThreads: 4 }))
      .toBe('4 open notes to handle, then send the final review');
    expect(nextActionOf({ status: 'adjust_im', reviewActiveThreads: 0 }))
      .toBe('notes handled — publish and send the final review');
  });

  it('reports print freshness on Done rows, quiet when current or unknown', () => {
    expect(nextActionOf({ status: 'done', version: 5, printedVersion: null })).toBe('no print PDF yet');
    expect(nextActionOf({ status: 'done', version: 5, printedVersion: 3 })).toBe('print PDF is v3 — regenerate for v5');
    expect(nextActionOf({ status: 'done', version: 5, printedVersion: 5 })).toBeNull();
    // Render data not loaded → say nothing rather than guess.
    expect(nextActionOf({ status: 'done', version: 5 })).toBeNull();
  });

  it('stays quiet where the badge or stale line already speaks', () => {
    expect(nextActionOf({ status: 'republish_needed', version: 2, printedVersion: 1 })).toBeNull();
    expect(nextActionOf({ status: 'unknown' })).toBeNull();
  });
});

describe('isInReview / hasBeenReviewed', () => {
  it('requires a published status and a matching review round', () => {
    expect(isInReview(reviewed())).toBe(true);
    expect(isInReview(reviewed({ status: 'draft' }))).toBe(false);
    expect(isInReview(reviewed({ reviewRequestedAt: null }))).toBe(false);
    expect(isInReview(reviewed({ version: 4 }))).toBe(false);
  });

  it('remembers a past round even after it ended — that is what Adjust IM is', () => {
    expect(hasBeenReviewed(reviewed({ status: 'draft' }))).toBe(true);
    expect(hasBeenReviewed(reviewed({ reviewRequestedAt: null }))).toBe(false);
  });

  it('ends the round when the last review link has been revoked', () => {
    // The manual's review columns are never cleared, so without the link signal the board
    // went on showing a manual as out with a supplier who could no longer open it.
    expect(isInReview({ ...reviewed(), hasLiveReviewLink: false })).toBe(false);
    expect(manualStatusOf({ ...reviewed(), hasLiveReviewLink: false }, false)).toBe('adjust_im');
  });

  it('believes the columns when there is no link data to check against', () => {
    expect(isInReview({ ...reviewed(), hasLiveReviewLink: null })).toBe(true);
    expect(isInReview({ ...reviewed(), hasLiveReviewLink: true })).toBe(true);
  });
});

describe('groupByStatus', () => {
  const rows = [
    { id: 'a', ...im('generated') },
    { id: 'b', ...im('draft') },
    { id: 'c', ...im('generated', true) },
    { id: 'd', ...im('generated') },
    { id: 'e', ...im('draft') },
  ];

  it('orders groups in WORKFLOW order and drops empty ones', () => {
    const groups = groupByStatus(rows, r => r.id === 'd');
    expect(groups.map(g => g.status)).toEqual(['in_progress', 'done', 'republish_needed']);
  });

  it('omits groups with no members', () => {
    const groups = groupByStatus([{ id: 'x', ...im('draft') }], () => false);
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('in_progress');
  });

  it('preserves the incoming order inside a group', () => {
    const groups = groupByStatus(rows, () => false);
    const inProgress = groups.find(g => g.status === 'in_progress')!;
    expect(inProgress.items.map(i => i.id)).toEqual(['a', 'b', 'd', 'e']);
  });

  it('accounts for every row exactly once', () => {
    const groups = groupByStatus(rows, r => r.id === 'd');
    const ids = groups.flatMap(g => g.items.map(i => i.id));
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns nothing for an empty list, so the caller renders its own empty state', () => {
    expect(groupByStatus([], () => false)).toEqual([]);
  });
});

describe('workflow metadata', () => {
  it('covers every step in the display order', () => {
    for (const status of MANUAL_STATUS_ORDER) {
      expect(MANUAL_STATUS_META[status]?.label).toBeTruthy();
      expect(MANUAL_STATUS_META[status]?.hint).toBeTruthy();
    }
  });

  it('orders every known step exactly once', () => {
    const keys = Object.keys(MANUAL_STATUS_META) as ManualStatus[];
    expect([...MANUAL_STATUS_ORDER].sort()).toEqual(keys.sort());
  });

  it('lays the seven business steps out in the order the business runs them', () => {
    expect(MANUAL_STATUS_ORDER.filter(s => s !== 'unknown')).toEqual([
      'to_do', 'in_progress', 'draft_review', 'adjust_im', 'final_review', 'done', 'republish_needed',
    ]);
  });

  it('marks exactly the two review steps as waiting on someone else', () => {
    const waiting = MANUAL_STATUS_ORDER.filter(s => MANUAL_STATUS_META[s].waiting);
    expect(waiting).toEqual(['draft_review', 'final_review']);
  });
});
