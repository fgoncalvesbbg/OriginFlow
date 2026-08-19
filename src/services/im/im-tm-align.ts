/**
 * Align a whole-fragment translation back onto its source segments, so the result can
 * be stored in the translation memory.
 *
 * WHY THIS EXISTS: the engine is given a whole fragment (one paragraph, one cell, one
 * title) and returns a whole fragment. The memory stores SEGMENTS. Without alignment
 * nothing the AI path produces can ever be remembered, and the corpus stays empty —
 * which makes the entire feature inert.
 *
 * WHY IT IS PARANOID: mis-alignment is the worst failure mode in the whole design. A
 * wrong pairing writes a target under the wrong source key, where it will later be
 * auto-applied to unrelated content across every market and every future product, and
 * be inherited as a reference by every fuzzy match. Unlike a cache miss, there is no
 * un-poisoning pass.
 *
 * So the gates below reject the whole fragment on ANY doubt. Concretely, alignment is
 * accepted only when the translated fragment has:
 *
 *   1. exactly the same number of segments as the source,
 *   2. the same container kind for each segment, in order, and
 *   3. an IDENTICAL, ORDERED token identity sequence for each segment.
 *
 * Rule 3 is stricter than it needs to be — a translator legitimately reorders chips for
 * target word order, and such a fragment is rejected rather than reordered into place.
 * That is deliberate: making the sequences identical is what lets the target's own
 * `{{Tn:...}}` numbering be stored verbatim, with no renumbering step that could pair
 * two same-identity chips carrying different payloads. Most formulaic manual sentences
 * carry zero or one token, so the rule costs little and removes a class of silent
 * corruption entirely.
 *
 * A rejected fragment is simply not remembered. It is still translated and still shown
 * to the user; the only loss is a little future leverage.
 */

import { normalizeLocale } from '../../config/im-locales';
import { renderPlaceholderValue } from './im-tm-placeholders';
import { segmentFragment } from './im-tm-segment';
import type { TmSourceUnit } from './im-tm-core';
import type { ExtractedPlaceholder, Segment, SegmentedFragment } from './im-tm-types';

export interface AlignedSegment {
  /** Index of the SOURCE segment this target belongs to. */
  segmentIndex: number;
  /** The placeholdered target, ready to store as `im_tm_segments.target_text`. */
  targetText: string;
  /** The source unit, for the keys and metadata the row needs. */
  unit: TmSourceUnit;
}

export type AlignmentRejection =
  | 'segment_count_differs'
  | 'container_differs'
  | 'token_sequence_differs'
  | 'placeholder_not_found'
  | 'placeholder_ambiguous'
  | 'source_ineligible'
  | 'nothing_to_align';

export interface AlignmentResult {
  aligned: AlignedSegment[];
  /** Set when nothing was aligned, naming the gate that refused. */
  rejection?: AlignmentRejection;
  /** Human-readable detail for a run report. */
  detail?: string;
}

const REJECT = (rejection: AlignmentRejection, detail?: string): AlignmentResult => ({
  aligned: [],
  rejection,
  detail,
});

const sameSequence = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const countOccurrences = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  let n = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return n;
    n++;
    from = at + needle.length;
  }
};

/**
 * Replace each source placeholder VALUE in the translated segment with its `{{Pn}}`
 * marker, so the row can be reused with different values later.
 *
 * The target may carry the value in the target locale's number format ("2,5 l" for a
 * source "2.5 l"), so both forms are tried. A value that cannot be found, or that
 * appears more than once, rejects the segment: guessing which occurrence to
 * placeholder is exactly the kind of near-miss that produces a confidently wrong
 * specification later.
 */
