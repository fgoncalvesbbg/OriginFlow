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
  fieldText,
  findFieldByName,
  buildJql,
  toRef,
  issueMatchesCode,
  matchIssuesToCodes,
  MAX_ALTERNATES,
  type CodeResult,
  type JiraSearchIssue,
} from './jira-match';

/** The resolved "ProjectID" custom field on go-bbg; the numeric id differs per site. */
const PID = 'customfield_10050';
const FIELD = { kind: 'field', fieldId: PID } as const;
const SUMMARY = { kind: 'summary' } as const;
const TEXT = { kind: 'text' } as const;

const BASE = 'https://go-bbg.atlassian.net';

const issue = (
  key: string,
  summary: string,
  projectId?: unknown,
  statusName = 'In Progress',
  categoryKey = 'indeterminate',
): JiraSearchIssue => ({
  key,
  fields: {
    summary,
    ...(projectId === undefined ? {} : { [PID]: projectId }),
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
  it('queries the ProjectID custom field by numeric id, immune to a rename in Jira', () => {
    expect(buildJql(['MDA26003'], 'PL', FIELD)).toBe(
      'project = "PL" AND (cf[10050] ~ "\\"MDA26003\\"") ORDER BY updated DESC',
    );
  });

  it('quotes a non-numeric field id by name', () => {
    expect(buildJql(['MDA26003'], '', { kind: 'field', fieldId: 'ProjectID' })).toBe(
      '("ProjectID" ~ "\\"MDA26003\\"") ORDER BY updated DESC',
    );
  });

  it('scopes to the configured project and phrase-matches each code', () => {
    expect(buildJql(['MDA26010', 'CL26003AU'], 'PL', SUMMARY)).toBe(
      'project = "PL" AND (summary ~ "\\"MDA26010\\"" OR summary ~ "\\"CL26003AU\\"") ORDER BY updated DESC',
    );
  });

  it('omits the project clause when no project key is configured', () => {
    expect(buildJql(['MDA26010'], '', SUMMARY)).toBe(
      '(summary ~ "\\"MDA26010\\"") ORDER BY updated DESC',
    );
  });

  it('looks a Jira-key-shaped code up by key, since ~ would not find it', () => {
    expect(buildJql(['PL-42'], 'PL', SUMMARY)).toBe(
      'project = "PL" AND (key = "PL-42") ORDER BY updated DESC',
    );
  });

  it('widens to the text field on the last pass', () => {
    expect(buildJql(['MDA26010'], 'PL', TEXT)).toContain('text ~ "\\"MDA26010\\""');
  });
});

describe('toRef', () => {
  it('normalizes a Jira issue and builds the browse link', () => {
    expect(toRef(issue('PL-7', 'MDA26010 Audrey'), BASE, 'field')).toEqual({
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
      matchedBy: 'field',
    });
  });

  it('falls back safely when Jira omits fields', () => {
    const ref = toRef({ key: 'PL-8' }, BASE);
    expect(ref.status).toBe('Unknown');
    expect(ref.statusCategory).toBe('unknown');
    expect(ref.assignee).toBeUndefined();
  });

  it('maps an unrecognised status category to "unknown" rather than passing it through', () => {
    expect(toRef(issue('PL-9', 's', undefined, 'Weird', 'custom-bucket'), BASE).statusCategory).toBe('unknown');
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
      SUMMARY,
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
      SUMMARY,
    );
    expect(results['MDA26016'].issue?.key).toBe('PL-11');
    expect(results['MDA26016'].matchCount).toBe(1);
    expect(results['MDA26016AU'].issue?.key).toBe('PL-10');
    expect(results['MDA26016AU'].matchCount).toBe(1);
  });

  it('reports a code with no matching issue as not found', () => {
    const results = emptyResults(['MDA99999']);
    matchIssuesToCodes(pairs(['MDA99999']), [issue('PL-1', 'MDA26010 Audrey')], results, BASE, SUMMARY);
    expect(results['MDA99999']).toEqual({ issue: null, matchCount: 0, alternates: [] });
  });

  it('keeps the first (most recently updated) match as primary and the rest as alternates', () => {
    const results = emptyResults(['MDA26010']);
    matchIssuesToCodes(
      pairs(['MDA26010']),
      [issue('PL-newest', 'MDA26010 Audrey'), issue('PL-older', 'MDA26010 Audrey packaging')],
      results,
      BASE,
      SUMMARY,
    );
    expect(results['MDA26010'].issue?.key).toBe('PL-newest');
    expect(results['MDA26010'].matchCount).toBe(2);
    expect(results['MDA26010'].alternates.map(a => a.key)).toEqual(['PL-older']);
  });

  it('caps alternates but keeps counting matches, so ambiguity stays visible', () => {
    const results = emptyResults(['MDA26010']);
    const many = Array.from({ length: 10 }, (_, i) => issue(`PL-${i}`, 'MDA26010 Audrey'));
    matchIssuesToCodes(pairs(['MDA26010']), many, results, BASE, SUMMARY);
    expect(results['MDA26010'].matchCount).toBe(10);
    expect(results['MDA26010'].alternates).toHaveLength(MAX_ALTERNATES);
  });

  it('matches a Jira-key-shaped code by key, not by summary text', () => {
    const results = emptyResults(['PL-42']);
    matchIssuesToCodes(pairs(['PL-42']), [issue('PL-42', 'Something unrelated')], results, BASE, SUMMARY);
    expect(results['PL-42'].issue?.key).toBe('PL-42');
  });

  it('trusts Jira on the text pass, where the match may be in the description', () => {
    // The code appears nowhere in the summary; only the `text ~` pass can find it,
    // and we cannot re-verify a description we did not fetch.
    const results = emptyResults(['MDA26010']);
    matchIssuesToCodes(pairs(['MDA26010']), [issue('PL-5', 'Audrey hood')], results, BASE, TEXT);
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
      SUMMARY,
    );
    expect(results[' CL26002AU'].issue?.key).toBe('PL-3');
  });

  it('accumulates across the summary and text passes without double counting', () => {
    const codes = ['MDA26010', 'MDA99999'];
    const results = emptyResults(codes);
    matchIssuesToCodes(pairs(codes), [issue('PL-1', 'MDA26010 Audrey')], results, BASE, SUMMARY);
    // Second pass runs only for the codes still unmatched — mirroring the handler.
    const missing = pairs(codes).filter(c => results[c.raw].matchCount === 0);
    expect(missing.map(m => m.code)).toEqual(['MDA99999']);
    matchIssuesToCodes(missing, [issue('PL-9', 'Something with the code in the body')], results, BASE, TEXT);
    expect(results['MDA26010'].matchCount).toBe(1);
    expect(results['MDA99999'].issue?.key).toBe('PL-9');
  });
});

