/**
 * Jira link-through chip: the launch Epic's key + its live status, linking to the ticket.
 *
 * Sibling of StatusBadge.tsx — same Badge primitive, same four-family tone vocabulary
 * from DESIGN.md, but the status text comes straight from Jira's Epic workflow.
 *
 * Renders a muted "Not on Jira" when no Epic carries the project code. That is a real
 * answer for the operator, not an error state.
 */

import React from 'react';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import { Badge, BadgeTone } from './common/Badge';
import type { JiraIssueRef, JiraLookup } from '../types';

interface Props {
  lookup: JiraLookup | null | undefined;
  /** While the live lookup is in flight. */
  loading?: boolean;
  /** Show the Epic summary alongside the status (detail page); off in dense tables. */
  showSummary?: boolean;
}

/**
 * Statuses that mean "stopped", whatever Jira's category says.
 *
 * Cancelled is the reason this maps by NAME rather than by statusCategory: Jira files
 * it under the 'done' category alongside Done, so a category-based mapping would paint
 * all 78 cancelled launches emerald "completed". Per DESIGN.md the rose family covers
 * blocked / rejected / cancelled, and StatusBadge.tsx already maps OriginFlow's own
 * ON_HOLD and CANCELLED there — so these two match the rest of the app.
 */
const STOPPED = new Set(['cancelled', 'canceled', 'on hold']);
/** Statuses that mean the launch actually shipped, as opposed to merely being closed. */
const DELIVERED = new Set(['done', 'go live', 'closed', 'complete', 'completed']);

/**
 * Tone for one Epic status.
 *
 * Name first, category second: the PL workflow puts 6 of its 9 statuses in Jira's
 * 'indeterminate' bucket, so the category alone cannot distinguish shipped from stopped
 * from in-flight. The status label always carries the precise meaning (DESIGN.md's
 * Color-Plus-Shape Rule), so the hue only needs to say which of those four it is.
 */
export const jiraStatusTone = (issue: JiraIssueRef): BadgeTone => {
  const name = issue.status.trim().toLowerCase();
  if (STOPPED.has(name)) return 'rose';
  if (DELIVERED.has(name)) return 'emerald';
  if (issue.statusCategory === 'done') return 'emerald';
  if (issue.statusCategory === 'indeterminate') return 'indigo';
  return 'gray';
};

export const JiraStatusBadge: React.FC<Props> = ({ lookup, loading = false, showSummary = false }) => {
  if (loading) {
    return <span className="text-xs text-muted italic">Checking Jira…</span>;
  }
  if (!lookup || !lookup.issue) {
    return <span className="text-xs text-muted">Not on Jira</span>;
  }

  const { issue, matchCount } = lookup;
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${issue.key} — ${issue.summary}${issue.assignee ? `\nAssignee: ${issue.assignee}` : ''}`}
        className="inline-flex items-center gap-1 shrink-0 rounded-xl hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      >
        <Badge tone={jiraStatusTone(issue)}>
          <span className="font-mono">{issue.key}</span>
          <span aria-hidden="true" className="opacity-40">|</span>
          <span>{issue.status}</span>
          <ExternalLink size={11} className="opacity-60" />
        </Badge>
      </a>
      {matchCount > 1 && (
        // Two Epics sharing one ProjectID is a Jira data problem. The chip links to the
        // most recently updated one, which may not be the one the operator means, so
        // say so rather than quietly picking a winner.
        <span
          title={`${matchCount} Jira Epics carry this project code (${[issue, ...lookup.alternates]
            .map(i => i.key)
            .join(', ')}). Showing the most recently updated one.`}
          className="inline-flex items-center text-amber-600"
        >
          <AlertTriangle size={13} />
        </span>
      )}
      {showSummary && issue.summary && (
        <span className="text-xs text-muted truncate">{issue.summary}</span>
      )}
    </span>
  );
};
