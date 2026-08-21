/**
 * PublishReviewPanel — the pre-publish review, docked beside the editor instead of on top of it.
 *
 * WHY A PANEL AND NOT A DIALOG
 * ----------------------------
 * This review used to be a modal: it listed what was missing, and then the operator had to
 * close it (losing the list) to go and fix anything. Everything worth showing here is a
 * pointer INTO the editor, so the review has to survive being acted on. Docked, it does:
 * clicking a row moves the editor to that field or chapter, the row stays where it was, and
 * the list re-derives from live state — so an item disappears the moment it is fixed. That is
 * also why it collapses sideways rather than closing: a rail keeps the outstanding count on
 * screen while giving the editor its width back.
 *
 * TWO KINDS OF CONTENT, DELIBERATELY DIFFERENT
 * --------------------------------------------
 *  1. ISSUES — machine-detected gaps (missing values, empty required SKU slots, chapters
 *     dropped for want of data, untranslated text). Each one is a jump target. Only the
 *     `blocking` kind stops a publish; the rest are advisory, and the button says
 *     "Publish anyway" so nobody mistakes the panel for a gate.
 *  2. THE REGULATORY CHECKLIST — obligations a PERSON has to confirm, grouped BY REGULATION,
 *     because an obligation only means something next to the regulation imposing it. Never
 *     blocks a publish (see services/regulatory/regulation-checklist.ts: a checklist that
 *     blocks only teaches people to tick everything).
 *
 * The panel renders no business rules of its own: issues arrive built (see publish-issues.ts),
 * checklist groups arrive grouped, and every write goes back out through a callback.
 */

import React, { useState } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle, CheckSquare, ChevronDown, ChevronRight,
  ChevronsRight, Crosshair, EyeOff, Globe, Loader2, Scale, Square, Table2, X,
} from 'lucide-react';
import {
  groupPublishIssues,
  summarizePublishIssues,
  type PublishIssue,
  type PublishIssueKind,
} from './publish-issues';
import type {
  ChecklistItemState,
  ChecklistItemStatus,
  ChecklistRegulationGroup,
  ChecklistSummary,
} from '../../../services';

/** Per-kind presentation: heading, colour vocabulary, and what fixing it means. */
const KIND_META: Record<PublishIssueKind, {
  title: string;
  hint?: string;
  icon: React.ReactNode;
  head: string;
  row: string;
}> = {
  blocking: {
    title: 'Must fix before publishing',
    icon: <AlertCircle size={13} />,
    head: 'text-rose-700',
    row: 'hover:bg-rose-50 text-rose-800',
  },
  value: {
    title: 'Missing values',
    hint: 'Published as an empty placeholder until filled.',
    icon: <Crosshair size={13} />,
    head: 'text-rose-600',
    row: 'hover:bg-rose-50 text-gray-700',
  },
  slot: {
    title: 'Required SKU content',
    hint: 'A required per-SKU table or image set is still empty.',
    icon: <Table2 size={13} />,
    head: 'text-violet-600',
    row: 'hover:bg-violet-50 text-gray-700',
  },
  condition: {
    title: 'Chapters left out',
    hint: 'These will NOT be in the published manual. Fill the attribute value, or force-include the chapter.',
    icon: <EyeOff size={13} />,
    head: 'text-orange-600',
    row: 'hover:bg-orange-50 text-gray-700',
  },
  translation: {
    title: 'Missing translation',
    icon: <Globe size={13} />,
    head: 'text-amber-600',
    row: 'hover:bg-amber-50 text-gray-700',
  },
};

export interface PublishReviewPanelProps {
  /** "Instruction Manual" / "Warning Leaflet" — this panel serves both. */
  typeLabel: string;
  /** Live issues, rebuilt by the parent on every render so fixes vanish as they are made. */
  issues: PublishIssue[];
  /** Human name for a language code, for the translation group headings. */
  languageName: (code: string) => string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  /** Put the editor on the thing this issue is about. Not called for targetless issues. */
  onJump: (issue: PublishIssue) => void;
  /** The row last jumped to, kept marked so the operator can see where they were. */
  activeIssueKey: string | null;

  /** Checklist items grouped by the regulation that states them. */
  regulationGroups: ChecklistRegulationGroup[];
  /** This manual's confirmations, keyed by item key. */
  checklistState: Record<string, ChecklistItemState>;
  /** The TEMPLATE author's decisions — shown as context, never applied. */
  templateChecklistState: Record<string, ChecklistItemState>;
  checklistSummary: ChecklistSummary;
  /** Item currently being written, if any. */
  checklistBusyKey: string | null;
  checklistError?: string;
  onDecide: (key: string, status: ChecklistItemStatus | null) => void;

  /**
   * True when the panel was opened by pressing Publish: it then owns the decision to go
   * ahead, and shows the publish/abandon footer. False when opened for a look around.
   */
  armed: boolean;
  onPublish: () => void;
  onCancelPublish: () => void;
}

