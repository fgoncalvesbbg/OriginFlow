/**
 * The IM workflow — one vocabulary for every surface that shows "where is this manual".
 *
 *   Supplier Draft Upload → Draft Review →
 *   Backlog → In Progress → In Review (draft) → Rework → In Review (final) → Final
 *   → Republish Needed
 *
 * The first two are the supplier draft intake (migration 179) and are derived by
 * `draftStepOf`, NOT by `manualStatusOf` — see the note below. The rest are the manual's own
 * life and are unchanged.
 *
 * These nine steps are what the business actually runs, and they are the ONLY step names
 * the UI is allowed to use: the All Manuals board columns, the table's group headings, the
 * generator's header chip and the generator's pipeline stepper all read from here. Two
 * screens describing the same manual with different words is the confusion this module
 * exists to prevent.
 *
 * NOTHING here is stored as a workflow column. Every step is DERIVED from facts that already
 * had to be true — publish state, the FINAL lock, the review round stamped on the manual —
 * so a step can never disagree with the manual it describes, and no one can drag a card into
 * a state the data does not support.
 *
 * The derivation, strongest claim first:
 *
 *  1. `done`              `isFinalized`. Final — signed off and locked. Overrides everything:
 *                         once a PM marks a manual final, that is the fact that matters
 *                         most. Publish drift still shows as a secondary flag (see
 *                         `manualFlagsOf`) — it just doesn't move the card.
 *  2. `draft_review` /    a review round is live for the CURRENT published version. Which of
 *     `final_review`      the two it is comes from `reviewStage` (migration 149).
 *                         Deliberately ABOVE the staleness check: a manual that is out with a
 *                         supplier must not silently leave the review column because a shared
 *                         block changed underneath it — the supplier is still reading it, and
 *                         yanking the card hides the round that is actually in flight. The
 *                         drift is reported as a flag on the card instead.
 *  3. `republish_needed`  published, but a template or shared block changed since.
 *  4. `unknown`           published, and the staleness check itself FAILED. Never rendered as
 *                         a healthy step — an error must not read as a clean bill of health.
 *  5. `adjust_im`         has been through a review round, and the PM has edited or
 *                         republished since (which is exactly what ends a round). This is the
 *                         "work the supplier's notes" step.
 *  6. `in_progress`       everything else: authored, maybe published, never reviewed.
 *
 * `backlog` is the one step no manual can be in — it means the project has NOTHING started:
 * no IM and no Warning Leaflet, of any status. The dashboard synthesises those cards from the
 * project list (`getBacklogProjects`); `manualStatusOf` never returns it. It lives in this
 * vocabulary anyway so the column, its label and its position are defined in exactly one
 * place like every other step. Creating either document as a draft is what empties it.
 *
 * Backlog is ALSO where a checked draft lands. There used to be a `draft_ready` step between
 * the two, and it said nothing Backlog did not: both mean "no manual yet, a writer can pick
 * this up", and a project sat in one or the other purely by whether a draft happened to
 * exist. Two columns for one piece of work is a column too many, so Quality marking the
 * draft reviewed now moves the project straight to Backlog — with the draft and Quality's
 * notes attached to it as the brief (`ProjectIMDraftPanel`, which is always on the
 * generator). The brief is a better starting point, not a different step.
 *
 * THE SAME IS TRUE OF THE TWO DRAFT STEPS, and more so. `draft_requested` and
 * `draft_qm_review` describe a supplier's draft PDF, not a manual — a project in either of
 * them has no project_ims row for `manualStatusOf` to read. They are refinements of that
 * same synthesised Backlog, derived by `draftStepOf` from the draft tables (migration 179),
 * and `manualStatusOf` returns neither — there is a test asserting exactly that.
 *
 * This is what makes the draft a pre-step rather than a gate. The draft NEVER blocks
 * authoring: the moment a manual exists it is the stronger fact and the card moves to
 * In Progress, whatever the draft is doing. A project cannot be stuck waiting on a supplier
 * who never uploads, because a writer was never stopped from starting.
 *
 * Three STORED KEYS predate the business names above and were deliberately left alone, so
 * that renaming a column never has to touch a switch statement:
 *
 *   draft_review / final_review  →  In Review (draft) / In Review (final)
 *   adjust_im                    →  Rework
 *   done                         →  Final
 *
 * MANUAL_STATUS_META is the ONLY place a step's words are written. Read a label from there
 * rather than typing one, and the key it hangs off stops mattering.
 *
 * Note what is NOT a step: publishing. A PM publishes to make a review possible and
 * republishes after adjusting, several times per manual — it is an action inside In Progress
 * and Re-edit, not a place a manual rests. It shows up as the version on the card and as
 * the `Published` readiness check in the generator.
 */

