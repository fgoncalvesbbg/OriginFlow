import { describe, it, expect } from 'vitest';
import {
  MANUAL_STATUS_META,
  MANUAL_STATUS_ORDER,
  groupByStatus,
  isInReview,
  manualStatusOf,
  nextActionOf,
  printedManualStatusOf,
  type ManualStatus,
} from './im-manual-status';

const im = (status: 'draft' | 'generated', isFinalized = false) => ({ status, isFinalized });

/** A published manual sent to Markup.io for review at `reviewVersion`. */
const reviewed = (opts: {
  status?: 'draft' | 'generated';
  isFinalized?: boolean;
  version?: number | null;
  reviewVersion?: number | null;
  reviewRequestedAt?: string | null;
} = {}) => ({
  status: opts.status ?? 'generated' as const,
  isFinalized: opts.isFinalized ?? false,
  version: opts.version === undefined ? 3 : opts.version,
  reviewVersion: opts.reviewVersion === undefined ? 3 : opts.reviewVersion,
  reviewRequestedAt: opts.reviewRequestedAt === undefined ? '2026-08-18T09:00:00Z' : opts.reviewRequestedAt,
});

describe('manualStatusOf', () => {
  it('reports Final regardless of the underlying status', () => {
    expect(manualStatusOf(im('generated', true), false)).toBe('final');
    expect(manualStatusOf(im('draft', true), false)).toBe('final');
  });

  it('keeps Final ahead of staleness', () => {
    // A locked manual whose sources drifted is still, first and foremost, locked.
    expect(manualStatusOf(im('generated', true), true)).toBe('final');
  });

  it('distinguishes a stale publish from an up-to-date one', () => {
    expect(manualStatusOf(im('generated'), true)).toBe('needs_republish');
    expect(manualStatusOf(im('generated'), false)).toBe('published');
  });

  it('reports Draft when never published, and ignores staleness there', () => {
    expect(manualStatusOf(im('draft'), false)).toBe('draft');
    expect(manualStatusOf(im('draft'), true)).toBe('draft');
  });

  it('reports In Review while the current published version is out on Markup.io', () => {
    expect(manualStatusOf(reviewed(), false)).toBe('in_review');
  });

  it('ends In Review when editing resumes (status back to draft)', () => {
    expect(manualStatusOf(reviewed({ status: 'draft' }), false)).toBe('draft');
  });

  it('ends In Review when a newer version is published', () => {
    expect(manualStatusOf(reviewed({ version: 4, reviewVersion: 3 }), false)).toBe('published');
  });

  it('keeps stronger claims ahead of In Review', () => {
    // Final: the lock is the fact that matters most.
    expect(manualStatusOf(reviewed({ isFinalized: true }), false)).toBe('final');
    // Stale sources: the PDF being reviewed is already outdated — say so.
    expect(manualStatusOf(reviewed(), true)).toBe('needs_republish');
    expect(manualStatusOf(reviewed(), null)).toBe('unknown');
  });

  it('never reviewed → plain Published (and legacy review fields stay harmless)', () => {
    expect(manualStatusOf(reviewed({ reviewRequestedAt: null }), false)).toBe('published');
    // A legacy render without a stamped version counts as the current round.
    expect(manualStatusOf(reviewed({ reviewVersion: null }), false)).toBe('in_review');
  });

  it('splits an in-review manual by its polled outcome: done → Review done', () => {
    expect(manualStatusOf({ ...reviewed(), reviewDone: true }, false)).toBe('review_done');
    expect(manualStatusOf({ ...reviewed(), reviewDone: false }, false)).toBe('in_review');
    // Never checked (null/absent) stays In Review — no outcome is not an outcome.
    expect(manualStatusOf({ ...reviewed(), reviewDone: null }, false)).toBe('in_review');
  });

  it('keeps stronger claims ahead of Review done', () => {
    expect(manualStatusOf({ ...reviewed(), reviewDone: true, isFinalized: true }, false)).toBe('final');
    expect(manualStatusOf({ ...reviewed(), reviewDone: true }, true)).toBe('needs_republish');
    // Editing / republishing ends the round; a stale cached outcome must not resurrect it.
    expect(manualStatusOf({ ...reviewed({ status: 'draft' }), reviewDone: true }, false)).toBe('draft');
    expect(manualStatusOf({ ...reviewed({ version: 4, reviewVersion: 3 }), reviewDone: true }, false)).toBe('published');
  });
});

