/**
 * useProjectInbox — owns the PM's inbox state for the whole app shell.
 *
 * Deliberately lives above the drawer rather than inside it: the topbar badge needs the
 * count while the drawer is closed, and the drawer needs the list while it is open. One
 * hook in Layout means one set of reads feeding both, instead of the badge and the panel
 * polling the same six tables on different clocks and disagreeing.
 *
 * Dismissals are applied optimistically and reconciled by the next poll — a dismissed row
 * must leave the list at click speed, and a failed write must not leave a phantom gap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getInboxSnapshot, dismissInboxItem, dismissInboxItems, restoreInboxItem } from '../services';
import type { InboxItem, InboxLane } from '../types/inbox.types';

/** Matches the cadence the topbar already used for notifications and stats. */
const POLL_MS = 60_000;
/** How long "Undo" stays on offer after a dismissal. */
const UNDO_MS = 8000;

export interface ProjectInbox {
  items: InboxItem[];
  failedSources: string[];
  loading: boolean;
  loadedOnce: boolean;
  /** Items the PM is the blocker for — what the topbar badge counts. */
  reviewCount: number;
  waitingCount: number;
  unreadCount: number;
  /** The badge number: work waiting on the PM plus unread mail. Never double-counts. */
  badgeCount: number;
  refresh: () => Promise<void>;
  dismiss: (item: InboxItem) => Promise<void>;
  dismissLane: (lane: InboxLane, scoped: readonly InboxItem[]) => Promise<void>;
  undo: () => Promise<void>;
  /** Non-null while an Undo is on offer. */
  undoable: InboxItem[] | null;
}

export const useProjectInbox = (userId: string | null): ProjectInbox => {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [undoable, setUndoable] = useState<InboxItem[] | null>(null);
  const undoTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setFailedSources([]);
      return;
    }
    setLoading(true);
    try {
      const snap = await getInboxSnapshot(userId);
      setItems(snap.items);
      setFailedSources(snap.failedSources);
      setLoadedOnce(true);
    } catch (e) {
      // A failed inbox read must never take the app shell down with it.
      console.error('[inbox] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [userId, refresh]);

  useEffect(() => () => { if (undoTimer.current) window.clearTimeout(undoTimer.current); }, []);

  const armUndo = useCallback((dismissed: InboxItem[]) => {
    setUndoable(dismissed);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoable(null), UNDO_MS);
  }, []);

  const dismiss = useCallback(async (item: InboxItem) => {
    if (!userId) return;
    setItems(prev => prev.filter(i => i.key !== item.key));
    armUndo([item]);
    try {
      await dismissInboxItem(userId, item);
    } catch (e) {
      console.error('[inbox] dismiss failed', e);
      setUndoable(null);
      void refresh();
    }
  }, [userId, armUndo, refresh]);

  /**
   * Dismiss a lane. `scoped` is what the drawer is actually showing, so a "Dismiss all"
   * pressed under a project filter cannot silently clear the other projects too.
   */
  const dismissLane = useCallback(async (lane: InboxLane, scoped: readonly InboxItem[]) => {
    if (!userId) return;
    const batch = scoped.filter(i => i.lane === lane);
    if (batch.length === 0) return;
    const keys = new Set(batch.map(i => i.key));
    setItems(prev => prev.filter(i => !keys.has(i.key)));
    armUndo(batch);
    try {
      await dismissInboxItems(userId, batch);
    } catch (e) {
      console.error('[inbox] bulk dismiss failed', e);
      setUndoable(null);
      void refresh();
    }
  }, [userId, armUndo, refresh]);

  const undo = useCallback(async () => {
    if (!userId || !undoable) return;
    const batch = undoable;
    setUndoable(null);
    try {
      await Promise.all(batch.map(i => restoreInboxItem(userId, i)));
    } catch (e) {
      console.error('[inbox] undo failed', e);
    }
    await refresh();
  }, [userId, undoable, refresh]);

  const counts = useMemo(() => {
    let reviewCount = 0;
    let waitingCount = 0;
    let unreadCount = 0;
    for (const i of items) {
      if (i.lane === 'review') reviewCount++;
      else if (i.lane === 'waiting') waitingCount++;
      else if (i.unread) unreadCount++;
    }
    return { reviewCount, waitingCount, unreadCount };
  }, [items]);

  return {
    items,
    failedSources,
    loading,
    loadedOnce,
    ...counts,
    // "Waiting on supplier" is intentionally excluded: it is not the PM's action, and
    // counting it would make the badge unclearable by anything the PM can do.
    badgeCount: counts.reviewCount + counts.unreadCount,
    refresh,
    dismiss,
    dismissLane,
    undo,
    undoable,
  };
};
