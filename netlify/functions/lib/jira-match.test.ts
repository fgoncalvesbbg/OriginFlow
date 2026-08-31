/**
 * Tests for the Jira code→Epic matching rule (netlify/functions/lib/jira-match.ts).
 *
 * The risks these cover:
 *  - OriginFlow launch codes overlap ("MDA26016" is a prefix of "MDA26016AU"), and
 *    Jira's `~` is a fuzzy tokenized match, so a substring check would cross-assign.
 *  - Each project code also has ~10-17 non-Epic gate sub-tickets carrying the same
 *    ProjectID; picking one of those would show a gate status as the launch stage.
 *
 * Field id and status vocabulary below are the real ones from go-bbg (project PL).
 */

import { describe, it, expect } from 'vitest';
import {
  SAFE_CODE,
  containsCode,
  fieldText,
  findFieldByName,
  jqlFieldRef,
  buildJql,
  toRef,
  issueMatchesCode,
  matchIssuesToCodes,
  MAX_ALTERNATES,
  type CodeResult,
  type JiraSearchIssue,
} from './jira-match';

/** The real "ProjectID" field id on go-bbg; it differs per Jira site. */
const PID = 'customfield_10260';
const BASE = 'https://go-bbg.atlassian.net';

/** An Epic as Jira returns it, with its ProjectID field populated. */
const epic = (
  key: string,
  summary: string,
  projectId?: unknown,
  statusName = 'Gates',
  categoryKey = 'indeterminate',
): JiraSearchIssue => ({
  key,
  fields: {
    summary,
    ...(projectId === undefined ? {} : { [PID]: projectId }),
    status: { name: statusName, statusCategory: { key: categoryKey } },
    issuetype: { name: 'Epic' },
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
    expect(containsCode('MDA26010', 'MDA26010')).toBe(true);
    expect(containsCode('MDA26003, MDA26004', 'MDA26004')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(containsCode(' mda26010 ', 'MDA26010')).toBe(true);
  });

  it('does NOT match a code glued to more alphanumerics', () => {
    // The bug this guards: MDA26016 must not claim the MDA26016AU Epic.
    expect(containsCode('MDA26016AU', 'MDA26016')).toBe(false);
    expect(containsCode('XMDA26010', 'MDA26010')).toBe(false);
  });

  it('matches the longer code against its own value', () => {
    expect(containsCode('MDA26016AU', 'MDA26016AU')).toBe(true);
  });

  it('treats regex metacharacters in a code literally', () => {
    expect(containsCode('a.b', 'a.b')).toBe(true);
    expect(containsCode('axb', 'a.b')).toBe(false);
  });
});

describe('SAFE_CODE', () => {
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
});

describe('jqlFieldRef', () => {
  it('uses the cf[id] form, which survives the field being renamed in Jira', () => {
    expect(jqlFieldRef(PID)).toBe('cf[10260]');
  });

  it('quotes a non-numeric field id by name', () => {
    expect(jqlFieldRef('ProjectID')).toBe('"ProjectID"');
  });
});

describe('buildJql', () => {
  it('restricts to Epics in the configured project and matches on the ProjectID field', () => {
    // issuetype = Epic is part of the contract: without it each code also returns its
    // ~10-17 gate sub-tickets, whose statuses are not the launch stage.
    expect(buildJql(['MDA26003'], 'PL', PID)).toBe(
      'project = "PL" AND issuetype = Epic AND (cf[10260] ~ "\\"MDA26003\\"") ORDER BY updated DESC',
    );
  });

  it('ORs every code into one query, so a whole dashboard costs one round trip', () => {
    expect(buildJql(['MDA26003', 'CL26003AU'], 'PL', PID)).toBe(
      'project = "PL" AND issuetype = Epic AND ' +
        '(cf[10260] ~ "\\"MDA26003\\"" OR cf[10260] ~ "\\"CL26003AU\\"") ORDER BY updated DESC',
    );
  });

  it('still restricts to Epics when no project key is configured', () => {
    expect(buildJql(['MDA26003'], '', PID)).toBe(
      'issuetype = Epic AND (cf[10260] ~ "\\"MDA26003\\"") ORDER BY updated DESC',
    );
  });
});

