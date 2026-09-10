/**
 * The five fixed columns of the projects board, and the rule that puts a project in one.
 *
 * WHY THE COLUMNS ARE HARDCODED. They are the business pipeline an operator reasons about —
 * RFQ, Business Case & Development, Production, Live, Cancelled / On Hold — and all five have
 * to be on screen in that order even when nothing is in them, because an empty column is the
 * answer to "what have we got in production?". A column set derived from the data (as the
 * board's old status grouping was) cannot render a bucket that no project currently occupies.
 *
 * WHY THE PHASE COMES FROM THE CHAPTER STATUSES, NOT `projects.current_step`. The first three
 * buckets are the project's own chapters (`project_steps`, seeded from the default template:
 * 1 RFQ, 2 Business Case & Development, 3 Production — see `supplier-portal-phases.ts`), and
 * each chapter carries a `StepStatus` that the PM sets on the project page. That per-chapter
 * status is the only maintained record of where a launch stands: `current_step` is written
 * once at creation and never advanced, so every project in the database reads step 1. Deriving
 * the bucket from the chapter statuses is what makes the board agree with the project page.
 *
 * Pure and DOM-free so the rule is testable; reading the chapters is the caller's job.
 */

import { ProjectOverallStatus, StepStatus } from '../types';

export type BoardBucketId = 'rfq' | 'development' | 'production' | 'live' | 'onHold';

export interface BoardBucket {
  id: BoardBucketId;
  label: string;
  /**
   * The chapter (`step_number`) this bucket represents, or null for the two buckets that are
   * an overall-status verdict rather than a chapter. `production` is the LAST chapter bucket:
   * a longer template's chapters 4+ collapse into it, because everything after Production
   * starts is still production-side work — see `dropTargetPhase`.
   */
  phase: number | null;
  /** Shown as the column's tooltip: what landing here means, and what dropping here does. */
  hint: string;
}

/** Fixed order. Rendered in full, every time, however empty. */
export const BOARD_BUCKETS: readonly BoardBucket[] = [
  { id: 'rfq', label: 'RFQ', phase: 1, hint: 'Sourcing — the RFQ chapter is still open. Drop here to reopen it.' },
  { id: 'development', label: 'Business Case & Development', phase: 2, hint: 'RFQ is closed and Business Case & Development is open. Drop here to move the project into it.' },
  { id: 'production', label: 'Production', phase: 3, hint: 'The Production chapter is open. Drop here to move the project into it.' },
  { id: 'live', label: 'Live', phase: null, hint: 'Launched. Drop here to mark the project completed.' },
  { id: 'onHold', label: 'Cancelled / On Hold', phase: null, hint: 'Paused or dropped. A card dropped here goes On Hold — cancelling is done on the project page.' },
];

/**
 * Where a project's chapters say it stands.
 *
 * `finished` and `unknown` are kept apart on purpose: a project whose every chapter is
 * complete is Live, whereas one whose chapters could not be read (a role without SELECT on
 * `project_steps`, or a project seeded before templates existed) must not be reported as
 * launched.
 */
export type PhasePosition =
  | { kind: 'phase'; phase: number }
  | { kind: 'finished' }
  | { kind: 'unknown' };

/** The bit of a chapter this module needs. `ProjectStep` satisfies it. */
export interface ChapterLike {
  stepNumber: number;
  status: StepStatus | string;
}

/**
 * The chapter a project is working: the lowest-numbered one that is not complete.
 *
 * Lowest-not-complete rather than highest-touched, so a project that had chapter 3 opened
 * early still reports the RFQ that was never closed — which is the chapter someone has to act
 * on. In-progress, not-started and blocked all count as open; only `completed` is done.
 */
export const activePhase = (chapters: readonly ChapterLike[]): PhasePosition => {
  if (chapters.length === 0) return { kind: 'unknown' };
  const open = chapters.filter(c => c.status !== StepStatus.COMPLETED);
  if (open.length === 0) return { kind: 'finished' };
  return { kind: 'phase', phase: Math.min(...open.map(c => c.stepNumber)) };
};

/** The bucket a chapter number belongs to. Chapters past 3 collapse into Production. */
export const bucketOfPhase = (phase: number): BoardBucketId =>
  phase <= 1 ? 'rfq' : phase === 2 ? 'development' : 'production';

/** The bit of a project this module needs. `Project` satisfies it. */
export interface ProjectLike {
  status: ProjectOverallStatus | string;
  currentStep: number;
}

/**
 * The column a project belongs in.
 *
 * Overall status wins over the chapters: a cancelled project is not "in Production" whatever
 * its chapters say, and a PM who marks a launch completed does not have to go back and tick
 * every chapter to get it out of the pipeline columns.
 */
