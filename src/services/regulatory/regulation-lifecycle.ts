/**
 * Regulation lifecycle — what `expired` means, and when it stops work (migration 140).
 *
 * THE THREE STATUSES, and why a third was needed:
 *
 *   active      In force. Applies, and nothing is stopped.
 *   superseded  Retired ON PURPOSE. Hidden from the assignment picker; existing uses keep
 *               working untouched. This is the "we don't use this any more" button, and it
 *               has never blocked anything.
 *   expired     No longer valid, and work must STOP until it is replaced. New in 140.
 *
 * `superseded` could not be made to block: it is already used to tidy the picker, and turning
 * it into a hard stop retroactively would have frozen every manual and request citing one of
 * the rows somebody retired months ago. So expiry is its own, deliberate act.
 *
 * WHAT LIFTS THE BLOCK: recording the successor. An expired regulation with `supersededById`
 * pointing at a regulation that is itself usable stops blocking immediately, and every TCF
 * requirement and IM template citing the expired row is then treated as citing the successor
 * (`resolveEffective`). One edit unblocks the company; relinking each usage is cleanup that
 * can happen afterwards, and the UI offers it as such. The alternative — freezing everything
 * until a person edits every row by hand — punishes the people who did nothing wrong.
 *
 * THE CHAIN IS FOLLOWED, NOT ASSUMED. 2009/125/EC -> 2024/1781 -> (one day) something else is
 * the normal shape of EU law, so the successor lookup walks transitively. It is also hostile
 * input: `superseded_by_id` is a self-referencing FK with nothing stopping A -> B -> A, and a
 * naive walk would hang the publish gate. Cycles and over-long chains resolve to "no usable
 * replacement", i.e. BLOCKING — the safe direction, because refusing to publish is
 * recoverable and publishing against a dead law is not.
 *
 * A NOTE ON `versionState`. That is what EUR-Lex says ('repealed'); `status` is what WE
 * decided. They are deliberately not wired together: an automated third-party lookup must
 * never freeze production work on its own. The UI surfaces 'repealed' as a prompt to expire,
 * and a person presses the button.
 */

import type { Regulation } from '../../types';

/** How far a replacement chain is followed before it is called broken. */
export const MAX_REPLACEMENT_DEPTH = 10;

export type ReplacementOutcome =
  /** Not expired — nothing to resolve. */
  | 'not-expired'
  /** Expired, and the chain ends at a usable regulation. */
  | 'replaced'
  /** Expired with no `supersededById` at all. */
  | 'unreplaced'
  /** `supersededById` points at a row that is not in the library (deleted, or not loaded). */
  | 'replacement-missing'
  /** Every regulation in the chain is itself expired without a way out. */
  | 'replacement-expired'
  /** A -> B -> A, or a chain longer than MAX_REPLACEMENT_DEPTH. */
  | 'replacement-cycle';

export interface ReplacementResolution {
  outcome: ReplacementOutcome;
  /**
   * The regulation whose obligations actually apply. The successor for a replaced expiry,
   * the row itself otherwise — never null, so callers can read `.checklist` unconditionally.
   */
  effective: Regulation;
  /** The successors walked through, nearest first. Empty unless the chain was followed. */
  chain: Regulation[];
  /** True when this regulation must stop work. */
  blocking: boolean;
}

/** Index a library by id — the shape every function here takes. */
export const indexRegulations = (regulations: Regulation[]): Map<string, Regulation> =>
  new Map(regulations.map(r => [r.id, r]));

/**
 * Follow `supersededById` from an expired regulation to the one that replaces it.
 *
 * A 'superseded' successor is accepted: retiring the successor from the picker says nothing
 * about whether it is still the law, and refusing it would block work for a bookkeeping
 * choice. Only an EXPIRED successor keeps the chain walking.
 */
