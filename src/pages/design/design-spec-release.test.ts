/**
 * The Design Spec release stages.
 *
 * Worth testing because two of these functions are the client half of a database rule, and
 * a client that disagrees with the database produces the worst kind of error: a control the
 * user is offered, and then refused. `allowedStagesFor` mirrors the forward-only check in
 * `design_spec_versions_guard`, and `nextRevisionFor` mirrors the revision the same trigger
 * assigns. If either drifts, the panel starts asking questions the database answers with a
 * raise.
 *
 * The rest is naming, which is not trivial here either — "Final Release v.02" is the string
 * the design team, the supplier portal and the stamp printed on the page all have to agree
 * on, and it is assembled in one place precisely so they cannot disagree.
 */
import { describe, it, expect } from 'vitest';
import {
  DESIGN_SPEC_STAGE_META, DESIGN_SPEC_STAGE_ORDER,
  allowedStagesFor, formatRevision, highestStage, nextRevisionFor,
  releaseLabel, releaseShort, releaseShortByNumber, stageRank,
} from './design-spec-release';
import type { DesignSpecStage } from '../../types/design-spec.types';

const v = (version: number, stage: DesignSpecStage, revision: number) =>
  ({ version, stage, revision });

describe('formatRevision', () => {
  it('pads to two digits, the way the design team writes it', () => {
    expect(formatRevision(1)).toBe('v.01');
    expect(formatRevision(9)).toBe('v.09');
  });

  it('grows past 99 rather than truncating', () => {
    expect(formatRevision(100)).toBe('v.100');
  });

  it('never renders a revision below 1 — the column forbids one', () => {
    expect(formatRevision(0)).toBe('v.01');
  });
});

describe('releaseLabel / releaseShort', () => {
  it('names a version the way the business does', () => {
    expect(releaseLabel(v(7, 'final', 2))).toBe('Final Release v.02');
    expect(releaseLabel(v(1, 'internal', 1))).toBe('Internal Review v.01');
    expect(releaseLabel(v(3, 'initial', 1))).toBe('Initial Release v.01');
  });

  it('shortens without becoming ambiguous — Internal and Initial share a first letter', () => {
    expect(releaseShort(v(1, 'internal', 1))).toBe('Internal v.01');
    expect(releaseShort(v(3, 'initial', 2))).toBe('Initial v.02');
    expect(new Set(DESIGN_SPEC_STAGE_ORDER.map(s => DESIGN_SPEC_STAGE_META[s].short)).size)
      .toBe(DESIGN_SPEC_STAGE_ORDER.length);
  });
});

describe('stageRank', () => {
  it('orders the three stages, and mirrors design_spec_stage_rank()', () => {
    expect(stageRank('internal')).toBe(1);
    expect(stageRank('initial')).toBe(2);
    expect(stageRank('final')).toBe(3);
  });
});

describe('highestStage', () => {
  it('is null while nothing is uploaded', () => {
    expect(highestStage([])).toBeNull();
  });

  it('reports the furthest stage reached, not the last row in the array', () => {
    // Order is deliberately wrong here: callers pass versions newest-first and oldest-first
    // in different places, and the answer must not depend on which.
    expect(highestStage([v(2, 'initial', 1), v(1, 'internal', 1)])).toBe('initial');
    expect(highestStage([v(1, 'internal', 1), v(2, 'initial', 1)])).toBe('initial');
  });
});

describe('allowedStagesFor — the client half of the forward-only rule', () => {
  it('offers all three before anything is uploaded', () => {
    expect(allowedStagesFor([])).toEqual(['internal', 'initial', 'final']);
  });

  it('drops Internal Review once an Initial Release exists', () => {
    // The supplier has seen the spec. A later "Internal Review v.02" would claim they had
    // not, and the database raises rather than storing one.
    expect(allowedStagesFor([v(1, 'internal', 1), v(2, 'initial', 1)]))
      .toEqual(['initial', 'final']);
  });

  it('still offers a stage the spec is already on — that is how a revision is added', () => {
    expect(allowedStagesFor([v(1, 'initial', 1)])).toContain('initial');
  });

  it('is never empty: a spec at Final Release can still add Final Release v.02', () => {
    expect(allowedStagesFor([v(4, 'final', 1)])).toEqual(['final']);
  });
});

describe('nextRevisionFor — the client half of the revision counter', () => {
  it('starts each stage at 1, independently of the others', () => {
    const versions = [v(1, 'internal', 1), v(2, 'internal', 2), v(3, 'initial', 1)];
    expect(nextRevisionFor(versions, 'initial')).toBe(2);
    expect(nextRevisionFor(versions, 'final')).toBe(1);
  });

  it('counts within the stage and not across the spec', () => {
    // Six uploads, but only the second Final Release — the number a reader sees is 02, not
    // 07. This is the whole reason `revision` is not `version`.
    const versions = [
      v(1, 'internal', 1), v(2, 'internal', 2), v(3, 'internal', 3),
      v(4, 'initial', 1), v(5, 'initial', 2), v(6, 'final', 1),
    ];
    expect(nextRevisionFor(versions, 'final')).toBe(2);
  });

  it('ignores gaps rather than filling them', () => {
    // A revision is never reused, even if one were somehow deleted: max+1, exactly what the
    // trigger does.
    expect(nextRevisionFor([v(1, 'final', 3)], 'final')).toBe(4);
  });
});

describe('releaseShortByNumber', () => {
  const versions = [v(1, 'internal', 1), v(2, 'initial', 1), v(7, 'final', 2)];

  it('translates an upload number into the name a reader knows', () => {
    expect(releaseShortByNumber(versions, 7)).toBe('Final v.02');
  });

  it('falls back to the bare upload number for a version the caller did not load', () => {
    // A note written against a version outside the list must not be labelled with someone
    // else's name — an honest v4 sends the reader somewhere real.
    expect(releaseShortByNumber(versions, 4)).toBe('v4');
  });

  it('says something readable when there is no version at all', () => {
    expect(releaseShortByNumber(versions, null)).toBe('an earlier version');
  });
});

describe('DESIGN_SPEC_STAGE_META', () => {
  it('keeps Internal Review out of the supplier portal', () => {
    expect(DESIGN_SPEC_STAGE_META.internal.supplierVisible).toBe(false);
    expect(DESIGN_SPEC_STAGE_META.initial.supplierVisible).toBe(true);
    expect(DESIGN_SPEC_STAGE_META.final.supplierVisible).toBe(true);
  });

  it('stamps everything except the Final Release, which IS the released document', () => {
    expect(DESIGN_SPEC_STAGE_META.internal.stamp).not.toBeNull();
    expect(DESIGN_SPEC_STAGE_META.initial.stamp).not.toBeNull();
    expect(DESIGN_SPEC_STAGE_META.final.stamp).toBeNull();
  });

  it('covers every stage in the order, with no extras', () => {
    expect(Object.keys(DESIGN_SPEC_STAGE_META).sort())
      .toEqual([...DESIGN_SPEC_STAGE_ORDER].sort());
  });
});
