/**
 * The internal version viewer: a design spec version's pages, its reviewers' pins, a switcher
 * across every version the spec has, and a side-by-side compare of any two of them.
 *
 * WHY THIS EXISTS. Design Specs has kept every version since day one — a new upload creates
 * a `design_spec_versions` row rather than replacing one, and every note records the version
 * it was written against. Until now none of that was READABLE internally: the panel's "Open"
 * button hands the browser a signed URL for a new tab, so the team saw the PDF with no pins
 * on it and the notes as a list with no pages. The reported pain ("whenever I need to check
 * the second version, I need to remember which things I flagged") was therefore a missing
 * surface, not missing data.
 *
 * NO NOTE IS WRITTEN HERE. Pins are drawn, never dropped: an internal reader is not a
 * reviewer, and a note written from here would belong to no review round and no share. What
 * this surface DOES write is triage — the verdict on a note the reader is looking at.
 *
 * CARRY-OVER IS THE POINT OF THE THIRD VERDICT. With the previous round's unresolved notes
 * ghosted onto the new version, the reader can say Fixed, Not changing, or **Still an
 * issue** — and that last one changes nothing about the note except recording that somebody
 * checked it against this version (`checked_subject_id`, migration 169). Without it an open
 * note nobody has looked at and an open note confirmed still wrong are indistinguishable,
 * which is the memory problem this module exists to end.
 *
 * Replies stay in `ProjectDesignSpecPanel` below: answering a supplier is a conversation, not
 * a verdict, and it wants the room.
 *
 * COMPARE IS TWO PANES, NOT A DIFF. Nothing here inspects the two PDFs for changes. Both
 * sides render independently, each with its own zoom and its own pins, and the only thing
 * shared is the scroll position — mapped page-to-page, never pixel-to-pixel, by
 * `compare-scroll.ts`. A page inserted between versions is corrected by the reader with the
 * page-offset control, visibly, rather than guessed at.
 *
 * AN OVERLAY, NOT A CARD. The Design Spec tab is a scrolling column of cards; a PDF needs
 * the viewport. Escape and the backdrop both close it.
 *
 * See docs/originflow-design-spec-version-review.md for the plan this is steps 1 and 2 of.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Ban, Check, Columns2, History, Layers, Loader2, Lock, MessageSquare,
  RotateCcw, Undo2, X,
} from 'lucide-react';
import { fetchDesignSpecObject } from '../../services/design';
import { markReviewCommentChecked, setReviewCommentStatus } from '../../services/review';
import type { DesignSpecVersion } from '../../types/design-spec.types';
import type { PdfReviewAnchor, ReviewComment, ReviewCommentStatus } from '../../types/review.types';
import { anchorLabel, orderByAnchor } from '../../modules/review-portal';
import { reviewImageUrl } from '../../services/review';
import { formatReviewStamp, reviewStampTitle } from '../im/project-im-generator/review-comments.utils';
import {
  DESIGN_SPEC_STAGE_META, releaseLabel, releaseShort, releaseShortByNumber,
} from './design-spec-release';
import { Badge } from '../../components/common/Badge';
import {
  readScrollPosition, scrollTopFor, mapPage, type PageBox,
} from './compare-scroll';

/**
 * Code-split for the same reason `DesignSpecReviewPortal` splits it: `PdfReviewCanvas`
 * imports pdf.js at module scope, and this component is reachable from a project page that
 * every internal user opens. Imported eagerly, ~350KB of pdf.js lands in the main chunk for
 * everyone, to serve a viewer opened deliberately.
 */
const PdfReviewCanvas = React.lazy(() => import('../../modules/review-portal/PdfReviewCanvas'));

/**
 * How many versions' bytes to hold at once.
 *
 * `fetchDesignSpecObject` pulls a whole PDF into memory to escape the signed URL's
 * five-minute TTL, and a spec may be 50MB, so an unbounded cache is 350MB after browsing
 * seven versions. Three is the compare view's two panes plus one recently-left version, so
 * the common move — flicking back to the version you reviewed — stays free. Anything on
 * screen is never evicted, whatever this number says.
 */
const BLOB_CACHE_LIMIT = 3;

/** How long to keep waiting for a pane's pages before giving up on a jump-to-note. */
const JUMP_RETRY_MS = 100;
const JUMP_RETRY_LIMIT = 50;

/** Where in the viewport a jumped-to pin lands: a third down, not glued to the top edge. */
const JUMP_LEAD_FRACTION = 0.3;

const STATUS_LABEL: Record<ReviewCommentStatus, string> = {
  open: 'Open',
  done: 'Done',
  wont_fix: 'Not changing',
};

const STATUS_TONE: Record<ReviewCommentStatus, 'amber' | 'emerald' | 'gray'> = {
  open: 'amber',
  done: 'emerald',
  wont_fix: 'gray',
};