import type { IMReviewStage, ProjectKind } from '../../types';

export type ManualStatus =
  | 'draft_requested'
  | 'draft_qm_review'
  | 'backlog'
  | 'in_progress'
  | 'draft_review'
  | 'adjust_im'
  | 'final_review'
  | 'done'
  | 'republish_needed'
  | 'unknown';

/** The fields this module needs. Kept structural so tests don't build a whole summary. */
export interface ManualStatusInput {
  status: 'draft' | 'generated';
  isFinalized: boolean;
  /** Publish counter + supplier review round (migrations 111/149, stamped by
   *  setProjectIMReviewRequested). Optional: rows that predate the feature (or callers
   *  that don't track reviews) derive as before. */
  version?: number | null;
  reviewRequestedAt?: string | null;
  reviewVersion?: number | null;
  /**
   * Which review step the current round is — 'draft' → Draft Review, 'final' → Final Review.
   * Null/absent reads as 'draft': a round with no recorded stage predates migration 149, and
   * placing it in Draft Review claims less than placing it in Final Review would.
   */
  reviewStage?: IMReviewStage | null;
  /**
   * Whether a review LINK is still live (minted, not revoked).
   *
   * The review columns on the manual are never cleared — that is deliberate, and it is what
   * makes the step derivable in one query. But revoking the last link genuinely ends a round,
   * and the columns cannot say so. Without this, revoking a link ended the round in the
   * editor (which reads the links) while the board went on showing the manual as out with a
   * supplier who can no longer open it.
   *
   * `false` = every link is gone, the round is over. Null/absent = the caller has no link
   * data, in which case the columns are believed as before rather than second-guessed.
   */
  hasLiveReviewLink?: boolean | null;
}

/**
 * True while the manual's CURRENT published version is out with a supplier for review.
 * Editing (stored status back to 'draft') or republishing (version bump past
 * reviewVersion) ends it implicitly — nothing is ever cleared. A null reviewVersion
 * (a legacy round without a stamped version) counts as current.
 *
 * This is also what moves a card OUT of a review column: the PM touching the manual is the
 * signal that they have taken the supplier's feedback on, which is the Re-edit step.
 */
export const isInReview = (
  im: Pick<ManualStatusInput, 'status' | 'version' | 'reviewRequestedAt' | 'reviewVersion' | 'hasLiveReviewLink'>,
): boolean =>
  im.status === 'generated' &&
  im.reviewRequestedAt != null &&
  im.hasLiveReviewLink !== false &&
  (im.reviewVersion == null || im.version == null || im.reviewVersion === im.version);

/** Has this manual ever been sent to a supplier? Decides In Progress vs Re-edit. */
export const hasBeenReviewed = (im: Pick<ManualStatusInput, 'reviewRequestedAt'>): boolean =>
  im.reviewRequestedAt != null;

/** The two steps a supplier holds the ball in. */
export const isReviewStep = (status: ManualStatus): boolean =>
  status === 'draft_review' || status === 'final_review';

// ---------------------------------------------------------------------------
// The draft intake steps — migration 179.
// ---------------------------------------------------------------------------

/**
 * The three steps a project can be in BEFORE a manual exists. Two are the supplier draft
 * intake; `backlog` is the one that was always here, and it is where a checked draft lands.
 *
 * These are refinements of the synthesised Backlog, NOT states of a manual, and that is the
 * whole reason `manualStatusOf` does not know about them. The draft never blocks authoring:
 * the moment a project_ims row exists the card is a manual and `manualStatusOf` decides,
 * exactly as before. A project can therefore be in Draft Review and have a writer already
 * working — the writer's card simply wins, because a started manual is the stronger fact.
 */