describe('printedManualStatusOf', () => {
  it('reports Final regardless of render/staleness', () => {
    expect(printedManualStatusOf(true, true, false)).toBe('final');
    expect(printedManualStatusOf(true, false, null)).toBe('final');
  });

  it('reports Draft when no print render exists yet', () => {
    expect(printedManualStatusOf(false, false, false)).toBe('draft');
    expect(printedManualStatusOf(false, false, true)).toBe('draft');
  });

  it('distinguishes a stale render from an up-to-date one, once rendered', () => {
    expect(printedManualStatusOf(false, true, true)).toBe('needs_republish');
    expect(printedManualStatusOf(false, true, false)).toBe('published');
  });

  it('reports Status unknown when the staleness check failed', () => {
    expect(printedManualStatusOf(false, true, null)).toBe('unknown');
  });
});

describe('nextActionOf', () => {
  const NOW = new Date('2026-08-18T12:00:00Z').getTime();

  it('flags a draft that was published before, stays quiet on a never-published one', () => {
    expect(nextActionOf({ status: 'draft', version: 3 })).toBe('edited after v3 — publish to update');
    expect(nextActionOf({ status: 'draft', version: 0 })).toBeNull();
  });

  it('reports review age and open threads while in review', () => {
    expect(nextActionOf({ status: 'in_review', reviewRequestedAt: '2026-08-13T09:00:00Z', reviewActiveThreads: 3 }, NOW))
      .toBe('review out 5 days · 3 open threads');
    expect(nextActionOf({ status: 'in_review', reviewRequestedAt: '2026-08-18T09:00:00Z' }, NOW))
      .toBe('review sent today');
  });

  it('points a finished review at sign-off', () => {
    expect(nextActionOf({ status: 'review_done' })).toBe('review finished — mark FINAL');
  });

  it('reports print freshness on published/final rows, quiet when current or unknown', () => {
    expect(nextActionOf({ status: 'published', version: 5, printedVersion: null })).toBe('no print PDF yet');
    expect(nextActionOf({ status: 'published', version: 5, printedVersion: 3 })).toBe('print PDF is v3 — regenerate for v5');
    expect(nextActionOf({ status: 'final', version: 5, printedVersion: 5 })).toBeNull();
    // Render data not loaded → say nothing rather than guess.
    expect(nextActionOf({ status: 'published', version: 5 })).toBeNull();
  });

  it('stays quiet where the badge or stale line already speaks', () => {
    expect(nextActionOf({ status: 'needs_republish', version: 2, printedVersion: 1 })).toBeNull();
    expect(nextActionOf({ status: 'unknown' })).toBeNull();
  });
});

describe('isInReview', () => {
  it('requires a published status and a matching review round', () => {
    expect(isInReview(reviewed())).toBe(true);
    expect(isInReview(reviewed({ status: 'draft' }))).toBe(false);
    expect(isInReview(reviewed({ reviewRequestedAt: null }))).toBe(false);
    expect(isInReview(reviewed({ version: 4 }))).toBe(false);
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

  it('orders groups action-first and drops empty ones', () => {
    const groups = groupByStatus(rows, r => r.id === 'd');
    expect(groups.map(g => g.status)).toEqual(['needs_republish', 'draft', 'published', 'final']);
  });

  it('omits groups with no members', () => {
    const groups = groupByStatus([{ id: 'x', ...im('draft') }], () => false);
    expect(groups).toHaveLength(1);
    expect(groups[0].status).toBe('draft');
  });

  it('preserves the incoming order inside a group', () => {
    const groups = groupByStatus(rows, () => false);
    const published = groups.find(g => g.status === 'published')!;
    expect(published.items.map(i => i.id)).toEqual(['a', 'd']);
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

describe('status metadata', () => {
  it('covers every status in the display order', () => {
    for (const status of MANUAL_STATUS_ORDER) {
      expect(MANUAL_STATUS_META[status]?.label).toBeTruthy();
      expect(MANUAL_STATUS_META[status]?.hint).toBeTruthy();
    }
  });

  it('orders every known status exactly once', () => {
    const keys = Object.keys(MANUAL_STATUS_META) as ManualStatus[];
    expect([...MANUAL_STATUS_ORDER].sort()).toEqual(keys.sort());
  });
});
