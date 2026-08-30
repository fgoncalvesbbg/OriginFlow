/**
 * Pure JQL-building and issue-matching helpers for the Jira connector.
 *
 * Split out of jira-status.ts so the fiddly part — deciding which Jira issue belongs
 * to which OriginFlow launch code — can be unit-tested without a Jira instance or a
 * Netlify runtime. Nothing here does I/O.
 *
 * Three matching strategies, tried in order (see MatchStrategy):
 *   1. 'field'   — the Jira custom field that holds the launch code (named "ProjectID"
 *                  on go-bbg by default). This is the real link, and the only strategy
 *                  that can be verified EXACTLY: we read the field back off the issue
 *                  and compare values, so a fuzzy JQL hit cannot produce a false match.
 *   2. 'summary' — fallback for tickets where nobody filled the field in; the code has
 *                  to appear in the summary as a whole token.
 *   3. 'text'    — last resort; the code is somewhere in the description or comments,
 *                  which we did not fetch and therefore cannot re-verify.
 */

/**
 * Codes safe to interpolate into JQL. Deliberately excludes `"` and `\` so the
 * quoted-string escaping problem cannot arise at all; anything else is reported as
 * unmatched rather than being sent to Jira.
 */
export const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9 ._\-/]{0,63}$/;
/** A code the operator typed as a Jira key already, e.g. "PL-123". */
export const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
/** Jira returns custom fields as `customfield_10050`; JQL wants `cf[10050]`. */
export const CUSTOM_FIELD_ID = /^customfield_(\d+)$/;

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
  /** How this issue was tied to the project code — surfaced so an operator can judge it. */
  matchedBy?: 'field' | 'summary' | 'text' | 'key';
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

/**
 * How to tie codes to issues on a given pass.
 * 'field' carries the resolved custom-field id (e.g. "customfield_10050").
 */
export type MatchStrategy =
  | { kind: 'field'; fieldId: string }
  | { kind: 'summary' }
  | { kind: 'text' };

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
 * Flatten whatever Jira stores in a custom field into plain text.
 *
 * The same "ProjectID" field can come back as a bare string (text field), as
 * `{ value }` or `{ name }` (select list), or as an array of either (multi-select),
 * depending on how it was configured — and the configuration can change without us
 * knowing. Handling all four means a field-type change in Jira does not silently
 * break every lookup.
 */
export const fieldText = (raw: unknown): string => {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number') return String(raw);
  if (Array.isArray(raw)) return raw.map(fieldText).filter(Boolean).join(' ');
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    return fieldText(o.value ?? o.name ?? o.displayName ?? '');
  }
  return '';
};

/** JQL clause naming one field, given a strategy. */
const jqlField = (strategy: MatchStrategy): string => {
  if (strategy.kind !== 'field') return strategy.kind;
  const m = CUSTOM_FIELD_ID.exec(strategy.fieldId);
  // cf[10050] is the id-based form and is immune to the field being renamed in Jira.
  return m ? `cf[${m[1]}]` : `"${strategy.fieldId}"`;
};

/**
 * One JQL query covering every code, so a 20-row dashboard costs one Jira round trip
 * rather than 20.
 */
export const buildJql = (codes: string[], projectKey: string, strategy: MatchStrategy): string => {
  const field = jqlField(strategy);
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
export const toRef = (
  issue: JiraSearchIssue,
  baseUrl: string,
  matchedBy?: JiraIssueRef['matchedBy'],
): JiraIssueRef => {
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
    matchedBy,
  };
};

/**
 * Does this issue actually belong to this code, under the given strategy?
 *
 * The JQL is only ever a pre-filter — Jira's `~` is a fuzzy, tokenized text match that
 * happily returns near-misses. This is the real rule.
 */
export const issueMatchesCode = (issue: JiraSearchIssue, code: string, strategy: MatchStrategy): boolean => {
  if (ISSUE_KEY.test(code) && issue.key.toLowerCase() === code.toLowerCase()) return true;

  if (strategy.kind === 'field') {
    const value = fieldText(issue.fields?.[strategy.fieldId]);
    if (!value) return false;
    // Exact value is the normal case; whole-token containment also covers a field that
    // legitimately lists several codes ("MDA26003, MDA26004").
    return value.toLowerCase() === code.toLowerCase() || containsCode(value, code);
  }

  if (strategy.kind === 'summary') return containsCode(issue.fields?.summary || '', code);

  // 'text' searched description and comments, which we did not fetch — trust Jira.
  return true;
};

/**
 * Assign each returned issue to the code(s) it actually belongs to.
 *
 * Issues arrive `ORDER BY updated DESC`, so the first match for a code is the most
 * recently touched one and becomes the primary; the rest are surfaced as alternates so
 * an ambiguous launch code is visible rather than silently resolved.
 *
 * Mutates `results` in place — it accumulates across the field, summary and text passes.
 */
export const matchIssuesToCodes = (
  codes: { raw: string; code: string }[],
  issues: JiraSearchIssue[],
  results: Record<string, CodeResult>,
  baseUrl: string,
  strategy: MatchStrategy,
): void => {
  const matchedBy: JiraIssueRef['matchedBy'] = strategy.kind;
  for (const { raw, code } of codes) {
    const entry = results[raw];
    if (!entry) continue;
    for (const issue of issues) {
      if (!issueMatchesCode(issue, code, strategy)) continue;
      const ref = toRef(issue, baseUrl, ISSUE_KEY.test(code) ? 'key' : matchedBy);
      entry.matchCount += 1;
      if (!entry.issue) entry.issue = ref;
      else if (entry.alternates.length < MAX_ALTERNATES) entry.alternates.push(ref);
    }
  }
};

/**
 * Pick the Jira field that holds the launch code, by display name.
 *
 * Resolved by NAME because the numeric custom-field id differs between Jira sites (and
 * between prod and a sandbox), so hardcoding one would make the connector site-specific.
 * Matching ignores case and spacing so "ProjectID", "Project ID" and "project id" all
 * resolve to the same field.
 */
export const findFieldByName = (
  fields: { id: string; name?: string }[],
  wanted: string,
): string | null => {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const target = norm(wanted);
  // Prefer an exact (normalized) name; fall back to a unique prefix match so a field
  // labelled "ProjectID (legacy)" still resolves when it is the only candidate.
  const exact = fields.find(f => f.name && norm(f.name) === target);
  if (exact) return exact.id;
  const partial = fields.filter(f => f.name && norm(f.name).startsWith(target));
  return partial.length === 1 ? partial[0].id : null;
};
