import { useEffect, useRef, useState } from 'react';

/**
 * A small floating menu anchored to whatever was clicked.
 *
 * Closes on outside click, on Escape, and ON SCROLL — a menu still floating where the card used
 * to be, after the board has scrolled out from under it, is worse than no menu.
 */

export interface ActionMenuItem {
  key?: string;
  label: string;
  onSelect: () => void;
  checked?: boolean;
  /** Drives the dot's colour — one of the ITEM_FLAGS tones, or 'none'. */
  tone?: string;
  separator?: false;
}

export interface ActionMenuSeparator {
  separator: true;
}

export interface ActionMenuProps {
  /** Where to hang the menu — a bounding rect from the button that opened it. */
  anchor: DOMRect | null;
  title?: string;
  items: (ActionMenuItem | ActionMenuSeparator)[];
  onClose: () => void;
}

const isSeparator = (i: ActionMenuItem | ActionMenuSeparator): i is ActionMenuSeparator =>
  (i as ActionMenuSeparator).separator === true;

export default function ActionMenu({ anchor, title, items, onClose }: ActionMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  // Measure after mount, then clamp inside the viewport. The menu's height depends on how many
  // items it was given, so this cannot be computed from the anchor alone.
  useEffect(() => {
    if (!anchor || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(anchor.right, window.innerWidth - r.width - 12)),
      top: Math.max(8, Math.min(anchor.bottom, window.innerHeight - r.height - 12)),
    });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  if (!anchor) return null;

  return (
    <div className="rdmp-menu" ref={ref} style={{ left: pos.left, top: pos.top }} role="menu">
      {title && <div className="rdmp-menu-h">{title}</div>}
      {items.map((item, i) =>
        isSeparator(item) ? (
          <div className="rdmp-menu-sep" key={`sep-${i}`} />
        ) : (
          <button
            key={item.key || item.label}
            type="button"
            role="menuitem"
            className="rdmp-menu-item"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className={`rdmp-menu-dot is-${item.tone || 'none'}`} />
            {item.checked ? '✓ ' : ''}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