export const PublishReviewPanel: React.FC<PublishReviewPanelProps> = ({
  typeLabel, issues, languageName, collapsed, onToggleCollapsed, onClose, onJump,
  activeIssueKey, regulationGroups, checklistState, templateChecklistState, checklistSummary,
  checklistBusyKey, checklistError, onDecide, armed, onPublish, onCancelPublish,
}) => {
  const summary = summarizePublishIssues(issues);
  const groups = groupPublishIssues(issues);

  // Collapsed rail: the outstanding count has to stay readable, or collapsing the panel
  // would hide the very thing it exists to report.
  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapsed}
        title={`Expand the pre-publish review (${summary.total} open item${summary.total === 1 ? '' : 's'})`}
        className="w-10 shrink-0 bg-white border border-gray-200 rounded-xl shadow flex flex-col items-center gap-3 py-3 hover:bg-light transition-colors"
      >
        <ChevronsRight size={14} className="rotate-180 text-gray-400" />
        {summary.total > 0 && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            summary.blocking > 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
          }`}>{summary.total}</span>
        )}
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 [writing-mode:vertical-rl]">
          Pre-publish review
        </span>
        {checklistSummary.open > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700" title={`${checklistSummary.open} regulatory item(s) still to review`}>
            {checklistSummary.open}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="w-[23rem] shrink-0 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 bg-light border-b border-gray-200 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
            <AlertTriangle size={14} className={summary.blocking > 0 ? 'text-rose-500' : 'text-amber-500'} />
            Pre-publish review
          </div>
          <p className="text-[11px] text-muted mt-0.5">
            {summary.blocking > 0
              ? `${summary.blocking} item${summary.blocking === 1 ? '' : 's'} must be fixed before this ${typeLabel.toLowerCase()} can be published.`
              : summary.total > 0
                ? `${summary.total} thing${summary.total === 1 ? '' : 's'} to look at. Click any row to jump to it.`
                : regulationGroups.length > 0
                  ? 'Nothing outstanding — the regulatory checklist below is the last thing to confirm.'
                  : 'Nothing outstanding. This manual is ready to publish.'}
          </p>
        </div>
        <button onClick={onToggleCollapsed} title="Collapse to the side" className="shrink-0 p-1 text-gray-400 hover:text-gray-700">
          <ChevronsRight size={15} />
        </button>
        <button onClick={onClose} title="Close the review panel" className="shrink-0 p-1 text-gray-400 hover:text-gray-700">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {summary.total === 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <CheckCircle size={14} className="mt-0.5 shrink-0 text-emerald-600" />
            <span>Everything the app can check is complete: values filled, required SKU content in place, every required language translated.</span>
          </div>
        )}

        {groups.map(group => {
          const meta = KIND_META[group.kind];
          const title = group.kind === 'translation'
            ? `Missing ${languageName(group.lang ?? '')} translation`
            : meta.title;
          return (
            <div key={group.key}>
              <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-1 ${meta.head}`}>
                {meta.icon}
                <span className="min-w-0 truncate">{title}</span>
                <span className="text-gray-400">({group.issues.length})</span>
              </div>
              {meta.hint && <p className="text-[11px] text-muted mb-1.5 leading-relaxed">{meta.hint}</p>}
              <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                {group.issues.map(issue => {
                  const active = issue.key === activeIssueKey;
                  const jumpable = issue.target !== null;
                  return (
                    <li key={issue.key}>
                      <button
                        type="button"
                        onClick={() => jumpable && onJump(issue)}
                        disabled={!jumpable}
                        title={jumpable
                          ? issue.target?.pane === 'content'
                            ? 'Open this chapter in "Add content" for editing'
                            : 'Jump to this field in "Fill values"'
                          : 'Nothing to open here — fix this outside the editor'}
                        className={`group w-full text-left px-2.5 py-2 flex items-start gap-2 transition-colors disabled:cursor-default ${
                          active ? 'bg-slate-100' : meta.row
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium leading-snug">{issue.label}</div>
                          {issue.sectionTitle && (
                            <div className="text-[11px] text-gray-400 truncate">{issue.sectionTitle}</div>
                          )}
                          {issue.detail && (
                            <div className="text-[11px] text-gray-500 leading-snug">{issue.detail}</div>
                          )}
                        </div>
                        {jumpable && (
                          <ChevronRight size={13} className="mt-0.5 shrink-0 text-gray-300 group-hover:text-gray-600" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {/* REGULATORY CHECKLIST — grouped by the regulation that imposes each obligation. */}
        {regulationGroups.length > 0 && (
          <div className="border border-emerald-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-emerald-50 border-b border-emerald-200">
              <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800 flex items-center gap-1.5">
                <Scale size={13} /> Regulatory checklist
              </div>
              <div className="text-[10px] font-semibold text-emerald-700 whitespace-nowrap">
                {checklistSummary.done} confirmed
                {checklistSummary.na > 0 && <> · {checklistSummary.na} n/a</>}
                {checklistSummary.open > 0
                  ? <> · {checklistSummary.open} to review</>
                  : <> · all {checklistSummary.total} decided</>}
              </div>
            </div>
            <p className="text-[11px] text-muted px-3 pt-2 leading-relaxed">
              What the regulations applying to this template oblige a person to verify by hand.
              Optional — an unticked item just records that nobody confirmed it, and never blocks
              a publish.
            </p>
            <div className="divide-y divide-gray-100 mt-1">
              {regulationGroups.map(group => (
                <RegulationChecklistGroup
                  key={group.regulationId}
                  group={group}
                  state={checklistState}
                  templateState={templateChecklistState}
                  busyKey={checklistBusyKey}
                  onDecide={onDecide}
                />
              ))}
            </div>
            {checklistError && (
              <p className="text-[11px] text-rose-700 bg-rose-50 border-t border-rose-200 px-3 py-1.5">
                {checklistError}
              </p>
            )}
          </div>
        )}
      </div>

      {armed && (
        <div className="border-t border-gray-100 p-3 flex items-center justify-end gap-2">
          <button
            onClick={onCancelPublish}
            className="text-xs px-3 py-2 border rounded-lg hover:bg-gray-50 text-gray-600"
          >Not yet</button>
          <button
            onClick={onPublish}
            disabled={summary.blocking > 0}
            title={summary.blocking > 0 ? 'Resolve the blocking items first' : undefined}
            className="text-xs px-3 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >{summary.total === 0 ? 'Publish' : 'Publish anyway'}</button>
        </div>
      )}
    </div>
  );
};

/**
 * One regulation's items. Collapsible, and collapsed by default once every item under it is
 * decided: a settled regulation is exactly the thing a reviewer should not have to scroll past
 * to reach the one that still needs work.
 */
const RegulationChecklistGroup: React.FC<{
  group: ChecklistRegulationGroup;
  state: Record<string, ChecklistItemState>;
  templateState: Record<string, ChecklistItemState>;
  busyKey: string | null;
  onDecide: (key: string, status: ChecklistItemStatus | null) => void;
}> = ({ group, state, templateState, busyKey, onDecide }) => {
  const open = group.items.filter(i => !state[i.key]).length;
  const [expanded, setExpanded] = useState(open > 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-1.5 px-3 py-2 text-left hover:bg-light"
      >
        {expanded
          ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-gray-400" />
          : <ChevronRight size={13} className="mt-0.5 shrink-0 text-gray-400" />}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-gray-800 font-mono truncate">{group.referenceCode}</div>
          <div className="text-[11px] text-gray-500 truncate" title={group.title}>{group.title}</div>
        </div>
        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
          open === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {open === 0 ? `${group.items.length} decided` : `${open} of ${group.items.length}`}
        </span>
      </button>
      {expanded && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-light/40">
          {group.items.map(item => {
            const decided = state[item.key];
            const busy = busyKey === item.key;
            const done = decided?.status === 'done';
            const na = decided?.status === 'na';
            // An obligation two regulations both state is ONE item with ONE confirmation —
            // say so, or the same row looks unconfirmed under the other citation.
            const shared = item.regulationReferences.filter(r => r !== group.referenceCode);
            const fromTemplate = templateState[item.key];
            return (
              <li key={item.key} className="flex items-start gap-2 px-3 py-2">
                <button
                  onClick={() => onDecide(item.key, done ? null : 'done')}
                  disabled={busy}
                  title={done ? 'Clear this confirmation' : 'Mark as taken into account'}
                  className="shrink-0 mt-0.5 disabled:opacity-40"
                >
                  {busy
                    ? <Loader2 size={15} className="animate-spin text-gray-400" />
                    : done
                      ? <CheckSquare size={15} className="text-emerald-600" />
                      : <Square size={15} className={na ? 'text-gray-300' : 'text-gray-400'} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs leading-snug ${na ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                    {item.text}
                  </p>
                  {(decided || shared.length > 0) && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {decided && (
                        <>
                          {done ? 'Confirmed' : 'Not applicable'}
                          {decided.updatedBy ? ` by ${decided.updatedBy}` : ''}
                        </>
                      )}
                      {decided && shared.length > 0 && ' — '}
                      {shared.length > 0 && (
                        <>also required by <span className="font-mono">{shared.join(' · ')}</span></>
                      )}
                    </p>
                  )}
                  {/* Provenance, not inheritance: the template author's decision is shown,
                      never applied. */}
                  {fromTemplate && (
                    <p className="text-[10px] text-gray-400 italic">
                      Template: {fromTemplate.status === 'done' ? 'covered' : 'not applicable'}
                      {fromTemplate.updatedBy ? ` — ${fromTemplate.updatedBy}` : ''}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onDecide(item.key, na ? null : 'na')}
                  disabled={busy}
                  title={na ? 'This item applies after all' : 'Not applicable to this manual'}
                  className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border disabled:opacity-40 ${
                    na
                      ? 'bg-gray-100 text-gray-600 border-gray-300'
                      : 'text-gray-400 border-gray-200 hover:text-gray-600 hover:border-gray-300'
                  }`}
                >
                  N/A
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default PublishReviewPanel;
