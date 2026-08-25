/**
 * Public, unauthenticated supplier review portal (`/#/review/im/:token`).
 *
 * The first-party replacement for the Markup.io round: instead of marking up a PDF on someone
 * else's site, the supplier reads the ONLINE manual here — the same read-only <IMViewer> the
 * internal Viewer tab and the /share/im/ page render — selects the wording that is wrong, and
 * leaves a note. The PM sees those notes in a side panel inside the IM editor.
 *
 * Access is the bearer token alone: no login, no PIN. Everything the page writes goes through
 * the anon-callable RPCs in db_migrations/131, each of which re-resolves the token itself, so
 * this page can never name the manual a comment lands on.
 *
 * The reviewer's display name is self-declared and kept in localStorage. It identifies who
 * wrote which note in a list; it is not, and must not be read as, authentication.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, MessageSquarePlus, CheckCircle2, Trash2, X, Send } from 'lucide-react';
import {
  resolveReviewShare,
  listReviewCommentsByToken,
  addReviewComment,
  deleteReviewComment,
  submitReview,
  getPublishedManifestUrl,
  type IMReviewComment,
  type IMReviewSession,
} from '../../services';
import { IMViewer, type ViewerSource, type ViewerTextSelection } from '../../modules/im-viewer';
import { buildReviewAnchor, MAX_QUOTE_CHARS } from './review-anchor';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';

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

const STATUS_LABEL: Record<IMReviewComment['status'], string> = {
  open: 'Open',
  done: 'Done',
  wont_fix: 'Not changing',
};

const STATUS_TONE: Record<IMReviewComment['status'], 'amber' | 'emerald' | 'gray'> = {
  open: 'amber',
  done: 'emerald',
  wont_fix: 'gray',
};

const IMReviewPortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [session, setSession] = useState<IMReviewSession | null>(null);
  const [source, setSource] = useState<ViewerSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [name, setName] = useState(readStoredName);
  const [nameDraft, setNameDraft] = useState('');

  const [comments, setComments] = useState<IMReviewComment[]>([]);
  const [selection, setSelection] = useState<ViewerTextSelection | null>(null);
  const [composerFor, setComposerFor] = useState<ViewerTextSelection | null>(null);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  // Resolve the token, then point the viewer at the published manifest.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setError('Invalid link.');
        setLoading(false);
        return;
      }
      try {
        const resolved = await resolveReviewShare(token);
        if (cancelled) return;
        if (!resolved) {
          // One message for unknown / revoked / expired / wrong-mode on purpose, so probing a
          // token can't tell the cases apart.
          setError('This review link is invalid, expired or has been revoked.');
          return;
        }
        const manifestUrl = getPublishedManifestUrl(resolved.projectId, resolved.templateType);
        if (!manifestUrl) {
          setError('This manual is unavailable.');
          return;
        }
        setSession(resolved);
        setSubmittedAt(resolved.submittedAt);
        setSource({ manifestUrl });
        const existing = await listReviewCommentsByToken(token);
        if (!cancelled) setComments(existing);
      } catch (e) {
        // Any unexpected failure must still resolve the loading state — otherwise this
        // supplier-facing page hangs on "Loading manual…" with an unhandled rejection.
        if (!cancelled) {
          console.error('[IMReviewPortal] Failed to load review:', e);
          setError('This manual is currently unavailable. Please try again later.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token]);

  const onSelectText = useCallback((sel: ViewerTextSelection | null) => {
    setSelection(sel);
  }, []);

  const openComposer = () => {
    if (!selection) return;
    setComposerFor(selection);
    setBody('');
    setNotice(null);
  };

  const closeComposer = () => {
    setComposerFor(null);
    setBody('');
  };

  const saveComment = async () => {
    if (!token || !composerFor || !body.trim() || saving) return;
    const anchor = buildReviewAnchor({
      sectionId: composerFor.sectionId,
      sectionTitle: composerFor.sectionTitle,
      sectionText: composerFor.sectionText,
      quote: composerFor.text,
    });
    if (!anchor) {
      setNotice({ kind: 'error', text: 'Select some text in the manual first.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const created = await addReviewComment(token, {
        sectionId: anchor.sectionId,
        sectionTitle: anchor.sectionTitle,
        quote: anchor.quote,
        quoteBefore: anchor.quoteBefore,
        quoteAfter: anchor.quoteAfter,
        body: body.trim(),
        authorName: name,
      });
      setComments(prev => [...prev, created]);
      closeComposer();
      setSelection(null);
      setNotice({ kind: 'ok', text: 'Note added.' });
    } catch (e: any) {
      // The RPC's messages are written for this screen (length caps, dead link) — show them.
      console.error('[IMReviewPortal] addReviewComment failed:', e);
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
      console.error('[IMReviewPortal] deleteReviewComment failed:', e);
      setNotice({ kind: 'error', text: 'Could not remove that note.' });
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
      console.error('[IMReviewPortal] submitReview failed:', e);
      setNotice({ kind: 'error', text: e?.message ?? 'Could not submit the review.' });
    } finally {
      setSaving(false);
    }
  };

  const openCount = useMemo(() => comments.filter(c => c.status === 'open').length, [comments]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400">Loading manual…</div>;
  }

  if (error || !source || !session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-500 gap-3 px-4 text-center">
        <AlertTriangle size={32} className="text-amber-400" />
        <p className="text-sm">{error || 'This manual is unavailable.'}</p>
      </div>
    );
  }

  // Name gate. Asked once per browser, before the manual, so every note has an author.
  if (!name) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl p-6">
          <h1 className="text-lg font-bold text-primary mb-1">Review this manual</h1>
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
            onKeyDown={e => { if (e.key === 'Enter' && nameDraft.trim()) { storeName(nameDraft.trim()); setName(nameDraft.trim()); } }}
            maxLength={120}
            placeholder="e.g. Anna Weber, Shenzhen QA"
            className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <p className="text-[11px] text-gray-400 mt-2">
            So the team knows who left each note. Stored on this device only.
          </p>
          <Button
            className="w-full mt-4"
            disabled={!nameDraft.trim()}
            onClick={() => { storeName(nameDraft.trim()); setName(nameDraft.trim()); }}
          >
            Start reviewing
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-white flex overflow-hidden">
      <div className="flex-1 min-w-0 relative">
        <IMViewer source={source} onSelectText={onSelectText} />

        {/* Floats over the manual next to whatever the reviewer just highlighted. */}
        {selection && !composerFor && (
          <button
            onClick={openComposer}
            // Keep the browser from collapsing the selection when this is pressed: without it
            // the mousedown clears the highlight, the button unmounts on the next render, and
            // the click never lands on anything.
            onMouseDown={e => e.preventDefault()}
            style={{ top: Math.max(8, selection.rect.bottom + 8), left: Math.max(8, selection.rect.left) }}
            className="fixed z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium shadow-lg hover:bg-indigo-700 transition-colors"
          >
            <MessageSquarePlus size={13} /> Comment on selection
          </button>
        )}
      </div>

      <aside className="w-96 shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-primary">Your review</h2>
            <Badge tone={openCount ? 'amber' : 'gray'}>{comments.length} note{comments.length === 1 ? '' : 's'}</Badge>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            Reviewing as <strong className="text-gray-600">{name}</strong> ·{' '}
            <button className="underline hover:text-gray-600" onClick={() => { setNameDraft(name); setName(''); }}>change</button>
          </p>
        </div>

        {notice && (
          <div className={`px-4 py-2 text-xs ${notice.kind === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {notice.text}
          </div>
        )}

        {composerFor ? (
          <div className="p-4 border-b border-gray-200 bg-white">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                {composerFor.sectionTitle || 'Selected text'}
              </span>
              <button onClick={closeComposer} className="p-0.5 text-gray-400 hover:text-gray-600" title="Cancel">
                <X size={14} />
              </button>
            </div>
            <blockquote className="text-xs text-gray-600 italic border-l-2 border-indigo-200 pl-2 mb-2 max-h-24 overflow-y-auto">
              {composerFor.text.slice(0, MAX_QUOTE_CHARS)}
            </blockquote>
            <textarea
              autoFocus
              rows={4}
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={4000}
              placeholder="What's wrong, and what should it say instead?"
              className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" size="sm" onClick={closeComposer}>Cancel</Button>
              <Button size="sm" loading={saving} disabled={!body.trim()} onClick={saveComment}>Add note</Button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 text-[11px] text-gray-400 border-b border-gray-200 bg-white">
            Highlight any text in the manual to comment on it.
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {comments.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">No notes yet.</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 truncate">
                  {c.sectionTitle || 'Chapter'}
                </span>
                <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
              </div>
              {c.quote && (
                <blockquote className="text-[11px] text-gray-500 italic border-l-2 border-gray-200 pl-2 mb-1.5 line-clamp-3">
                  {c.quote}
                </blockquote>
              )}
              <p className="text-xs text-gray-700 whitespace-pre-wrap">{c.body}</p>
              {c.status === 'open' && (
                <button
                  onClick={() => removeComment(c.id)}
                  className="mt-2 flex items-center gap-1 text-[11px] text-gray-400 hover:text-rose-600 transition-colors"
                >
                  <Trash2 size={11} /> Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-gray-200 bg-white">
          {submittedAt ? (
            <div className="flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 size={14} />
              <span>Review submitted. You can still add notes.</span>
            </div>
          ) : (
            <Button className="w-full" loading={saving} leftIcon={<Send size={13} />} onClick={finishReview}>
              Submit review
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
};

export default IMReviewPortal;
