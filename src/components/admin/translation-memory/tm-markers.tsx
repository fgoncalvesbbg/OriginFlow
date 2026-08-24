/**
 * Rendering the three marker families a stored segment contains.
 *
 * A memory row's `target_text` is the PLACEHOLDERED form, not display HTML, so it is full
 * of `{{P0}}`, `{{T0:o.strong}}` and `{{FRZ_3}}`. Showing those raw is how an operator
 * "tidies up" one out of existence, and a mangled marker is not caught by anything the
 * person can see — it surfaces months later, on a different product, as a fragment that
 * silently refuses to translate.
 *
 * So markers render as chips: visibly not-prose, not something you retype. The editing
 * textarea still holds the raw text (an operator must be able to move a marker for target
 * word order), but everywhere read-only they become pills, and the editor previews them.
 */

import React from 'react';

/** Split keeps the separators, because the whole pattern is one capture group. */
const MARKER_SPLIT_RE = /(\{\{P\d+\}\}|\{\{T\d+:[A-Za-z0-9_.-]+\}\}|\{\{FRZ_\d+\}\})/g;

/**
 * Anchored, and deliberately NOT global. `RegExp.test` on a /g regex advances `lastIndex`
 * between calls, so reusing the split pattern to classify each part would skip every other
 * marker.
 */
const IS_MARKER_RE = /^(?:\{\{P\d+\}\}|\{\{T\d+:[A-Za-z0-9_.-]+\}\}|\{\{FRZ_\d+\}\})$/;

/** Fresh instance per call, for the same `lastIndex` reason. */
const allMarkersRe = () => /\{\{P\d+\}\}|\{\{T\d+:[A-Za-z0-9_.-]+\}\}|\{\{FRZ_\d+\}\}/g;

type MarkerKind = 'placeholder' | 'token' | 'frozen';

const kindOf = (marker: string): MarkerKind =>
  marker.startsWith('{{P') ? 'placeholder' : marker.startsWith('{{FRZ_') ? 'frozen' : 'token';

const CHIP_CLASSES: Record<MarkerKind, string> = {
  // Values re-formatted per locale — where a numeral bug hides.
  placeholder: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  // Inline formatting and chips: structure, not content.
  token: 'bg-slate-100 text-slate-600 border-slate-300',
  // Frozen chip/verbatim payloads, substituted wholesale at read time.
  frozen: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** Short label — `{{T0:o.strong}}` reads as `strong`, the open/close implied by position. */
const labelOf = (marker: string): string => {
  const formatting = /^\{\{T\d+:(?:o|c)\.(.+)\}\}$/.exec(marker);
  if (formatting) return formatting[1];
  const token = /^\{\{T\d+:(.+)\}\}$/.exec(marker);
  if (token) return token[1];
  const placeholder = /^\{\{P(\d+)\}\}$/.exec(marker);
  if (placeholder) return 'P' + placeholder[1];
  const frozen = /^\{\{FRZ_(\d+)\}\}$/.exec(marker);
  return frozen ? 'chip ' + frozen[1] : marker;
};

/**
 * Segment text with its markers as inline pills.
 *
 * `title` carries the literal marker, so an operator who needs to retype one into the
 * editor can read it off by hovering rather than guessing from the shortened label.
 */
export const MarkerText: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => (
  <span className={className}>
    {text.split(MARKER_SPLIT_RE).map((part, i) =>
      IS_MARKER_RE.test(part) ? (
        <span
          key={i}
          title={part}
          className={`inline-block align-baseline mx-0.5 px-1 py-px rounded border text-[10px] font-mono leading-tight ${CHIP_CLASSES[kindOf(part)]}`}
        >
          {labelOf(part)}
        </span>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      ),
    )}
  </span>
);

/** Every marker in a string, in order. Shows the editor what it must preserve. */
export const markersIn = (text: string): string[] => text.match(allMarkersRe()) ?? [];
