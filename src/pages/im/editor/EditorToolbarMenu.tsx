/**
 * EditorToolbarMenu — the one dropdown used by the IM editor headers and the
 * inline-HTML editor bar.
 *
 * Why it exists: the template editor and the project IM editor grew ten-plus flat
 * buttons each, and the inline editor bar six kinds of "insert". A flat row of ten
 * is unreadable, so each surface now keeps only the actions used on every pass
 * visible (preview / undo / save / publish, or bold / lists) and clusters the rest
 * BY FUNCTION behind a labelled trigger — languages, compliance, settings, insert.
 * They all use this component so the grammar is identical: same trigger shape,
 * same badge slot, same panel, same click-outside/Escape behaviour.
 *
 * Two variants:
 *   'header'  — the page-header pill (rounded-xl, shadow), fires on click.
 *   'toolbar' — the dense editor-bar pill, and `preserveSelection` makes it fire
 *               on mousedown with preventDefault so the contentEditable's live
 *               selection survives opening the menu and picking an item.
 *
 * The panel is PORTALLED to <body> and positioned from the trigger's viewport rect
 * rather than absolutely inside the trigger. It has to be: an inline-HTML block is a
 * user-resizable box (`resize-y`, which only works with `overflow` != visible), so an
 * absolute panel was clipped to the block — a short block cut the Insert menu in half.
 * Positioning also flips the panel above the trigger when there is more room there, and
 * caps its height to what the viewport has, so it is never taller than the screen.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export type ToolbarItemTone = 'default' | 'warn' | 'success' | 'danger';

export interface ToolbarMenuItem {
  key: string;
  icon?: React.ReactNode;
  label: string;
  /** Second line — says what the action actually does, so the label can stay short. */
  hint?: string;
  /** Right-aligned state (a count, "5/44", "22"). */
  badge?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Native tooltip; falls back to `hint` when omitted. */
  title?: string;
  tone?: ToolbarItemTone;
}

export interface ToolbarMenuGroup {
  /** Small uppercase caption above the group. Omit for an unlabelled group. */
  label?: string;
  items: ToolbarMenuItem[];
}

interface EditorToolbarMenuProps {
  icon: React.ReactNode;
  /** Omit for an icon-only trigger (the settings gear). */
  label?: string;
  /** Badge on the trigger — the whole point of clustering is not hiding state. */
  badge?: React.ReactNode;
  groups: ToolbarMenuGroup[];
  title?: string;
  disabled?: boolean;
  /** Panel width class. */
  panelWidth?: string;
  /** Trigger density: page header (default) or inline editor bar. */
  variant?: 'header' | 'toolbar';
  /**
   * Fire on mousedown with preventDefault instead of click. Required inside a
   * contentEditable toolbar: a focus change collapses the selection the menu's
   * actions are about to act on.
   */
  preserveSelection?: boolean;
  /** Panel side. Defaults to right-aligned (menus live at the end of a row). */
  align?: 'left' | 'right';
  /**
   * Render the trigger as the page's primary action (solid indigo) instead of the
   * default white/bordered pill — for the one menu per surface that replaces what used
   * to be a plain filled `<button>` (e.g. Publish) and needs the same visual weight.
   */
  primary?: boolean;
}

const TONE_CLASSES: Record<ToolbarItemTone, string> = {
  default: 'text-gray-700 hover:bg-light',
  warn: 'text-amber-700 hover:bg-amber-50',
  success: 'text-emerald-700 hover:bg-emerald-50',
  danger: 'text-rose-600 hover:bg-rose-50',
};