export type DraftStep = Extract<
  ManualStatus,
  'draft_requested' | 'draft_qm_review' | 'backlog'
>;

/** The facts `draftStepOf` needs. Structural, so tests need not build a whole project. */
export interface DraftStatusInput {
  /** A live im_draft_requests row — one that exists and is not cancelled. */
  hasOpenRequest: boolean;
  /** At least one im_draft_uploads row against that request. */
  hasUpload: boolean;
  /** Quality pressed Submit on the review round for the LATEST upload. */
  draftSubmitted: boolean;
  /**
   * Whether the project has REACHED the phase the request lives in
   * (`projects.current_step >= im_draft_requests.step_number`, migration 180).
   *
   * Absent reads as true, so a caller that does not track phases behaves as it did before
   * 180 rather than silently hiding every request.
   */
  reachedStep?: boolean;
  /**
   * What the project IS (migration 182). A re-edit carries its requirement from the moment
   * it is created, so it has no intake to wait on. Absent reads as `'launch'`.
   */
  kind?: ProjectKind;
}

/**
 * Which pre-manual step a project sits in, strongest claim first.
 *
 * A SUBMITTED DRAFT IS BACKLOG. Quality marking the draft reviewed ends the intake: the
 * brief exists, nobody is waiting on anybody, and the project is a plain "ready to be
 * written" — which is what Backlog means. The draft does not disappear with the step; it
 * stays attached to the project and the writer opens it from the generator whenever they
 * start. `draftSubmitted` is tested before everything else so this survives someone later
 * cancelling the request: cancelling says "no further draft is coming", and it cannot
 * un-write notes that have already been made.
 *
 * TWO SEPARATE GUARDS AGAINST PARKING, and they do different jobs:
 *
 *   `hasOpenRequest`  someone said this draft is not coming (cancelled), or never asked.
 *   `reachedStep`     nobody is late yet — the launch has not got to the phase that asks.
 *
 * The second became load-bearing in migration 180, when the request stopped being something
 * a PM opened by hand and became standard on every launch. Without it, every project would
 * enter Supplier Draft Upload the day it is created — including one still in RFQ, which is
 * not waiting on a draft manual by any reading — and Backlog would empty out.
 *
 * An upload already in flight is checked BEFORE `reachedStep`: if a supplier has sent
 * something, that work is real and showing it as Backlog because of a phase number would
 * hide it.
 */
export const draftStepOf = (d: DraftStatusInput): DraftStep => {
  /**
   * A RE-EDIT HAS NO INTAKE. Its requirement — what must change and why — is mandatory at
   * creation (migration 182 enforces it), so there is never a moment where the work is
   * waiting on a brief. It is the re-edit's equivalent of a submitted supplier draft, which
   * is why it lands in the same place a submitted draft does: plain Backlog, ready to write.
   *
   * Checked first, ahead of even `draftSubmitted`, because a re-edit has no supplier to ask
   * and so none of the facts below can be anything but false for it.
   */
  if (d.kind === 'reedit') return 'backlog';
  if (d.draftSubmitted) return 'backlog';
  if (!d.hasOpenRequest) return 'backlog';
  if (d.hasUpload) return 'draft_qm_review';
  return d.reachedStep === false ? 'backlog' : 'draft_requested';
};

/** True for the steps that describe a draft rather than a manual. */
export const isDraftStep = (status: ManualStatus): boolean =>
  status === 'draft_requested' || status === 'draft_qm_review';

/**
 * `isStale`: true = out of date, false = up to date, null = THE CHECK FAILED. The null
 * case exists so a failed staleness check renders as "Status unknown" instead of a green
 * "Published" — an error must never be displayed as a clean bill of health.
 */
