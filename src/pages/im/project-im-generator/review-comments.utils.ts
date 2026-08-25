/**
 * Shaping supplier review comments for the PM's side panel.
 *
 * Kept JSX-free and structural — the inputs are the minimum shape each function needs rather
 * than whole domain objects — so it is unit-testable under the repo's `environment: 'node'`
 * vitest setup, the same discipline as im-manual-status.ts.
 */

import type { IMReviewComment, IMReviewCommentStatus } from '../../../services';

/** The bit of a chapter this module needs. Structural so tests don't build whole IMSections. */
export interface ReviewSectionRef {
  id: string;
  /** Already localized by the caller — this module does no i18n. */
  title: string;
}

export interface ReviewCommentGroup {
  sectionId: string;
  title: string;
  /**
   * True when the chapter the notes point at is no longer in the manual — deleted, or hidden
   * by a condition or SKU scope since the review went out. The panel still lists these; the
   * PM needs to see feedback they can no longer navigate to, not have it silently vanish.
   */
  orphaned: boolean;
  comments: IMReviewComment[];
  openCount: number;
}

export interface ReviewCommentCounts {
  open: number;
  done: number;
  wontFix: number;
  total: number;
}

export const reviewCommentCounts = (comments: readonly IMReviewComment[]): ReviewCommentCounts => ({
  open: comments.filter(c => c.status === 'open').length,
  done: comments.filter(c => c.status === 'done').length,
  wontFix: comments.filter(c => c.status === 'wont_fix').length,
  total: comments.length,
});

/**
 * Group notes by chapter, in the manual's own reading order.
 *
 * Chapters with no notes are omitted — the panel is a work queue, not an outline. Notes whose
 * chapter is gone are collected into trailing groups, after every live chapter, so they never
 * push actionable feedback down the list. Within a group, notes stay in the order they were
 * written, which is the order the reviewer read the chapter in.
 */
export const groupCommentsBySection = (
  comments: readonly IMReviewComment[],
  sections: readonly ReviewSectionRef[],
): ReviewCommentGroup[] => {
  const bySection = new Map<string, IMReviewComment[]>();
  for (const c of comments) {
    const list = bySection.get(c.sectionId);
    if (list) list.push(c);
    else bySection.set(c.sectionId, [c]);
  }

  const groups: ReviewCommentGroup[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const list = bySection.get(section.id);
    if (!list || list.length === 0) continue;
    seen.add(section.id);
    groups.push({
      sectionId: section.id,
      title: section.title,
      orphaned: false,
      comments: list,
      openCount: list.filter(c => c.status === 'open').length,
    });
  }

  for (const [sectionId, list] of bySection) {
    if (seen.has(sectionId)) continue;
    groups.push({
      sectionId,
      // The title snapshotted when the note was written is all that's left of a deleted chapter.
      title: list.find(c => c.sectionTitle)?.sectionTitle ?? 'Removed chapter',
      orphaned: true,
      comments: list,
      openCount: list.filter(c => c.status === 'open').length,
    });
  }

  return groups;
};

/** The bit of a review share this module needs. */
export interface ReviewShareRef {
  submittedAt: string | null;
  manualVersion: number | null;
}

export interface ReviewRoundState {
  /** A review link exists and hasn't been revoked. */
  isOpen: boolean;
  /** The reviewer pressed "Submit review". */
  isSubmitted: boolean;
  /**
   * The manual has been republished since the link went out, so the notes were written
   * against wording that may no longer exist.
   */
  isStale: boolean;
  openCount: number;
}

/**
 * Collapse the round into the four facts the pipeline step and the panel header need.
 *
 * `shares` is every non-revoked review link on this manual — a PM may send the same manual to
 * two suppliers. The round counts as submitted only when EVERY outstanding reviewer has
 * submitted, because one supplier finishing doesn't mean the feedback is all in.
 */
export const reviewRoundStateOf = (
  shares: readonly ReviewShareRef[],
  comments: readonly IMReviewComment[],
  currentVersion: number | null | undefined,
): ReviewRoundState => {
  const openCount = comments.filter(c => c.status === 'open').length;
  if (shares.length === 0) {
    return { isOpen: false, isSubmitted: false, isStale: false, openCount };
  }
  return {
    isOpen: true,
    isSubmitted: shares.every(s => s.submittedAt != null),
    // A link minted before versions were recorded (null) can't be judged stale — say no
    // rather than nagging the PM about a round we have no baseline for.
    isStale: currentVersion != null
      && shares.some(s => s.manualVersion != null && s.manualVersion !== currentVersion),
    openCount,
  };
};

/** Sort order for the triage controls, so every list offers them the same way round. */
export const REVIEW_STATUS_ORDER: IMReviewCommentStatus[] = ['open', 'done', 'wont_fix'];

export const REVIEW_STATUS_LABEL: Record<IMReviewCommentStatus, string> = {
  open: 'Open',
  done: 'Done',
  wont_fix: 'Not changing',
};
