/**
 * Rebuild a fragment's HTML from its skeleton plus translated segments.
 *
 * This is the module that has to be paranoid. Everything upstream can be merely
 * wrong; this one can silently corrupt a printed, regulated manual — so every gate
 * below FAILS CLOSED, and the two failure levels are deliberate:
 *
 *  - A per-segment gate failure leaves THAT segment as untranslated source, records
 *    the reason, and lets the rest of the fragment through. `applied: false`.
 *  - A fragment-level gate failure returns `ok: false` with `html` set to the
 *    ORIGINAL source, untouched. Callers must never persist a `ok: false` result —
 *    the same contract `translateHtml` already enforces when it throws "fragment
 *    left untranslated" rather than adopting a suspect model response.
 *
 * The untranslated identity is the load-bearing property:
 *
 *   reassembleFragment(sf, [], ...).html === sf.sourceHtml   (BYTE-IDENTICAL)
 *
 * It holds because `parts` is an array of skeleton runs and segment holes rather
 * than a set of offsets to splice — reassembly is substitution, never search and
 * replace. Asserted over a corpus in the tests.
 *
 * TOKEN RENUMBERING, the thing that is easy to get wrong
 * -----------------------------------------------------
 * A segment's markers are numbered from 0 WITHIN the segment (`{{T0:...}}`), which
 * is what lets the same sentence in two different blocks share one TM row. The
 * fragment's chip payloads, however, are numbered per FRAGMENT (`{{FRZ_7}}`). So
 * re-injection maps each `{{Tn:identity}}` back through `segment.tokens[n].frozenIndex`
 * to the fragment-global number. Getting this backwards produces a fragment whose
 * chips point at the wrong placeholders — which `countTokens` alone would not catch.
 */

import { countTokens, thaw } from './im-chip-freeze';
import { sameMarkerSet } from './im-xliff-codec';
import { renderPlaceholderValue } from './im-tm-placeholders';
import { renderParts } from './im-tm-segment';
import type {
  ExtractedPlaceholder,
  ReassembleResult,
  ReassemblyFailure,
  ReassemblyFailureCode,
  Segment,
  SegmentedFragment,
  TranslatedSegment,
} from './im-tm-types';