export const manualStatusOf = (im: ManualStatusInput, isStale: boolean | null): ManualStatus => {
  if (im.isFinalized) return 'done';
  if (isInReview(im)) return im.reviewStage === 'final' ? 'final_review' : 'draft_review';
  if (im.status === 'generated') {
    if (isStale === null) return 'unknown';
    if (isStale) return 'republish_needed';
  }
  return hasBeenReviewed(im) ? 'adjust_im' : 'in_progress';
};

/**
 * Which review step a NEW review link should open, given where the manual stands now.
 *
 * This is the rule that makes "create a link and the card moves to the review step" work
 * without asking: the stage is simply the review step that FOLLOWS the manual's current one.
 * From Backlog / In Progress the next review is the draft one; from Re-edit — i.e. the
 * supplier has already had a draft pass — it is the final one. Re-sending while a round is
 * open keeps that round's own stage rather than promoting the manual by accident.
 *
 * The PM can override it in the send dialog; this only picks the default.
 */
export const nextReviewStageFor = (status: ManualStatus, everReviewed: boolean): IMReviewStage => {
  if (status === 'draft_review') return 'draft';
  if (status === 'final_review' || status === 'adjust_im') return 'final';
  // done / republish_needed / unknown / in_progress / backlog — a manual that has already had a
  // supplier pass is past the draft review wherever it currently sits.
  return everReviewed ? 'final' : 'draft';
};

// ---------------------------------------------------------------------------
// Printed IM freshness — a SEPARATE, smaller vocabulary, on purpose.
//
// The Printed IM is not a workflow item: it is the Digital IM's own content exported for
// fewer languages, so it has no supplier reviews, no sign-off of its own and no place on
// the board. Describing a PDF with workflow words ("In Progress", "Re-edit") would say
// something untrue about it. It shares the TONES above — same five meanings — and nothing
// else.
// ---------------------------------------------------------------------------

export type PrintedStatus = 'not_printed' | 'out_of_date' | 'printed' | 'done' | 'unknown';

/**
 * Where the print run stands. Fully DERIVED, never a stored flag: "Done" means the Digital
 * IM itself is final AND a print PDF exists for exactly the currently-selected printed
 * languages AND that PDF matches the manual's current version. `hasRender` = such a PDF
 * exists at all; `isStale` mirrors the Digital IM's own staleness check (null = check
 * failed/unknown, which must never render as a healthy "Printed").
 */
export const printedManualStatusOf = (
  digitalIsFinalized: boolean,
  hasRender: boolean,
  isStale: boolean | null,
): PrintedStatus => {
  if (!hasRender) return 'not_printed';
  if (isStale === null) return 'unknown';
  if (isStale) return 'out_of_date';
  return digitalIsFinalized ? 'done' : 'printed';
};

export const PRINTED_STATUS_META: Record<PrintedStatus, { label: string; classes: string; hint: string }> = {
  not_printed: {
    label: 'Not printed',
    classes: 'bg-gray-100 text-gray-600 border-gray-200',
    hint: 'No print PDF has been rendered for the selected printed languages yet.',
  },
  printed: {
    label: 'Printed',
    classes: 'bg-amber-100 text-amber-700 border-amber-200',
    hint: 'A current print PDF exists, but the manual behind it is not signed off yet.',
  },
  out_of_date: {
    label: 'Out of date',
    classes: 'bg-orange-100 text-orange-700 border-orange-200',
    hint: 'The manual changed after this print PDF was rendered — render it again.',
  },
  done: {
    label: 'Done',
    classes: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    hint: 'A current print PDF exists for a signed-off manual.',
  },
  unknown: {
    label: 'Status unknown',
    classes: 'bg-gray-100 text-gray-600 border-gray-200',
    hint: 'The up-to-date check failed — this PDF may or may not be current. Retry the check.',
  },
};

export interface ManualStatusMeta {
  label: string;
  /** Badge classes, following the project's tinted-pill status vocabulary. */
  classes: string;
  /** Group heading blurb: what this step means and what to do about it. */
  hint: string;
  /** True when the ball is in someone else's court — the PM is waiting, not working. */
  waiting?: boolean;
}

