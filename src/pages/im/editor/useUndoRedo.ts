import { useEffect, useRef, useReducer, useCallback } from 'react';

/**
 * Model-level undo/redo for an editor whose editable state can be serialized to a
 * string. The caller passes the current `snapshot` (recomputed each render) and an
 * `apply(snapshot)` that restores it; the hook records history and exposes undo/redo.
 *
 * Recording is debounced so a burst of rapid edits (typing, dragging) collapses into a
 * single history entry rather than one per keystroke. History is bounded to `limit`
 * entries. Undo/redo do not survive a page reload — the localStorage draft remains the
 * crash safety net.
 *
 * Keyboard: Ctrl/Cmd+Z / Ctrl+Shift+Z (and Ctrl+Y) are handled ONLY when focus is not
 * inside a text-editing surface (contentEditable, input, textarea, select). There the
 * browser's native text-undo is what the author expects, so we defer to it.
 */
export function useUndoRedo(
  snapshot: string,
  apply: (snapshot: string) => void,
  opts?: { debounceMs?: number; limit?: number; enabled?: boolean; enableKeyboard?: boolean },
) {
  const { debounceMs = 600, limit = 50, enabled = true, enableKeyboard = true } = opts ?? {};
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const committed = useRef<string>(snapshot);
  const restoring = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);

  // Keep the latest apply without re-subscribing listeners.
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // Observe changes to the snapshot and record the pre-change value (debounced).
  useEffect(() => {
    if (!enabled) return;
    if (restoring.current) { restoring.current = false; committed.current = snapshot; return; }
    if (snapshot === committed.current) return;
    const prev = committed.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      past.current.push(prev);
      if (past.current.length > limit) past.current.shift();
      future.current = [];
      committed.current = snapshot;
      force();
    }, debounceMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [snapshot, enabled, debounceMs, limit]);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const prev = past.current.pop()!;
    future.current.push(committed.current);
    committed.current = prev;
    restoring.current = true;
    applyRef.current(prev);
    force();
  }, []);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const next = future.current.pop()!;
    past.current.push(committed.current);
    committed.current = next;
    restoring.current = true;
    applyRef.current(next);
    force();
  }, []);

  useEffect(() => {
    if (!enabled || !enableKeyboard) return;
    const isEditableTarget = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if (isEditableTarget()) return; // let the browser handle native text undo
      const isRedo = key === 'y' || (key === 'z' && e.shiftKey);
      e.preventDefault();
      if (isRedo) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, enableKeyboard, undo, redo]);

  return { undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}
