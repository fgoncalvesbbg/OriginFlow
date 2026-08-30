/**
 * Tests for the Jira code→issue matching rules (netlify/functions/lib/jira-match.ts).
 *
 * The risk this covers: OriginFlow launch codes overlap each other ("MDA26016" is a
 * prefix of "MDA26016AU"), and Jira's `~` operator is a fuzzy text match, so a naive
 * substring check would silently attach the wrong ticket to a project.
 */

import { describe, it, expect } from 'vitest';
import {
  SAFE_CODE,
  ISSUE_KEY,
  containsCode,
  buildJql,
  toRef,
  matchIssuesToCodes,
  MAX_ALTERNATES,
  type CodeResult,
  type JiraSearchIssue,
} from './jira-match';

const BASE = 'https://go-bbg.atlassian.net';

const issue = (key: string, summary: string, statusName = 'In Progress', categoryKey = 'indeterminate'): JiraSearchIssue => ({
  key,
  fields: {
    summary,
    status: { name: statusName, statusCategory: { key: categoryKey } },
    issuetype: { name: 'Task' },
    assignee: { displayName: 'Fabio Goncalves' },
    priority: { name: 'Medium' },
    updated: '2026-08-29T10:00:00.000+0000',
    duedate: '2026-09-15',
  },
});

const emptyResults = (codes: string[]): Record<string, CodeResult> =>
  Object.fromEntries(codes.map(c => [c, { issue: null, matchCount: 0, alternates: [] }]));

const pairs = (codes: string[]) => codes.map(c => ({ raw: c, code: c.trim() }));

