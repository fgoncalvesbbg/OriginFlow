/**
 * The Design Spec workflow derivation.
 *
 * Worth testing hard because the whole design rests on it: only Backlog and Cancelled are
 * stored, so every other step is a claim this module makes about the files and the review
 * links. If the precedence is wrong, a board shows a spec as out with a supplier when it is
 * issued, or as healthy when the round data failed to load.
 */
import { describe, it, expect } from 'vitest';
import {
  designSpecStatusOf, designSpecStatusLabel, designSpecStatusClasses, designSpecNextAction,
  currentVersionOf, groupByDesignSpecStatus, isInReview, isReviewClosed,
  DESIGN_SPEC_STATUS_ORDER, DESIGN_SPEC_STATUS_META,
  type DesignSpecRoundInput,
} from './design-spec-status';

const spec = (over: Partial<Parameters<typeof designSpecStatusOf>[0]> = {}) => ({
  state: 'active' as const,
  finalVersionId: null as string | null,
  versions: [{ version: 1, stage: 'initial' as const, revision: 1 }],
  ...over,
});

const round = (over: Partial<DesignSpecRoundInput> = {}): DesignSpecRoundInput => ({
  hasLiveLink: true,
  allSubmitted: false,
  openCount: 0,
  ...over,
});

describe('designSpecStatusOf — precedence', () => {
  it('reports Backlog when nothing has been uploaded', () => {
    expect(designSpecStatusOf(spec({ state: 'backlog', versions: [] }), undefined)).toBe('backlog');
  });

  it('reports In Progress once a version exists and no round is live', () => {
    expect(designSpecStatusOf(spec(), undefined)).toBe('in_progress');
  });

  it('reports In Review while a live link is unsubmitted', () => {
    expect(designSpecStatusOf(spec(), round())).toBe('in_review');
  });

  it('stays In Review once every reviewer has submitted — the round is closed, not gone', () => {
    // The card goes green via designSpecStatusClasses; it must NOT slide back to In
    // Progress, which would hide the fact that the ball has come back.
    expect(designSpecStatusOf(spec(), round({ allSubmitted: true }))).toBe('in_review');
  });

  it('returns to In Progress once the last link is revoked', () => {
    // Revoking the last link genuinely ends a round.
    expect(designSpecStatusOf(spec(), round({ hasLiveLink: false, allSubmitted: true, openCount: 3 })))
      .toBe('in_progress');
  });

  it('reports Final once a version is issued, even with a live round', () => {
    // Issuing outranks a round: a stray live link must not make an issued spec look open.
    expect(designSpecStatusOf(spec({ finalVersionId: 'v2' }), round())).toBe('final');
  });

  it('reports Cancelled above everything, including an issued final', () => {
    expect(designSpecStatusOf(
      spec({ state: 'cancelled', finalVersionId: 'v2' }), round(),
    )).toBe('cancelled');
  });

  it('reports Status unknown when the round data failed to load, never a healthy step', () => {
    // null = the query failed. An error must not render as In Progress.
    expect(designSpecStatusOf(spec(), null)).toBe('unknown');
  });

  it('treats an absent round as no round rather than as a failure', () => {
    // undefined = this caller does not track rounds; that is not an error.
    expect(designSpecStatusOf(spec(), undefined)).toBe('in_progress');
  });

  it('does not report unknown for a spec whose step does not depend on the round', () => {
    expect(designSpecStatusOf(spec({ state: 'backlog', versions: [] }), null)).toBe('backlog');
    expect(designSpecStatusOf(spec({ finalVersionId: 'v2' }), null)).toBe('final');
    expect(designSpecStatusOf(spec({ state: 'cancelled' }), null)).toBe('cancelled');
  });
});

describe('round predicates', () => {
  it('separates out-with-a-reviewer from closed', () => {
    expect(isInReview(round())).toBe(true);
    expect(isReviewClosed(round())).toBe(false);

    expect(isInReview(round({ allSubmitted: true }))).toBe(false);
    expect(isReviewClosed(round({ allSubmitted: true }))).toBe(true);
  });

  it('counts neither when there is no live link', () => {
    const dead = round({ hasLiveLink: false, allSubmitted: true });
    expect(isInReview(dead)).toBe(false);
    expect(isReviewClosed(dead)).toBe(false);
  });
});

