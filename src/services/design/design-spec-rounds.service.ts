/**
 * Review-round state for design specs, in the shape `design-spec-status.ts` derives from.
 *
 * A thin projection over the shared review layer's `getReviewRounds`, keyed by the review
 * subject id — which for a design spec is the VERSION id, because a spec runs a separate
 * round per version.
 *
 * The one subtlety: a subject appears in the shared map for EITHER of two reasons — it has
 * a live link, or it has open notes. So "present in the map" does not mean "out with a
 * reviewer": a version whose last link was revoked while notes were still open is in there
 * too, and `submitted` reads true for it because that flag is only falsified by an
 * outstanding link. `liveLinks` is what separates the two, and revoking the last link is
 * what genuinely ends a round.
 */

import { getReviewRounds, reviewRoundKey } from '../review/review-comments.service';
import type { DesignSpecRoundInput } from '../../pages/design/design-spec-status';

/**
 * Rounds for every design spec version that has one, keyed by version id.
 *
 * A version that was never sent is simply absent, so a caller does `rounds.get(versionId)`
 * and treats `undefined` as "never sent". Returns null on failure rather than an empty map,
 * because "the query failed" must render as Status unknown and not as a healthy In Progress
 * — the same rule the IM's staleness check follows.
 */
export const getDesignSpecRounds = async (): Promise<Map<string, DesignSpecRoundInput> | null> => {
  let shared: Awaited<ReturnType<typeof getReviewRounds>>;
  try {
    shared = await getReviewRounds(['design_spec']);
  } catch (e) {
    console.error('[getDesignSpecRounds] failed:', e);
    return null;
  }

  const out = new Map<string, DesignSpecRoundInput>();
  for (const [key, summary] of shared) {
    // reviewRoundKey builds `${projectId}::design_spec::${versionId}`; the version id is
    // the only part a caller has in hand, so unpack from the end.
    const versionId = key.split('::').pop();
    if (!versionId) continue;
    out.set(versionId, {
      hasLiveLink: summary.liveLinks > 0,
      allSubmitted: summary.submitted,
      openCount: summary.openCount,
    });
  }
  return out;
};

export { reviewRoundKey };
