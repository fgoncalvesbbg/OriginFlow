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
  AlertCircle, AlertTriangle, CheckCircle, ChevronDown, ChevronRight,
  ChevronsRight, Crosshair, EyeOff, Globe, Table2,
} from 'lucide-react';
import {
  groupPublishIssues,
  summarizePublishIssues,
  type PublishIssue,
  type PublishIssueGroup,
  type PublishIssueKind,
} from './publish-issues';
import type {
  ChecklistItemState,
  ChecklistItemStatus,
  ChecklistRegulationGroup,
  ChecklistSummary,
} from '../../../services';
// The checklist has a second home now (the editor's side rail opens it on its own), so it
// lives in its own module. Here it stays inline: the publish gate is exactly where it has
// to be seen before committing.
import { RegulatoryChecklistSection } from './RegulatoryChecklist';

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
  /** Collapse back to the side rail, which owns open/closed for every editor panel. */
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
  typeLabel, issues, languageName, onClose, onJump,
  activeIssueKey, regulationGroups, checklistState, templateChecklistState, checklistSummary,
  checklistBusyKey, checklistError, onDecide, armed, onPublish, onCancelPublish,
}) => {
  const summary = summarizePublishIssues(issues);
  const groups = groupPublishIssues(issues);

  // No collapsed rendering of its own any more: EditorSideRail is the collapsed state for
  // every editor panel, and it keeps this panel's count on screen while it is shut.
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
        <button onClick={onClose} title="Collapse this panel" className="shrink-0 p-1 text-gray-400 hover:text-gray-700">
          <ChevronsRight size={15} />
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
            <IssueGroupSection
              key={group.key}
              group={group}
              meta={meta}
              title={title}
              // Blocking issues stop the publish outright, so they stay in view; everything
              // else is advisory and starts collapsed to keep the panel scannable.
              defaultExpanded={group.kind === 'blocking'}
              activeIssueKey={activeIssueKey}
              onJump={onJump}
            />
          );
        })}

        {regulationGroups.length > 0 && (
          <RegulatoryChecklistSection
            regulationGroups={regulationGroups}
            checklistState={checklistState}
            templateChecklistState={templateChecklistState}
            checklistSummary={checklistSummary}
            checklistBusyKey={checklistBusyKey}
            checklistError={checklistError}
            onDecide={onDecide}
          />
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
 * One issue-kind group (or one language's translation group). Collapsible so a manual with
 * many gaps doesn't turn into one long scroll — only `blocking` starts open, since that is
 * the one kind that stops the publish and has to stay in view; everything else is advisory
 * and starts collapsed, same spirit as the regulatory groups below.
 */
const IssueGroupSection: React.FC<{
  group: PublishIssueGroup;
  meta: (typeof KIND_META)[PublishIssueKind];
  title: string;
  defaultExpanded: boolean;
  activeIssueKey: string | null;
  onJump: (issue: PublishIssue) => void;
}> = ({ group, meta, title, defaultExpanded, activeIssueKey, onJump }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className={`w-full flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide mb-1 ${meta.head}`}
      >
        {expanded
          ? <ChevronDown size={12} className="shrink-0" />
          : <ChevronRight size={12} className="shrink-0" />}
        {meta.icon}
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        <span className="text-gray-400 font-normal">({group.issues.length})</span>
      </button>
      {expanded && (
        <>
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
                        ? 'Open this chapter in "Edit IM" for editing'
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
        </>
      )}
    </div>
  );
};

export default PublishReviewPanel;
