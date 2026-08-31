/**
 * Live end-to-end check of the Jira connector against the real Jira site.
 *
 * OPT-IN — skipped unless JIRA_LIVE_TEST=1, because it makes real network calls and
 * depends on Jira data that changes. `npm test` stays offline and fast:
 *
 *   JIRA_LIVE_TEST=1 npx vitest run netlify/functions/lib/jira-match.live.test.ts
 *
 * Why this exists rather than only scripts/jira-check.mjs: this exercises the SAME
 * buildJql / matchIssuesToCodes / findFieldByName the Netlify function uses, so it
 * catches drift between the diagnostic and the real code path. The credentials come
 * from the repo-root .env, exactly as `netlify dev` would supply them.
 *
 * Asserts the two properties the whole design rests on, against real data:
 *   1. every project code resolves to exactly ONE Epic, and
 *   2. that Epic's ProjectID field really equals the code.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  buildJql,
  findFieldByName,
  matchIssuesToCodes,
  type CodeResult,
  type JiraSearchIssue,
} from './jira-match';

const ENABLED = process.env.JIRA_LIVE_TEST === '1';

/** Read a var from the environment, falling back to the repo-root .env (as netlify dev does). */
const env = (key: string): string => {
  if (process.env[key]) return String(process.env[key]).trim();
  try {
    const file = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
    const line = file.split(/\r?\n/).find(l => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : '';
  } catch {
    return '';
  }
};

describe.skipIf(!ENABLED)('Jira connector (live)', () => {
  const BASE = env('JIRA_BASE_URL').replace(/\/+$/, '');
  const PROJECT_KEY = env('JIRA_PROJECT_KEY');
  const FIELD_NAME = env('JIRA_PROJECT_ID_FIELD') || 'ProjectID';
  const AUTH = 'Basic ' + Buffer.from(`${env('JIRA_EMAIL')}:${env('JIRA_API_TOKEN')}`).toString('base64');

  /** Real project codes from the OriginFlow projects table. */
  const CODES = ['MDA26003', 'MDA26010', 'MDA26004', 'MDA26038', 'CL26003AU'];

  let fieldId: string | null = null;

  const search = async (jql: string, fields: string[]): Promise<JiraSearchIssue[]> => {
    const res = await fetch(`${BASE}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, maxResults: 100 }),
    });
    // Read the body ONCE: putting `await res.text()` in the assertion message would
    // consume it eagerly and break the success path.
    const raw = await res.text();
    expect(res.status, `Jira search failed: ${raw.slice(0, 300)}`).toBe(200);
    const data: any = JSON.parse(raw);
    return data.issues || [];
  };

  beforeAll(async () => {
    const res = await fetch(`${BASE}/rest/api/3/field`, {
      headers: { Authorization: AUTH, Accept: 'application/json' },
    });
    expect(res.status).toBe(200);
    fieldId = findFieldByName(await res.json(), FIELD_NAME);
  });

  it(`resolves the "${'ProjectID'}" field to a custom field id`, () => {
    expect(fieldId).toMatch(/^customfield_\d+$/);
  });

  it('resolves every project code to exactly one Epic, verified against the field value', async () => {
    const issues = await search(buildJql(CODES, PROJECT_KEY, fieldId!), ['summary', 'status', 'issuetype', fieldId!]);

    const results: Record<string, CodeResult> = Object.fromEntries(
      CODES.map(c => [c, { issue: null, matchCount: 0, alternates: [] }]),
    );
    matchIssuesToCodes(CODES.map(c => ({ raw: c, code: c })), issues, results, BASE, fieldId!);

    for (const code of CODES) {
      const r = results[code];
      expect(r.issue, `${code} resolved to no Epic`).not.toBeNull();
      // The premise of the feature: one launch, one Epic.
      expect(r.matchCount, `${code} matched ${r.matchCount} Epics: ${[r.issue, ...r.alternates].map(i => i?.key).join(', ')}`).toBe(1);
      expect(r.issue!.key).toMatch(/^[A-Z]+-\d+$/);
      expect(r.issue!.issueType).toBe('Epic');
      expect(r.issue!.status.length).toBeGreaterThan(0);
      expect(r.issue!.url).toBe(`${BASE}/browse/${r.issue!.key}`);
    }
  });

  it('returns nothing at all for a code no Epic carries', async () => {
    const bogus = 'ZZZ99999NOPE';
    const issues = await search(buildJql([bogus], PROJECT_KEY, fieldId!), ['summary', 'status', fieldId!]);
    const results: Record<string, CodeResult> = { [bogus]: { issue: null, matchCount: 0, alternates: [] } };
    matchIssuesToCodes([{ raw: bogus, code: bogus }], issues, results, BASE, fieldId!);
    expect(results[bogus].issue).toBeNull();
  });

  it('excludes the gate sub-tickets that share a ProjectID', async () => {
    // MDA26003 has ~11 non-Epic gate tickets carrying the same ProjectID. Without
    // `issuetype = Epic` in the JQL, those would compete with the launch Epic.
    const withoutEpicFilter = `${PROJECT_KEY ? `project = "${PROJECT_KEY}" AND ` : ''}cf[${fieldId!.match(/\d+/)![0]}] ~ "\\"MDA26003\\""`;
    const all = await search(withoutEpicFilter, ['issuetype']);
    const epicsOnly = await search(buildJql(['MDA26003'], PROJECT_KEY, fieldId!), ['issuetype']);

    expect(all.length).toBeGreaterThan(1);
    expect(epicsOnly).toHaveLength(1);
    expect(all.filter(i => i.fields?.issuetype?.name !== 'Epic').length).toBeGreaterThan(0);
  });
});
