/**
 * Token-level similarity between two segments, and the tier decision that follows.
 *
 * WHY TOKENS AND NOT CHARACTERS
 * -----------------------------
 * Character-level similarity rates `2.5 l` against `25 l` as a near-match — a
 * numerically wrong, potentially safety-relevant substitution presented as a
 * high-confidence hit. Token comparison treats them as different tokens. On top of
 * that, ANY difference in a numeral, a unit, an identifier or a chip sets
 * `criticalDiff`, which caps the score below the auto-apply threshold no matter how
 * similar the rest of the sentence is. That cap is the single most important rule
 * in this module and it has its own test.
 *
 * WHY NOT EMBEDDINGS
 * ------------------
 * "Do not immerse in water" and "Do not immerse in liquids" are semantically
 * near-identical and legally distinct. Edit distance is preferable here precisely
 * because it is literal and can show exactly what differs. Semantic search belongs
 * in an author-facing "have we written this before?" tool with a human deciding,
 * not in an auto-apply path.
 *
 * WHY LEVENSHTEIN AND NOT DICE
 * ----------------------------
 * We need the ALIGNMENT, not just a number: the minimal-edit instruction handed to
 * the translation engine ("replace 2.5 l with 3.0 l, leave everything else") comes
 * out of the backtrace. Dice cannot produce that. Dice earns its keep as the cheap
 * prefilter that screens candidates before any DP runs.
 *
 * Hand-rolled, no dependencies — the repo has no NLP or string-distance library and
 * segments are short enough (tens of tokens) that O(n*m) is free.
 */

import { UNIT_SYMBOLS } from './im-tm-placeholders';
import type {
  CompareToken,
  CompareTokenClass,
  DiffOp,
  MatchTier,
  PlaceholderType,
  ScoreResult,
} from './im-tm-types';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const TM_EXACT = 100;
/** Floor for applying a fuzzy match without a human. The one knob worth tuning. */
export const TM_AUTO_APPLY_MIN = 95;
/**
 * Ceiling imposed on any match with a numeral/unit/identifier/chip difference.
 * Structurally below TM_AUTO_APPLY_MIN — asserted in the tests, because the whole
 * safety story collapses if these two ever cross.
 */
export const TM_CRITICAL_CAP = 89;
/** Worth showing a human as a suggestion. */
export const TM_SUGGEST_MIN = 70;
/** Worth handing the engine as a style/terminology reference. */
export const TM_CANDIDATE_MIN = 55;

const UNIT_SET = new Set(UNIT_SYMBOLS);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * In order: a marker; a decimal or group-separated NUMBER; a word-ish run
 * (letters/digits with internal apostrophes and hyphens); or any single non-space
 * character as punctuation. Whitespace is skipped.
 *
 * The dedicated number alternative has to come first and has to exist: without it
 * `2.5` tokenizes as `2` `.` `5`, which both distorts the score and turns the
 * minimal-edit instruction into the useless 'replace "2" with "3"; replace "5"
 * with "0"' instead of 'replace "2.5" with "3.0"'.
 */
