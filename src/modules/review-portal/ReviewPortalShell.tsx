/**
 * The supplier review portal, minus the document.
 *
 * Everything a reviewer does that has nothing to do with WHAT they are reviewing lives here:
 * resolving the token, the name gate, the note rail, the composer, image attachments,
 * in-thread replies, submitting the round, and the one deliberately-vague "invalid or
 * revoked" screen. The document itself is a render prop — an `<IMViewer>` for a manual, a
 * `<PdfReviewCanvas>` for a design spec.
 *
 * THIS SPLIT IS THE POINT. The requirement for the Design Specs module was explicitly that
 * it and the Instruction Manual share ONE review implementation, so that a fix to submit,
 * attachments or triage lands in both. Everything above is that shared half; the anchor and
 * the document surface are the only parts that genuinely differ, and they differ because an
 * IM note points at wording this app rendered while a PDF note points at a page position.
 *
 * ACCESS IS THE BEARER TOKEN ALONE — no login, no PIN. Every write goes through the
 * anon-callable RPCs in migrations 131/162, each of which re-resolves the token itself, so
 * this page can never name the document a note lands on.
 *
 * The reviewer's display name is self-declared and kept in localStorage. It identifies who
 * wrote which note in a list; it is not, and must not be read as, authentication.
 *
 * ROUND TWO SEES ROUND ONE. When a link is minted as the successor of an earlier one
 * (`review_shares.supersedes_id`, migration 169), this page also loads what that recipient
 * said in the earlier rounds of their own chain — so a supplier reviewing v3 does not have to
 * remember what they asked for on v2. Those notes are kept in a SEPARATE list from the live
 * ones and are strictly read-only: they are anchored to a different version of the document,
 * so Reply and Remove would act on a round that is over, and the surface must be free to draw
 * them differently from the notes being written now.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Loader2, ImagePlus, Send, Trash2, X, Reply, History,
} from 'lucide-react';
import {
  resolveReviewSession,
  listReviewCommentsByToken,
  listPriorReviewCommentsByToken,
  listReviewRepliesByToken,
  addReviewComment,
  deleteReviewComment,
  addReviewReplyByToken,
  submitReview,
  uploadReviewImage,
  reviewImageUrl,
} from '../../services/review';
import type {
  ReviewAnchor, ReviewAttachment, ReviewComment, ReviewReply, ReviewSession,
} from '../../types/review.types';
import {
  downscaleImage, validateImageFile, IMAGE_ACCEPT_ATTR, MAX_ATTACHMENTS,
} from '../../pages/im/review-image';
import { formatReviewStamp, reviewStampTitle } from '../../pages/im/project-im-generator/review-comments.utils';
import { anchorLabel, anchorExcerpt, orderByAnchor } from './anchor-labels';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { KlarsteinLogo } from '../../components/KlarsteinBrand';

/** Where the self-declared reviewer name is remembered between visits. */
const NAME_KEY = 'im-review-name';

const readStoredName = (): string => {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() ?? '';
  } catch {
    // Private-mode browsers throw on localStorage. Falling back to an empty name just means
    // the reviewer types it again — never a reason to break the page.
    return '';
  }
};

const storeName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* see readStoredName */
  }
};

const STATUS_LABEL: Record<ReviewComment['status'], string> = {
  open: 'Open',
  done: 'Done',
  wont_fix: 'Not changing',
};

const STATUS_TONE: Record<ReviewComment['status'], 'amber' | 'emerald' | 'gray'> = {
  open: 'amber',
  done: 'emerald',
  wont_fix: 'gray',
};

