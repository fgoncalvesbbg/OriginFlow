/**
 * The behaviour behind a type-to-search combo.
 *
 * Owns the INTERACTION only: open/closed, which row is highlighted, and what a key press does.
 * Searching and rendering stay with the caller, because what "matches" and what a row looks like
 * both vary — this hook has no opinion on either.
 *
 * Copied from ProductToolkit's `shared/lib/useSearchCombo.js`, where it had two callers. It has
 * one here; promote it to src/hooks if a second appears.
 */
import { useEffect, useRef, useState } from 'react';

export interface UseSearchComboOptions<T> {
  /** The currently visible (already-filtered) rows, in display order. */
  shown: readonly T[];
  onPick: (item: T) => void;
  closeOnPick?: boolean;
}

export function useSearchCombo<T>({ shown, onPick, closeOnPick = false }: UseSearchComboOptions<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Only cancels when a click lands outside the combo — clicking a row is handled by the row's
  // own onClick, which fires before this ever sees the event target detach from the DOM.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Keep the highlighted row in view when it is reached with the arrow keys rather than the
  // mouse — without this, holding ArrowDown walks the highlight off the bottom of the list.
  // Optional-called: scrollIntoView is a nicety and does not exist in every environment.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  });

  const pick = (item: T | undefined) => {
    if (!item) return;
    onPick(item);
    if (closeOnPick) setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (!open) return; // let it bubble — a parent panel may close itself on Escape
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (!shown.length) return;
      setActive(i => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return (next + shown.length) % shown.length;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(shown[active]);
    }
  };

  return { open, setOpen, active, setActive, wrapRef, inputRef, activeRef, onKeyDown, pick };
}