const TOKEN_MARKER_RE = /\{\{T(\d+):([A-Za-z0-9_.-]+)\}\}/g;
const PLACEHOLDER_MARKER_RE = /\{\{P(\d+)\}\}/g;
/** Any surviving marker of ours after BOTH re-injection passes is a bug, not a translation. */
const RESIDUE_RE = /\{\{[TP]\d/;
/**
 * Placeholder markers only. A target that is not in placeholdered form must carry
 * no `{{Pn}}` — but it still carries `{{Tn:...}}`, which the token pass handles
 * next, so the two residues have to be checked separately and in order.
 */
const PLACEHOLDER_RESIDUE_RE = /\{\{P\d/;

export interface ReassembleOptions {
  /** Target language, for decimal-separator rendering of numeric placeholders. */
  targetLang: string;
  /**
   * The ordered placeholders of each SOURCE segment, keyed by segment index — the
   * values to re-inject. A segment absent from this map is treated as having none.
   */
  placeholdersBySegment?: Record<number, ExtractedPlaceholder[]>;
}

/**
 * Whether a translated segment carries `{{Pn}}` markers that need value
 * re-injection, or already has literal values in place.
 *
 * TM-sourced text is stored in placeholdered form; engine and human text comes back
 * with the concrete values the source had. Deriving this from `origin` rather than
 * asking the caller for a flag keeps the two impossible to mix up.
 */
const isPlaceholdered = (origin: TranslatedSegment['origin']): boolean =>
  origin === 'tm_exact' || origin === 'tm_fuzzy';

interface SegmentOutcome {
  text: string;
  reason?: ReassemblyFailureCode;
  detail?: string;
}

/** Re-inject `{{Pn}}` values, or verify none were expected. */
const injectPlaceholders = (
  target: string,
  placeholders: ExtractedPlaceholder[],
  targetLang: string,
  placeholdered: boolean,
): SegmentOutcome => {
  if (!placeholdered) {
    return PLACEHOLDER_RESIDUE_RE.test(target)
      ? {
          text: target,
          reason: 'marker_residue',
          detail: 'a literal target must not contain a {{Pn}} placeholder marker',
        }
      : { text: target };
  }

  const seen = new Map<number, number>();
  let unknown = -1;
  const out = target.replace(PLACEHOLDER_MARKER_RE, (_m, n: string) => {
    const index = Number(n);
    const p = placeholders[index];
    if (!p) {
      unknown = index;
      return '';
    }
    seen.set(index, (seen.get(index) ?? 0) + 1);
    return renderPlaceholderValue(p, targetLang);
  });

  if (unknown >= 0) {
    return {
      text: target,
      reason: 'placeholder_unknown_index',
      detail: 'target references {{P' + unknown + '}} but the source has ' + placeholders.length,
    };
  }
  for (let i = 0; i < placeholders.length; i++) {
    const count = seen.get(i) ?? 0;
    if (count !== 1) {
      return {
        text: target,
        reason: 'placeholder_missing',
        detail: '{{P' + i + '}} appears ' + count + ' times in the target, expected exactly once',
      };
    }
  }
  return { text: out };
};

/** Re-inject `{{Tn:identity}}` markers as fragment-global tokens or verbatim markup. */
const injectTokens = (target: string, segment: Segment): SegmentOutcome => {
  const sourceIdentities = segment.tokens.map((t) => t.identity);
  const targetIdentities: string[] = [];
  let unknown = -1;

  const out = target.replace(TOKEN_MARKER_RE, (_m, n: string, identity: string) => {
    const token = segment.tokens[Number(n)];
    if (!token || token.identity !== identity) {
      unknown = Number(n);
      return '';
    }
    targetIdentities.push(identity);
    if (token.frozenIndex !== undefined) return '{{FRZ_' + token.frozenIndex + '}}';
    return token.raw ?? '';
  });

  if (unknown >= 0) {
    return {
      text: target,
      reason: 'token_multiset_mismatch',
      detail: 'target references an unknown or mismatched marker {{T' + unknown + '}}',
    };
  }

  // Order MAY differ — a translator legitimately reorders markers for target word
  // order — but nothing may be added, dropped or duplicated. Same semantics, and
  // the same helper, as the XLIFF import integrity check.
  if (!sameMarkerSet(sourceIdentities, targetIdentities)) {
    return {
      text: target,
      reason: 'token_multiset_mismatch',
      detail:
        'markers differ: source [' + sourceIdentities.join(', ') + '] target ['
        + targetIdentities.join(', ') + ']',
    };
  }

  // Inline formatting must still balance, or the fragment's HTML is malformed.
  const opens = new Map<string, number>();
  for (const identity of targetIdentities) {
    const open = /^o\.(.+)$/.exec(identity);
    const close = /^c\.(.+)$/.exec(identity);
    if (open) opens.set(open[1], (opens.get(open[1]) ?? 0) + 1);
    if (close) opens.set(close[1], (opens.get(close[1]) ?? 0) - 1);
  }
  for (const [tag, balance] of opens) {
    if (balance !== 0) {
      return {
        text: target,
        reason: 'unbalanced_inline_tags',
        detail: 'tag <' + tag + '> is unbalanced in the target',
      };
    }
  }

  return { text: out };
};

/**
 * Rebuild the fragment. Never throws.
 *
 * Returns the fragment HTML plus a per-segment record of what was actually applied,
 * so a caller can report "3 of 5 segments translated" honestly instead of implying
 * a clean run.
 */
export const reassembleFragment = (
  sf: SegmentedFragment,
  translated: TranslatedSegment[],
  opts: ReassembleOptions,
): ReassembleResult => {
  const failures: ReassemblyFailure[] = [];
  const perSegment: ReassembleResult['perSegment'] = [];
  const replacements = new Map<number, string>();
  const byIndex = new Map<number, TranslatedSegment>();
  for (const t of translated) byIndex.set(t.segmentIndex, t);

  for (const segment of sf.segments) {
    const t = byIndex.get(segment.index);
    if (!t) continue;

    const placeholders = opts.placeholdersBySegment?.[segment.index] ?? [];
    const withValues = injectPlaceholders(
      t.targetKeyText,
      placeholders,
      opts.targetLang,
      isPlaceholdered(t.origin),
    );
    if (withValues.reason) {
      failures.push({ segmentIndex: segment.index, code: withValues.reason, detail: withValues.detail ?? '' });
      perSegment.push({ segmentIndex: segment.index, applied: false, reason: withValues.reason });
      continue;
    }

    const withTokens = injectTokens(withValues.text, segment);
    if (withTokens.reason) {
      failures.push({ segmentIndex: segment.index, code: withTokens.reason, detail: withTokens.detail ?? '' });
      perSegment.push({ segmentIndex: segment.index, applied: false, reason: withTokens.reason });
      continue;
    }

    if (RESIDUE_RE.test(withTokens.text)) {
      failures.push({
        segmentIndex: segment.index,
        code: 'marker_residue',
        detail: 'a {{P}} or {{T}} marker survived re-injection',
      });
      perSegment.push({ segmentIndex: segment.index, applied: false, reason: 'marker_residue' });
      continue;
    }

    replacements.set(segment.index, withTokens.text);
    perSegment.push({ segmentIndex: segment.index, applied: true });
  }

  const assembled = renderParts(sf, replacements);

  // Fragment-level gate: the chip/image token count must be exactly what the source
  // had, and every referenced payload must exist. A mismatch means the fragment as a
  // whole is untrustworthy, so nothing is applied.
  const expected = countTokens(sf.frozenText);
  const actual = countTokens(assembled);
  const maxFrozen = sf.frozen.length;
  const outOfRange = (assembled.match(/\{\{FRZ_(\d+)\}\}/g) ?? []).some(
    (m) => Number(/\d+/.exec(m)?.[0] ?? -1) >= maxFrozen,
  );

  if (expected !== actual || outOfRange) {
    failures.push({
      code: 'fragment_token_count_mismatch',
      detail: outOfRange
        ? 'a token referenced a frozen payload that does not exist'
        : 'token count changed from ' + expected + ' to ' + actual,
    });
    return {
      html: sf.sourceHtml,
      ok: false,
      failures,
      perSegment: perSegment.map((p) => ({ ...p, applied: false })),
    };
  }

  return { html: thaw(assembled, sf.frozen), ok: true, failures, perSegment };
};
