/**
 * Pure JQL-building and issue-matching helpers for the Jira connector.
 *
 * Split out of jira-status.ts so the fiddly part — deciding which Jira issue belongs
 * to which OriginFlow launch code — can be unit-tested without a Jira instance or a
 * Netlify runtime. Nothing here does I/O.
 */

/**
 * Codes safe to interpolate into JQL. Deliberately excludes `"` and `\` so the
 * quoted-string escaping problem cannot arise at all; anything else is reported as
 * unmatched rather than being sent to Jira.
 */
export const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9 ._\-/]{0,63}$/;
/** A code the operator typed as a Jira key already, e.g. "PL-123". */
export const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** Normalized issue shape returned to the client. Mirrored in src/types/project.types.ts. */
export interface JiraIssueRef {
  key: string;
  url: string;
  summary: string;
  status: string;
  /** Jira's own three-bucket rollup — stable across custom workflows, unlike status names. */
  statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown';
  issueType?: string;
  assignee?: string;
  priority?: string;
  updated?: string;
  dueDate?: string;
}

export interface CodeResult {
  issue: JiraIssueRef | null;
  /** How many issues matched — >1 means the launch code is ambiguous in Jira. */
  matchCount: number;
  alternates: JiraIssueRef[];
}

export interface JiraSearchIssue {
  key: string;
  fields?: Record<string, any>;
}

export const MAX_ALTERNATES = 4;

/** Escape a code for use inside a JS RegExp. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-token containment: does `haystack` contain `code` not glued to another
 * alphanumeric? This is what stops "MDA26016" claiming "MDA26016AU"'s issue.
 */
export const containsCode = (haystack: string, code: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9])${escapeRe(code)}(?![A-Za-z0-9])`, 'i').test(haystack);

/**
 * One JQL query covering every code, so a 20-row dashboard costs one Jira round trip
 * rather than 20. `field` is 'summary' (precise) or 'text' (summary + description +
 * comments), used only for the second pass.
 */
export const buildJql = (codes: string[], projectKey: string, field: 'summary' | 'text'): string => {
  const clauses = codes.map(code =>
    // A code that is already an issue key is looked up as one; `~` would not find it.
    ISSUE_KEY.test(code) ? `key = "${code}"` : `${field} ~ "\\"${code}\\""`,
  );
  const scoped = projectKey
    ? `project = "${projectKey}" AND (${clauses.join(' OR ')})`
    : `(${clauses.join(' OR ')})`;
  return `${scoped} ORDER BY updated DESC`;
};

/** Turn a raw Jira issue into the normalized shape the UI renders. */
export const toRef = (issue: JiraSearchIssue, baseUrl: string): JiraIssueRef => {
  const f = issue.fields || {};
  const rawCategory = f.status?.statusCategory?.key;
  return {
    key: issue.key,
    url: `${baseUrl}/browse/${issue.key}`,
    summary: f.summary || '',
    status: f.status?.name || 'Unknown',
    statusCategory:
      rawCategory === 'new' || rawCategory === 'indeterminate' || rawCategory === 'done'
        ? rawCategory
        : 'unknown',
    issueType: f.issuetype?.name || undefined,
    assignee: f.assignee?.displayName || undefined,
    priority: f.priority?.name || undefined,
    updated: f.updated || undefined,
    dueDate: f.duedate || undefined,
  };
};

/**
 * Assign each returned issue to the code(s) it actually mentions.
 *
 * Necessary because one batched JQL returns a flat list with no indication of which
 * clause matched, and because Jira's `~` is a fuzzy text match that can return issues
 * which merely tokenize similarly. The boundary-anchored recheck here is the real
 * matching rule; the JQL is a cheap pre-filter.
 *
 * Issues arrive `ORDER BY updated DESC`, so the first match for a code is the most
 * recently touched one and becomes the primary; the rest are surfaced as alternates so
 * an ambiguous launch code is visible rather than silently resolved.
 *
 * Mutates `results` in place (it accumulates across the summary and text passes).
 */
export const matchIssuesToCodes = (
  codes: { raw: string; code: string }[],
  issues: JiraSearchIssue[],
  results: Record<string, CodeResult>,
  baseUrl: string,
  field: 'summary' | 'text',
): void => {
  for (const { raw, code } of codes) {
    for (const issue of issues) {
      const isKeyMatch = ISSUE_KEY.test(code) && issue.key.toLowerCase() === code.toLowerCase();
      // The 'text' pass searched description/comments, which we cannot re-check from
      // the `summary` field alone — there we trust Jira's own match.
      const matches = isKeyMatch || field === 'text' || containsCode(issue.fields?.summary || '', code);
      if (!matches) continue;

      const entry = results[raw];
      if (!entry) continue;
      const ref = toRef(issue, baseUrl);
      entry.matchCount += 1;
      if (!entry.issue) entry.issue = ref;
      else if (entry.alternates.length < MAX_ALTERNATES) entry.alternates.push(ref);
    }
  }
};
