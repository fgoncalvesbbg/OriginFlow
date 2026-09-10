import { describe, it, expect } from 'vitest';
import {
  BOARD_BUCKETS, activePhase, bucketOf, bucketOfPhase, dropTargetPhase, planBucketDrop,
} from './project-board-buckets';
import { ProjectOverallStatus, StepStatus } from '../types';
import type { ChapterRef } from './project-board-buckets';

const chapters = (...statuses: StepStatus[]): ChapterRef[] =>
  statuses.map((status, i) => ({ id: `s${i + 1}`, stepNumber: i + 1, status }));

const STANDARD = chapters(StepStatus.IN_PROGRESS, StepStatus.NOT_STARTED, StepStatus.NOT_STARTED);
const project = (status: ProjectOverallStatus, currentStep = 1) => ({ status, currentStep });
const running = project(ProjectOverallStatus.IN_PROGRESS);

describe('BOARD_BUCKETS', () => {
  it('is the five buckets in the operator-facing order', () => {
    expect(BOARD_BUCKETS.map(b => b.label)).toEqual([
      'RFQ', 'Business Case & Development', 'Production', 'Live', 'Cancelled / On Hold',
    ]);
  });

  it('maps the first three onto the standard template chapter numbers', () => {
    expect(BOARD_BUCKETS.map(b => b.phase)).toEqual([1, 2, 3, null, null]);
  });
});

describe('activePhase', () => {
  it('is the lowest chapter that is not complete', () => {
    expect(activePhase(chapters(StepStatus.COMPLETED, StepStatus.IN_PROGRESS, StepStatus.NOT_STARTED)))
      .toEqual({ kind: 'phase', phase: 2 });
  });

  it('counts a blocked chapter as still open — it is the one needing action', () => {
    expect(activePhase(chapters(StepStatus.COMPLETED, StepStatus.BLOCKED, StepStatus.NOT_STARTED)))
      .toEqual({ kind: 'phase', phase: 2 });
  });

  it('reports the unclosed earlier chapter, not the one opened ahead of it', () => {
    // A PM who starts Production early has not finished the RFQ; RFQ is the actionable one.
    expect(activePhase(chapters(StepStatus.IN_PROGRESS, StepStatus.NOT_STARTED, StepStatus.IN_PROGRESS)))
      .toEqual({ kind: 'phase', phase: 1 });
  });

  it('separates "every chapter done" from "no chapters readable"', () => {
    expect(activePhase(chapters(StepStatus.COMPLETED, StepStatus.COMPLETED, StepStatus.COMPLETED)))
      .toEqual({ kind: 'finished' });
    expect(activePhase([])).toEqual({ kind: 'unknown' });
  });
});

describe('bucketOfPhase', () => {
  it('collapses a longer template’s later chapters into Production', () => {
    expect(bucketOfPhase(1)).toBe('rfq');
    expect(bucketOfPhase(2)).toBe('development');
    expect(bucketOfPhase(3)).toBe('production');
    expect(bucketOfPhase(5)).toBe('production');
  });
});

describe('bucketOf', () => {
  it('places a running project by its open chapter', () => {
    expect(bucketOf(running, STANDARD)).toBe('rfq');
    expect(bucketOf(running, chapters(StepStatus.COMPLETED, StepStatus.IN_PROGRESS, StepStatus.NOT_STARTED))).toBe('development');
    expect(bucketOf(running, chapters(StepStatus.COMPLETED, StepStatus.COMPLETED, StepStatus.IN_PROGRESS))).toBe('production');
  });

  it('ignores current_step, which is never advanced after creation', () => {
    // Every project in the database reads current_step = 1; the chapters are the real record.
    expect(bucketOf(project(ProjectOverallStatus.IN_PROGRESS, 1), chapters(StepStatus.COMPLETED, StepStatus.COMPLETED, StepStatus.IN_PROGRESS)))
      .toBe('production');
  });

  it('is Live once every chapter is complete, without needing the status set', () => {
    expect(bucketOf(running, chapters(StepStatus.COMPLETED, StepStatus.COMPLETED, StepStatus.COMPLETED))).toBe('live');
  });

  it('lets the overall status override the chapters', () => {
    expect(bucketOf(project(ProjectOverallStatus.COMPLETED), STANDARD)).toBe('live');
    expect(bucketOf(project(ProjectOverallStatus.ON_HOLD), STANDARD)).toBe('onHold');
    expect(bucketOf(project(ProjectOverallStatus.CANCELLED), chapters(StepStatus.COMPLETED, StepStatus.COMPLETED, StepStatus.COMPLETED)))
      .toBe('onHold');
  });

  it('does not report a project with unreadable chapters as launched', () => {
    expect(bucketOf(running, [])).toBe('rfq');
  });
});

