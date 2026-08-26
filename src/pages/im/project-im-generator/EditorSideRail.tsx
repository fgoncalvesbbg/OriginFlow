/**
 * EditorSideRail — the always-present icon column on the right of the IM editor.
 *
 * WHY A RAIL
 * ----------
 * The editor grew four side surfaces (pre-publish review, supplier review, translations,
 * regulatory checklist) that each arrived by a different route: one from a toolbar chip, one
 * from a header button, one from a modal, one buried inside another panel. Nothing told you
 * they existed, or that any of them had outstanding work, until you went looking.
 *
 * The rail is the fix: ALWAYS on screen, one icon per panel, each carrying its own outstanding
 * count. Collapsed (no panel open) is the default, so the editor keeps its full width until
 * you ask for something — but the counts stay visible the whole time, which is the part that
 * was missing.
 *
 * ONE AT A TIME
 * -------------
 * Opening a panel closes the previous one. Two side by side would leave the editor about a
 * third of the window on a laptop, and these are all "read a list, go fix a thing" surfaces —
 * you work one list at a time. The rail keeps every other count in view meanwhile, so nothing
 * is hidden by the choice.
 *
 * The rail renders no panel content and owns no rules: each panel keeps its own header and
 * body (their headers carry real summaries), counts and tones arrive computed, and selecting
 * an item is a callback. The rail's only job is being findable.
 */

import React from 'react';

/** Which panel is open. `null` = collapsed to the icon column, the default. */
export type SidePanelId = 'publish' | 'comments' | 'translation' | 'regulatory';

/** Amber = work outstanding, emerald = settled, rose = blocking, gray = nothing to report. */
export type RailTone = 'rose' | 'amber' | 'emerald' | 'gray';

export interface SideRailItem {
  id: SidePanelId;
  /** Short label, used as the tooltip's lead. */
  label: string;
  icon: React.ReactNode;
  /** One sentence for the tooltip: what this panel is for right now. */
  title: string;
  /**
   * Badge number. 0/undefined shows no badge — a zero badge reads as a problem at a glance,
   * and "nothing outstanding" is better said by the absence of one.
   */
  count?: number;
  tone: RailTone;
}

const BADGE_TONE: Record<RailTone, string> = {
  rose: 'bg-rose-100 text-rose-700',
  amber: 'bg-amber-100 text-amber-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  gray: 'bg-gray-100 text-gray-500',
};

const ICON_TONE: Record<RailTone, string> = {
  rose: 'text-rose-500',
  amber: 'text-amber-500',
  emerald: 'text-emerald-600',
  gray: 'text-gray-400',
};

interface EditorSideRailProps {
  items: SideRailItem[];
  active: SidePanelId | null;
  /** Selecting the active item collapses back to the rail — the caller receives null. */
  onSelect: (id: SidePanelId | null) => void;
}

export const EditorSideRail: React.FC<EditorSideRailProps> = ({ items, active, onSelect }) => (
  <nav
    aria-label="Editor panels"
    className="w-11 shrink-0 bg-white border border-gray-200 rounded-xl shadow flex flex-col items-center gap-1 py-2 self-start"
  >
    {items.map(item => {
      const isActive = item.id === active;
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(isActive ? null : item.id)}
          title={`${item.label} — ${item.title}`}
          aria-pressed={isActive}
          className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
            isActive ? 'bg-slate-200 text-gray-800' : `hover:bg-light ${ICON_TONE[item.tone]}`
          }`}
        >
          {item.icon}
          {!!item.count && (
            <span
              className={`absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold leading-[15px] text-center ${BADGE_TONE[item.tone]}`}
            >
              {item.count > 99 ? '99+' : item.count}
            </span>
          )}
        </button>
      );
    })}
  </nav>
);

export default EditorSideRail;