describe('badge text and tone', () => {
  it('says so when a review has closed', () => {
    expect(designSpecStatusLabel('in_review', round())).toBe('In Review');
    expect(designSpecStatusLabel('in_review', round({ allSubmitted: true }))).toBe('In Review · closed');
  });

  it('turns a closed review green and leaves an open one sky', () => {
    expect(designSpecStatusClasses('in_review', round())).toContain('sky');
    expect(designSpecStatusClasses('in_review', round({ allSubmitted: true }))).toContain('emerald');
  });

  it('does not green a non-review step just because a round is closed', () => {
    expect(designSpecStatusClasses('in_progress', round({ allSubmitted: true })))
      .toBe(DESIGN_SPEC_STATUS_META.in_progress.classes);
  });

  it('carries every label in text, so hue is never the only signal', () => {
    for (const status of DESIGN_SPEC_STATUS_ORDER) {
      expect(DESIGN_SPEC_STATUS_META[status].label.trim()).not.toBe('');
      expect(DESIGN_SPEC_STATUS_META[status].hint.trim()).not.toBe('');
    }
  });

  it('marks only the waiting step as waiting', () => {
    const waiting = DESIGN_SPEC_STATUS_ORDER.filter(s => DESIGN_SPEC_STATUS_META[s].waiting);
    expect(waiting).toEqual(['in_review']);
  });
});

describe('currentVersionOf', () => {
  it('is null when nothing is uploaded', () => {
    expect(currentVersionOf([])).toBeNull();
  });

  it('takes the highest version, whatever order they arrive in', () => {
    expect(currentVersionOf([{ version: 2 }, { version: 5 }, { version: 3 }])).toBe(5);
  });
});

describe('designSpecNextAction', () => {
  const now = new Date('2026-09-09T12:00:00Z').getTime();

  it('tells a Backlog spec what it is missing', () => {
    expect(designSpecNextAction(spec({ state: 'backlog', versions: [] }), undefined, null, now))
      .toBe('no draft uploaded yet');
  });

  it('names the release, and the job that release implies', () => {
    // Three different jobs, not one job with three nouns: an Internal Review is checked
    // internally, an Initial Release goes to the supplier, a Final Release gets issued.
    expect(designSpecNextAction(spec(), undefined, null, now))
      .toBe('Initial v.01 uploaded — send it to the supplier');
    expect(designSpecNextAction(
      spec({ versions: [{ version: 1, stage: 'internal', revision: 1 }] }), undefined, null, now,
    )).toBe('Internal v.01 uploaded — check it internally, then upload the Initial Release');
    expect(designSpecNextAction(
      spec({ versions: [{ version: 3, stage: 'final', revision: 2 }] }), undefined, null, now,
    )).toBe('Final v.02 uploaded — issue it to lock the spec');
  });

  it('leads with the outstanding notes when there are any', () => {
    expect(designSpecNextAction(spec(), round({ hasLiveLink: false, openCount: 2 }), null, now))
      .toBe('2 open notes to handle, then upload the next version');
  });

  it('says how long a round has been out', () => {
    expect(designSpecNextAction(spec(), round(), '2026-09-06T12:00:00Z', now))
      .toBe('out 3 days');
    expect(designSpecNextAction(spec(), round(), '2026-09-09T09:00:00Z', now))
      .toBe('sent today');
  });

  it('singularises one note and one day', () => {
    expect(designSpecNextAction(spec(), round({ openCount: 1 }), '2026-09-08T12:00:00Z', now))
      .toBe('out 1 day · 1 open note');
  });

  it('says what unblocks next once the round closes', () => {
    expect(designSpecNextAction(spec(), round({ allSubmitted: true, openCount: 4 }), null, now))
      .toBe('review closed · 4 open notes — work the notes, then upload the Final Release');
  });

  it('is quiet about settled specs', () => {
    expect(designSpecNextAction(spec({ finalVersionId: 'v2' }), undefined, null, now)).toBeNull();
    expect(designSpecNextAction(spec({ state: 'cancelled' }), undefined, null, now)).toBeNull();
  });
});

describe('groupByDesignSpecStatus', () => {
  it('groups in workflow order, drops empty groups and keeps input order within a group', () => {
    const a = { ...spec({ state: 'backlog', versions: [] }), id: 'a' };
    const b = { ...spec(), id: 'b' };
    const c = { ...spec(), id: 'c' };
    const d = { ...spec({ finalVersionId: 'v9' }), id: 'd' };

    const groups = groupByDesignSpecStatus([d, c, b, a], () => undefined);

    expect(groups.map(g => g.status)).toEqual(['backlog', 'in_progress', 'final']);
    expect(groups.find(g => g.status === 'in_progress')!.items.map(i => i.id)).toEqual(['c', 'b']);
  });
});