const TOKEN_RE = /\{\{[^{}]*\}\}|\d+(?:[.,]\d+)+|[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*|[^\s]/gu;

const MARKER_BODY_RE = /^\{\{(.*)\}\}$/;

/** `2,50` and `2.5` are the same number. */
const canonicalNumber = (s: string): string => {
  const dotted = s.replace(/,/g, '.');
  const n = Number(dotted);
  return Number.isFinite(n) ? String(n) : dotted;
};

const classify = (
  text: string,
  placeholderTypes: PlaceholderType[],
): { cls: CompareTokenClass; key: string } => {
  const marker = MARKER_BODY_RE.exec(text);
  if (marker) {
    const body = marker[1];
    // A placeholder marker compares on its TYPE, so a measurement placeholder can
    // never be considered equal to an article-code placeholder in the same slot.
    const ph = /^P(\d+)$/.exec(body);
    if (ph) {
      const type = placeholderTypes[Number(ph[1])] ?? 'unknown';
      return { cls: 'marker', key: 'p.' + type };
    }
    // Inline formatting and line breaks are marked `f.` so a formatting-only
    // difference can be distinguished from a chip difference downstream.
    const tok = /^T\d+:(.*)$/.exec(body);
    const identity = tok ? tok[1] : body;
    if (/^(?:o\.|c\.)/.test(identity) || identity === 'br') return { cls: 'marker', key: 'f.' + identity };
    return { cls: 'marker', key: 'm.' + identity };
  }

  if (UNIT_SET.has(text)) return { cls: 'unit', key: text };

  const hasLetter = /\p{L}/u.test(text);
  const hasDigit = /\p{N}/u.test(text);

  if (hasDigit && !hasLetter) return { cls: 'number', key: canonicalNumber(text) };
  if (hasDigit && hasLetter) return { cls: 'identifier', key: text };
  if (hasLetter) return { cls: 'word', key: text.toLowerCase() };

  // A bare numeral written with a separator, e.g. "2.5", arrives here only if it
  // failed the digit test above; otherwise this is punctuation.
  return { cls: 'punct', key: text };
};

/** True when a token can legitimately precede a unit symbol: a number, or a numeric placeholder. */
const canPrecedeUnit = (t: CompareToken | undefined): boolean =>
  !!t && (t.cls === 'number' || t.key === 'p.measure' || t.key === 'p.num');

/**
 * A unit symbol only counts as a unit when a quantity precedes it.
 *
 * Several real unit symbols are also ordinary words or letters — `A`, `l`, `m`, `s`,
 * `h`, `t`, `K`, `F`. Classifying them by spelling alone means the English article "A"
 * at the start of a sentence is read as amperes, and because any unit difference sets
 * `criticalDiff`, that silently capped the score of every pair of sentences differing
 * around an "A". The direction of the error was safe but the leverage cost was real and
 * the reported reason was actively misleading.
 */
const demoteBareUnits = (tokens: CompareToken[]): CompareToken[] => {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].cls !== 'unit') continue;
    // Skip back over punctuation, so "2.5 (l)" still reads as a unit.
    let j = i - 1;
    while (j >= 0 && tokens[j].cls === 'punct') j--;
    if (canPrecedeUnit(tokens[j])) continue;
    tokens[i] = { text: tokens[i].text, cls: 'word', key: tokens[i].text.toLowerCase() };
  }
  return tokens;
};

/**
 * Tokenize a normalized/placeholdered segment for comparison.
 *
 * `placeholderTypes` must be the ordered placeholder types of the SAME segment, so
 * `{{P0}}` can be classified by what it stands for rather than by its index.
 */
export const tokenizeForCompare = (
  patternText: string,
  placeholderTypes: PlaceholderType[] = [],
): CompareToken[] =>
  demoteBareUnits(
    (patternText.match(TOKEN_RE) ?? []).map((text) => ({ text, ...classify(text, placeholderTypes) })),
  );

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

const PUNCT_WEIGHT = 0.25;

const isCriticalClass = (c: CompareTokenClass): boolean =>
  c === 'number' || c === 'unit' || c === 'identifier';

const isFormatMarker = (t: CompareToken): boolean => t.cls === 'marker' && t.key.startsWith('f.');

const weightOf = (t: CompareToken): number => (t.cls === 'punct' ? PUNCT_WEIGHT : 1);

interface OpCost {
  w: number;
  critical: boolean;
  format: boolean;
}

const FREE: OpCost = { w: 0, critical: false, format: false };

const substitutionCost = (a: CompareToken, b: CompareToken): OpCost => {
  if (a.key === b.key) return FREE;
  if (a.cls === 'marker' || b.cls === 'marker') {
    const bothFormat = isFormatMarker(a) && isFormatMarker(b);
    return { w: 1, critical: !bothFormat, format: bothFormat };
  }
  if (isCriticalClass(a.cls) || isCriticalClass(b.cls)) return { w: 1, critical: true, format: false };
  if (a.cls === 'punct' && b.cls === 'punct') return { w: PUNCT_WEIGHT, critical: false, format: false };
  return { w: 1, critical: false, format: false };
};