/**
 * Step colour is a MEANING, not decoration, and each hue is used for one meaning only:
 *
 *   gray     nothing has started
 *   amber    the PM has work to do
 *   sky      out with a supplier, waiting
 *   emerald  finished — the review closed, or the manual is signed off
 *   orange   published output has drifted and must be regenerated
 *
 * Every label is also carried in text (DESIGN.md's Color-Plus-Shape Rule), so the hue only
 * ever has to say which of those five it is.
 */
export const MANUAL_STATUS_META: Record<ManualStatus, ManualStatusMeta> = {
  draft_requested: {
    label: 'Supplier Draft Upload',
    classes: 'bg-sky-100 text-sky-700 border-sky-200',
    hint: 'A draft manual has been requested from the supplier and they have not uploaded it yet. Nothing here blocks a writer — the project can be started at any time.',
    waiting: true,
  },
  draft_qm_review: {
    label: 'Draft Review',
    classes: 'bg-sky-100 text-sky-700 border-sky-200',
    hint: 'The supplier has uploaded a draft and Quality is marking it up. Open the markup, and mark it reviewed when you are done — the project then moves to Backlog with the notes as the brief.',
    waiting: true,
  },
  backlog: {
    label: 'Backlog',
    classes: 'bg-gray-100 text-gray-600 border-gray-200',
    hint: 'Nothing written yet — no IM and no leaflet. Some of these have a checked supplier draft waiting as a brief, which the writer sees on the manual. Create either document as a draft and the project moves to In Progress.',
  },
  in_progress: {
    label: 'In Progress',
    classes: 'bg-amber-100 text-amber-700 border-amber-200',
    hint: 'Being authored. Publish, then send the draft review to the supplier.',
  },
  draft_review: {
    label: 'In Review (draft)',
    classes: 'bg-sky-100 text-sky-700 border-sky-200',
    hint: 'Out with the supplier for the first pass. Turns green once they close their review.',
    waiting: true,
  },
  adjust_im: {
    // "Rework", not "Re-edit": a Re-Edit is now a KIND OF PROJECT (migration 182) — a new
    // manual for a SKU that is already live — whereas this step is a manual coming back
    // from its supplier review with notes to work. Two different things in the same status
    // dropdown needed two different words. The stored key stays `adjust_im`.
    label: 'Rework',
    classes: 'bg-amber-100 text-amber-700 border-amber-200',
    hint: 'The supplier has been through it — work their notes, then send the final review.',
  },
  final_review: {
    label: 'In Review (final)',
    classes: 'bg-sky-100 text-sky-700 border-sky-200',
    hint: 'Out with the supplier to confirm the adjustments. Turns green once they close it.',
    waiting: true,
  },
  done: {
    label: 'Final',
    classes: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    hint: 'Signed off and locked. Unlock a manual in its editor before changing it.',
  },
  republish_needed: {
    label: 'Republish Needed',
    classes: 'bg-orange-100 text-orange-700 border-orange-200',
    hint: 'A template or shared block changed after these were published.',
  },
  unknown: {
    label: 'Status unknown',
    classes: 'bg-gray-100 text-gray-600 border-gray-200',
    hint: 'The up-to-date check failed — these may or may not need a re-publish. Retry the check.',
  },
};

/**
 * The workflow, in order. ONE order, used by the board columns, the table's groups and the
 * status filter alike — a board that reads left-to-right and a table that reads by urgency
 * would be two different mental models of the same nine steps.
 *
 * `unknown` trails the nine because it is not a step: it is the staleness check having
 * failed, and it appears only while that is true.
 */
export const MANUAL_STATUS_ORDER: readonly ManualStatus[] = [
  'draft_requested',
  'draft_qm_review',
  'backlog',
  'in_progress',
  'draft_review',
  'adjust_im',
  'final_review',
  'done',
  'republish_needed',
  'unknown',
];

// ---------------------------------------------------------------------------
// Review-round tone — the "green when the supplier closes it" rule.
// ---------------------------------------------------------------------------