/** Which half of the compare view a pane is. 'a' is always the lower version number. */
type SlotKey = 'a' | 'b';

export interface DesignSpecVersionViewerProps {
  specCode: string;
  specTitle: string;
  /** Every version, newest first — the order `getDesignSpecVersions` returns. */
  versions: readonly DesignSpecVersion[];
  /** Every note on the spec, across every version. Filtered per version here. */
  notes: readonly ReviewComment[];
  /** Which version to open on — the row whose button was pressed. */
  initialVersionId: string;
  /** The issued final, so the switcher can mark it. */
  finalVersionId: string | null;
  /** False hides every triage control. The database enforces the same thing regardless. */
  canEdit: boolean;
  /** Reload the panel's notes after a verdict, so both surfaces agree without a refresh. */
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}

/**
 * Pin numbers for one version's notes.
 *
 * Must agree with `PdfReviewCanvas`, which numbers its own pins by reading order — page,
 * then down the page, then creation time. `orderByAnchor` sorts by exactly that, so ordering
 * the same input the same way reproduces the same numbers rather than guessing at them.
 * Only PDF-anchored notes get a number, as only they have a pin to label.
 */
const pinNumbers = (versionNotes: readonly ReviewComment[]): Map<string, number> => {
  const pinned = orderByAnchor(versionNotes.filter(n => n.anchor?.kind === 'pdf'));
  return new Map(pinned.map((n, i) => [n.id, i + 1]));
};

/**
 * Each rendered page's geometry inside a pane, in that pane's own pixels.
 *
 * Measured with `getBoundingClientRect` against the container rather than read from
 * `offsetTop`: the page wrappers are `position: relative`, so their offset parent is whatever
 * positioned ancestor happens to be above the scroll container, and that is not the origin
 * scroll positions are measured from. Adding the container's own `scrollTop` back converts
 * the viewport-relative rect into a content-relative offset.
 */
const pageBoxesOf = (el: HTMLDivElement | null): PageBox[] => {
  if (!el) return [];
  const containerTop = el.getBoundingClientRect().top;
  const boxes: PageBox[] = [];
  for (const node of el.querySelectorAll<HTMLElement>('[data-page]')) {
    const page = Number(node.dataset.page);
    if (!page) continue;
    const rect = node.getBoundingClientRect();
    boxes.push({ page, top: rect.top - containerTop + el.scrollTop, height: rect.height });
  }
  return boxes;
};

/**
 * One version's bytes, as a local blob URL, sharing a cache with the other pane.
 *
 * Called once per pane. `null` means the pane is not showing anything (compare is off), which
 * has to be a state rather than a skipped hook.
 */
const useVersionObject = (
  versionId: string | null,
  cache: React.MutableRefObject<Map<string, string>>,
  /** Versions currently on screen. Never evicted, whatever the cache limit says. */
  onScreen: React.MutableRefObject<readonly string[]>,
): { url: string | null; loading: boolean; error: string } => {
  const [state, setState] = useState<{ url: string | null; loading: boolean; error: string }>(
    { url: null, loading: versionId != null, error: '' },
  );

  useEffect(() => {
    if (!versionId) {
      setState({ url: null, loading: false, error: '' });
      return;
    }
    let cancelled = false;
    const store = cache.current;

    const cached = store.get(versionId);
    if (cached) {
      // Re-insert to mark it most recently used; Map keeps insertion order, which is what
      // makes the first key the eviction candidate.
      store.delete(versionId);
      store.set(versionId, cached);
      setState({ url: cached, loading: false, error: '' });
      return;
    }

    setState({ url: null, loading: true, error: '' });
    void (async () => {
      try {
        const obj = await fetchDesignSpecObject(versionId);
        if (cancelled) {
          // The reader switched away mid-download. The bytes are ours and nothing will ever
          // ask for them, so release them rather than caching a version nobody chose.
          URL.revokeObjectURL(obj.objectUrl);
          return;
        }
        store.set(versionId, obj.objectUrl);
        while (store.size > BLOB_CACHE_LIMIT) {
          const victim = [...store.keys()].find(k => !onScreen.current.includes(k));
          // Everything left is on screen: hold more than the limit rather than revoke a URL
          // a pane is rendering from.
          if (!victim) break;
          URL.revokeObjectURL(store.get(victim)!);
          store.delete(victim);
        }
        setState({ url: obj.objectUrl, loading: false, error: '' });
      } catch (e: any) {
        if (cancelled) return;
        console.error('[DesignSpecVersionViewer] could not load the version:', e);
        setState({ url: null, loading: false, error: e?.message ?? 'That version could not be opened.' });
      }
    })();

    return () => { cancelled = true; };
  }, [versionId, cache, onScreen]);

  return state;
};