export const resolveReplacement = (
  regulation: Regulation,
  byId: Map<string, Regulation>,
): ReplacementResolution => {
  if (regulation.status !== 'expired') {
    return { outcome: 'not-expired', effective: regulation, chain: [], blocking: false };
  }

  const chain: Regulation[] = [];
  const seen = new Set<string>([regulation.id]);
  let current = regulation;

  for (let depth = 0; depth < MAX_REPLACEMENT_DEPTH; depth++) {
    const nextId = current.supersededById;
    if (!nextId) {
      return {
        outcome: chain.length === 0 ? 'unreplaced' : 'replacement-expired',
        effective: regulation,
        chain,
        blocking: true,
      };
    }
    if (seen.has(nextId)) {
      return { outcome: 'replacement-cycle', effective: regulation, chain, blocking: true };
    }
    const next = byId.get(nextId);
    if (!next) {
      return { outcome: 'replacement-missing', effective: regulation, chain, blocking: true };
    }
    seen.add(nextId);
    chain.push(next);
    if (next.status !== 'expired') {
      return { outcome: 'replaced', effective: next, chain, blocking: false };
    }
    current = next;
  }

  // Ran out of depth without landing anywhere usable. Treated as a broken chain rather than
  // silently accepting the last hop, because "we gave up looking" is not "this is fine".
  return { outcome: 'replacement-cycle', effective: regulation, chain, blocking: true };
};

/** The regulation whose obligations actually apply — the successor, or the row itself. */
export const resolveEffective = (
  regulation: Regulation,
  byId: Map<string, Regulation>,
): Regulation => resolveReplacement(regulation, byId).effective;

/** True when this regulation stops work: expired with no usable replacement. */
export const isBlocking = (regulation: Regulation, byId: Map<string, Regulation>): boolean =>
  resolveReplacement(regulation, byId).blocking;

/** One reason a publish or a request is being refused. */
export interface RegulationBlock {
  regulationId: string;
  referenceCode: string;
  title: string;
  outcome: ReplacementOutcome;
  expiredAt?: string | null;
  expiredReason?: string;
  /** Human sentence naming the regulation and what to do about it. */
  message: string;
}

const OUTCOME_FIX: Record<ReplacementOutcome, string> = {
  'not-expired': '',
  replaced: '',
  unreplaced:
    'Record the regulation that replaces it, or set it back to Active if it was expired by mistake.',
  'replacement-missing':
    'Its replacement no longer exists in the library. Point it at a regulation that does.',
  'replacement-expired':
    'Everything it points at is expired too. Record a replacement that is still in force.',
  'replacement-cycle':
    'Its replacements point back at each other, so there is no version still in force. Fix the chain.',
};

/** Turn a blocking regulation into the sentence a person acts on. */
export const describeBlock = (
  regulation: Regulation,
  resolution: ReplacementResolution,
): RegulationBlock => ({
  regulationId: regulation.id,
  referenceCode: regulation.referenceCode,
  title: regulation.title,
  outcome: resolution.outcome,
  expiredAt: regulation.expiredAt ?? null,
  expiredReason: regulation.expiredReason,
  message:
    `"${regulation.referenceCode}" is marked expired` +
    (regulation.expiredAt ? ` (${regulation.expiredAt})` : '') +
    `. ${OUTCOME_FIX[resolution.outcome]}`,
});

/**
 * Every blocking regulation in a set, deduped by id and ordered by reference code so the
 * same list reads the same way on the publish panel and the request form.
 *
 * `library` is the whole library, not just the candidates: resolving a replacement needs
 * rows nobody assigned to anything.
 */
export const collectBlocks = (
  candidates: readonly (Regulation | undefined | null)[],
  library: Regulation[],
): RegulationBlock[] => {
  const byId = indexRegulations(library);
  const blocks = new Map<string, RegulationBlock>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    // The library row wins over a stale copy stitched into an assignment — a regulation
    // expired ten seconds ago must block a publish that loaded its template before that.
    const regulation = byId.get(candidate.id) ?? candidate;
    const resolution = resolveReplacement(regulation, byId);
    if (!resolution.blocking || blocks.has(regulation.id)) continue;
    blocks.set(regulation.id, describeBlock(regulation, resolution));
  }
  return Array.from(blocks.values()).sort((a, b) => a.referenceCode.localeCompare(b.referenceCode));
};

/**
 * A one-line summary for a gate that has to explain itself in a button tooltip.
 * Empty string when nothing is blocked, so callers can use it as a truthiness test.
 */
export const summarizeBlocks = (blocks: RegulationBlock[]): string => {
  if (blocks.length === 0) return '';
  const names = blocks.map(b => b.referenceCode).join(', ');
  return blocks.length === 1
    ? `${names} is expired and has no replacement recorded.`
    : `${blocks.length} regulations are expired with no replacement recorded: ${names}.`;
};