const placeholderizeTarget = (
  targetKeyText: string,
  placeholders: readonly ExtractedPlaceholder[],
  targetLocale: string,
): { text: string } | { rejection: AlignmentRejection; detail: string } => {
  let text = targetKeyText;

  for (let i = 0; i < placeholders.length; i++) {
    const p = placeholders[i];
    const localized = renderPlaceholderValue(p, targetLocale);
    const candidates = localized === p.value ? [p.value] : [localized, p.value];

    let chosen: string | null = null;
    for (const candidate of candidates) {
      const hits = countOccurrences(text, candidate);
      if (hits === 1) {
        chosen = candidate;
        break;
      }
      if (hits > 1) {
        return {
          rejection: 'placeholder_ambiguous',
          detail: 'the value "' + candidate + '" appears more than once in the translation',
        };
      }
    }
    if (chosen === null) {
      return {
        rejection: 'placeholder_not_found',
        detail: 'the value "' + p.value + '" does not appear in the translation',
      };
    }
    text = text.replace(chosen, '{{P' + i + '}}');
  }

  return { text };
};

export interface AlignOptions {
  targetLocale: string;
  /** Must be the SAME list used when the source was segmented, or boundaries can differ. */
  protectedPhrases?: string[];
}

/**
 * Align a translated fragment onto the source units it came from.
 *
 * `sourceUnits` must be the TRANSLATABLE units of `sourceSegmented`, in order, as
 * produced by `buildTmSourceUnits`. Never throws.
 */
export const alignTargetToSource = (
  sourceUnits: readonly TmSourceUnit[],
  sourceSegmented: SegmentedFragment,
  targetHtml: string,
  opts: AlignOptions,
): AlignmentResult => {
  if (sourceSegmented.ineligibleReason) {
    return REJECT('source_ineligible', 'the source fragment could not be segmented safely');
  }
  if (!sourceUnits.length) return REJECT('nothing_to_align');

  const targetLocale = normalizeLocale(opts.targetLocale);
  const targetSegmented = segmentFragment(targetHtml, {
    // The abbreviation exception list is per language, and the target IS the target
    // language — segmenting it with the source's list would cut in the wrong places.
    sourceLang: targetLocale.split('-')[0],
    protectedPhrases: opts.protectedPhrases,
  });

  if (targetSegmented.ineligibleReason) {
    return REJECT('source_ineligible', 'the translated fragment could not be segmented safely');
  }

  // Gate 1: identical segment count. Anything else means the engine merged or split
  // sentences, and there is no honest way to pair them up.
  const sourceSegments: Segment[] = sourceUnits.map((u) => u.segment);
  const targetSegments = targetSegmented.segments;
  if (targetSegments.length !== sourceSegments.length) {
    return REJECT(
      'segment_count_differs',
      'source has ' + sourceSegments.length + ' segment(s), translation has ' + targetSegments.length,
    );
  }

  // Gate 2 + 3: same container and the same ordered token identities, pairwise.
  for (let i = 0; i < sourceSegments.length; i++) {
    if (sourceSegments[i].container !== targetSegments[i].container) {
      return REJECT(
        'container_differs',
        'segment ' + i + ' is a <' + sourceSegments[i].container + '> in the source but a <'
        + targetSegments[i].container + '> in the translation',
      );
    }
    const srcIds = sourceSegments[i].tokens.map((t) => t.identity);
    const tgtIds = targetSegments[i].tokens.map((t) => t.identity);
    if (!sameSequence(srcIds, tgtIds)) {
      return REJECT(
        'token_sequence_differs',
        'segment ' + i + ' has tokens [' + srcIds.join(', ') + '] in the source but ['
        + tgtIds.join(', ') + '] in the translation',
      );
    }
  }

  // All gates passed. Because the token identity SEQUENCES are identical, the target's
  // own {{Tn:...}} numbering already matches the source's, so it is stored verbatim.
  const aligned: AlignedSegment[] = [];
  for (let i = 0; i < sourceSegments.length; i++) {
    const unit = sourceUnits[i];
    const result = placeholderizeTarget(
      targetSegments[i].keyText,
      unit.placeholdered.placeholders,
      targetLocale,
    );
    if ('rejection' in result) return REJECT(result.rejection, result.detail);
    aligned.push({ segmentIndex: unit.segment.index, targetText: result.text, unit });
  }

  return { aligned };
};