/**
 * A review step means two different things to the PM and must not look the same:
 *
 *   sky      still out with the supplier — nothing to do but wait
 *   emerald  the supplier submitted; the round is CLOSED and the next step is unblocked
 *
 * "Closed" is the supplier pressing Submit, and nothing else. It is deliberately NOT
 * "submitted with zero open notes": triaging the notes is the PM's own work and it happens
 * in Re-edit, so gating the green on it would hide the one fact the board exists to
 * surface — that the ball has come back.
 *
 * `submitted` is null when the round's outcome hasn't loaded; unknown reads as still out.
 */
export const reviewStepClasses = (submitted: boolean | null | undefined): string =>
  submitted
    ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : 'bg-sky-100 text-sky-700 border-sky-200';

/** Badge classes for any step, with the review steps going green once the supplier closes. */
export const statusClasses = (status: ManualStatus, submitted?: boolean | null): string =>
  isReviewStep(status) ? reviewStepClasses(submitted) : MANUAL_STATUS_META[status].classes;

/** Badge text for any step. A closed review says so — "In Review (draft) · closed". */
export const statusLabel = (status: ManualStatus, submitted?: boolean | null): string =>
  isReviewStep(status) && submitted
    ? `${MANUAL_STATUS_META[status].label} · closed`
    : MANUAL_STATUS_META[status].label;

// ---------------------------------------------------------------------------
// Secondary flags — facts that are true ALONGSIDE the step, and must not move the
// card. A step answers "whose turn is it"; a flag answers "and what is wrong with it".
// Folding these into the step is what used to let a manual sit in Done while its
// published output was two versions behind, with nothing on screen saying so.
// ---------------------------------------------------------------------------

export type ManualFlagKey = 'out_of_date' | 'unpublished_edits' | 'never_published';

export interface ManualFlag {
  key: ManualFlagKey;
  label: string;
  title: string;
  classes: string;
}

export interface ManualFlagInput extends ManualStatusInput {
  version?: number | null;
}

/**
 * Warnings to show next to the step badge, worst first. Empty is the normal case.
 *
 * Each is suppressed where the step badge already says it: a card in Republish Needed does
 * not also need an "Out of date" chip.
 */
export const manualFlagsOf = (im: ManualFlagInput, isStale: boolean | null): ManualFlag[] => {
  const status = manualStatusOf(im, isStale);
  const flags: ManualFlag[] = [];

  if (isStale === true && status !== 'republish_needed') {
    flags.push({
      key: 'out_of_date',
      label: 'Out of date',
      title: 'A template or shared block changed since this was published — republish to pick it up.',
      classes: 'bg-orange-100 text-orange-700 border-orange-200',
    });
  }

  // Published once, edited since. The editor and the published manual disagree, and only the
  // version number hinted at it before.
  if (im.status === 'draft' && (im.version ?? 0) > 0) {
    flags.push({
      key: 'unpublished_edits',
      label: 'Unpublished edits',
      title: `Edited after v${im.version} — the published manual is still v${im.version}. Publish to update it.`,
      classes: 'bg-amber-100 text-amber-700 border-amber-200',
    });
  }

  // Signed off without ever having been published. Four manuals in the live database are in
  // exactly this state; the board used to show them as a plain, healthy Done.
  if (im.isFinalized && (im.version ?? 0) === 0) {
    flags.push({
      key: 'never_published',
      label: 'Never published',
      title: 'This manual is marked FINAL but has never been published — there is no online manual behind it.',
      classes: 'bg-orange-100 text-orange-700 border-orange-200',
    });
  }

  return flags;
};

// ---------------------------------------------------------------------------
// Next action — the one-line "what do I do with this card" hint that turns the
// board into a work queue. Deliberately quiet when there is nothing to do (null),
// and silent about things the step badge/hint already says.
// ---------------------------------------------------------------------------

