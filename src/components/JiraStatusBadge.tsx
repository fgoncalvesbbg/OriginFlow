/**
 * Jira link-through chip: issue key + live Jira status, linking straight to the ticket.
 *
 * Sibling of StatusBadge.tsx — same Badge primitive, but the tone comes from Jira's
 * statusCategory rather than an OriginFlow enum. We key off `statusCategory` (Jira's
 * own new/indeterminate/done rollup) instead of the status NAME because workflow
 * status names are configurable per project and would not map reliably.
 *
 * Renders nothing but a muted "Not on Jira" when the code has no matching issue —
 * that is a real answer for the operator, not an error state.
 */

import React from 'react';
import { ExternalLink, AlertTriangle } from 'lucide-react';
import { Badge, BadgeTone } from './common/Badge';
import type { JiraLookup } from '../types';

interface Props {
  lookup: JiraLookup | null | undefined;
  /** While the live lookup is in flight. */
  loading?: boolean;
  /** Show the issue summary alongside the status (detail page); off in dense tables. */
  showSummary?: boolean;
}

const toneForCategory = (category: string): BadgeTone => {
  switch (category) {
    case 'done':
      return 'emerald';
    case 'indeterminate':
      return 'indigo';
    case 'new':
      return 'gray';
    default:
      return 'gray';
  }
};

export const JiraStatusBadge: React.FC<Props> = ({ lookup, loading = false, showSummary = false }) => {
  if (loading) {
    return <span className="text-xs text-muted italic">Checking Jira…</span>;
  }
  if (!lookup || !lookup.issue) {
    return <span className="text-xs text-muted">Not on Jira</span>;
  }

  const { issue, matchCount } = lookup;
  // A 'field' (or 'key') match is the ProjectID link and is exact. 'summary'/'text'
  // mean the ProjectID field was blank and we fell back to searching the ticket, so
  // say that in the tooltip rather than presenting a guess as a fact.
  const matchNote =
    issue.matchedBy === 'summary'
      ? '\nMatched on the issue summary — the ProjectID field is not set on this ticket.'
      : issue.matchedBy === 'text'
        ? '\nMatched on the issue text — the ProjectID field is not set on this ticket.'
        : '';
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${issue.key} — ${issue.summary}${issue.assignee ? ` (${issue.assignee})` : ''}${matchNote}`}
        className={`inline-flex items-center gap-1 shrink-0 rounded-lg hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-indigo-300 ${matchNote ? 'decoration-dotted underline-offset-4 underline' : ''}`}
      >
        <Badge tone={toneForCategory(issue.statusCategory)}>
          <span className="font-mono">{issue.key}</span>
          <span aria-hidden="true" className="opacity-40">|</span>
          <span>{issue.status}</span>
          <ExternalLink size={11} className="opacity-60" />
        </Badge>
      </a>
      {matchCount > 1 && (
        // An ambiguous launch code is worth surfacing: the chip links to the most
        // recently updated match, which may not be the one the operator means.
        <span
          title={`${matchCount} Jira issues mention this project code. Showing the most recently updated one.`}
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