/** Cost of inserting or deleting a single token — a dropped chip is as critical as a changed one. */
const gapCost = (t: CompareToken): OpCost => {
  if (t.cls === 'marker') {
    const fmt = isFormatMarker(t);
    return { w: 1, critical: !fmt, format: fmt };
  }
  if (isCriticalClass(t.cls)) return { w: 1, critical: true, format: false };
  return { w: weightOf(t), critical: false, format: false };
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

type Move = 'diag' | 'up' | 'left' | 'none';

/**
 * Weighted token-level Levenshtein with a backtrace.
 *
 * `a` is the STORED source, `b` is the NEW source, so an `insert` op means "present
 * in the new sentence, absent from the remembered one" — which is the direction the
 * minimal-edit instruction needs.
 */
export const scoreMatch = (a: CompareToken[], b: CompareToken[]): ScoreResult => {
  const n = a.length;
  const m = b.length;

  if (!n && !m) return { score: 100, criticalDiff: false, formatOnly: false, ops: [] };
  if (!n || !m) {
    const present = n ? a : b;
    const ops: DiffOp[] = [
      n ? { op: 'delete', text: present.map((t) => t.text).join(' ') }
        : { op: 'insert', text: present.map((t) => t.text).join(' ') },
    ];
    const critical = present.some((t) => gapCost(t).critical);
    return { score: 0, criticalDiff: critical, formatOnly: false, ops };
  }

  const dist: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const move: Move[][] = Array.from({ length: n + 1 }, () => new Array<Move>(m + 1).fill('none'));

  for (let i = 1; i <= n; i++) {
    dist[i][0] = dist[i - 1][0] + gapCost(a[i - 1]).w;
    move[i][0] = 'up';
  }
  for (let j = 1; j <= m; j++) {
    dist[0][j] = dist[0][j - 1] + gapCost(b[j - 1]).w;
    move[0][j] = 'left';
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = dist[i - 1][j - 1] + substitutionCost(a[i - 1], b[j - 1]).w;
      const del = dist[i - 1][j] + gapCost(a[i - 1]).w;
      const ins = dist[i][j - 1] + gapCost(b[j - 1]).w;
      let best = sub;
      let chosen: Move = 'diag';
      if (del < best) {
        best = del;
        chosen = 'up';
      }
      if (ins < best) {
        best = ins;
        chosen = 'left';
      }
      dist[i][j] = best;
      move[i][j] = chosen;
    }
  }

  // Backtrace, newest-first, then reversed.
  const raw: Array<{ op: DiffOp; critical: boolean; format: boolean; changed: boolean }> = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = i === 0 ? 'left' : j === 0 ? 'up' : move[i][j];
    if (mv === 'diag') {
      const cost = substitutionCost(a[i - 1], b[j - 1]);
      raw.push(
        cost.w === 0
          ? { op: { op: 'equal', text: b[j - 1].text }, critical: false, format: false, changed: false }
          : {
              op: { op: 'replace', from: a[i - 1].text, to: b[j - 1].text, critical: cost.critical },
              critical: cost.critical,
              format: cost.format,
              changed: true,
            },
      );
      i--;
      j--;
    } else if (mv === 'up') {
      const cost = gapCost(a[i - 1]);
      raw.push({
        op: { op: 'delete', text: a[i - 1].text },
        critical: cost.critical,
        format: cost.format,
        changed: true,
      });
      i--;
    } else {
      const cost = gapCost(b[j - 1]);
      raw.push({
        op: { op: 'insert', text: b[j - 1].text },
        critical: cost.critical,
        format: cost.format,
        changed: true,
      });
      j--;
    }
  }
  raw.reverse();

  const criticalDiff = raw.some((r) => r.critical);
  const changed = raw.filter((r) => r.changed);
  const formatOnly = changed.length > 0 && changed.every((r) => r.format);

  const totalWeight = Math.max(
    a.reduce((sum, t) => sum + weightOf(t), 0),
    b.reduce((sum, t) => sum + weightOf(t), 0),
  );
  let score = totalWeight === 0 ? 100 : Math.floor(100 * (1 - dist[n][m] / totalWeight));
  score = Math.max(0, Math.min(100, score));
  if (criticalDiff) score = Math.min(score, TM_CRITICAL_CAP);

  return { score, criticalDiff, formatOnly, ops: mergeEqualRuns(raw.map((r) => r.op)) };
};

