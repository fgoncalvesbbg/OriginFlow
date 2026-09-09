/**
 * The anchor union (migration 162) — the one part of the review layer that could NOT be
 * shared between the Instruction Manual and a Design Spec, and therefore the part most
 * worth pinning down.
 *
 * An IM note anchors to a chapter plus selected wording; a design spec note anchors to a
 * page plus a normalised position. These tests assert that each shape goes onto the wire
 * with the OTHER shape's parameters explicitly null, because the database enforces exactly
 * one anchor per row (`review_comments_one_anchor`) and a leaked field would be rejected
 * server-side with a constraint error rather than a message a reviewer can act on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rpcCalls } = vi.hoisted(() => ({ rpcCalls: [] as Array<{ fn: string; args: any }> }));

vi.mock('../../data', () => ({
  db: { select: vi.fn(), insert: vi.fn(), updateWhere: vi.fn() },
  auth: { getUser: vi.fn(() => Promise.resolve({ id: 'u1', email: 'a@b.c' })) },
  portalDb: {
    rpc: vi.fn((fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      // Shape of a row coming back from review_add_comment.
      return Promise.resolve({
        id: 'c1', share_id: 's1', project_id: 'p1',
        subject_type: args.p_page != null ? 'design_spec' : 'im',
        subject_id: null, subject_version: 2, language: 'en',
        section_id: args.p_section_id, section_title: args.p_section_title,
        quote: args.p_quote, quote_before: args.p_quote_before, quote_after: args.p_quote_after,
        page: args.p_page, anchor_x: args.p_anchor_x, anchor_y: args.p_anchor_y,
        anchor_w: args.p_anchor_w, anchor_h: args.p_anchor_h,
        body: args.p_body, author_name: args.p_author_name, attachments: [],
        status: 'open', resolved_at: null, resolved_by: null,
        created_at: '2026-09-09T00:00:00Z',
      });
    }),
  },
  storage: { publicUrl: (b: string, p: string) => `https://x/${b}/${p}` },
  orEmpty: (p: Promise<unknown>) => p,
}));

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import { addReviewComment, anchorFromRow } from './review-comments.service';

describe('addReviewComment — anchor goes onto the wire as exactly one shape', () => {
  beforeEach(() => { rpcCalls.length = 0; });

  it('sends a text anchor with every PDF parameter null', async () => {
    await addReviewComment('tok', {
      anchor: {
        kind: 'text',
        sectionId: 'sec-1', sectionTitle: 'Safety',
        quote: 'wrong voltage', quoteBefore: 'the ', quoteAfter: ' rating',
      },
      body: 'This is wrong', authorName: 'Wang',
    });

    expect(rpcCalls).toHaveLength(1);
    const { fn, args } = rpcCalls[0];
    expect(fn).toBe('review_add_comment');
    expect(args.p_section_id).toBe('sec-1');
    expect(args.p_quote).toBe('wrong voltage');
    expect(args.p_page).toBeNull();
    expect(args.p_anchor_x).toBeNull();
    expect(args.p_anchor_y).toBeNull();
    expect(args.p_anchor_w).toBeNull();
    expect(args.p_anchor_h).toBeNull();
  });

  it('sends a pin anchor with every text parameter null', async () => {
    await addReviewComment('tok', {
      anchor: { kind: 'pdf', page: 3, x: 0.25, y: 0.6, w: null, h: null },
      body: 'Handle radius should be R5', authorName: 'Ana',
    });

    const { args } = rpcCalls[0];
    expect(args.p_page).toBe(3);
    expect(args.p_anchor_x).toBe(0.25);
    expect(args.p_anchor_y).toBe(0.6);
    expect(args.p_section_id).toBeNull();
    expect(args.p_section_title).toBeNull();
    expect(args.p_quote).toBeNull();
    expect(args.p_quote_before).toBeNull();
    expect(args.p_quote_after).toBeNull();
  });

  it('carries a dragged region through as w/h', async () => {
    await addReviewComment('tok', {
      anchor: { kind: 'pdf', page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      body: 'These tolerances are unmanufacturable', authorName: 'Wei',
    });

    const { args } = rpcCalls[0];
    expect(args.p_anchor_w).toBe(0.3);
    expect(args.p_anchor_h).toBe(0.4);
  });

  it('round-trips a pin back out of the returned row as a pdf anchor', async () => {
    const created = await addReviewComment('tok', {
      anchor: { kind: 'pdf', page: 3, x: 0.25, y: 0.6, w: null, h: null },
      body: 'note', authorName: 'Ana',
    });
    expect(created.anchor).toEqual({ kind: 'pdf', page: 3, x: 0.25, y: 0.6, w: null, h: null });
  });
});

describe('anchorFromRow', () => {
  it('reads a text anchor when the row carries a chapter', () => {
    expect(anchorFromRow({
      section_id: 'sec-1', section_title: 'Safety',
      quote: 'q', quote_before: 'b', quote_after: 'a', page: null,
    })).toEqual({
      kind: 'text', sectionId: 'sec-1', sectionTitle: 'Safety',
      quote: 'q', quoteBefore: 'b', quoteAfter: 'a',
    });
  });

  it('coerces numeric strings, which is how PostgREST returns numeric columns', () => {
    // numeric(6,5) arrives as a string over JSON. Left as-is it would break arithmetic in
    // the canvas, positioning every pin at NaN.
    const a = anchorFromRow({ section_id: null, page: '2', anchor_x: '0.25000', anchor_y: '0.60000' });
    expect(a).toEqual({ kind: 'pdf', page: 2, x: 0.25, y: 0.6, w: null, h: null });
  });

  it('prefers the page when a row somehow carries both, rather than a half-populated shape', () => {
    // The database forbids this (review_comments_one_anchor); deterministic beats undefined.
    const a = anchorFromRow({ section_id: 'sec-1', page: 2, anchor_x: 0.5, anchor_y: 0.5 });
    expect(a?.kind).toBe('pdf');
  });

  it('returns null for a row with no anchor at all', () => {
    expect(anchorFromRow({ section_id: null, page: null })).toBeNull();
  });
});