describe('fieldText', () => {
  it('reads the plain-string form of a text custom field', () => {
    expect(fieldText('MDA26003')).toBe('MDA26003');
    expect(fieldText('  MDA26003  ')).toBe('MDA26003');
  });

  it('reads select-list and multi-select forms', () => {
    // The same field comes back shaped differently depending on how it is configured
    // in Jira, and that configuration can change without us being told.
    expect(fieldText({ value: 'MDA26003' })).toBe('MDA26003');
    expect(fieldText({ name: 'MDA26003' })).toBe('MDA26003');
    expect(fieldText([{ value: 'MDA26003' }, { value: 'MDA26004' }])).toBe('MDA26003 MDA26004');
  });

  it('treats an unset field as empty rather than throwing', () => {
    expect(fieldText(null)).toBe('');
    expect(fieldText(undefined)).toBe('');
    expect(fieldText({})).toBe('');
  });
});

describe('findFieldByName', () => {
  const fields = [
    { id: 'summary', name: 'Summary' },
    { id: 'customfield_10050', name: 'ProjectID' },
    { id: 'customfield_10099', name: 'Project Lead' },
  ];

  it('resolves the field id by display name', () => {
    expect(findFieldByName(fields, 'ProjectID')).toBe('customfield_10050');
  });

  it('ignores case and spacing, so "Project ID" and "projectid" both resolve', () => {
    expect(findFieldByName(fields, 'Project ID')).toBe('customfield_10050');
    expect(findFieldByName(fields, 'projectid')).toBe('customfield_10050');
    expect(findFieldByName([{ id: 'cf_1', name: 'Project ID' }], 'ProjectID')).toBe('cf_1');
  });

  it('resolves a uniquely-prefixed name like "ProjectID (legacy)"', () => {
    expect(findFieldByName([{ id: 'cf_2', name: 'ProjectID (legacy)' }], 'ProjectID')).toBe('cf_2');
  });

  it('returns null when the name is missing or ambiguous, so the caller can fall back', () => {
    expect(findFieldByName(fields, 'LaunchCode')).toBeNull();
    expect(
      findFieldByName([{ id: 'a', name: 'ProjectID one' }, { id: 'b', name: 'ProjectID two' }], 'ProjectID'),
    ).toBeNull();
  });
});