export interface NextActionInput {
  status: ManualStatus;
  /** Publish counter (0 = never published). */
  version?: number | null;
  reviewRequestedAt?: string | null;
  /** The supplier pressed Submit on every outstanding link. Null = outcome not loaded. */
  reviewSubmitted?: boolean | null;
  /** Supplier notes still to be handled; null/undefined = count unknown. */
  reviewActiveThreads?: number | null;
  /**
   * im_version of the manual's NEWEST print render. undefined = render data not
   * loaded (say nothing); null = never printed.
   */
  printedVersion?: number | null;
  /**
   * When the supplier draft was requested (im_draft_requests.requested_at). Drives the
   * "waiting N days" line on Supplier Draft Upload; absent = say it without the age.
   */
  draftRequestedAt?: string | null;
  /** Quality's notes on the ready draft. Null/undefined = count not loaded. */
  draftNoteCount?: number | null;
  /**
   * Whether Quality has been through the supplier's draft and marked it reviewed.
   *
   * Needed because the step alone no longer says so: a checked draft IS Backlog, and Backlog
   * with a brief waiting reads very differently to Backlog with nothing at all. The note
   * count cannot stand in for it — a draft can be checked and have nothing wrong with it.
   */
  draftReady?: boolean;
}

/** Days between an ISO instant and now, floored at 0. */
const daysSince = (iso: string, now: number): number =>
  Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));

/** Print-freshness fragment shared by the settled steps. Null = fine or unknown. */
const printHint = (version: number | null | undefined, printedVersion: number | null | undefined): string | null => {
  if (printedVersion === undefined) return null;             // render data not loaded
  if (printedVersion === null) return 'no print PDF yet';
  if (version != null && printedVersion < version) return `print PDF is v${printedVersion} — regenerate for v${version}`;
  return null;
};

const notesFragment = (open: number | null | undefined): string | null =>
  typeof open === 'number' && open > 0 ? `${open} open note${open === 1 ? '' : 's'}` : null;

export const nextActionOf = (im: NextActionInput, now: number = Date.now()): string | null => {
  switch (im.status) {
    case 'draft_requested':
      return im.draftRequestedAt
        ? (() => {
            const d = daysSince(im.draftRequestedAt!, now);
            return d === 0
              ? 'requested today — waiting on the supplier'
              : `waiting on the supplier — ${d} day${d === 1 ? '' : 's'}`;
          })()
        : 'waiting on the supplier to upload the draft';
    case 'draft_qm_review':
      return 'supplier draft in — open the markup, then mark it reviewed';
    case 'backlog': {
      // Backlog says two different things now, and the difference is the whole reason the
      // draft steps exist: a project with a checked draft comes with a brief.
      if (!im.draftReady) return 'nothing started — open the project to create its IM or leaflet';
      const notes = notesFragment(im.draftNoteCount);
      return notes
        ? `quality draft ready · ${notes} — start the IM with it as the brief`
        : 'quality draft ready — start the IM with it as the brief';
    }
    case 'in_progress':
      return (im.version ?? 0) > 0
        ? `published v${im.version} — send for draft review`
        : 'not published yet';
    case 'draft_review':
    case 'final_review': {
      // Closed: the supplier is done and the card has gone green — say what unblocks next,
      // not how long it has been out.
      if (im.reviewSubmitted) {
        const notes = notesFragment(im.reviewActiveThreads);
        return im.status === 'draft_review'
          ? `review closed${notes ? ` · ${notes}` : ''} — start adjusting`
          : `review closed${notes ? ` · ${notes}` : ''} — mark it Final`;
      }
      const parts: string[] = [];
      if (im.reviewRequestedAt) {
        const d = daysSince(im.reviewRequestedAt, now);
        parts.push(d === 0 ? 'sent today' : `out ${d} day${d === 1 ? '' : 's'}`);
      }
      const notes = notesFragment(im.reviewActiveThreads);
      if (notes) parts.push(notes);
      return parts.join(' · ') || null;
    }
    case 'adjust_im': {
      const notes = notesFragment(im.reviewActiveThreads);
      return notes
        ? `${notes} to handle, then send the final review`
        : 'notes handled — publish and send the final review';
    }
    case 'done':
      return printHint(im.version, im.printedVersion);
    default:
      // republish_needed carries its own stale-language line; unknown has its hint.
      return null;
  }
};

/**
 * Bucket manuals by derived step, preserving the incoming order within each group and
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