describe('containsCode', () => {
  it('matches a launch code as a whole token', () => {
    expect(containsCode('MDA26010 Audrey hood', 'MDA26010')).toBe(true);
    expect(containsCode('[MDA26010] Audrey', 'MDA26010')).toBe(true);
    expect(containsCode('Audrey (MDA26010)', 'MDA26010')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(containsCode('mda26010 audrey', 'MDA26010')).toBe(true);
  });

  it('does NOT match a code glued to more alphanumerics', () => {
    // The bug this guards: MDA26016 must not claim the MDA26016AU ticket.
    expect(containsCode('MDA26016AU Bovella 27Duo AU', 'MDA26016')).toBe(false);
    expect(containsCode('XMDA26010', 'MDA26010')).toBe(false);
  });

  it('matches the longer code against its own summary', () => {
    expect(containsCode('MDA26016AU Bovella 27Duo AU', 'MDA26016AU')).toBe(true);
  });

  it('handles multi-word codes and regex metacharacters literally', () => {
    expect(containsCode('Test Pergolas rollout', 'Test Pergolas')).toBe(true);
    expect(containsCode('a.b launch', 'a.b')).toBe(true);
    expect(containsCode('axb launch', 'a.b')).toBe(false);
  });
});

describe('SAFE_CODE / ISSUE_KEY', () => {
  it('accepts the codes actually in the projects table', () => {
    for (const c of ['MDA26010', 'CL26003AU', 'MDA1111', 'Test Pergolas', 'MDA111TEst']) {
      expect(SAFE_CODE.test(c)).toBe(true);
    }
  });

  it('rejects anything that could break out of a JQL quoted string', () => {
    expect(SAFE_CODE.test('MDA"26010')).toBe(false);
    expect(SAFE_CODE.test('MDA\\26010')).toBe(false);
    expect(SAFE_CODE.test('')).toBe(false);
  });

  it('recognises codes that are already Jira issue keys', () => {
    expect(ISSUE_KEY.test('PL-123')).toBe(true);
    expect(ISSUE_KEY.test('MDA26010')).toBe(false);
    expect(ISSUE_KEY.test('Test Pergolas')).toBe(false);
  });
});

describe('buildJql', () => {
  it('scopes to the configured project and phrase-matches each code', () => {
    expect(buildJql(['MDA26010', 'CL26003AU'], 'PL', 'summary')).toBe(
      'project = "PL" AND (summary ~ "\\"MDA26010\\"" OR summary ~ "\\"CL26003AU\\"") ORDER BY updated DESC',
    );
  });

  it('omits the project clause when no project key is configured', () => {
    expect(buildJql(['MDA26010'], '', 'summary')).toBe(
      '(summary ~ "\\"MDA26010\\"") ORDER BY updated DESC',
    );
  });

  it('looks a Jira-key-shaped code up by key, since ~ would not find it', () => {
    expect(buildJql(['PL-42'], 'PL', 'summary')).toBe(
      'project = "PL" AND (key = "PL-42") ORDER BY updated DESC',
    );
  });

  it('widens to the text field on the second pass', () => {
    expect(buildJql(['MDA26010'], 'PL', 'text')).toContain('text ~ "\\"MDA26010\\""');
  });
});

describe('toRef', () => {
  it('normalizes a Jira issue and builds the browse link', () => {
    expect(toRef(issue('PL-7', 'MDA26010 Audrey'), BASE)).toEqual({
      key: 'PL-7',
      url: 'https://go-bbg.atlassian.net/browse/PL-7',
      summary: 'MDA26010 Audrey',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      issueType: 'Task',
      assignee: 'Fabio Goncalves',
      priority: 'Medium',
      updated: '2026-08-29T10:00:00.000+0000',
      dueDate: '2026-09-15',
    });
  });

  it('falls back safely when Jira omits fields', () => {
    const ref = toRef({ key: 'PL-8' }, BASE);
    expect(ref.status).toBe('Unknown');
    expect(ref.statusCategory).toBe('unknown');
    expect(ref.assignee).toBeUndefined();
  });

  it('maps an unrecognised status category to "unknown" rather than passing it through', () => {
    expect(toRef(issue('PL-9', 's', 'Weird', 'custom-bucket'), BASE).statusCategory).toBe('unknown');
  });
});

describe('matchIssuesToCodes', () => {
  it('assigns each issue to the code its summary actually contains', () => {
    const codes = ['MDA26010', 'CL26003AU'];
    const results = emptyResults(codes);
    matchIssuesToCodes(
      pairs(codes),
      [issue('PL-1', 'MDA26010 Audrey'), issue('PL-2', 'CL26003AU AireLux Smart AU')],
      results,
      BASE,
      'summary',
    );
    expect(results['MDA26010'].issue?.key).toBe('PL-1');
    expect(results['CL26003AU'].issue?.key).toBe('PL-2');
    expect(results['MDA26010'].matchCount).toBe(1);
  });

  it('does not let a prefix code steal a longer code’s issue', () => {
    // Both codes go out in one batched JQL, so both issues come back in one flat
    // list — the boundary recheck is the only thing keeping them apart.
    const codes = ['MDA26016', 'MDA26016AU'];
    const results = emptyResults(codes);
    matchIssuesToCodes(
      pairs(codes),
      [issue('PL-10', 'MDA26016AU Bovella 27Duo AU'), issue('PL-11', 'MDA26016 Shiraz Premium')],
      results,
      BASE,
      'summary',
    );
    expect(results['MDA26016'].issue?.key).toBe('PL-11');
    expect(results['MDA26016'].matchCount).toBe(1);
    expect(results['MDA26016AU'].issue?.key).toBe('PL-10');
    expect(results['MDA26016AU'].matchCount).toBe(1);
  });

  it('reports a code with no matching issue as not found', () => {
    const results = emptyResults(['MDA99999']);
    matchIssuesToCodes(pairs(['MDA99999']), [issue('PL-1', 'MDA26010 Audrey')], results, BASE, 'summary');
    expect(results['MDA99999']).toEqual({ issue: null, matchCount: 0, alternates: [] });
  });

  it('keeps the first (most recently updated) match as primary and the rest as alternates', () => {
    const results = emptyResults(['MDA26010']);
    matchIssuesToCodes(
      pairs(['MDA26010']),
      [issue('PL-newest', 'MDA26010 Audrey'), issue('PL-older', 'MDA26010 Audrey packaging')],
      results,
      BASE,
      'summary',
    );
    expect(results['MDA26010'].issue?.key).toBe('PL-newest');
    expect(results['MDA26010'].matchCount).toBe(2);
    expect(results['MDA26010'].alternates.map(a => a.key)).toEqual(['PL-older']);
  });

  it('caps alternates but keeps counting matches, so ambiguity stays visible', () => {
    const results = emptyResults(['MDA26010']);
    const many = Array.from({ length: 10 }, (_, i) => issue(`PL-${i}`, 'MDA26010 Audrey'));
    matchIssuesToCodes(pairs(['MDA26010']), many, results, BASE, 'summary');
    expect(results['MDA26010'].matchCount).toBe(10);
    expect(results['MDA26010'].alternates).toHaveLength(MAX_ALTERNATES);
  });

  it('matches a Jira-key-shaped code by key, not by summary text', () => {
    const results = emptyResults(['PL-42']);
    matchIssuesToCodes(pairs(['PL-42']), [issue('PL-42', 'Something unrelated')], results, BASE, 'summary');
    expect(results['PL-42'].issue?.key).toBe('PL-42');
  });

  it('trusts Jira on the text pass, where the match may be in the description', () => {
    // The code appears nowhere in the summary; only the `text ~` pass can find it,
    // and we cannot re-verify a description we did not fetch.
    const results = emptyResults(['MDA26010']);
    matchIssuesToCodes(pairs(['MDA26010']), [issue('PL-5', 'Audrey hood')], results, BASE, 'text');
    expect(results['MDA26010'].issue?.key).toBe('PL-5');
  });

  it('keys results by the caller’s original string while searching the trimmed code', () => {
    // " CL26002AU" is a real row in the projects table (leading space).
    const results = emptyResults([' CL26002AU']);
    matchIssuesToCodes(
      [{ raw: ' CL26002AU', code: 'CL26002AU' }],
      [issue('PL-3', 'CL26002AU Dryfy Connect AU')],
      results,
      BASE,
      'summary',
    );
    expect(results[' CL26002AU'].issue?.key).toBe('PL-3');
  });

  it('accumulates across the summary and text passes without double counting', () => {
    const codes = ['MDA26010', 'MDA99999'];
    const results = emptyResults(codes);
    matchIssuesToCodes(pairs(codes), [issue('PL-1', 'MDA26010 Audrey')], results, BASE, 'summary');
    // Second pass runs only for the codes still unmatched — mirroring the handler.
    const missing = pairs(codes).filter(c => results[c.raw].matchCount === 0);
    expect(missing.map(m => m.code)).toEqual(['MDA99999']);
    matchIssuesToCodes(missing, [issue('PL-9', 'Something with the code in the body')], results, BASE, 'text');
    expect(results['MDA26010'].matchCount).toBe(1);
    expect(results['MDA99999'].issue?.key).toBe('PL-9');
  });
});
