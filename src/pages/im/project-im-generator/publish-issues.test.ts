import { describe, it, expect } from 'vitest';
import {
  fillAnchors,
  groupPublishIssues,
  summarizePublishIssues,
  type PublishIssue,
} from './publish-issues';

const issue = (over: Partial<PublishIssue> & Pick<PublishIssue, 'key' | 'kind'>): PublishIssue => ({
  label: over.label ?? over.key,
  target: over.target ?? null,
  ...over,
});

describe('summarizePublishIssues', () => {
  it('separates what blocks a publish from what is merely worth reviewing', () => {
    const summary = summarizePublishIssues([
      issue({ key: 'b', kind: 'blocking' }),
      issue({ key: 'v', kind: 'value' }),
      issue({ key: 't', kind: 'translation', lang: 'de' }),
    ]);
    expect(summary).toEqual({ total: 3, blocking: 1, advisory: 2 });
  });

  it('reports an empty manual review as complete rather than as unknown', () => {
    expect(summarizePublishIssues([])).toEqual({ total: 0, blocking: 0, advisory: 0 });
  });
});

describe('groupPublishIssues', () => {
  it('collects each kind into one group, in the order the kinds first appear', () => {
    const groups = groupPublishIssues([
      issue({ key: 'v1', kind: 'value' }),
      issue({ key: 's1', kind: 'slot' }),
      // A second value issue found further down the manual still lands in the first group.
      issue({ key: 'v2', kind: 'value' }),
    ]);
    expect(groups.map((g) => [g.key, g.issues.map((i) => i.key)])).toEqual([
      ['value', ['v1', 'v2']],
      ['slot', ['s1']],
    ]);
  });

  it('splits translations per language — one list to work through per language', () => {
    const groups = groupPublishIssues([
      issue({ key: 'de:a', kind: 'translation', lang: 'de' }),
      issue({ key: 'fr:a', kind: 'translation', lang: 'fr' }),
      issue({ key: 'de:b', kind: 'translation', lang: 'de' }),
    ]);
    expect(groups.map((g) => [g.lang, g.issues.length])).toEqual([['de', 2], ['fr', 1]]);
    expect(groups.map((g) => g.key)).toEqual(['translation:de', 'translation:fr']);
  });

  it('returns nothing for a manual with no gaps', () => {
    expect(groupPublishIssues([])).toEqual([]);
  });
});

describe('fillAnchors', () => {
  it('namespaces each kind of target, so a slot named like an attribute cannot collide', () => {
    expect(fillAnchors.value('power')).not.toBe(fillAnchors.slot('power'));
    expect(fillAnchors.condition('sec-1')).not.toBe(fillAnchors.section('sec-1'));
  });

  it('embeds the id verbatim — the producer and the jump must build the same string', () => {
    expect(fillAnchors.value('attr-123')).toBe('value:attr-123');
    expect(fillAnchors.slot('dimensions_table')).toBe('slot:dimensions_table');
  });
});