/** What a surface gets, and what it may do. */
export interface ReviewSurfaceRenderProps {
  session: ReviewSession;
  comments: readonly ReviewComment[];
  /**
   * What this reviewer said in EARLIER rounds of their chain of links — empty for a first
   * round, and for every link minted before rounds were chained.
   *
   * A surface should render these as clearly secondary: they point at a place on the PREVIOUS
   * version, and a page added or removed since shifts them. The PDF surface draws them as
   * hollow rings for exactly that reason. A surface is free to ignore them entirely; they are
   * listed in the rail either way.
   */
  priorComments: readonly ReviewComment[];
  /** True while the composer is open. Surfaces suppress their own "comment here" affordance. */
  composing: boolean;
  /** The anchor being composed, so the surface can draw it provisionally. */
  draftAnchor: ReviewAnchor | null;
  /**
   * The reviewer has committed to commenting on a place.
   *
   * The SURFACE decides when this happens, not the shell: a text surface shows a floating
   * "Comment on selection" button positioned over the document, a PDF surface opens the
   * composer the moment a pin is dropped. Both are positioning decisions about a document
   * the shell cannot see.
   */
  startComment: (anchor: ReviewAnchor) => void;
  focusedCommentId: string | null;
  focusComment: (id: string | null) => void;
}

export interface ReviewPortalShellProps {
  token: string | undefined;
  /** "Review this manual" / "Review this design spec". */
  gateTitle: string;
  /** Shown while the token is being resolved. */
  loadingLabel: string;
  /** Shown when the document itself cannot be reached. */
  unavailableLabel: string;
  /** "Highlight any text…" / "Click anywhere on the page…". */
  pickHint: string;
  /** Placeholder for the note body. */
  bodyPlaceholder?: string;
  /**
   * Anything the surface needs before it can render, derived from the session.
   *
   * Returning an error here is how a surface says "the token is fine but the document is
   * gone" — a manual that was never published, a version whose file is missing.
   */
  prepare?: (session: ReviewSession) => Promise<string | null>;
  surface: (props: ReviewSurfaceRenderProps) => React.ReactNode;
}

