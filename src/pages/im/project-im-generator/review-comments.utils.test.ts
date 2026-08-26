import { describe, it, expect } from 'vitest';
import {
  formatReviewStamp,
  groupCommentsBySection,
  reviewCommentCounts,
  reviewRoundStateOf,
  reviewStampTitle,
} from './review-comments.utils';
import type { IMReviewComment } from '../../../services';

/** A note, with only the fields these functions read spelled out. */
const note = (
  sectionId: string,
  opts: { id?: string; status?: IMReviewComment['status']; title?: string | null; at?: string } = {},
): IMReviewComment => ({
  id: opts.id ?? `${sectionId}-${opts.status ?? 'open'}-${opts.at ?? '1'}`,
  shareId: 'share-1',
  projectId: 'proj-1',
  templateType: 'im',
  language: 'en',
  manualVersion: 3,
  sectionId,
  sectionTitle: opts.title === undefined ? 'Snapshot title' : opts.title,
  quote: 'do not immerse',
  quoteBefore: '',
  quoteAfter: '',
  body: 'wrong wording',
  authorName: 'Anna',
  attachments: [],
  status: opts.status ?? 'open',
  resolvedAt: null,
  resolvedBy: null,
  createdAt: `2026-08-2${opts.at ?? '1'}T09:00:00Z`,
});

const sections = [
  { id: 'sec-a', title: 'Safety' },
  { id: 'sec-b', title: 'Cleaning' },
  { id: 'proj-xyz', title: 'Project extra' },
];

describe('reviewCommentCounts', () => {
  it('counts each status separately and the total', () => {
    const counts = reviewCommentCounts([
      note('sec-a'),
      note('sec-a', { status: 'done', at: '2' }),
      note('sec-b', { status: 'wont_fix' }),
    ]);
    expect(counts).toEqual({ open: 1, done: 1, wontFix: 1, total: 3 });
  });

  it('is all zeroes for no comments', () => {
    expect(reviewCommentCounts([])).toEqual({ open: 0, done: 0, wontFix: 0, total: 0 });
  });
});

describe('groupCommentsBySection', () => {
  it('orders groups by the manual reading order, not by when the notes were written', () => {
    const groups = groupCommentsBySection([note('sec-b'), note('sec-a')], sections);
    expect(groups.map(g => g.sectionId)).toEqual(['sec-a', 'sec-b']);
  });

  it('omits chapters with no notes — the panel is a work queue, not an outline', () => {
    const groups = groupCommentsBySection([note('sec-b')], sections);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Cleaning');
  });

  it('keeps notes within a group in the order they were written', () => {
    const first = note('sec-a', { id: 'first', at: '1' });
    const second = note('sec-a', { id: 'second', at: '2' });
    const groups = groupCommentsBySection([first, second], sections);
    expect(groups[0].comments.map(c => c.id)).toEqual(['first', 'second']);
  });

  it('handles project-only chapters, whose ids are not uuids', () => {
    const groups = groupCommentsBySection([note('proj-xyz')], sections);
    expect(groups[0]).toMatchObject({ sectionId: 'proj-xyz', title: 'Project extra', orphaned: false });
  });

  it('puts notes on a deleted chapter in a trailing orphan group, never mixed in', () => {
    // Actionable feedback must not be pushed down the list by feedback that can't be navigated to.
    const groups = groupCommentsBySection([note('sec-gone'), note('sec-b')], sections);
    expect(groups.map(g => g.sectionId)).toEqual(['sec-b', 'sec-gone']);
    expect(groups[1].orphaned).toBe(true);
  });

  it('labels an orphan group from the title snapshotted at comment time', () => {
    const groups = groupCommentsBySection([note('sec-gone', { title: 'Old chapter' })], sections);
    expect(groups[0].title).toBe('Old chapter');
  });

  it('falls back to a generic label when even the snapshot is missing', () => {
    const groups = groupCommentsBySection([note('sec-gone', { title: null })], sections);
    expect(groups[0].title).toBe('Removed chapter');
  });

  it('counts open notes per group, ignoring resolved ones', () => {
    const groups = groupCommentsBySection(
      [note('sec-a', { at: '1' }), note('sec-a', { status: 'done', at: '2' })],
      sections,
    );
    expect(groups[0].openCount).toBe(1);
    expect(groups[0].comments).toHaveLength(2);
  });

  it('returns nothing for no comments', () => {
    expect(groupCommentsBySection([], sections)).toEqual([]);
  });
});