export const bucketOf = (project: ProjectLike, chapters: readonly ChapterLike[]): BoardBucketId => {
  if (project.status === ProjectOverallStatus.CANCELLED || project.status === ProjectOverallStatus.ON_HOLD) return 'onHold';
  if (project.status === ProjectOverallStatus.COMPLETED) return 'live';

  const position = activePhase(chapters);
  if (position.kind === 'finished') return 'live';
  // Unreadable chapters fall back to `current_step` — which is 1 for every existing project,
  // so the card lands in RFQ rather than dropping off the board.
  if (position.kind === 'unknown') return bucketOfPhase(project.currentStep || 1);
  return bucketOfPhase(position.phase);
};

/**
 * The chapter to open when a card is dropped on a phase column: the lowest chapter the project
 * actually has at or past the column's number.
 *
 * Resolved against the project's own chapters rather than assuming the standard three, because
 * the phase list comes from an editable template. Null when the project has no such chapter —
 * a two-chapter project has nothing to open for Production, and the caller refuses the drop
 * instead of silently doing nothing.
 */
export const dropTargetPhase = (chapters: readonly ChapterLike[], bucketPhase: number): number | null => {
  const at = chapters.map(c => c.stepNumber).filter(n => n >= bucketPhase);
  return at.length === 0 ? null : Math.min(...at);
};

/** The writes a drop implies. `steps` lists only the chapters whose status actually changes. */
export interface BucketDropPlan {
  kind: 'plan';
  /** New overall status, or null to leave it alone. */
  status: ProjectOverallStatus | null;
  /** New `current_step`, or null. Written so the table column stops reading 1 for everything. */
  currentStep: number | null;
  steps: readonly { id: string; status: StepStatus }[];
}

export type BucketDrop =
  | BucketDropPlan
  /** The card is already in that column, or the gesture means nothing. */
  | { kind: 'noop' }
  /** The drop cannot be expressed on this project; `reason` is shown to the operator. */
  | { kind: 'unsupported'; reason: string };

/** A chapter, with the id needed to write its status back. `ProjectStep` satisfies it. */
export interface ChapterRef extends ChapterLike {
  id: string;
}

/**
 * What dropping a card on `target` should do.
 *
 * The two status columns are deliberately asymmetric with the phase columns:
 *
 *  - A phase column rewrites the chapter statuses (everything before the target complete, the
 *    target open, everything after not started) AND forces the overall status back to
 *    in-progress — otherwise a card dragged out of Cancelled / On Hold would bounce straight
 *    back, since status wins in `bucketOf`.
 *  - Live sets the overall status only and leaves the chapters as the PM left them. Ticking
 *    every chapter on the operator's behalf would destroy the record of what was actually
 *    signed off, and it is not needed: `bucketOf` reads `completed` first.
 *  - Cancelled / On Hold sets On Hold, never Cancelled. The column holds both because they are
 *    the same thing to a pipeline view, but a drag is a cheap, reversible gesture and
 *    cancelling a launch is not — that decision stays on the project page. A card already
 *    cancelled therefore sits in the column without a drop being able to change it.
 */
export const planBucketDrop = (
  project: ProjectLike,
  chapters: readonly ChapterRef[],
  target: BoardBucketId,
): BucketDrop => {
  if (bucketOf(project, chapters) === target) return { kind: 'noop' };

  const bucket = BOARD_BUCKETS.find(b => b.id === target);
  if (!bucket) return { kind: 'noop' };

  if (target === 'onHold') {
    return { kind: 'plan', status: ProjectOverallStatus.ON_HOLD, currentStep: null, steps: [] };
  }

  if (target === 'live') {
    return { kind: 'plan', status: ProjectOverallStatus.COMPLETED, currentStep: null, steps: [] };
  }

  const phase = dropTargetPhase(chapters, bucket.phase as number);
  if (phase === null) {
    return {
      kind: 'unsupported',
      reason: `This project has no ${bucket.label} phase. Move it from the project page.`,
    };
  }

  const steps = chapters
    .map(c => ({
      id: c.id,
      status:
        c.stepNumber < phase ? StepStatus.COMPLETED
        : c.stepNumber === phase ? StepStatus.IN_PROGRESS
        : StepStatus.NOT_STARTED,
      was: c.status,
    }))
    .filter(c => c.status !== c.was)
    .map(({ id, status }) => ({ id, status }));

  return {
    kind: 'plan',
    status: project.status === ProjectOverallStatus.IN_PROGRESS ? null : ProjectOverallStatus.IN_PROGRESS,
    currentStep: project.currentStep === phase ? null : phase,
    steps,
  };
};
