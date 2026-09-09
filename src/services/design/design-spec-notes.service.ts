/**
 * The design team's side of a spec's review notes.
 *
 * Thin on purpose: reading, triaging and replying to a note are the SHARED review layer's
 * (`src/services/review/`), the same code the Instruction Manual's editor panel uses. What
 * this file adds is the addressing — a design spec's notes are fetched for the whole SPEC
 * rather than one version, so the detail page can show the history of every round in one
 * list and say which version each note was written against.
 *
 * That works because one spec per project is a database constraint: (project_id,
 * subject_type='design_spec') identifies the spec, so omitting the subject id returns every
 * version's notes rather than a mixture of several specs'.
 */

import {
  getReviewComments, getReviewReplies, addReviewReply, setReviewCommentStatus,
} from '../review/review-comments.service';
import type { ReviewComment, ReviewReply } from '../../types/review.types';

export { setReviewCommentStatus, addReviewReply };

/** Every note on a project's design spec, across every version, oldest first. */
export const getDesignSpecNotes = (projectId: string): Promise<ReviewComment[]> =>
  getReviewComments({ type: 'design_spec', projectId });

/** Replies on those notes, grouped by the note they answer. */
export const getDesignSpecNoteReplies = async (
  notes: readonly ReviewComment[],
): Promise<Map<string, ReviewReply[]>> => {
  const replies = await getReviewReplies(notes.map(n => n.id));
  const out = new Map<string, ReviewReply[]>();
  for (const r of replies) {
    const list = out.get(r.commentId);
    if (list) list.push(r); else out.set(r.commentId, [r]);
  }
  return out;
};