describe('issueMatchesCode — ProjectID field strategy', () => {
  it('matches on an exact field value', () => {
    expect(issueMatchesCode(issue('PL-3', 'Nevora Induction White LED', 'MDA26003'), 'MDA26003', FIELD)).toBe(true);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(issueMatchesCode(issue('PL-3', 'x', '  mda26003 '), 'MDA26003', FIELD)).toBe(true);
  });

  it('rejects a fuzzy JQL hit whose field value is a different code', () => {
    // This is the whole point of re-verifying: Jira's ~ is tokenized and can return
    // near-misses, which would otherwise be shown as a confident match.
    expect(issueMatchesCode(issue('PL-4', 'MDA26003 mentioned here', 'MDA26099'), 'MDA26003', FIELD)).toBe(false);
  });

  it('does not fall back to the summary when the field is set but different', () => {
    expect(issueMatchesCode(issue('PL-5', 'MDA26003 Nevora', 'MDA26099'), 'MDA26003', FIELD)).toBe(false);
  });

  it('reports no match when the field is empty, leaving it to the summary pass', () => {
    expect(issueMatchesCode(issue('PL-6', 'MDA26003 Nevora'), 'MDA26003', FIELD)).toBe(false);
  });

  it('matches one code within a field that lists several', () => {
    expect(issueMatchesCode(issue('PL-7', 'x', 'MDA26003, MDA26004'), 'MDA26004', FIELD)).toBe(true);
  });

  it('still will not let a prefix code match a longer value', () => {
    expect(issueMatchesCode(issue('PL-8', 'x', 'MDA26016AU'), 'MDA26016', FIELD)).toBe(false);
  });
});

describe('matchIssuesToCodes — pass ordering', () => {
  it('records how each code was matched, so the UI can show how solid the link is', () => {
    const results = emptyResults(['MDA26003']);
    matchIssuesToCodes(pairs(['MDA26003']), [issue('PL-3', 'Nevora', 'MDA26003')], results, BASE, FIELD);
    expect(results['MDA26003'].issue?.matchedBy).toBe('field');
  });

  it('falls through to the summary only for codes the field pass did not resolve', () => {
    const codes = ['MDA26003', 'MDA26004'];
    const results = emptyResults(codes);

    // Pass 1: only MDA26003 has the ProjectID field filled in.
    matchIssuesToCodes(
      pairs(codes),
      [issue('PL-3', 'Nevora', 'MDA26003'), issue('PL-4', 'MDA26004 MisterCook')],
      results,
      BASE,
      FIELD,
    );
    expect(results['MDA26003'].issue?.key).toBe('PL-3');
    expect(results['MDA26004'].matchCount).toBe(0);

    // Pass 2 runs for the remainder — mirroring the handler's loop.
    const pending = pairs(codes).filter(c => results[c.raw].matchCount === 0);
    expect(pending.map(p => p.code)).toEqual(['MDA26004']);
    matchIssuesToCodes(pending, [issue('PL-4', 'MDA26004 MisterCook')], results, BASE, SUMMARY);

    expect(results['MDA26004'].issue?.key).toBe('PL-4');
    expect(results['MDA26004'].issue?.matchedBy).toBe('summary');
    // The already-resolved code must not be re-counted by the later pass.
    expect(results['MDA26003'].matchCount).toBe(1);
  });
});