describe('fieldText', () => {
  it('reads the plain-string form the field actually uses on go-bbg', () => {
    expect(fieldText('MDA26003')).toBe('MDA26003');
    expect(fieldText('  MDA26003  ')).toBe('MDA26003');
  });

  it('reads select-list and multi-select forms, in case the field is reconfigured', () => {
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
    { id: PID, name: 'ProjectID' },
    { id: 'customfield_10099', name: 'Project Lead' },
  ];

  it('resolves the field id by display name', () => {
    expect(findFieldByName(fields, 'ProjectID')).toBe(PID);
  });

  it('ignores case and spacing, so "Project ID" and "projectid" both resolve', () => {
    expect(findFieldByName(fields, 'Project ID')).toBe(PID);
    expect(findFieldByName(fields, 'projectid')).toBe(PID);
    expect(findFieldByName([{ id: 'cf_1', name: 'Project ID' }], 'ProjectID')).toBe('cf_1');
  });

  it('resolves a uniquely-prefixed name like "ProjectID (legacy)"', () => {
    expect(findFieldByName([{ id: 'cf_2', name: 'ProjectID (legacy)' }], 'ProjectID')).toBe('cf_2');
  });

  it('returns null when the name is missing or ambiguous', () => {
    // The handler turns null into a hard error rather than guessing from the summary.
    expect(findFieldByName(fields, 'LaunchCode')).toBeNull();
    expect(
      findFieldByName([{ id: 'a', name: 'ProjectID one' }, { id: 'b', name: 'ProjectID two' }], 'ProjectID'),
    ).toBeNull();
  });
});

describe('toRef', () => {
  it('normalizes an Epic and builds the browse link', () => {
    expect(toRef(epic('PL-2516', 'MDA26003 - White LED Display Induction Hob', 'MDA26003', 'PO PLACEMENT'), BASE)).toEqual({
      key: 'PL-2516',
      url: 'https://go-bbg.atlassian.net/browse/PL-2516',
      summary: 'MDA26003 - White LED Display Induction Hob',
      status: 'PO PLACEMENT',
      statusCategory: 'indeterminate',
      issueType: 'Epic',
      assignee: 'Fabio Goncalves',
      priority: 'Medium',
      updated: '2026-08-29T10:00:00.000+0000',
      dueDate: '2026-09-15',
    });
  });

  it('preserves Jira’s own status wording rather than reformatting it', () => {
    // "PO PLACEMENT" and "Go Live" are the operators' vocabulary; title-casing would
    // turn "PO" into "Po".
    for (const name of ['RFQ CREATION', 'BUSINESS CASE', 'Gates', 'PO PLACEMENT', 'PRODUCTION', 'Go Live']) {
      expect(toRef(epic('PL-1', 's', 'MDA26003', name), BASE).status).toBe(name);
    }
  });

  it('falls back safely when Jira omits fields', () => {
    const ref = toRef({ key: 'PL-8' }, BASE);
    expect(ref.status).toBe('Unknown');
    expect(ref.statusCategory).toBe('unknown');
    expect(ref.assignee).toBeUndefined();
  });

  it('maps an unrecognised status category to "unknown" rather than passing it through', () => {
    expect(toRef(epic('PL-9', 's', 'MDA26003', 'Weird', 'custom-bucket'), BASE).statusCategory).toBe('unknown');
  });
});

describe('issueMatchesCode', () => {
  it('matches on an exact ProjectID value', () => {
    expect(issueMatchesCode(epic('PL-2516', 'White LED Induction Hob', 'MDA26003'), 'MDA26003', PID)).toBe(true);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(issueMatchesCode(epic('PL-2516', 'x', '  mda26003 '), 'MDA26003', PID)).toBe(true);
  });

  it('rejects a fuzzy JQL hit whose ProjectID is a different code', () => {
    // The whole point of re-verifying: Jira's ~ is tokenized and returns near-misses,
    // which would otherwise be presented as a confident match.
    expect(issueMatchesCode(epic('PL-4', 'MDA26003 mentioned here', 'MDA26099'), 'MDA26003', PID)).toBe(false);
  });

  it('does not fall back to the summary when the field says otherwise', () => {
    // Every Epic in PL has ProjectID set, so a summary fallback could only ever attach
    // the WRONG Epic. The summary is not consulted at all.
    expect(issueMatchesCode(epic('PL-5', 'MDA26003 - Nevora', 'MDA26099'), 'MDA26003', PID)).toBe(false);
    expect(issueMatchesCode(epic('PL-6', 'MDA26003 - Nevora'), 'MDA26003', PID)).toBe(false);
  });

  it('matches one code within a field that lists several', () => {
    expect(issueMatchesCode(epic('PL-7', 'x', 'MDA26003, MDA26004'), 'MDA26004', PID)).toBe(true);
  });

  it('will not let a prefix code match a longer value', () => {
    expect(issueMatchesCode(epic('PL-8', 'x', 'MDA26016AU'), 'MDA26016', PID)).toBe(false);
    expect(issueMatchesCode(epic('PL-9', 'x', 'MDA26016'), 'MDA26016AU', PID)).toBe(false);
  });
});

describe('matchIssuesToCodes', () => {
  it('assigns each Epic to the code its ProjectID field carries', () => {
    const codes = ['MDA26003', 'CL26003AU'];
    const results = emptyResults(codes);
    matchIssuesToCodes(
      pairs(codes),
      [
        epic('PL-2516', 'MDA26003 - White LED Display Induction Hob', 'MDA26003', 'PO PLACEMENT'),
        epic('PL-3307', 'CL26003AU - AireLux Portable AC AU', 'CL26003AU', 'PRODUCTION'),
      ],
      results,
      BASE,
      PID,
    );
    expect(results['MDA26003'].issue?.key).toBe('PL-2516');
    expect(results['MDA26003'].issue?.status).toBe('PO PLACEMENT');
    expect(results['CL26003AU'].issue?.key).toBe('PL-3307');
    expect(results['CL26003AU'].issue?.status).toBe('PRODUCTION');
    expect(results['MDA26003'].matchCount).toBe(1);
  });

  it('does not let a prefix code steal a longer code’s Epic', () => {
    // Both codes go out in one batched JQL, so both Epics come back in one flat list —
    // the boundary recheck is the only thing keeping them apart.
    const codes = ['MDA26016', 'MDA26016AU'];
    const results = emptyResults(codes);
    matchIssuesToCodes(
      pairs(codes),
      [epic('PL-10', 'Bovella 27Duo AU', 'MDA26016AU'), epic('PL-11', 'Shiraz Premium', 'MDA26016')],
      results,
      BASE,
      PID,
    );
    expect(results['MDA26016'].issue?.key).toBe('PL-11');
    expect(results['MDA26016'].matchCount).toBe(1);
    expect(results['MDA26016AU'].issue?.key).toBe('PL-10');
    expect(results['MDA26016AU'].matchCount).toBe(1);
  });

  it('reports a code with no Epic as not found', () => {
    const results = emptyResults(['MDA99999']);
    matchIssuesToCodes(pairs(['MDA99999']), [epic('PL-1', 'Audrey', 'MDA26010')], results, BASE, PID);
    expect(results['MDA99999']).toEqual({ issue: null, matchCount: 0, alternates: [] });
  });

  it('surfaces a duplicated ProjectID instead of silently picking a winner', () => {
    const results = emptyResults(['MDA26003']);
    matchIssuesToCodes(
      pairs(['MDA26003']),
      [epic('PL-newest', 'Hob', 'MDA26003'), epic('PL-older', 'Hob duplicate', 'MDA26003')],
      results,
      BASE,
      PID,
    );
    // ORDER BY updated DESC, so the first is the most recently touched.
    expect(results['MDA26003'].issue?.key).toBe('PL-newest');
    expect(results['MDA26003'].matchCount).toBe(2);
    expect(results['MDA26003'].alternates.map(a => a.key)).toEqual(['PL-older']);
  });

  it('caps alternates but keeps counting, so ambiguity stays visible', () => {
    const results = emptyResults(['MDA26003']);
    const many = Array.from({ length: 10 }, (_, i) => epic(`PL-${i}`, 'Hob', 'MDA26003'));
    matchIssuesToCodes(pairs(['MDA26003']), many, results, BASE, PID);
    expect(results['MDA26003'].matchCount).toBe(10);
    expect(results['MDA26003'].alternates).toHaveLength(MAX_ALTERNATES);
  });

  it('keys results by the caller’s original string while searching the trimmed code', () => {
    // " CL26002AU" is a real row in the projects table (leading space).
    const results = emptyResults([' CL26002AU']);
    matchIssuesToCodes(
      [{ raw: ' CL26002AU', code: 'CL26002AU' }],
      [epic('PL-3', 'Dryfy Connect AU', 'CL26002AU')],
      results,
      BASE,
      PID,
    );
    expect(results[' CL26002AU'].issue?.key).toBe('PL-3');
  });
});