/** One triage verdict. Small, quiet, and identical for all four so none reads as the default. */
const VerdictButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  onClick: () => void;
}> = ({ icon, label, busy, onClick }) => (
  <button
    onClick={onClick}
    disabled={busy}
    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg border border-gray-200 bg-white text-[10px] font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-40"
  >
    {icon}{label}
  </button>
);

const DesignSpecVersionViewer: React.FC<DesignSpecVersionViewerProps> = ({
  specCode, specTitle, versions, notes, initialVersionId, finalVersionId,
  canEdit, onChanged, onClose,
}) => {
  const [activeId, setActiveId] = useState(initialVersionId);
  /** The version being compared against, or null when one pane is enough. */
  const [compareId, setCompareId] = useState<string | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  /** Rail scope: the versions on screen, or the whole spec's history. */
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [syncScroll, setSyncScroll] = useState(true);
  /** `b`'s page number minus `a`'s, as dialled in by the reader. */
  const [pageOffset, setPageOffset] = useState(0);
  /** A note to jump to once the pane showing it has rendered its pages. */
  const [jumpTo, setJumpTo] = useState<{ versionId: string; page: number; fraction: number } | null>(null);
  /** Ghost the earlier rounds' unresolved notes onto the version on screen. */
  const [carryOver, setCarryOver] = useState(true);
  const [busyNote, setBusyNote] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  /** Downloaded versions, least-recently-used first. A ref: nothing renders from it. */
  const blobs = useRef(new Map<string, string>());
  const onScreenIds = useRef<readonly string[]>([initialVersionId]);
  /** Each pane's scroll container, handed over by the canvas as it mounts. */
  const scrollEls = useRef<Record<SlotKey, HTMLDivElement | null>>({ a: null, b: null });
  /**
   * Which pane the reader is driving.
   *
   * Scroll sync is one-way per gesture: only the pane last touched propagates, so the echo
   * the other pane emits when we set its `scrollTop` is ignored instead of bouncing back.
   * A flag cleared on a timer would either fight a fast trackpad or wedge shut when a
   * programmatic scroll lands on a position the pane was already at and fires no event.
   */
  const driver = useRef<SlotKey | null>(null);
  /** Live settings for the scroll handler, which is bound once and must not go stale. */
  const cfg = useRef({ sync: true, offset: 0, comparing: false });

  const active = useMemo(() => versions.find(v => v.id === activeId) ?? null, [versions, activeId]);
  const compare = useMemo(
    () => (compareId ? versions.find(v => v.id === compareId) ?? null : null),
    [versions, compareId],
  );

  /**
   * The panes, lower version number on the left.
   *
   * Chronological order matters more than "the one you picked goes first": a reader comparing
   * v2 against v3 is reading a before and an after, and putting the after on the left inverts
   * every judgement they make about what changed.
   */
  const slots = useMemo((): { key: SlotKey; version: DesignSpecVersion }[] => {
    if (!active) return [];
    if (!compare) return [{ key: 'a', version: active }];
    const [older, newer] = [active, compare].sort((x, y) => x.version - y.version);
    return [{ key: 'a', version: older }, { key: 'b', version: newer }];
  }, [active, compare]);

  // Declared BEFORE the two `useVersionObject` calls so it is written before their effects
  // run — the eviction pass must never see a stale idea of what is on screen.
  useEffect(() => {
    onScreenIds.current = slots.map(s => s.version.id);
  }, [slots]);

  useEffect(() => {
    cfg.current = { sync: syncScroll, offset: pageOffset, comparing: compare != null };
  }, [syncScroll, pageOffset, compare]);

  const slotA = slots.find(s => s.key === 'a')?.version ?? null;
  const slotB = slots.find(s => s.key === 'b')?.version ?? null;
  const objectA = useVersionObject(slotA?.id ?? null, blobs, onScreenIds);
  const objectB = useVersionObject(slotB?.id ?? null, blobs, onScreenIds);

  // Release every downloaded version on close. Reads the ref at unmount rather than closing
  // over it, so it frees what the cache actually holds and not what it held on mount.
  useEffect(() => () => {
    for (const url of blobs.current.values()) URL.revokeObjectURL(url);
    blobs.current.clear();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ---- notes, grouped and numbered ----

  const notesByVersion = useMemo(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const n of notes) {
      if (!n.subjectId) continue;
      const list = map.get(n.subjectId);
      if (list) list.push(n); else map.set(n.subjectId, [n]);
    }
    return map;
  }, [notes]);

  /**
   * Pin numbers for every version, not only the one on screen.
   *
   * The rail can list two versions' notes at once in compare mode, and each pane numbers its
   * own pins from 1 — so two notes legitimately both wear a "1". The version badge beside the
   * number is what tells them apart, and numbering per version is what keeps each badge
   * matching the pin the reader can actually see.
   */
  const numbersByVersion = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const [versionId, list] of notesByVersion) map.set(versionId, pinNumbers(list));
    return map;
  }, [notesByVersion]);

  const notesFor = useCallback(
    (versionId: string) => orderByAnchor(notesByVersion.get(versionId) ?? []),
    [notesByVersion],
  );

  /**
   * The version a verdict is recorded against: the NEWEST one on screen.
   *
   * In compare mode two versions are visible and a carried note is ghosted onto both, so
   * "which version did you just check this against" would otherwise be ambiguous. The newer
   * one is the only sensible answer — nobody decides a note is fixed by looking at the older
   * copy.
   */
  const checkTarget = useMemo(() => {
    if (slots.length === 0) return null;
    return slots.reduce((best, s) => (s.version.version > best.version.version ? s : best)).version;
  }, [slots]);

  /**
   * Unresolved notes from EARLIER versions, to ghost onto this one.
   *
   * Every earlier version, not just the immediately preceding one: a note left open through
   * v1 and v2 is exactly the note most at risk of being forgotten, and dropping it once v3
   * arrives would rebuild the problem this feature exists to solve. Only PDF-anchored notes
   * qualify, since a ghost is a position on a page.
   */
  const ghostsFor = useCallback((version: DesignSpecVersion): ReviewComment[] => {
    if (!carryOver) return [];
    return orderByAnchor(notes.filter(n =>
      n.status === 'open'
      && n.anchor?.kind === 'pdf'
      && n.subjectVersion != null
      && n.subjectVersion < version.version));
  }, [carryOver, notes]);

  /** Notes ghosted onto at least one pane, so the rail can list them as carried over. */
  const carriedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const slot of slots) for (const g of ghostsFor(slot.version)) ids.add(g.id);
    return ids;
  }, [slots, ghostsFor]);

  const railNotes = useMemo(() => {
    const ordered = [...versions].sort((a, b) => a.version - b.version);
    if (showAllVersions) {
      const listed = ordered.flatMap(v => notesFor(v.id));
      // A note whose version row is gone would otherwise vanish from a list claiming to show
      // everything.
      const placed = new Set(listed.map(n => n.id));
      return [...listed, ...notes.filter(n => !placed.has(n.id))];
    }
    const onScreen = ordered.filter(v => slots.some(s => s.version.id === v.id));
    const own = onScreen.flatMap(v => notesFor(v.id));
    const ownIds = new Set(own.map(n => n.id));
    // Carried notes go AFTER this version's own, in version order: they are context for what
    // is on screen, not part of it.
    const carried = ordered
      .flatMap(v => notesFor(v.id))
      .filter(n => carriedIds.has(n.id) && !ownIds.has(n.id));
    return [...own, ...carried];
  }, [showAllVersions, versions, slots, notesFor, notes, carriedIds]);

  // ---- scroll sync ----

  /** Push the driving pane's position onto the other one. */
  const syncFrom = useCallback((from: SlotKey) => {
    const { sync, offset, comparing } = cfg.current;
    if (!sync || !comparing) return;
    const to: SlotKey = from === 'a' ? 'b' : 'a';
    const src = scrollEls.current[from];
    const dst = scrollEls.current[to];
    if (!src || !dst) return;
    const srcBoxes = pageBoxesOf(src);
    const dstBoxes = pageBoxesOf(dst);
    if (srcBoxes.length === 0 || dstBoxes.length === 0) return;

    const pos = readScrollPosition(srcBoxes, src.scrollTop);
    // The offset is stated as "b's page minus a's", so it applies forwards from a and
    // backwards from b.
    const page = mapPage(pos.page, from === 'a' ? offset : -offset, dstBoxes.length);
    dst.scrollTop = scrollTopFor(dstBoxes, { page, fraction: pos.fraction });
  }, []);

  /**
   * Register a pane's scroll container and listen to it.
   *
   * Bound once per slot and never rebuilt, because the canvas reads this through a ref — so
   * everything it needs comes from refs too. The listener dies with the element it is on.
   */
  const bindPane = useCallback((slot: SlotKey) => (el: HTMLDivElement | null) => {
    scrollEls.current[slot] = el;
    if (!el) return;
    el.addEventListener('scroll', () => {
      if (driver.current !== slot) return;
      syncFrom(slot);
    }, { passive: true });
  }, [syncFrom]);

  /** Re-align the panes after a setting changes, from whichever side was last touched. */
  const resync = useCallback(() => syncFrom(driver.current ?? 'a'), [syncFrom]);

  // A changed offset or a re-enabled sync should take effect now, not at the next scroll —
  // otherwise the control looks broken until the reader happens to move.
  useEffect(() => {
    if (syncScroll && compare) resync();
  }, [pageOffset, syncScroll, compare, resync]);

  // ---- jump to a note ----

  /**
   * Scroll the pane showing `jumpTo`'s version to it, once that pane has pages.
   *
   * Retried rather than done once: choosing a note on another version remounts that pane's
   * canvas, and its pages do not exist until the PDF has been parsed. Bounded so a version
   * that fails to load cannot leave a timer running.
   */
  useEffect(() => {
    if (!jumpTo) return;
    const slot = slots.find(s => s.version.id === jumpTo.versionId)?.key;
    if (!slot) { setJumpTo(null); return; }

    let tries = 0;
    const timer = window.setInterval(() => {
      const el = scrollEls.current[slot];
      const boxes = pageBoxesOf(el);
      const box = boxes.find(b => b.page === jumpTo.page);
      if (el && box) {
        window.clearInterval(timer);
        const target = box.top + jumpTo.fraction * box.height;
        el.scrollTop = Math.max(0, target - el.clientHeight * JUMP_LEAD_FRACTION);
        driver.current = slot;
        syncFrom(slot);
        setJumpTo(null);
        return;
      }
      if (++tries >= JUMP_RETRY_LIMIT) {
        window.clearInterval(timer);
        setJumpTo(null);
      }
    }, JUMP_RETRY_MS);

    return () => window.clearInterval(timer);
  }, [jumpTo, slots, syncFrom]);

  /**
   * Focus a note: bring its version on screen if it is not, then jump to its pin.
   *
   * Clicking the already-focused note unfocuses it but does not scroll away — the reader is
   * dismissing a highlight, not asking to go somewhere.
   */
  const focusNote = useCallback((note: ReviewComment) => {
    const already = focusedCommentId === note.id;
    setFocusedCommentId(already ? null : note.id);
    if (already || !note.subjectId) return;

    const onScreen = slots.some(s => s.version.id === note.subjectId);
    // A carried note already HAS a mark on screen — its ghost. Switching to its own version
    // would take the reader away from the fix they are inspecting, which is the opposite of
    // what clicking it means here.
    const carried = carriedIds.has(note.id);
    if (!onScreen && !carried) setActiveId(note.subjectId);
    if (note.anchor?.kind === 'pdf') {
      const a = note.anchor as PdfReviewAnchor;
      const target = carried && checkTarget ? checkTarget.id : note.subjectId;
      setJumpTo({ versionId: target, page: a.page, fraction: a.y });
    }
  }, [focusedCommentId, slots, carriedIds, checkTarget]);

  /**
   * Record a verdict on a note, against the newest version on screen.
   *
   * 'still' is the one that changes no status: the note stays open because it IS open, and
   * what gets written is that somebody checked it here. The other three go through the shared
   * triage call, which stamps the same check alongside the status so a Fixed verdict says
   * which version fixed it.
   */
  const triage = useCallback(async (
    note: ReviewComment,
    verdict: 'done' | 'wont_fix' | 'still' | 'reopen',
  ) => {
    if (!checkTarget) return;
    const against = { subjectId: checkTarget.id, version: checkTarget.version };
    setBusyNote(note.id);
    setNotice('');
    try {
      if (verdict === 'still') await markReviewCommentChecked(note.id, against);
      else await setReviewCommentStatus(note.id, verdict === 'reopen' ? 'open' : verdict, against);
      await onChanged();
    } catch (e: any) {
      console.error('[DesignSpecVersionViewer] triage failed:', e);
      setNotice(e?.message ?? 'That verdict could not be saved.');
    } finally {
      setBusyNote(null);
    }
  }, [checkTarget, onChanged]);

  /** Pick the primary version. Choosing the compared one swaps the two rather than colliding. */
  const chooseVersion = useCallback((id: string) => {
    if (id === activeId) return;
    if (id === compareId) { setCompareId(activeId); setActiveId(id); return; }
    setActiveId(id);
  }, [activeId, compareId]);

  const comparing = compare != null;
  const railScopeLabel = comparing ? 'These versions' : 'This version';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex flex-col"
      // The zeroed margin is load-bearing, not decoration. The panel renders this inside a
      // `space-y-5` stack, whose `> * + *` rule puts a 20px top margin on it — and on a fixed
      // box with both `top` and `bottom` resolved, a top margin both shifts it down and
      // shortens it, leaving a strip of the page uncovered above the backdrop. Inline rather
      // than `!mt-0` because Tailwind here is the Play CDN, which generates classes from the
      // live DOM; an inline declaration beats the stack's rule without depending on that.
      style={{ marginTop: 0 }}
      onClick={onClose}
    >
      <div
        className="flex-1 m-2 sm:m-4 bg-white rounded-xl overflow-hidden flex flex-col min-h-0"
        onClick={e => e.stopPropagation()}
      >
        {/* ---- header ---- */}
        <div className="px-4 py-2.5 border-b border-gray-200 flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          <span className="font-mono text-xs text-gray-500">{specCode}</span>
          <span className="text-sm font-bold text-primary truncate max-w-[14rem]">{specTitle}</span>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Layers size={13} className="text-gray-400 shrink-0" />
            {[...versions].sort((a, b) => a.version - b.version).map(v => {
              const list = notesByVersion.get(v.id) ?? [];
              const openCount = list.filter(n => n.status === 'open').length;
              const isPrimary = v.id === activeId;
              const isCompared = v.id === compareId;
              return (
                <button
                  key={v.id}
                  onClick={() => chooseVersion(v.id)}
                  // The note count belongs ON the switcher: choosing which version to read is
                  // the moment the reader wants to know where the comments are.
                  title={[
                    `${releaseLabel(v)} (upload v${v.version})`,
                    v.pageCount != null ? `${v.pageCount} page${v.pageCount === 1 ? '' : 's'}` : null,
                    list.length > 0 ? `${list.length} note${list.length === 1 ? '' : 's'}, ${openCount} open` : 'no notes',
                    v.note || null,
                  ].filter(Boolean).join(' · ')}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                    isPrimary
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : isCompared
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {releaseShort(v)}
                  {v.id === finalVersionId && (
                    <span className={isPrimary ? 'text-indigo-100' : 'text-emerald-600'}> issued</span>
                  )}
                  {list.length > 0 && (
                    <span className={`ml-1 ${
                      isPrimary ? 'text-indigo-100' : openCount > 0 ? 'text-amber-600' : 'text-gray-400'
                    }`}>
                      {list.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {versions.length > 1 && (
            <label
              className="flex items-center gap-1 text-[11px] text-gray-500"
              title="Show the earlier rounds' unresolved notes as hollow rings, at the place they were marked on their own version"
            >
              <input
                type="checkbox"
                checked={carryOver}
                onChange={e => setCarryOver(e.target.checked)}
                className="accent-indigo-600"
              />
              <History size={13} className="text-gray-400" />
              Carry over
            </label>
          )}

          {versions.length > 1 && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <Columns2 size={13} className="text-gray-400" />
              <select
                value={compareId ?? ''}
                onChange={e => {
                  setCompareId(e.target.value || null);
                  // A fresh pairing starts aligned; carrying an offset from the last one over
                  // would silently mis-align two versions the reader has not compared yet.
                  setPageOffset(0);
                }}
                className="border border-gray-200 rounded-lg px-1.5 py-1 text-[11px] bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="">Compare…</option>
                {versions
                  .filter(v => v.id !== activeId)
                  .sort((a, b) => b.version - a.version)
                  .map(v => <option key={v.id} value={v.id}>with {releaseShort(v)}</option>)}
              </select>
            </label>
          )}

          {comparing && (
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={syncScroll}
                  onChange={e => setSyncScroll(e.target.checked)}
                  className="accent-indigo-600"
                />
                Sync scroll
              </label>
              <span className="flex items-center gap-1" title="Shift the right-hand version by this many pages when a page was added or removed">
                Offset
                <button
                  onClick={() => setPageOffset(o => o - 1)}
                  className="px-1.5 rounded border border-gray-200 hover:bg-gray-50"
                >
                  −
                </button>
                <span className="w-5 text-center tabular-nums">{pageOffset > 0 ? `+${pageOffset}` : pageOffset}</span>
                <button
                  onClick={() => setPageOffset(o => o + 1)}
                  className="px-1.5 rounded border border-gray-200 hover:bg-gray-50"
                >
                  +
                </button>
              </span>
            </div>
          )}

          <div className="flex-1" />
          <button onClick={onClose} title="Close (Esc)" className="p-1 text-gray-400 hover:text-gray-700 shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* ---- panes beside the note rail ---- */}
        <div className="flex-1 flex min-h-0">
          {slots.map(({ key, version }) => {
            const obj = key === 'a' ? objectA : objectB;
            const versionNotes = notesFor(version.id);
            const openCount = versionNotes.filter(n => n.status === 'open').length;
            const ghosts = ghostsFor(version);
            return (
              <div
                key={key}
                className={`flex-1 min-w-0 flex flex-col ${key === 'b' ? 'border-l border-gray-200' : ''}`}
                // Whichever pane the reader touches last is the one that drives the other.
                onPointerEnter={() => { driver.current = key; }}
                onPointerDown={() => { driver.current = key; }}
                onWheel={() => { driver.current = key; }}
              >
                {comparing && (
                  <div className="px-3 py-1.5 border-b border-gray-200 flex items-center gap-2 shrink-0 bg-gray-50">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${DESIGN_SPEC_STAGE_META[version.stage].classes}`}
                      title={`${DESIGN_SPEC_STAGE_META[version.stage].hint} (upload v${version.version})`}
                    >
                      {releaseLabel(version)}
                    </span>
                    {version.id === finalVersionId && (
                      <Lock size={11} className="text-emerald-600" aria-label="Issued as the final" />
                    )}
                    <span className="text-[11px] text-gray-400 truncate">
                      {version.pageCount != null && `${version.pageCount} page${version.pageCount === 1 ? '' : 's'} · `}
                      {versionNotes.length === 0
                        ? 'no notes'
                        : `${versionNotes.length} note${versionNotes.length === 1 ? '' : 's'}, ${openCount} open`}
                      {ghosts.length > 0 && ` · ${ghosts.length} carried in`}
                    </span>
                  </div>
                )}

                <div className="flex-1 min-h-0 bg-gray-100">
                  {obj.error ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3 px-4 text-center text-gray-500">
                      <AlertTriangle size={28} className="text-amber-400" />
                      <p className="text-sm">{obj.error}</p>
                    </div>
                  ) : obj.loading || !obj.url ? (
                    <div className="h-full flex items-center justify-center gap-2 text-sm text-gray-400">
                      <Loader2 size={16} className="animate-spin" /> Loading v{version.version}…
                    </div>
                  ) : (
                    <Suspense fallback={
                      <div className="h-full flex items-center justify-center gap-2 text-sm text-gray-400">
                        <Loader2 size={16} className="animate-spin" /> Loading viewer…
                      </div>
                    }>
                      <PdfReviewCanvas
                        // Remount per version rather than letting the canvas swap documents in
                        // place: it does not reset its `loading`, `error` or `pages` when the
                        // URL changes, so switching would show the previous version's page
                        // boxes until the new document resolved. A key is the honest fix here
                        // and leaves the live supplier portal's copy of that component
                        // untouched.
                        key={version.id}
                        fileUrl={obj.url}
                        comments={versionNotes}
                        composing={false}
                        draftAnchor={null}
                        // Read-only, so no pin can be dropped; the prop is required by the
                        // surface both the reviewer and this viewer share.
                        onDropPin={() => {}}
                        focusedCommentId={focusedCommentId}
                        onFocusComment={setFocusedCommentId}
                        readOnly
                        onScrollElement={bindPane(key)}
                        ghostComments={ghosts}
                      />
                    </Suspense>
                  )}
                </div>
              </div>
            );
          })}

          <aside className="w-72 lg:w-80 shrink-0 border-l border-gray-200 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
                <MessageSquare size={12} /> Notes
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {railNotes.length} note{railNotes.length === 1 ? '' : 's'}
                {showAllVersions
                  ? ' across every version'
                  : comparing
                    ? ` on ${slotA ? releaseShort(slotA) : '?'} and ${slotB ? releaseShort(slotB) : '?'}`
                    : ` on ${active ? releaseShort(active) : '?'}`}
              </p>
              <div className="flex gap-1 mt-1.5">
                {([false, true] as const).map(all => (
                  <button
                    key={String(all)}
                    onClick={() => setShowAllVersions(all)}
                    className={`px-2 py-0.5 rounded-lg border text-[11px] font-medium transition-colors ${
                      showAllVersions === all
                        ? 'bg-gray-800 text-white border-gray-800'
                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {all ? 'All versions' : railScopeLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {railNotes.length === 0 ? (
                <p className="px-3 py-6 text-xs text-gray-400 text-center">
                  {showAllVersions
                    ? 'No notes on this spec yet.'
                    : 'No notes here. Switch version, or list every version.'}
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {railNotes.map(n => {
                    const onScreen = slots.some(s => s.version.id === n.subjectId);
                    const carried = carriedIds.has(n.id) && !onScreen;
                    const focused = focusedCommentId === n.id;
                    const stamp = formatReviewStamp(n.createdAt);
                    const number = n.subjectId ? numbersByVersion.get(n.subjectId)?.get(n.id) : undefined;
                    // A carried note is marked on screen by a ring, which bears no number, so
                    // the rail must not print one either.
                    const showNumber = onScreen && number != null;
                    // Only worth saying for a note being judged against a LATER version than
                    // the one it was written on; on its own version it is just "open".
                    const judged = n.status === 'open'
                      && checkTarget != null
                      && n.subjectVersion != null
                      && n.subjectVersion < checkTarget.version;
                    return (
                      <li key={n.id} className={focused ? 'bg-indigo-50' : ''}>
                        <button
                          onClick={() => focusNote(n)}
                          className={`w-full text-left px-3 pt-2.5 pb-1 transition-colors ${
                            focused ? '' : 'hover:bg-gray-50'
                          } ${onScreen || carried ? '' : 'opacity-70'}`}
                          title={onScreen
                            ? 'Jump to this note'
                            : carried
                              ? `Carried over from ${releaseShortByNumber(versions, n.subjectVersion)} — jump to its ring on this version`
                              : `Written against ${releaseShortByNumber(versions, n.subjectVersion)} — opens that version`}
                        >
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            {/* A number only where a pin bearing it is on screen; a ring
                                otherwise, matching the ghost on the page, so the rail never
                                labels a note with a number the reader cannot find. */}
                            <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                              !showNumber
                                ? `border-2 border-dashed ${carried ? 'border-gray-500 text-gray-500' : 'border-gray-200 text-gray-400'}`
                                : n.status === 'open'
                                  ? 'border bg-amber-400 text-amber-950 border-amber-400'
                                  : 'border bg-emerald-500 text-white border-emerald-500'
                            }`}>
                              {showNumber ? number : '·'}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                              {anchorLabel(n.anchor)}
                            </span>
                            {n.subjectVersion != null && (
                              <Badge tone={onScreen ? 'gray' : 'indigo'}>v{n.subjectVersion}</Badge>
                            )}
                            {carried && <Badge tone="indigo" icon={<History size={9} />}>carried</Badge>}
                            <Badge tone={STATUS_TONE[n.status]}>{STATUS_LABEL[n.status]}</Badge>
                          </div>
                          <p className="text-xs text-gray-700 whitespace-pre-wrap">{n.body}</p>
                          {n.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {n.attachments.map(a => (
                                <img
                                  key={a.path}
                                  src={reviewImageUrl(a.path)}
                                  alt=""
                                  className="h-10 w-10 object-cover rounded border border-gray-200"
                                />
                              ))}
                            </div>
                          )}
                          <p className="text-[10px] text-gray-400 mt-1">
                            {n.authorName}
                            {stamp.short && (
                              <> · <time dateTime={n.createdAt} title={reviewStampTitle(stamp)}>{stamp.short}</time></>
                            )}
                          </p>
                          {judged && (
                            // The whole reason `checked_subject_version` exists: without this
                            // line an unlooked-at note and a confirmed-still-broken one read
                            // identically.
                            <p className={`text-[10px] mt-0.5 font-medium ${
                              n.checkedSubjectVersion === checkTarget?.version ? 'text-amber-700' : 'text-gray-400'
                            }`}>
                              {n.checkedSubjectVersion == null
                                ? `Not re-checked since ${releaseShortByNumber(versions, n.subjectVersion)}`
                                : n.checkedSubjectVersion === checkTarget?.version
                                  ? `Confirmed still an issue on ${releaseShortByNumber(versions, n.checkedSubjectVersion)}`
                                  : `Last checked against ${releaseShortByNumber(versions, n.checkedSubjectVersion)}`}
                            </p>
                          )}
                        </button>

                        {canEdit && checkTarget && (
                          // Verdicts are siblings of the jump button, not children: a button
                          // inside a button is invalid markup and the two click targets would
                          // fight.
                          <div className="px-3 pb-2.5 pt-0.5 flex flex-wrap items-center gap-1">
                            {n.status === 'open' ? (
                              <>
                                <VerdictButton
                                  icon={<Check size={11} />}
                                  label={`Fixed in ${releaseShort(checkTarget)}`}
                                  busy={busyNote === n.id}
                                  onClick={() => void triage(n, 'done')}
                                />
                                <VerdictButton
                                  icon={<History size={11} />}
                                  label="Still an issue"
                                  busy={busyNote === n.id}
                                  onClick={() => void triage(n, 'still')}
                                />
                                <VerdictButton
                                  icon={<Ban size={11} />}
                                  label="Not changing"
                                  busy={busyNote === n.id}
                                  onClick={() => void triage(n, 'wont_fix')}
                                />
                              </>
                            ) : (
                              <VerdictButton
                                icon={<Undo2 size={11} />}
                                label="Reopen"
                                busy={busyNote === n.id}
                                onClick={() => void triage(n, 'reopen')}
                              />
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {notice && (
              <p className="px-3 py-2 border-t border-rose-100 bg-rose-50 text-[11px] text-rose-700 shrink-0">
                {notice}
              </p>
            )}
            <p className="px-3 py-2 border-t border-gray-200 text-[10px] text-gray-400 shrink-0">
              {checkTarget
                ? `Verdicts are recorded against ${releaseShort(checkTarget)}. Reply to a reviewer on the Design Spec tab.`
                : 'Reply to a reviewer on the Design Spec tab.'}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default DesignSpecVersionViewer;