export const ReviewPortalShell: React.FC<ReviewPortalShellProps> = ({
  token, gateTitle, loadingLabel, unavailableLabel, pickHint,
  bodyPlaceholder = 'What’s wrong, and what should it say instead?',
  prepare, surface,
}) => {
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [name, setName] = useState(readStoredName);
  const [nameDraft, setNameDraft] = useState('');

  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [priorComments, setPriorComments] = useState<ReviewComment[]>([]);
  /** Collapsed by default: the round being written is what the reviewer came here for. */
  const [showPrior, setShowPrior] = useState(false);
  const [replies, setReplies] = useState<ReviewReply[]>([]);
  const [draftAnchor, setDraftAnchor] = useState<ReviewAnchor | null>(null);
  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');

  // Images staged for the note being written. Uploaded as they are picked, not on save: the
  // reviewer sees each thumbnail land (and can drop it again) instead of waiting on a long
  // upload at the moment they press "Add note".
  const [pending, setPending] = useState<ReviewAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setError('Invalid link.');
        setLoading(false);
        return;
      }
      try {
        const resolved = await resolveReviewSession(token);
        if (cancelled) return;
        if (!resolved) {
          // One message for unknown / revoked / expired / wrong-mode on purpose, so probing
          // a token can't tell the cases apart.
          setError('This review link is invalid, expired or has been revoked.');
          return;
        }

        if (prepare) {
          const problem = await prepare(resolved);
          if (cancelled) return;
          if (problem) { setError(problem); return; }
        }

        setSession(resolved);
        setSubmittedAt(resolved.submittedAt);

        const [existing, existingReplies, prior] = await Promise.all([
          listReviewCommentsByToken(token),
          listReviewRepliesByToken(token),
          // Empty unless this link supersedes another. The rpc is the gate, not this call:
          // it walks the chain from this token and returns nothing for an unchained link.
          listPriorReviewCommentsByToken(token),
        ]);
        if (!cancelled) {
          setComments(existing);
          setReplies(existingReplies);
          setPriorComments(prior);
        }
      } catch (e) {
        // Any unexpected failure must still resolve the loading state — otherwise this
        // supplier-facing page hangs on a spinner with an unhandled rejection.
        if (!cancelled) {
          console.error('[ReviewPortalShell] failed to load review:', e);
          setError(unavailableLabel);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
    // `prepare` and the labels are stable per page; re-resolving on a new token is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const startComment = useCallback((anchor: ReviewAnchor) => {
    setDraftAnchor(anchor);
    setComposing(true);
    setBody('');
    setPending([]);
    setNotice(null);
  }, []);

  const closeComposer = () => {
    setComposing(false);
    setDraftAnchor(null);
    setBody('');
    // Staged uploads are abandoned, not deleted: the objects are orphaned in the bucket under
    // this share's prefix. Cheap, and far better than blocking Cancel on a round trip.
    setPending([]);
  };

  /**
   * Attach the picked images: validate, downscale in the browser, upload each.
   *
   * Sequential rather than parallel — a reviewer on a phone attaching three photos over a
   * hotel connection gets a stable one-at-a-time progression instead of three uploads
   * fighting for the same narrow pipe. One failure stops the run and keeps what landed.
   */
  const attachFiles = async (files: FileList | null) => {
    if (!token || !files?.length || uploading) return;
    setUploading(true);
    setNotice(null);
    // A local accumulator, not `pending`: this loop awaits between iterations, so reading the
    // state variable would see the value captured when the handler was created and the
    // per-note cap would never advance.
    let staged = pending;
    try {
      for (const file of Array.from(files)) {
        const rejection = validateImageFile(file, staged.length);
        if (rejection) {
          setNotice({ kind: 'error', text: rejection });
          break;
        }
        const { blob, width, height, contentType } = await downscaleImage(file);
        const attachment = await uploadReviewImage(token, blob, contentType, { width, height });
        staged = [...staged, attachment];
        setPending(staged);
      }
    } catch (e: any) {
      console.error('[ReviewPortalShell] image upload failed:', e);
      setNotice({ kind: 'error', text: e?.message ?? 'Could not attach that image.' });
    } finally {
      setUploading(false);
      // Reset the input so picking the SAME file again still fires a change event.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePending = (path: string) => {
    setPending(prev => prev.filter(a => a.path !== path));
  };

  const saveComment = async () => {
    if (!token || !draftAnchor || !body.trim() || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const created = await addReviewComment(token, {
        anchor: draftAnchor,
        body: body.trim(),
        authorName: name,
        attachments: pending,
      });
      setComments(prev => [...prev, created]);
      closeComposer();
      setNotice({ kind: 'ok', text: 'Note added.' });
    } catch (e: any) {
      // The RPC's messages are written for this screen (length caps, anchor rules, dead
      // link) — show them.
      console.error('[ReviewPortalShell] addReviewComment failed:', e);
      setNotice({ kind: 'error', text: e?.message ?? 'Could not save that note. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const removeComment = async (id: string) => {
    if (!token) return;
    try {
      const ok = await deleteReviewComment(token, id);
      if (ok) setComments(prev => prev.filter(c => c.id !== id));
      else setNotice({ kind: 'error', text: 'That note can no longer be removed — the team has already acted on it.' });
    } catch (e) {
      console.error('[ReviewPortalShell] deleteReviewComment failed:', e);
      setNotice({ kind: 'error', text: 'Could not remove that note.' });
    }
  };

  const sendReply = async (commentId: string) => {
    if (!token || !replyBody.trim() || saving) return;
    setSaving(true);
    try {
      const created = await addReviewReplyByToken(token, commentId, replyBody.trim(), name);
      setReplies(prev => [...prev, created]);
      setReplyBody('');
      setReplyingTo(null);
    } catch (e: any) {
      console.error('[ReviewPortalShell] addReviewReply failed:', e);
      setNotice({ kind: 'error', text: e?.message ?? 'Could not send that reply.' });
    } finally {
      setSaving(false);
    }
  };

  const finishReview = async () => {
    if (!token || saving) return;
    setSaving(true);
    try {
      const at = await submitReview(token, name);
      setSubmittedAt(at);
      setNotice({ kind: 'ok', text: 'Review submitted — thank you.' });
    } catch (e: any) {
      console.error('[ReviewPortalShell] submitReview failed:', e);
      setNotice({ kind: 'error', text: e?.message ?? 'Could not submit the review.' });
    } finally {
      setSaving(false);
    }
  };

  const openCount = useMemo(() => comments.filter(c => c.status === 'open').length, [comments]);
  /** Reading order — page then down the page for a PDF, creation order for text. */
  const ordered = useMemo(() => orderByAnchor(comments), [comments]);
  const repliesByComment = useMemo(() => {
    const map = new Map<string, ReviewReply[]>();
    for (const r of replies) {
      const list = map.get(r.commentId);
      if (list) list.push(r); else map.set(r.commentId, [r]);
    }
    return map;
  }, [replies]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400">
        {loadingLabel}
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-500 gap-3 px-4 text-center">
        <AlertTriangle size={32} className="text-amber-400" />
        <p className="text-sm">{error || unavailableLabel}</p>
      </div>
    );
  }

  // Name gate. Asked once per browser, before the document, so every note has an author.
  if (!name) {
    const commit = () => {
      const trimmed = nameDraft.trim();
      if (!trimmed) return;
      storeName(trimmed);
      setName(trimmed);
    };
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 gap-6">
        <KlarsteinLogo height={26} />
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl p-6">
          <h1 className="text-lg font-bold text-primary mb-1">{gateTitle}</h1>
          <p className="text-sm text-muted mb-5">
            {session.label
              ? `${session.label} — your notes go straight to the product team.`
              : 'Your notes go straight to the product team.'}
          </p>
          <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5" htmlFor="reviewer-name">
            Your name
          </label>
          <input
            id="reviewer-name"
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); }}
            maxLength={120}
            placeholder="e.g. Anna Weber, Shenzhen QA"
            className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <p className="text-[11px] text-gray-400 mt-2">
            So the team knows who left each note. Stored on this device only.
          </p>
          <Button className="w-full mt-4" disabled={!nameDraft.trim()} onClick={commit}>
            Start reviewing
          </Button>
        </div>
      </div>
    );
  }

  const draftLabel = draftAnchor ? anchorLabel(draftAnchor, 'Selected text') : '';
  const draftExcerpt = draftAnchor ? anchorExcerpt(draftAnchor) : null;

  return (
    <div className="h-screen w-screen bg-white flex overflow-hidden">
      <div className="flex-1 min-w-0 relative">
        {surface({
          session,
          comments,
          priorComments,
          composing,
          draftAnchor,
          startComment,
          focusedCommentId,
          focusComment: setFocusedCommentId,
        })}
      </div>

      <aside className="w-96 shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col">
        <div className="kl-brandbar px-4 h-12 flex items-center shrink-0">
          <KlarsteinLogo height={18} />
        </div>
        <div className="px-4 py-3 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-primary">Your review</h2>
            <Badge tone={openCount ? 'amber' : 'gray'}>
              {comments.length} note{comments.length === 1 ? '' : 's'}
            </Badge>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            Reviewing as <strong className="text-gray-600">{name}</strong> ·{' '}
            <button className="underline hover:text-gray-600" onClick={() => { setNameDraft(name); setName(''); }}>
              change
            </button>
          </p>
        </div>

        {notice && (
          <div className={`px-4 py-2 text-xs ${notice.kind === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {notice.text}
          </div>
        )}

        {composing && draftAnchor ? (
          <div className="p-4 border-b border-gray-200 bg-white">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                {draftLabel}
              </span>
              <button onClick={closeComposer} className="p-0.5 text-gray-400 hover:text-gray-600" title="Cancel">
                <X size={14} />
              </button>
            </div>
            {draftExcerpt && (
              <blockquote className="text-xs text-gray-600 italic border-l-2 border-indigo-200 pl-2 mb-2 max-h-24 overflow-y-auto">
                {draftExcerpt}
              </blockquote>
            )}
            <textarea
              autoFocus
              rows={4}
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={4000}
              placeholder={bodyPlaceholder}
              className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            {/* Staged images. Already uploaded, so a thumbnail appearing means the file is
                safely stored — not that it will be sent when the note is saved. */}
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {pending.map(a => (
                  <div key={a.path} className="relative group">
                    <img src={reviewImageUrl(a.path)} alt="" className="h-14 w-14 object-cover rounded border border-gray-200" />
                    <button
                      onClick={() => removePending(a.path)}
                      title="Remove this image"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 hover:text-rose-600 hover:border-rose-300 flex items-center justify-center shadow-sm"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 mt-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={IMAGE_ACCEPT_ATTR}
                multiple
                className="hidden"
                onChange={e => void attachFiles(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || pending.length >= MAX_ATTACHMENTS}
                title={pending.length >= MAX_ATTACHMENTS
                  ? `A note can carry at most ${MAX_ATTACHMENTS} images`
                  : 'Attach a screenshot or photo'}
                className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-indigo-600 disabled:opacity-40 disabled:hover:text-gray-500 transition-colors"
              >
                {uploading
                  ? <><Loader2 size={12} className="animate-spin" /> Uploading…</>
                  : <><ImagePlus size={12} /> Add image</>}
              </button>
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={closeComposer}>Cancel</Button>
              {/* Saving while an upload is in flight would drop that image from the note. */}
              <Button size="sm" loading={saving} disabled={!body.trim() || uploading} onClick={saveComment}>
                Add note
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 text-[11px] text-gray-400 border-b border-gray-200 bg-white">
            {pickHint}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {priorComments.length > 0 && (
            /* Read-only, and visibly so: no Reply, no Remove, muted. These belong to a round
               that is closed, on a version that is not the one on screen. */
            <div className="border border-gray-200 rounded-lg bg-white/60">
              <button
                onClick={() => setShowPrior(v => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
              >
                <History size={12} className="text-gray-400 shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                  What you asked for last round
                </span>
                <span className="ml-auto text-[11px] text-gray-400">
                  {priorComments.length} · {showPrior ? 'hide' : 'show'}
                </span>
              </button>
              {showPrior && (
                <ul className="border-t border-gray-100 divide-y divide-gray-100">
                  {priorComments.map(c => {
                    const stamp = formatReviewStamp(c.createdAt);
                    const focused = focusedCommentId === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => setFocusedCommentId(focused ? null : c.id)}
                          className={`w-full text-left px-3 py-2 ${focused ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                              {anchorLabel(c.anchor)}
                            </span>
                            {c.subjectVersion != null && <Badge tone="gray">v{c.subjectVersion}</Badge>}
                            <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                          </div>
                          <p className="text-xs text-gray-600 whitespace-pre-wrap">{c.body}</p>
                          {stamp.short && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              <time dateTime={c.createdAt} title={reviewStampTitle(stamp)}>{stamp.short}</time>
                            </p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="px-3 pb-2 text-[10px] text-gray-400">
                Marked on the previous version, so the positions are approximate. Add a new note
                for anything still wrong.
              </p>
            </div>
          )}
          {ordered.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">No notes yet.</p>
          )}
          {ordered.map((c, i) => {
            const stamp = formatReviewStamp(c.createdAt);
            const excerpt = anchorExcerpt(c.anchor);
            const thread = repliesByComment.get(c.id) ?? [];
            const focused = focusedCommentId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setFocusedCommentId(focused ? null : c.id)}
                className={`bg-white border rounded-lg p-3 cursor-pointer transition-colors ${
                  focused ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 truncate">
                    {/* A pin's number matches the pin drawn on the page, so the rail and the
                        document can be read against each other. */}
                    {c.anchor?.kind === 'pdf' && <span className="text-indigo-600">{i + 1}. </span>}
                    {anchorLabel(c.anchor)}
                  </span>
                  <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                </div>
                {/* Who wrote it and exactly when. A link can go to several people at the
                    supplier, and the same person returns days later — an unattributed,
                    undated note is one nobody can act on or stand behind. */}
                <div className="flex flex-wrap items-baseline gap-x-1.5 text-[10px] text-gray-400 mb-1.5">
                  <span className="font-semibold text-gray-600 truncate max-w-full">{c.authorName}</span>
                  {name && c.authorName === name && <span className="text-gray-400">(you)</span>}
                  {stamp.short && (
                    <>
                      <span>·</span>
                      <time dateTime={c.createdAt} title={reviewStampTitle(stamp)}>{stamp.short}</time>
                    </>
                  )}
                </div>
                {excerpt && (
                  <blockquote className="text-[11px] text-gray-500 italic border-l-2 border-gray-200 pl-2 mb-1.5 line-clamp-3">
                    {excerpt}
                  </blockquote>
                )}
                <p className="text-xs text-gray-700 whitespace-pre-wrap">{c.body}</p>
                {c.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {c.attachments.map(a => (
                      <a
                        key={a.path}
                        href={reviewImageUrl(a.path)}
                        target="_blank"
                        rel="noreferrer"
                        title="Open full size"
                        onClick={e => e.stopPropagation()}
                      >
                        <img
                          src={reviewImageUrl(a.path)}
                          alt=""
                          className="h-12 w-12 object-cover rounded border border-gray-200 hover:border-indigo-300"
                        />
                      </a>
                    ))}
                  </div>
                )}

                {/* The thread. An answer from the team is why a reviewer comes back to a
                    note they already wrote, so it belongs on the note and not in an email. */}
                {thread.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-l-2 border-indigo-100 pl-2">
                    {thread.map(r => (
                      <div key={r.id}>
                        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[10px] text-gray-400">
                          <span className="font-semibold text-gray-600">{r.authorName}</span>
                          {r.authorUserId && <span className="text-indigo-500">· team</span>}
                        </div>
                        <p className="text-[11px] text-gray-600 whitespace-pre-wrap">{r.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                {replyingTo === c.id ? (
                  <div className="mt-2" onClick={e => e.stopPropagation()}>
                    <textarea
                      autoFocus
                      rows={2}
                      value={replyBody}
                      onChange={e => setReplyBody(e.target.value)}
                      maxLength={4000}
                      placeholder="Reply…"
                      className="w-full border border-gray-300 rounded p-1.5 text-[11px] focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <div className="flex items-center gap-2 mt-1">
                      <Button variant="ghost" size="sm" onClick={() => { setReplyingTo(null); setReplyBody(''); }}>
                        Cancel
                      </Button>
                      <Button size="sm" loading={saving} disabled={!replyBody.trim()} onClick={() => void sendReply(c.id)}>
                        Reply
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={e => { e.stopPropagation(); setReplyingTo(c.id); setReplyBody(''); }}
                      className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600 transition-colors"
                    >
                      <Reply size={11} /> Reply
                    </button>
                    {c.status === 'open' && (
                      <button
                        onClick={e => { e.stopPropagation(); void removeComment(c.id); }}
                        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-rose-600 transition-colors"
                      >
                        <Trash2 size={11} /> Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-gray-200 bg-white">
          {submittedAt ? (
            <div className="flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 size={14} />
              <span>Review submitted. You can still add notes.</span>
            </div>
          ) : (
            <Button className="kl-cta w-full" loading={saving} leftIcon={<Send size={13} />} onClick={finishReview}>
              Submit review
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
};

export default ReviewPortalShell;
