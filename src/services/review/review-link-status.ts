/**
 * What happened to a review link, as one word.
 *
 * A PM's question about an outstanding round is never "does a row exist" — it is "did the
 * supplier ever open it, and are they done". Those two facts live in three different
 * columns (`use_count`/`last_used_at`, `submitted_at`) and are crossed by two more that
 * override them entirely (`revoked_at`, `expires_at`), so every surface that listed links
 * was re-deriving the same precedence by hand and getting a different answer. This is that
 * precedence, once.
 *
 * PRECEDENCE, AND WHY IT IS THIS WAY ROUND
 * ---------------------------------------
 * Revoked and expired come FIRST, ahead of submitted, because they describe the link's
 * reachability now — a revoked link the supplier submitted through is still a dead URL, and
 * saying "submitted" about it would send a PM chasing a portal nobody can open. Between the
 * two, revoked wins: it is a decision someone made, where expiry is just time passing.
 *
 * Then submitted, then opened, then sent. A submitted link has necessarily been opened, so
 * "opened" only ever describes a reader who has not finished.
 *
 * Kept free of JSX and of any domain object — the inputs are the five fields this needs —
 * so it is unit-testable under the repo's `environment: 'node'` vitest setup and can be
 * shared by the IM panel, the project panel and the design spec panel alike.
 */

export type ReviewLinkStatusKey = 'revoked' | 'expired' | 'submitted' | 'opened' | 'sent';

/** The bit of a link this module needs. Structural, so IMShare and ReviewShare both fit. */
export interface ReviewLinkStatusRef {
  revokedAt: string | null;
  expiresAt: string | null;
  submittedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
}

export interface ReviewLinkStatus {
  key: ReviewLinkStatusKey;
  /** The word on the chip. Always present — status is never colour alone. */
  label: string;
  /** One sentence for the chip's tooltip, saying what the PM's next move is. */
  hint: string;
  /**
   * Status palette name, NOT a brand colour (see CLAUDE.md): sent/opened/submitted are a
   * progress signal a PM acts on, the same way approved/pending/rejected is.
   */
  tone: 'gray' | 'sky' | 'amber' | 'emerald';
  /** False once the URL no longer resolves — revoked or past its TTL. */
  live: boolean;
}

export const reviewLinkStatusOf = (
  link: ReviewLinkStatusRef,
  now: Date = new Date(),
): ReviewLinkStatus => {
  if (link.revokedAt) {
    return {
      key: 'revoked',
      label: 'Revoked',
      hint: 'This link was revoked and no longer opens. Send a new one to reopen the round.',
      tone: 'gray',
      live: false,
    };
  }
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) {
    return {
      key: 'expired',
      label: 'Expired',
      hint: 'The link has passed its expiry date and no longer opens. Send a new one.',
      tone: 'gray',
      live: false,
    };
  }
  if (link.submittedAt) {
    return {
      key: 'submitted',
      label: 'Submitted',
      hint: 'The reviewer pressed Submit — their notes are all in.',
      tone: 'emerald',
      live: true,
    };
  }
  if (link.useCount > 0 || link.lastUsedAt) {
    return {
      key: 'opened',
      label: 'Opened',
      hint: 'The reviewer has opened the link but has not submitted yet.',
      tone: 'sky',
      live: true,
    };
  }
  return {
    key: 'sent',
    label: 'Not opened',
    hint: 'The link has never been opened. Check the supplier actually received it.',
    tone: 'amber',
    live: true,
  };
};

/**
 * One line summarising a whole list, for a collapsed header or a card with no room for rows.
 *
 * Counts only the links that still resolve: a revoked or expired link is history, and
 * rolling it into "2 of 3 opened" would overstate how much of the round is live.
 */
export const summarizeReviewLinks = (
  links: readonly ReviewLinkStatusRef[],
  now: Date = new Date(),
): string => {
  if (links.length === 0) return 'No links sent yet.';
  const statuses = links.map(l => reviewLinkStatusOf(l, now));
  const live = statuses.filter(s => s.live);
  if (live.length === 0) {
    return `${statuses.length} link${statuses.length === 1 ? '' : 's'} sent — none still live.`;
  }
  const submitted = live.filter(s => s.key === 'submitted').length;
  const unopened = live.filter(s => s.key === 'sent').length;
  const parts = [`${live.length} live link${live.length === 1 ? '' : 's'}`];
  if (submitted > 0) parts.push(`${submitted} submitted`);
  if (unopened > 0) parts.push(`${unopened} never opened`);
  return `${parts.join(' · ')}.`;
};