describe('dropTargetPhase', () => {
  it('resolves to the project’s own chapter number', () => {
    expect(dropTargetPhase(STANDARD, 2)).toBe(2);
    expect(dropTargetPhase(chapters(StepStatus.NOT_STARTED, StepStatus.NOT_STARTED), 1)).toBe(1);
  });

  it('takes the first chapter at or past the bucket, for templates numbered past 3', () => {
    expect(dropTargetPhase([{ stepNumber: 1, status: StepStatus.COMPLETED }, { stepNumber: 4, status: StepStatus.NOT_STARTED }], 3)).toBe(4);
  });

  it('is null when the project has no such chapter', () => {
    expect(dropTargetPhase(chapters(StepStatus.IN_PROGRESS, StepStatus.NOT_STARTED), 3)).toBeNull();
    expect(dropTargetPhase([], 1)).toBeNull();
  });
});

describe('planBucketDrop', () => {
  it('is a no-op when the card is dropped on the column it came from', () => {
    expect(planBucketDrop(running, STANDARD, 'rfq')).toEqual({ kind: 'noop' });
  });

  it('opens the target chapter, closes the ones before it and resets the ones after', () => {
    const plan = planBucketDrop(running, STANDARD, 'production');
    expect(plan).toEqual({
      kind: 'plan',
      status: null,
      currentStep: 3,
      steps: [
        { id: 's1', status: StepStatus.COMPLETED },
        { id: 's2', status: StepStatus.COMPLETED },
        { id: 's3', status: StepStatus.IN_PROGRESS },
      ],
    });
  });

  it('writes only the chapters that actually change', () => {
    // Chapter 3 is already not-started, so the plan leaves it out rather than rewriting it.
    const plan = planBucketDrop(running, STANDARD, 'development');
    expect(plan).toMatchObject({
      steps: [
        { id: 's1', status: StepStatus.COMPLETED },
        { id: 's2', status: StepStatus.IN_PROGRESS },
      ],
    });
  });

  it('moving a project backwards reopens the earlier chapter', () => {
    const plan = planBucketDrop(project(ProjectOverallStatus.IN_PROGRESS, 3), chapters(StepStatus.COMPLETED, StepStatus.COMPLETED, StepStatus.IN_PROGRESS), 'rfq');
    expect(plan).toMatchObject({
      currentStep: 1,
      steps: [
        { id: 's1', status: StepStatus.IN_PROGRESS },
        { id: 's2', status: StepStatus.NOT_STARTED },
        { id: 's3', status: StepStatus.NOT_STARTED },
      ],
    });
  });

  it('un-holds a project dragged into a phase column, or it would bounce straight back', () => {
    // bucketOf lets the status win, so a phase drop that left ON_HOLD in place would move the
    // card and then snap it back to Cancelled / On Hold on the next render.
    const plan = planBucketDrop(project(ProjectOverallStatus.ON_HOLD), STANDARD, 'development');
    expect(plan).toMatchObject({ status: ProjectOverallStatus.IN_PROGRESS });
  });

  it('marks Live with the status alone and leaves the chapters signed off as they were', () => {
    expect(planBucketDrop(running, STANDARD, 'live')).toEqual({
      kind: 'plan', status: ProjectOverallStatus.COMPLETED, currentStep: null, steps: [],
    });
  });

  it('sends a dropped card to On Hold, never to Cancelled', () => {
    expect(planBucketDrop(running, STANDARD, 'onHold')).toEqual({
      kind: 'plan', status: ProjectOverallStatus.ON_HOLD, currentStep: null, steps: [],
    });
  });

  it('refuses a phase the project’s template does not have, rather than doing nothing', () => {
    const drop = planBucketDrop(running, chapters(StepStatus.IN_PROGRESS, StepStatus.NOT_STARTED), 'production');
    expect(drop.kind).toBe('unsupported');
  });

  it('cannot move a project whose chapters are unreadable into a phase column', () => {
    expect(planBucketDrop(running, [], 'development').kind).toBe('unsupported');
  });
});
