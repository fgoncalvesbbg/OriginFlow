/**
 * Which phase of a supplier's project the design spec blocks hang under.
 *
 * The supplier portal lists a project's phases and the documents due in each. Design specs
 * join that list rather than sitting in a panel of their own: a draft out for review is work
 * due in the development phase, and the issued final is what production builds to. Anything
 * appended below the phase list would read as reference material — which is exactly how the
 * spec was being treated before, when it reached the factory as an emailed URL.
 *
 * WHY NUMBERS AND NOT IDS. Phases come from an editable template (`template_steps`, migration
 * 152), so there is no fixed row to point at. The standard template numbers them 1 RFQ,
 * 2 Business Case & Development, 3 Production, and that numbering is what these constants
 * name. A template that has been shortened or renamed still gets the blocks, on its last
 * phase — see `phaseStep`.
 *
 * Pure and DOM-free so the fallback is testable; reading the project's phases is the
 * component's job.
 */

/** Development — where a draft goes out for the supplier to mark up. */
export const DESIGN_REVIEW_PHASE = 2;

/** Production — where the issued final lives, and where it is looked for. */
export const DESIGN_FINAL_PHASE = 3;

/** The bit of a phase this module needs. `ProjectStep` satisfies it. */
export interface PhaseLike {
  stepNumber: number;
}

/**
 * The phase number to render a block under, given the phases a project actually has.
 *
 * Falls back to the LAST phase rather than to nothing. A project on a two-phase template has
 * no phase 3, and dropping the issued final on the floor for it would hide the one document
 * the factory must build to — whereas showing it under that template's final phase is still
 * true to what the phase means. Returns null only when the project has no phases at all,
 * where there is no list to hang anything on.
 */
export const phaseStep = (steps: readonly PhaseLike[], preferred: number): number | null => {
  if (steps.length === 0) return null;
  if (steps.some(s => s.stepNumber === preferred)) return preferred;
  return Math.max(...steps.map(s => s.stepNumber));
};
