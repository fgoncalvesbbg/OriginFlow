/**
 * "Optional & Conditional Content" panel for the project IM generator.
 *
 * Lists every block in the manual whose inclusion is not automatic — conditional blocks gated
 * on an attribute value, and opt-in placeholders the PM must decide about — grouped by the
 * chapter they live in.
 *
 * Three UX decisions worth keeping:
 *
 *  1. **Inclusion is a 3-state choice, not a boolean.** A block is either left on Auto (the
 *     template's condition decides) or explicitly forced In or Out. The previous control showed
 *     only the resolved boolean on a button labelled with the CURRENT state, so "Exclude" meant
 *     "this is excluded" while looking like "click to exclude" — and an auto-included block was
 *     indistinguishable from a manually-included one. The segmented control exposes the real
 *     model, which also removes the need for a separate "reset" link.
 *  2. **What you chose and what resulted are different colours.** Selection uses the steel
 *     accent (DESIGN.md: accent marks selection); the outcome uses the status vocabulary
 *     (emerald included / gray not included / amber needs data or review), always with an icon
 *     and a word so state is never colour alone.
 *  3. **Content is inspectable in place.** Each row expands to its rendered preview rather than
 *     opening a modal, so a PM can check what a block actually says before deciding.
 */

import React, { useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronRight, GitBranch, Minus, RotateCcw } from 'lucide-react';
import { Badge, type BadgeTone } from '../../../components/common/Badge';
import { sanitizeHtml } from '../../../utils';
// The preview renders authored IM markup, so it needs the IM content styles (lists, paragraph
// spacing, bold/italic). ProjectIMGenerator uses `im-content` in several previews but never
// imported this, so they were only styled when another route happened to have loaded it first;
// importing it here makes the panel self-sufficient and fixes those previews too.
import '../styles/im-content.css';

/** How a block's inclusion is currently decided. */
export type IncludeMode = 'auto' | 'include' | 'exclude';

export interface OptionalContentItem {
  /** Stable `${sectionId}:${index}` key — the same key used for the visibility override map. */
  key: string;
  sectionId: string;
  /** Chapter title in the active language, used as the group heading. */
  sectionTitle: string;
  /** Short plain-text label for the row (first words of the block's content). */
  label: string;
  /** Rendered preview HTML for the active language. Sanitized here, at the point of render. */
  previewHtml: string;
  /**
   * `placeholder` = opt-in content the PM must decide about (Auto leaves it out).
   * `conditional` = gated on attribute data (Auto follows the data).
   */
  kind: 'placeholder' | 'conditional';
  /** Human-readable condition, e.g. "Handle type ∈ fixed". Null for placeholders. */
  conditionText: string | null;
  /** What Auto resolves to right now. */
  autoVisible: boolean;
  /** Whether the block ends up in the manual, override applied. */
  visible: boolean;
  /** The PM's explicit choice, or undefined when left on Auto. */
  override: boolean | undefined;
  /** Conditional block whose driving attribute has no value yet. */
  noData: boolean;
}

// ---------------------------------------------------------------------------
// Include / Exclude control
// ---------------------------------------------------------------------------

const MODES: ReadonlyArray<{ mode: IncludeMode; label: string; title: string }> = [
  { mode: 'auto', label: 'Auto', title: 'Let the template condition decide' },
  { mode: 'include', label: 'Include', title: 'Always put this in the manual' },
  { mode: 'exclude', label: 'Exclude', title: 'Always leave this out of the manual' },
];

export const modeOf = (override: boolean | undefined): IncludeMode =>
  override === undefined ? 'auto' : override ? 'include' : 'exclude';

/**
 * Segmented Auto / Include / Exclude picker.
 *
 * Shared with the Chapter Conditions panel so the two adjacent lists speak the same language;
 * a different control for the same decision one panel apart is how an interface loses trust.
 */
