/**
 * A two-pane split whose divider the author can drag, and whose side pane collapses away.
 *
 * WHY. Both IM editors put the live preview beside the editing surface at a width fixed in the
 * markup — 44% in the template editor's focus mode, and whatever was left of the row in the
 * project generator. Neither could be changed, so an author working on a wide table had no way to
 * give the editor more room, and an author who only wanted to type could not reclaim the preview's
 * half of the screen.
 *
 * The size is kept as a PERCENTAGE of the container rather than pixels: the panes live inside a
 * viewport-height row, so a pixel width chosen on a wide monitor would leave nothing for the
 * editor on a laptop. Both the size and the collapsed flag persist per screen, because a working
 * layout preference that resets on every navigation is worse than no preference at all.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';

/** Percentage bounds. Neither pane may be squeezed to the point of being unusable. */
const MIN_PCT = 20;
const MAX_PCT = 80;
/** Arrow-key step, in percentage points, for resizing without a pointer. */
const KEY_STEP = 2;

interface Stored {
  pct: number;
  collapsed: boolean;
}

const read = (key: string, fallback: Stored): Stored => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const pct = typeof parsed.pct === 'number' && Number.isFinite(parsed.pct) ? parsed.pct : fallback.pct;
    return {
      pct: Math.min(MAX_PCT, Math.max(MIN_PCT, pct)),
      collapsed: parsed.collapsed === true,
    };
  } catch {
    // Private windows and blocked site data land here; the default layout is fine.
    return fallback;
  }
};

export interface ResizablePane {
  /** Width of the resizable pane, as a CSS percentage string. Ignore while collapsed. */
  width: string;
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  /** Spread onto the container that holds both panes. */
  containerProps: { ref: React.RefObject<HTMLDivElement | null> };
  /** Renders the drag handle. Place it on the resizable pane's leading edge. */
  Divider: React.FC<{ label?: string }>;
}

/**
 * @param key    localStorage key — unique per screen, so the two editors keep separate layouts.
 * @param side   Which side of the container the resizable pane occupies.
 * @param initial Default width percentage before the author has ever dragged.
 */
export const useResizablePane = (key: string, side: 'left' | 'right', initial: number): ResizablePane => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<Stored>(() => read(key, { pct: initial, collapsed: false }));
  const dragging = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* preference simply will not persist */
    }
  }, [key, state]);

  const applyFromPointer = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const fromLeft = ((clientX - rect.left) / rect.width) * 100;
      const pct = side === 'left' ? fromLeft : 100 - fromLeft;
      setState((prev) => ({ ...prev, pct: Math.min(MAX_PCT, Math.max(MIN_PCT, pct)) }));
    },
    [side],
  );

  // Listeners go on the window, not the handle: the pointer routinely leaves a 6px-wide target
  // mid-drag, and losing the drag when it does would make the divider feel broken.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      event.preventDefault();
      applyFromPointer(event.clientX);
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      // A drag interrupted by unmount must not leave the cursor and selection locked.
      up();
    };
  }, [applyFromPointer]);

  const setCollapsed = useCallback((next: boolean) => setState((prev) => ({ ...prev, collapsed: next })), []);

  const Divider: React.FC<{ label?: string }> = useCallback(
    ({ label = 'Resize the preview' }) => (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        tabIndex={0}
        title={`${label} — drag, or use the arrow keys. Double-click to reset.`}
        onPointerDown={(event) => {
          event.preventDefault();
          dragging.current = true;
          // Held on the body so the cursor does not flicker back whenever the pointer strays
          // off the handle, and so text does not get selected across the panes.
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        onDoubleClick={() => setState((prev) => ({ ...prev, pct: initial }))}
        onKeyDown={(event) => {
          const towardStart = event.key === 'ArrowLeft';
          const towardEnd = event.key === 'ArrowRight';
          if (!towardStart && !towardEnd) return;
          event.preventDefault();
          // A left arrow always makes the pane on the left smaller, whichever side is resizable.
          const delta = (towardStart ? -KEY_STEP : KEY_STEP) * (side === 'left' ? 1 : -1);
          setState((prev) => ({ ...prev, pct: Math.min(MAX_PCT, Math.max(MIN_PCT, prev.pct + delta)) }));
        }}
        className="group relative w-2 shrink-0 cursor-col-resize flex items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <div className="absolute inset-y-0 w-0.5 bg-gray-200 group-hover:bg-indigo-400 transition-colors" />
        <GripVertical size={12} className="relative text-gray-300 group-hover:text-indigo-500 transition-colors" />
      </div>
    ),
    [initial, side],
  );

  return {
    width: `${state.pct}%`,
    collapsed: state.collapsed,
    setCollapsed,
    containerProps: { ref: containerRef },
    Divider,
  };
};

/**
 * The rail left behind when the pane is collapsed — the only way back, so it is always rendered
 * rather than hidden behind a menu.
 */
export const CollapsedPaneRail: React.FC<{
  onExpand: () => void;
  label: string;
  side: 'left' | 'right';
}> = ({ onExpand, label, side }) => (
  <button
    type="button"
    onClick={onExpand}
    title={`Show ${label}`}
    className="w-8 shrink-0 bg-white border border-gray-200 rounded-xl shadow flex flex-col items-center justify-center gap-2 text-gray-400 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
  >
    {side === 'right' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl] rotate-180">
      {label}
    </span>
  </button>
);
