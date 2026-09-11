import { describe, it, expect } from 'vitest';
import { reviewLinkStatusOf, summarizeReviewLinks, type ReviewLinkStatusRef } from './review-link-status';

const NOW = new Date('2026-09-11T12:00:00Z');

const link = (over: Partial<ReviewLinkStatusRef> = {}): ReviewLinkStatusRef => ({
  revokedAt: null,
  expiresAt: null,
  submittedAt: null,
  lastUsedAt: null,
  useCount: 0,
  ...over,
});

describe('reviewLinkStatusOf', () => {
  it('reports a fresh link as never opened, and as still live', () => {
    const s = reviewLinkStatusOf(link(), NOW);
    expect(s.key).toBe('sent');
    expect(s.live).toBe(true);
  });

  it('reports a link with hits as opened', () => {
    expect(reviewLinkStatusOf(link({ useCount: 3, lastUsedAt: '2026-09-10T08:00:00Z' }), NOW).key)
      .toBe('opened');
  });

  it('counts a hit recorded only as lastUsedAt (use_count never backfilled)', () => {
    expect(reviewLinkStatusOf(link({ lastUsedAt: '2026-09-10T08:00:00Z' }), NOW).key).toBe('opened');
  });

  it('prefers submitted over opened', () => {
    expect(reviewLinkStatusOf(link({ useCount: 2, submittedAt: '2026-09-10T09:00:00Z' }), NOW).key)
      .toBe('submitted');
  });

  // Reachability beats progress: a dead URL must never read as an open round.
  it('prefers revoked over submitted', () => {
    const s = reviewLinkStatusOf(
      link({ submittedAt: '2026-09-10T09:00:00Z', revokedAt: '2026-09-10T10:00:00Z' }),
      NOW,
    );
    expect(s.key).toBe('revoked');
    expect(s.live).toBe(false);
  });

  it('prefers revoked over expired', () => {
    expect(reviewLinkStatusOf(
      link({ revokedAt: '2026-09-10T10:00:00Z', expiresAt: '2026-09-01T00:00:00Z' }),
      NOW,
    ).key).toBe('revoked');
  });

  it('expires on the instant, not the day', () => {
    expect(reviewLinkStatusOf(link({ expiresAt: '2026-09-11T12:00:00Z' }), NOW).key).toBe('expired');
    expect(reviewLinkStatusOf(link({ expiresAt: '2026-09-11T12:00:01Z' }), NOW).key).toBe('sent');
  });

  it('treats a never-expiring link as live', () => {
    expect(reviewLinkStatusOf(link({ expiresAt: null }), NOW).live).toBe(true);
  });
});

describe('summarizeReviewLinks', () => {
  it('says so when nothing has been sent', () => {
    expect(summarizeReviewLinks([], NOW)).toBe('No links sent yet.');
  });

  it('counts only links that still resolve', () => {
    const out = summarizeReviewLinks([
      link({ submittedAt: '2026-09-10T09:00:00Z' }),
      link(),
      link({ revokedAt: '2026-09-10T10:00:00Z' }),
    ], NOW);
    expect(out).toBe('2 live links · 1 submitted · 1 never opened.');
  });

  it('does not overstate a round whose links are all dead', () => {
    expect(summarizeReviewLinks([
      link({ revokedAt: '2026-09-10T10:00:00Z' }),
      link({ expiresAt: '2026-09-01T00:00:00Z' }),
    ], NOW)).toBe('2 links sent — none still live.');
  });
});
