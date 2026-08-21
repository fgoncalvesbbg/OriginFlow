import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calls, rows } = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; table: string; payload?: any; where?: any; onConflict?: string }>,
  rows: { value: [] as any[] },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  return {
    db: {
      select: vi.fn((table: string, options: any) => {
        calls.push({ op: 'select', table, where: options?.where });
        return Promise.resolve(rows.value);
      }),
      upsert: vi.fn((table: string, payload: any, options: any) => {
        calls.push({ op: 'upsert', table, payload, onConflict: options?.onConflict });
        return Promise.resolve();
      }),
      delete: vi.fn((table: string, options: any) => {
        calls.push({ op: 'delete', table, where: options?.where });
        return Promise.resolve();
      }),
    },
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import {
  parseRegulationChecklist,
  checklistItemKey,
  buildTemplateChecklist,
  getChecklistState,
  setChecklistItemState,
  getTemplateChecklistState,
  setTemplateChecklistItemState,
  summarizeChecklist,
} from './regulation-checklist';
import type { Regulation, TemplateRegulation } from '../../types';

const regulation = (over: Partial<Regulation> = {}): Regulation => ({
  id: 'reg-1',
  title: 'Ecodesign requirements',
  referenceCode: '(EU) 2019/2016',
  summaryBytes: 0,
  applicableCategories: [],
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const assignment = (reg: Regulation, over: Partial<TemplateRegulation> = {}): TemplateRegulation => ({
  id: `tr-${reg.id}`,
  templateId: 'tpl-1',
  regulationId: reg.id,
  createdAt: '2026-01-01T00:00:00Z',
  source: 'explicit',
  regulation: reg,
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  rows.value = [];
});

describe('parseRegulationChecklist', () => {
  it('takes one item per line and strips pasted bullet markers', () => {
    expect(parseRegulationChecklist('- Energy label enclosed\n* QR code resolves\n• DoC signed'))
      .toEqual(['Energy label enclosed', 'QR code resolves', 'DoC signed']);
  });

  it('drops blank lines and tolerates an absent checklist', () => {
    expect(parseRegulationChecklist('A\n\n  \nB')).toEqual(['A', 'B']);
    expect(parseRegulationChecklist(undefined)).toEqual([]);
    expect(parseRegulationChecklist(null)).toEqual([]);
  });

  it('keeps a numbered list numbered, and keeps a leading minus sign that is not a bullet', () => {
    expect(parseRegulationChecklist('1. First\n2. Second')).toEqual(['1. First', '2. Second']);
    expect(parseRegulationChecklist('-20°C storage marking')).toEqual(['-20°C storage marking']);
  });
});

describe('checklistItemKey', () => {
  it('absorbs pure formatting — markers, whitespace, case, trailing punctuation', () => {
    const base = checklistItemKey('Energy label enclosed');
    expect(checklistItemKey('  energy   label enclosed  ')).toBe(base);
    expect(checklistItemKey('- Energy label enclosed.')).toBe(base);
    expect(checklistItemKey('ENERGY LABEL ENCLOSED;')).toBe(base);
  });

  it('changes when the obligation is reworded, so the confirmation is not carried over', () => {
    expect(checklistItemKey('Energy label enclosed'))
      .not.toBe(checklistItemKey('Energy label enclosed in the packaging'));
  });

  it('distinguishes items that differ only in a number', () => {
    expect(checklistItemKey('Minimum 5 year spare part availability'))
      .not.toBe(checklistItemKey('Minimum 7 year spare part availability'));
  });
});

describe('buildTemplateChecklist', () => {
  it('combines the items of every applying regulation, in order', () => {
    const items = buildTemplateChecklist([
      assignment(regulation({ id: 'r1', referenceCode: 'A', checklist: 'First\nSecond' })),
      assignment(regulation({ id: 'r2', referenceCode: 'B', checklist: 'Third' })),
    ]);
    expect(items.map((i) => i.text)).toEqual(['First', 'Second', 'Third']);
    expect(items.map((i) => i.regulationReferences)).toEqual([['A'], ['A'], ['B']]);
  });

  it('merges an identical obligation stated by two regulations into ONE tickable item', () => {
    const items = buildTemplateChecklist([
      assignment(regulation({ id: 'r1', referenceCode: 'A', checklist: 'WEEE symbol on the rating plate' })),
      assignment(regulation({ id: 'r2', referenceCode: 'B', checklist: '- weee symbol on the rating plate.' })),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].regulationIds).toEqual(['r1', 'r2']);
    expect(items[0].regulationReferences).toEqual(['A', 'B']);
    // The first wording encountered is the one displayed.
    expect(items[0].text).toBe('WEEE symbol on the rating plate');
  });

  it('does not duplicate a regulation that repeats its own item', () => {
    const items = buildTemplateChecklist([
      assignment(regulation({ id: 'r1', referenceCode: 'A', checklist: 'Same item\nSame item.' })),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].regulationIds).toEqual(['r1']);
  });

  it('includes category-derived assignments, which apply just as much as explicit ones', () => {
    const items = buildTemplateChecklist([
      assignment(regulation({ id: 'r1', referenceCode: 'A', checklist: 'From a category' }),
        { source: 'category', id: 'derived:r1' }),
    ]);
    expect(items.map((i) => i.text)).toEqual(['From a category']);
  });

  it('ignores regulations with no checklist, and an assignment whose library row vanished', () => {
    expect(buildTemplateChecklist([
      assignment(regulation({ id: 'r1', checklist: undefined })),
      assignment(regulation({ id: 'r2', checklist: '   ' })),
      { ...assignment(regulation({ id: 'r3' })), regulation: undefined },
    ])).toEqual([]);
  });
});

describe('getChecklistState / setChecklistItemState', () => {
  it('reads one manual’s confirmations keyed by item', async () => {
    rows.value = [
      { item_key: 'k1', status: 'done', note: null, updated_by: 'a@b.c', updated_at: '2026-08-21T10:00:00Z' },
      { item_key: 'k2', status: 'na', note: 'no water circuit', updated_by: null, updated_at: '2026-08-21T11:00:00Z' },
    ];
    const state = await getChecklistState('proj-1', 'im');
    expect(state.k1).toEqual({ status: 'done', note: undefined, updatedBy: 'a@b.c', updatedAt: '2026-08-21T10:00:00Z' });
    expect(state.k2.status).toBe('na');
    expect(state.k2.note).toBe('no water circuit');
    expect(calls[0]).toMatchObject({
      op: 'select',
      table: 'im_regulatory_checklist_state',
      where: { project_id: 'proj-1', template_type: 'im' },
    });
  });

  it('scopes reads to ONE manual — the leaflet is not the manual', async () => {
    await getChecklistState('proj-1', 'warning_leaflet');
    expect(calls[0].where).toEqual({ project_id: 'proj-1', template_type: 'warning_leaflet' });
  });

  it('returns nothing without a project rather than reading the whole table', async () => {
    expect(await getChecklistState('', 'im')).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('upserts on the (project, type, item) key so re-deciding an item overwrites it', async () => {
    await setChecklistItemState('proj-1', 'im', 'k1', 'done', { actor: 'a@b.c' });
    expect(calls[0]).toMatchObject({
      op: 'upsert',
      table: 'im_regulatory_checklist_state',
      onConflict: 'project_id,template_type,item_key',
    });
    expect(calls[0].payload).toMatchObject({
      project_id: 'proj-1', template_type: 'im', item_key: 'k1', status: 'done', updated_by: 'a@b.c',
    });
  });

  it('stores a note with na, and normalizes a blank note to null', async () => {
    await setChecklistItemState('proj-1', 'im', 'k1', 'na', { note: '  no water circuit  ' });
    expect(calls[0].payload.note).toBe('no water circuit');
    await setChecklistItemState('proj-1', 'im', 'k2', 'done', { note: '   ' });
    expect(calls[1].payload.note).toBeNull();
  });

  it('DELETES the row to clear a decision — unreviewed is the absence of a row', async () => {
    await setChecklistItemState('proj-1', 'im', 'k1', null);
    expect(calls[0]).toMatchObject({
      op: 'delete',
      table: 'im_regulatory_checklist_state',
      where: { project_id: 'proj-1', template_type: 'im', item_key: 'k1' },
    });
  });
});

describe('summarizeChecklist', () => {
  const items = [
    { key: 'a', text: 'A', regulationIds: [], regulationReferences: [] },
    { key: 'b', text: 'B', regulationIds: [], regulationReferences: [] },
    { key: 'c', text: 'C', regulationIds: [], regulationReferences: [] },
  ];

  it('counts confirmed, not-applicable and unreviewed', () => {
    expect(summarizeChecklist(items, {
      a: { status: 'done', updatedAt: 'x' },
      b: { status: 'na', updatedAt: 'x' },
    })).toEqual({ total: 3, done: 1, na: 1, open: 1, complete: false });
  });

  it('is complete when every item is decided either way', () => {
    expect(summarizeChecklist(items, {
      a: { status: 'done', updatedAt: 'x' },
      b: { status: 'na', updatedAt: 'x' },
      c: { status: 'done', updatedAt: 'x' },
    }).complete).toBe(true);
  });

  it('an empty checklist is not "complete" — there is nothing to confirm', () => {
    expect(summarizeChecklist([], {})).toEqual({ total: 0, done: 0, na: 0, open: 0, complete: false });
  });

  it('ignores stale rows for items that no longer exist', () => {
    expect(summarizeChecklist(items, { gone: { status: 'done', updatedAt: 'x' } }).done).toBe(0);
  });
});

describe('template scope (migration 120) — the author’s readiness gate', () => {
  it('reads one template’s confirmations from its OWN table', async () => {
    rows.value = [
      { item_key: 'k1', status: 'done', note: null, updated_by: 'author@b.c', updated_at: '2026-08-21T09:00:00Z' },
    ];
    const state = await getTemplateChecklistState('tpl-1');
    expect(state.k1).toEqual({
      status: 'done', note: undefined, updatedBy: 'author@b.c', updatedAt: '2026-08-21T09:00:00Z',
    });
    expect(calls[0]).toMatchObject({
      op: 'select',
      table: 'im_regulatory_checklist_template_state',
      where: { template_id: 'tpl-1' },
    });
  });

  it('returns nothing without a template rather than reading the whole table', async () => {
    expect(await getTemplateChecklistState('')).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('upserts on (template, item) so re-deciding overwrites', async () => {
    await setTemplateChecklistItemState('tpl-1', 'k1', 'na', { note: 'leaflet has no packaging insert', actor: 'author@b.c' });
    expect(calls[0]).toMatchObject({
      op: 'upsert',
      table: 'im_regulatory_checklist_template_state',
      onConflict: 'template_id,item_key',
    });
    expect(calls[0].payload).toMatchObject({
      template_id: 'tpl-1', item_key: 'k1', status: 'na',
      note: 'leaflet has no packaging insert', updated_by: 'author@b.c',
    });
  });

  it('DELETES to clear a decision', async () => {
    await setTemplateChecklistItemState('tpl-1', 'k1', null);
    expect(calls[0]).toMatchObject({
      op: 'delete',
      table: 'im_regulatory_checklist_template_state',
      where: { template_id: 'tpl-1', item_key: 'k1' },
    });
  });

  it('writes the template decision WITHOUT touching the per-manual table', async () => {
    await setTemplateChecklistItemState('tpl-1', 'k1', 'done');
    expect(calls.map(c => c.table)).toEqual(['im_regulatory_checklist_template_state']);
  });

  it('keys both scopes with the same function, so one can be shown beside the other', async () => {
    // Not a tautology: the two scopes are separate tables, and a divergent key here would
    // silently stop the template's decision lining up with the manual's for the same item.
    const key = checklistItemKey('Energy label is enclosed');
    await setTemplateChecklistItemState('tpl-1', key, 'done');
    await setChecklistItemState('proj-1', 'im', key, 'done');
    expect(calls[0].payload.item_key).toBe(calls[1].payload.item_key);
  });

  it('summarizes template progress with the same helper as the manual scope', () => {
    const items = buildTemplateChecklist([
      assignment(regulation({ id: 'r1', referenceCode: 'A', checklist: 'One\nTwo\nThree' })),
    ]);
    expect(summarizeChecklist(items, {
      [items[0].key]: { status: 'done', updatedAt: 'x' },
      [items[1].key]: { status: 'na', updatedAt: 'x' },
    })).toEqual({ total: 3, done: 1, na: 1, open: 1, complete: false });
  });
});