/** Collapse consecutive `equal` tokens into one readable run. */
const mergeEqualRuns = (ops: DiffOp[]): DiffOp[] => {
  const out: DiffOp[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (op.op === 'equal' && last && last.op === 'equal') {
      out[out.length - 1] = { op: 'equal', text: last.text + ' ' + op.text };
      continue;
    }
    out.push(op);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export interface TierFacts {
  /** The two `segmentKey`s are identical. */
  keyEqual: boolean;
  /** The two `contextHash`es are identical. */
  contextEqual: boolean;
  /** Both sides are placeholder-safe. */
  placeholderSafeBoth: boolean;
  /** Ordered placeholder type signatures are identical. */
  placeholderKindsEqual: boolean;
  /** Stored row is `approved`. Nothing else may ever be auto-applied. */
  approved: boolean;
  /** Stored row's segmentation/normalization/placeholder versions match the current ones. */
  versionsEqual: boolean;
}

/**
 * Decide the tier for one candidate.
 *
 * Order matters: the hard gates run first, so a 100% text match on an unreviewed
 * row comes back as a reference and never as an exact hit. The rule that only
 * `approved` content is auto-applied cannot be retrofitted — published snapshots
 * inherit poisoned content and there is no un-poisoning pass — so it is enforced
 * here as well as in the database.
 */
export const tierFor = (result: ScoreResult, facts: TierFacts): MatchTier => {
  const { score, criticalDiff, formatOnly } = result;

  // An unreviewed or version-mismatched row can still be a useful reference, but a
  // hash equality across different normalizers means nothing.
  const canBeExact =
    facts.approved && facts.versionsEqual && facts.placeholderKindsEqual && !criticalDiff;

  if (facts.keyEqual && canBeExact) {
    return facts.contextEqual ? 'exact_in_context' : 'exact';
  }

  if (score >= TM_AUTO_APPLY_MIN && canBeExact && facts.placeholderSafeBoth && !formatOnly) {
    return 'fuzzy_auto';
  }

  if (score >= TM_SUGGEST_MIN) return 'fuzzy_review';
  if (score >= TM_CANDIDATE_MIN) return 'reference';
  return 'none';
};

/** True when a tier may be written into content with no human and no model call. */
export const isAutoApplicable = (tier: MatchTier): boolean =>
  tier === 'exact_in_context' || tier === 'exact' || tier === 'fuzzy_auto';

// ---------------------------------------------------------------------------
// Prefilter
// ---------------------------------------------------------------------------

const multiset = (tokens: CompareToken[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t.key, (m.get(t.key) ?? 0) + 1);
  return m;
};

/**
 * Cheap symmetric screen so thousands of candidates can be rejected before any DP
 * runs: a length-ratio gate plus the Dice coefficient over token-key multisets.
 */
export const prefilterPass = (a: CompareToken[], b: CompareToken[], minScore: number): boolean => {
  if (!a.length || !b.length) return a.length === b.length;
  const longer = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) / longer > 0.45) return false;

  const ma = multiset(a);
  const mb = multiset(b);
  let shared = 0;
  for (const [key, count] of ma) shared += Math.min(count, mb.get(key) ?? 0);
  const dice = (2 * shared) / (a.length + b.length);
  return dice >= minScore / 100 - 0.15;
};

// ---------------------------------------------------------------------------
// Minimal-edit instruction
// ---------------------------------------------------------------------------

/**
 * Turn a diff into an instruction for the translation engine, plus the machine-
 * readable critical operations for a review badge.
 *
 * The engine is told to make the MINIMAL necessary edit to a remembered
 * translation rather than to retranslate, which is both cheaper and what keeps
 * phrasing stable across near-identical sentences. The scaffolding wording lives
 * here; the prompt template that wraps it belongs to the caller.
 */
export const renderEditInstruction = (
  ops: DiffOp[],
): { instruction: string; criticalOps: DiffOp[] } => {
  const changes: string[] = [];
  const criticalOps: DiffOp[] = [];

  for (const op of ops) {
    if (op.op === 'equal') continue;
    if (op.op === 'replace') {
      changes.push('replace "' + op.from + '" with "' + op.to + '"');
      if (op.critical) criticalOps.push(op);
      continue;
    }
    if (op.op === 'insert') {
      changes.push('add "' + op.text + '"');
      continue;
    }
    changes.push('remove "' + op.text + '"');
  }

  const instruction = changes.length
    ? 'The stored translation is for an almost identical sentence. Make ONLY these changes: '
      + changes.join('; ')
      + '. Leave every other word, all markup, and all {{...}} tokens exactly as they are.'
    : 'The stored translation is for an identical sentence. Return it unchanged.';

  return { instruction, criticalOps };
};