export const IncludeModeControl: React.FC<{
  value: IncludeMode;
  onChange: (mode: IncludeMode) => void;
  /** Announced to screen readers, e.g. "Inclusion for Safety Instructions". */
  ariaLabel: string;
  className?: string;
}> = ({ value, onChange, ariaLabel, className = '' }) => (
  <div
    role="group"
    aria-label={ariaLabel}
    className={`inline-flex shrink-0 rounded-md border border-gray-300 bg-white p-px ${className}`}
  >
    {MODES.map(({ mode, label, title }) => {
      const active = value === mode;
      return (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          title={title}
          aria-pressed={active}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 motion-reduce:transition-none ${
            active
              ? 'bg-indigo-600 text-white'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
          }`}
        >
          {label}
        </button>
      );
    })}
  </div>
);

// ---------------------------------------------------------------------------
// Outcome badge
// ---------------------------------------------------------------------------

/** The resolved outcome, as tone + icon + word (never colour alone). */
const outcomeFor = (item: OptionalContentItem): { tone: BadgeTone; icon: React.ReactNode; text: string } => {
  if (item.visible) return { tone: 'emerald', icon: <Check size={11} />, text: 'In the manual' };
  // Not included. Distinguish "a decision is still owed" from "correctly left out".
  if (item.override === undefined) {
    if (item.kind === 'placeholder') {
      return { tone: 'amber', icon: <AlertCircle size={11} />, text: 'Needs review' };
    }
    if (item.noData) return { tone: 'amber', icon: <AlertCircle size={11} />, text: 'Waiting on data' };
  }
  return { tone: 'gray', icon: <Minus size={11} />, text: 'Left out' };
};

/**
 * The template's rule for this block, in plain words. Always shown, whatever the PM chose,
 * because the rule is the context for the choice — hiding it behind an override is what made
 * the old list unreadable.
 */
const ruleText = (item: OptionalContentItem): string => {
  if (item.kind === 'placeholder') return item.conditionText || 'Optional: include it if it applies';
  const condition = item.conditionText ?? 'Condition';
  if (item.noData) return `${condition}: no value entered yet`;
  return `${condition}: ${item.autoVisible ? 'matches' : 'no match'}`;
};

/**
 * True when the PM's choice contradicts the template's rule. This is the one thing a reviewer
 * genuinely needs flagged — an explicit choice that agrees with Auto changes nothing.
 */
const isContraryOverride = (item: OptionalContentItem): boolean =>
  item.override !== undefined && item.override !== item.autoVisible;

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

const ItemRow: React.FC<{
  item: OptionalContentItem;
  expanded: boolean;
  onToggleExpanded: () => void;
  onModeChange: (mode: IncludeMode) => void;
}> = ({ item, expanded, onToggleExpanded, onModeChange }) => {
  const outcome = outcomeFor(item);
  const mode = modeOf(item.override);
  const panelId = `optional-preview-${item.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <div className={`px-3 py-2 ${item.visible ? '' : 'bg-gray-50/70'}`}>
      {/*
        Two lines, not one. The mode control needs ~150px and the block label needs room to be
        recognisable; competing for a single row truncated labels mid-sentence ("Before you
        switch the appliance on, please con…"), which is what made the old list unusable.
        Line 1 is the identity of the block, line 2 is its state and the decision.
      */}
      {/* Disclosure. A sibling of the mode control, not its parent — nested buttons are invalid. */}
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-1.5 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      >
        <ChevronRight
          size={13}
          aria-hidden="true"
          className={`mt-[3px] shrink-0 text-gray-400 transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
        />
        {item.kind === 'placeholder'
          ? <AlertCircle size={12} aria-hidden="true" className="mt-[2px] shrink-0 text-amber-500" />
          : <GitBranch size={12} aria-hidden="true" className="mt-[2px] shrink-0 text-gray-400" />}
        <span className={`min-w-0 flex-1 text-xs font-semibold leading-snug ${item.visible ? 'text-gray-800' : 'text-gray-500'}`}>
          <span className="line-clamp-2">{item.label}</span>
        </span>
      </button>

      {/*
        `items-start` + a wrapping rule text rather than `truncate`: the rule is the reason the
        block is in or out, so clipping it to "Option…" defeats the point of showing it. The
        control stays pinned top-right and the row grows by a line when a rule is long.
      */}
      <div className="mt-1.5 flex items-start gap-2 pl-[22px]">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={outcome.tone} icon={outcome.icon} className="rounded px-1.5 py-0 text-[10px]">
            {outcome.text}
          </Badge>
          {isContraryOverride(item) && (
            <span className="rounded bg-amber-50 px-1.5 py-0 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
              Overrides the rule
            </span>
          )}
          <span className="text-[11px] leading-snug text-gray-500">{ruleText(item)}</span>
        </div>
        <IncludeModeControl
          value={mode}
          onChange={onModeChange}
          ariaLabel={`Inclusion for ${item.label}`}
        />
      </div>

      {expanded && (
        <div id={panelId} className="mt-2 ml-[22px] rounded-md border border-gray-200 bg-white p-2.5">
          {item.previewHtml
            ? (
              <div
                className="im-content pointer-events-none text-xs leading-relaxed text-gray-700"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.previewHtml) }}
              />
            )
            : <p className="text-[11px] italic text-gray-400">This block has no content for the selected language.</p>}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface OptionalContentPanelProps {
  items: OptionalContentItem[];
  /** Chapter ids in manual order, so groups follow the reading order of the document. */
  sectionOrder: string[];
  /** Apply a choice. `undefined` clears the override back to Auto. */
  onSetOverride: (key: string, override: boolean | undefined) => void;
}

export const OptionalContentPanel: React.FC<OptionalContentPanelProps> = ({
  items,
  sectionOrder,
  onSetOverride,
}) => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const bySection = new Map<string, OptionalContentItem[]>();
    for (const item of items) {
      const list = bySection.get(item.sectionId) ?? [];
      list.push(item);
      bySection.set(item.sectionId, list);
    }
    return sectionOrder
      .filter(id => bySection.has(id))
      .map(id => ({
        sectionId: id,
        title: bySection.get(id)![0].sectionTitle,
        items: bySection.get(id)!,
      }));
  }, [items, sectionOrder]);

  if (items.length === 0) return null;

  const includedCount = items.filter(i => i.visible).length;
  // Two different kinds of outstanding work, so counted separately: "review" is a decision the
  // PM owns, "waiting on data" is blocked on a supplier value and isn't theirs to resolve.
  const reviewCount = items.filter(i => outcomeFor(i).text === 'Needs review').length;
  const waitingCount = items.filter(i => outcomeFor(i).text === 'Waiting on data').length;

  const toggleExpanded = (key: string) =>
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const applyMode = (key: string, mode: IncludeMode) =>
    onSetOverride(key, mode === 'auto' ? undefined : mode === 'include');

  return (
    <div className="border-b border-gray-100 pb-6">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h4 className="flex items-center gap-2 text-sm font-bold text-gray-800">
          <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-bold text-purple-700">IF</span>
          Optional &amp; Conditional Content
        </h4>
        <span className="text-[11px] font-medium text-gray-500">
          {includedCount} of {items.length} in the manual
          {reviewCount > 0 && <span className="text-amber-700"> · {reviewCount} to review</span>}
          {waitingCount > 0 && <span className="text-amber-700"> · {waitingCount} waiting on data</span>}
        </span>
      </div>
      <p className="mb-3 max-w-[70ch] text-[11px] leading-relaxed text-gray-500">
        These blocks are not part of every manual. Leave one on <strong className="font-semibold text-gray-600">Auto</strong> to
        follow its template condition, or force it in or out. Click a row to read it.
      </p>

      <div className="space-y-3">
        {groups.map(group => {
          const groupIncluded = group.items.filter(i => i.visible).length;
          const groupOverrides = group.items.filter(i => i.override !== undefined);
          return (
            <div key={group.sectionId} className="overflow-hidden rounded-lg border border-gray-200">
              <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5">
                <h5 className="truncate text-[11px] font-bold uppercase tracking-wide text-gray-600">
                  {group.title}
                </h5>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] tabular-nums text-gray-500">
                    {groupIncluded} of {group.items.length}
                  </span>
                  {groupOverrides.length > 0 && (
                    <button
                      type="button"
                      onClick={() => groupOverrides.forEach(i => onSetOverride(i.key, undefined))}
                      title="Return every block in this chapter to Auto"
                      className="flex items-center gap-1 rounded text-[11px] font-medium text-gray-500 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <RotateCcw size={11} aria-hidden="true" /> Reset
                    </button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {group.items.map(item => (
                  <ItemRow
                    key={item.key}
                    item={item}
                    expanded={expandedKeys.has(item.key)}
                    onToggleExpanded={() => toggleExpanded(item.key)}
                    onModeChange={mode => applyMode(item.key, mode)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