describe('reviewRoundStateOf', () => {
  it('reports no round when no review link has been sent', () => {
    expect(reviewRoundStateOf([], [note('sec-a')], 3)).toMatchObject({ isOpen: false, isSubmitted: false });
  });

  it('is open but not submitted while a reviewer is still working', () => {
    const state = reviewRoundStateOf([{ submittedAt: null, manualVersion: 3 }], [], 3);
    expect(state).toMatchObject({ isOpen: true, isSubmitted: false, isStale: false });
  });

  it('counts as submitted only once every outstanding reviewer has submitted', () => {
    // One supplier finishing doesn't mean all the feedback is in.
    const shares = [
      { submittedAt: '2026-08-24T10:00:00Z', manualVersion: 3 },
      { submittedAt: null, manualVersion: 3 },
    ];
    expect(reviewRoundStateOf(shares, [], 3).isSubmitted).toBe(false);
    expect(reviewRoundStateOf([shares[0]], [], 3).isSubmitted).toBe(true);
  });

  it('flags the round stale once the manual is republished past the reviewed version', () => {
    const state = reviewRoundStateOf([{ submittedAt: null, manualVersion: 3 }], [], 4);
    expect(state.isStale).toBe(true);
  });

  it('does not claim staleness for a link minted before versions were recorded', () => {
    // No baseline to compare against — better silent than nagging about an unjudgeable round.
    expect(reviewRoundStateOf([{ submittedAt: null, manualVersion: null }], [], 4).isStale).toBe(false);
  });

  it('does not claim staleness when the current version is unknown', () => {
    expect(reviewRoundStateOf([{ submittedAt: null, manualVersion: 3 }], [], null).isStale).toBe(false);
  });

  it('carries the open count through regardless of round state', () => {
    const comments = [note('sec-a'), note('sec-b', { status: 'done' })];
    expect(reviewRoundStateOf([], comments, 3).openCount).toBe(1);
    expect(reviewRoundStateOf([{ submittedAt: null, manualVersion: 3 }], comments, 3).openCount).toBe(1);
  });
});

describe('formatReviewStamp', () => {
  const now = new Date('2026-08-26T12:00:00Z');

  it('always renders an absolute date AND a time, never a bare relative day', () => {
    const stamp = formatReviewStamp('2026-08-26T09:30:00Z', now);
    // Locale-dependent ordering, so assert the parts rather than one formatted string.
    expect(stamp.short).toMatch(/2026/);
    expect(stamp.short).toMatch(/Aug/);
    expect(stamp.short).toMatch(/26/);
    expect(stamp.short).toMatch(/\d{2}:\d{2}/);
  });

  it('keeps the relative day only as tooltip garnish', () => {
    expect(formatReviewStamp('2026-08-26T09:30:00Z', now).relative).toBe('today');
    expect(formatReviewStamp('2026-08-25T09:30:00Z', now).relative).toBe('yesterday');
    expect(formatReviewStamp('2026-08-14T09:30:00Z', now).relative).toBe('12 days ago');
  });

  it('returns empty parts for a missing or unparseable timestamp so callers can drop the stamp', () => {
    for (const bad of [null, undefined, '', 'not-a-date']) {
      expect(formatReviewStamp(bad, now)).toEqual({ short: '', full: '', relative: '' });
    }
  });

  it('builds a tooltip from the full moment plus the relative day, and nothing at all when unstamped', () => {
    const stamp = formatReviewStamp('2026-08-25T09:30:00Z', now);
    expect(reviewStampTitle(stamp)).toBe(`${stamp.full} · yesterday`);
    expect(reviewStampTitle(formatReviewStamp(null, now))).toBe('');
  });
});
