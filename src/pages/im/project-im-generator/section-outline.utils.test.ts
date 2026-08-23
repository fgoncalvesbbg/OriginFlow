import { describe, it, expect } from 'vitest';
import { buildSectionOutline, findExcludedAncestor, METADATA_SECTION_TITLE } from './section-outline.utils';

const node = (id: string, order: number, parentId: string | null = null, title = id) =>
  ({ id, order, parentId, title });

describe('buildSectionOutline', () => {
  it('numbers chapters and their sub-sections hierarchically', () => {
    const out = buildSectionOutline([
      node('a', 1), node('b', 2),
      node('a1', 1, 'a'), node('a2', 2, 'a'),
      node('a2x', 1, 'a2'),
    ]);
    expect(out['a']).toEqual({ prefix: '1.', level: 0 });
    expect(out['a1']).toEqual({ prefix: '1.1.', level: 1 });
    expect(out['a2']).toEqual({ prefix: '1.2.', level: 1 });
    expect(out['a2x']).toEqual({ prefix: '1.2.1.', level: 2 });
    expect(out['b']).toEqual({ prefix: '2.', level: 0 });
  });

  it('orders siblings by `order`, not by input order', () => {
    const out = buildSectionOutline([node('second', 2), node('first', 1)]);
    expect(out['first'].prefix).toBe('1.');
    expect(out['second'].prefix).toBe('2.');
  });

  it('skips metadata sections and does not let them consume a number', () => {
    const out = buildSectionOutline([
      node('meta', 1, null, METADATA_SECTION_TITLE),
      node('real', 2),
    ]);
    expect(out['meta']).toBeUndefined();
    // The operator sees one chapter, so it must be numbered "1." — a hidden row that ate
    // number 1 would make every number on screen wrong.
    expect(out['real'].prefix).toBe('1.');
  });

  it('treats a section whose parent is missing as a root', () => {
    // Orphans must stay listed: the resolver walks them as roots, so they publish.
    const out = buildSectionOutline([node('orphan', 1, 'gone')]);
    expect(out['orphan']).toEqual({ prefix: '1.', level: 0 });
  });

  it('terminates on a cyclic parent chain', () => {
    const out = buildSectionOutline([node('x', 1, 'y'), node('y', 1, 'x')]);
    // Neither is reachable from the root, so neither is numbered — but it must not hang.
    expect(Object.keys(out)).toEqual([]);
  });
});

describe('findExcludedAncestor', () => {
  const parents: Record<string, string | null> = { child: 'mid', mid: 'top', top: null };
  const parentOf = (id: string) => parents[id] ?? null;

  it('returns null when every ancestor is included', () => {
    expect(findExcludedAncestor('child', parentOf, () => false)).toBeNull();
  });

  it('names the nearest excluded ancestor', () => {
    expect(findExcludedAncestor('child', parentOf, id => id === 'top' || id === 'mid')).toBe('mid');
  });

  it('ignores the section itself — only ancestors count', () => {
    // A section excluded on its own account is reported as excluded, not as parent-excluded;
    // conflating the two would tell the operator to go fix the wrong row.
    expect(findExcludedAncestor('child', parentOf, id => id === 'child')).toBeNull();
  });

  it('terminates on a cyclic chain', () => {
    const cyclic: Record<string, string> = { a: 'b', b: 'a' };
    expect(findExcludedAncestor('a', id => cyclic[id], () => false)).toBeNull();
  });
});
