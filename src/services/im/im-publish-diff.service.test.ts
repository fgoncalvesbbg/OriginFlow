import { describe, it, expect } from 'vitest';
import { diffResolvedSections } from './im-publish-diff.service';
import type { ResolvedManual, ResolvedSection } from '../../types';

const section = (over: Partial<ResolvedSection>): ResolvedSection => ({
  id: 'sec-1',
  title: 'Safety',
  layout: 'standard' as ResolvedSection['layout'],
  parentId: null,
  order: 0,
  nodes: [{ type: 'html', id: 'n1', html: '<p>Hi</p>', text: 'Hi' }],
  ...over,
});

const manual = (sections: ResolvedSection[]): ResolvedManual => ({
  schemaVersion: 2,
  templateId: 't1',
  language: 'en',
  metadata: {} as ResolvedManual['metadata'],
  sections,
  searchIndex: [],
  warnings: [],
});

describe('diffResolvedSections', () => {
  it('reports nothing when sections are identical', () => {
    expect(diffResolvedSections(manual([section({})]), manual([section({})]))).toEqual([]);
  });

  it('is insensitive to object key order (jsonb round-trips reorder keys)', () => {
    // Same section, keys assembled in a different insertion order — as a stored
    // snapshot comes back from Postgres jsonb.
    const reordered = JSON.parse(JSON.stringify({
      nodes: [{ text: 'Hi', html: '<p>Hi</p>', id: 'n1', type: 'html' }],
      order: 0, parentId: null, layout: 'standard', title: 'Safety', id: 'sec-1',
    })) as ResolvedSection;
    expect(diffResolvedSections(manual([reordered]), manual([section({})]))).toEqual([]);
  });

  it('flags a content change as changed', () => {
    const next = section({ nodes: [{ type: 'html', id: 'n1', html: '<p>Bye</p>', text: 'Bye' }] });
    expect(diffResolvedSections(manual([section({})]), manual([next]))).toEqual([
      { sectionId: 'sec-1', title: 'Safety', kind: 'changed' },
    ]);
  });

  it('flags a pure position change as moved, not changed', () => {
    expect(diffResolvedSections(manual([section({})]), manual([section({ order: 3 })]))).toEqual([
      { sectionId: 'sec-1', title: 'Safety', kind: 'moved' },
    ]);
  });

  it('flags added and removed sections', () => {
    const prev = manual([section({})]);
    const next = manual([section({ id: 'sec-2', title: 'Cleaning' })]);
    expect(diffResolvedSections(prev, next)).toEqual([
      { sectionId: 'sec-2', title: 'Cleaning', kind: 'added' },
      { sectionId: 'sec-1', title: 'Safety', kind: 'removed' },
    ]);
  });

  it('treats undefined-valued keys as absent (stringify parity with stored JSON)', () => {
    const withUndefined = section({ skuScope: undefined });
    const without = JSON.parse(JSON.stringify(section({}))) as ResolvedSection;
    expect(diffResolvedSections(manual([without]), manual([withUndefined]))).toEqual([]);
  });
});
