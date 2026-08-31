/**
 * Pure JQL-building and issue-matching helpers for the Jira connector.
 *
 * Split out of jira-status.ts so the matching rule can be unit-tested without a Jira
 * instance or a Netlify runtime. Nothing here does I/O.
 *
 * THE RULE, verified against go-bbg on 2026-08-31: a launch is one EPIC in project PL
 * whose "ProjectID" field holds the OriginFlow project code. All 278 Epics in PL have
 * that field populated, and each code resolves to exactly one Epic — so the Epic's own
 * status ("RFQ CREATION" -> "BUSINESS CASE" -> "Gates" -> "PO PLACEMENT" ->
 * "PRODUCTION" -> "Go Live" / "Done") is the launch stage the operator cares about.
 *
 * The ~10 non-Epic issues that share each ProjectID are per-gate sub-tickets (Design
 * Gate, Compliance Gate, RFQ Process...). They are deliberately excluded: their
 * statuses are gate-level noise, not the launch stage.
 *
 * There is deliberately NO summary/description fallback. It would only ever fire for an
 * Epic missing its ProjectID (none exist), and could just as easily attach a *different*
 * Epic that merely mentions the code — a wrong status is worse than a missing one.
 */

/**
 * Codes safe to interpolate into JQL. Deliberately excludes `"` and `\` so the
 * quoted-string escaping problem cannot arise at all; anything else is reported as
 * unmatched rather than being sent to Jira.
 */
export const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9 ._\-/]{0,63}$/;
/** Jira returns custom fields as `customfield_10260`; JQL wants `cf[10260]`. */
export const CUSTOM_FIELD_ID = /^customfield_(\d+)$/;

/** Normalized issue shape returned to the client. Mirrored in src/types/project.types.ts. */
export interface JiraIssueRef {
  key: string;
  url: string;
  summary: string;
  /** The Epic's workflow status, e.g. "PO PLACEMENT". This is the launch stage. */
  status: string;
  /** Jira's three-bucket rollup. Coarse here — see statusTone(); 6 of 9 PL statuses are 'indeterminate'. */
  statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown';
  issueType?: string;
  assignee?: string;
  priority?: string;
  updated?: string;
  dueDate?: string;
}

export interface CodeResult {
  issue: JiraIssueRef | null;
  /**
   * How many Epics carried this code. Expected to be 1; >1 means two Epics share a
   * ProjectID in Jira, which is a data problem worth showing rather than hiding.
   */
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
 * alphanumeric? This is what stops "MDA26016" claiming "MDA26016AU"'s Epic.
 */
export const containsCode = (haystack: string, code: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9])${escapeRe(code)}(?![A-Za-z0-9])`, 'i').test(haystack);

/**
 * Flatten whatever Jira stores in the ProjectID field into plain text.
 *
 * On go-bbg it is a plain-text field, but the same field can be reconfigured as a
 * select list (`{ value }`) or multi-select (an array) without us being told. Handling
 * all the shapes means a field-type change does not silently break every lookup.
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

/** `cf[10260]` is the id-based form and survives the field being renamed in Jira. */
export const jqlFieldRef = (fieldId: string): string => {
  const m = CUSTOM_FIELD_ID.exec(fieldId);
  return m ? `cf[${m[1]}]` : `"${fieldId}"`;
};

/**
 * One JQL query covering every code, so a 20-row dashboard costs one Jira round trip
 * rather than 20.
 *
 * `issuetype = Epic` is part of the contract, not an optimisation: without it each code
 * returns ~10-17 gate sub-tickets whose statuses would drown the launch stage.
 */
export const buildJql = (codes: string[], projectKey: string, fieldId: string): string => {
  const field = jqlFieldRef(fieldId);
  const clauses = codes.map(code => `${field} ~ "\\"${code}\\""`);
  const scope = [
    ...(projectKey ? [`project = "${projectKey}"`] : []),
    'issuetype = Epic',
    `(${clauses.join(' OR ')})`,
  ];
  return `${scope.join(' AND ')} ORDER BY updated DESC`;
};

/** Turn a raw Jira Epic into the normalized shape the UI renders. */
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
 * Does this Epic's ProjectID field actually hold this code?
 *
 * The JQL is only ever a pre-filter — Jira's `~` is a fuzzy, tokenized text match that
 * happily returns near-misses. This is the real rule.
 */
export const issueMatchesCode = (issue: JiraSearchIssue, code: string, fieldId: string): boolean => {
  const value = fieldText(issue.fields?.[fieldId]);
  if (!value) return false;
  // Exact value is the normal case; whole-token containment also covers a field that
  // legitimately lists several codes.
  return value.toLowerCase() === code.toLowerCase() || containsCode(value, code);
};

/**
 * Assign each returned Epic to the code its ProjectID field carries.
 *
 * Needed because one batched JQL returns a flat list with no indication of which clause
 * matched. Epics arrive `ORDER BY updated DESC`, so if a code somehow has two Epics the
 * most recently touched one becomes the primary and the other is surfaced as an
 * alternate rather than silently dropped.
 */
export const matchIssuesToCodes = (
  codes: { raw: string; code: string }[],
  issues: JiraSearchIssue[],
  results: Record<string, CodeResult>,
  baseUrl: string,
  fieldId: string,
): void => {
  for (const { raw, code } of codes) {
    const entry = results[raw];
    if (!entry) continue;
    for (const issue of issues) {
      if (!issueMatchesCode(issue, code, fieldId)) continue;
      const ref = toRef(issue, baseUrl);
      entry.matchCount += 1;
      if (!entry.issue) entry.issue = ref;
      else if (entry.alternates.length < MAX_ALTERNATES) entry.alternates.push(ref);
    }
  }
};

/**
 * Pick the Jira field that holds the launch code, by display name.
 *
 * Resolved by NAME because the numeric custom-field id differs between Jira sites (it
 * is customfield_10260 on go-bbg), so hardcoding one would make the connector
 * site-specific. Matching ignores case and spacing so "ProjectID", "Project ID" and
 * "project id" all resolve to the same field.
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