const EditorToolbarMenu: React.FC<EditorToolbarMenuProps> = ({
  icon, label, badge, groups, title, disabled, panelWidth = 'w-64',
  variant = 'header', preserveSelection = false, align = 'right', primary = false,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Viewport coordinates for the portalled panel. Null until it has been measured. */
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The panel is portalled, so it is NOT inside `ref` — check it separately or
      // every click on a menu item would read as a click outside.
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /**
   * Place the panel against the trigger in viewport space. Runs once the panel is in
   * the DOM (so its natural size is known) and again on scroll/resize, since a fixed
   * panel does not follow its trigger on its own.
   */
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const GAP = 6;
    const EDGE = 8;
    const place = () => {
      const trigger = ref.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      // scrollHeight, not the rect: the rect is already capped by a maxHeight we set on
      // a previous pass, which would make the flip decision oscillate.
      const wanted = panel.scrollHeight;
      const width = panel.getBoundingClientRect().width;
      const below = window.innerHeight - trigger.bottom - GAP - EDGE;
      const above = trigger.top - GAP - EDGE;
      const flip = wanted > below && above > below;
      const maxHeight = Math.max(120, flip ? above : below);
      const left = Math.max(EDGE, Math.min(
        align === 'left' ? trigger.left : trigger.right - width,
        window.innerWidth - EDGE - width,
      ));
      const top = flip
        ? Math.max(EDGE, trigger.top - GAP - Math.min(wanted, maxHeight))
        : trigger.bottom + GAP;
      // Bail when nothing moved: `place` also runs on every scroll event, and a fresh
      // object each time would re-render the panel continuously.
      setPos(prev => (prev && prev.top === top && prev.left === left && prev.maxHeight === maxHeight)
        ? prev
        : { top, left, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    // Capture phase: the editor panes are the scroll containers, not the window.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // `groups` is deliberately not a dependency — callers build it inline, so a new
    // identity every render would re-place (and re-render) in a loop.
  }, [open, align]);

  // Groups whose every item is hidden by the caller are passed as empty — drop them
  // so no stray caption or divider survives.
  const visibleGroups = groups.filter(g => g.items.length > 0);
  if (visibleGroups.length === 0) return null;

  /**
   * One press handler for both variants: mousedown (+preventDefault) when the
   * caller can't afford to lose focus, click otherwise. Enter/Space are wired in
   * the mousedown case so the menu stays keyboard-reachable.
   */
  const pressProps = (run: () => void, isDisabled?: boolean) => (
    preserveSelection
      ? {
          onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); if (!isDisabled) run(); },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (!isDisabled) run();
          },
        }
      : { onClick: () => { if (!isDisabled) run(); } }
  );

  const triggerClass = variant === 'toolbar'
    ? `flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        open ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
      }`
    : primary
      ? `flex items-center gap-2 text-white rounded-xl text-sm font-bold shadow disabled:opacity-70 disabled:cursor-not-allowed ${
          label ? 'px-4 py-2' : 'justify-center w-10 h-10'
        } ${open ? 'bg-indigo-700' : 'bg-indigo-600 hover:bg-indigo-700'}`
      : `flex items-center gap-2 bg-white border text-gray-700 rounded-xl text-sm font-medium hover:bg-light shadow disabled:opacity-50 disabled:cursor-not-allowed ${
          label ? 'px-3 py-2' : 'justify-center w-10 h-10'
        } ${open ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-gray-300'}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        {...pressProps(() => setOpen(o => !o))}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ? undefined : title}
        className={triggerClass}
      >
        {icon}
        {label && <span>{label}</span>}
        {badge}
        {label && <ChevronDown size={variant === 'toolbar' ? 12 : 14} className={`${variant === 'toolbar' ? '' : primary ? 'text-indigo-200' : 'text-gray-400'} transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && createPortal(
        <div
          role="menu"
          ref={panelRef}
          // Hidden for the first paint only: `pos` needs the panel's real size, so it is
          // rendered, measured, then placed in the same layout pass.
          style={pos
            ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
            : { top: 0, left: 0, visibility: 'hidden' }}
          className={`fixed ${panelWidth} max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain bg-white rounded-xl shadow-xl border border-gray-200 z-[75] py-1`}
        >
          {visibleGroups.map((group, gi) => (
            <div key={group.label ?? `g${gi}`}>
              {gi > 0 && <div className="my-1 border-t border-gray-100" />}
              {group.label && (
                <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  {group.label}
                </div>
              )}
              {group.items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  {...pressProps(() => { setOpen(false); item.onClick?.(); }, item.disabled)}
                  disabled={item.disabled}
                  title={item.title ?? item.hint}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed ${TONE_CLASSES[item.tone ?? 'default']}`}
                >
                  {item.icon && <span className="mt-0.5 shrink-0">{item.icon}</span>}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium leading-tight">{item.label}</span>
                    {item.hint && <span className="block text-[11px] text-muted leading-snug mt-0.5">{item.hint}</span>}
                  </span>
                  {item.badge && <span className="shrink-0 mt-0.5">{item.badge}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};

export default EditorToolbarMenu;
