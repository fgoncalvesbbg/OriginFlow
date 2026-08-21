import { describe, it, expect, vi, beforeEach } from 'vitest';

// The port is mocked, not a driver client — same reasoning as im-tm-write.service.test.ts.
const { calls, results } = vi.hoisted(() => ({
  calls: [] as Array<{ op: string; table: string; payload?: any; where?: any; columns?: string }>,
  results: {
    rows: [] as any[],
    // Per-table override; falls back to `rows` so the single-table tests stay terse.
    byTable: {} as Record<string, any[]>,
    count: 0,
    deleteError: null as unknown,
  },
}));

vi.mock('../../data', async () => {
  const resilience = await import('../../data/resilience');
  return {
    db: {
      select: vi.fn((table: string, options: any) => {
        calls.push({ op: 'select', table, where: options?.where, columns: options?.columns });
        return Promise.resolve(results.byTable[table] ?? results.rows);
      }),
      selectMaybeOne: vi.fn((table: string, options: any) => {
        calls.push({ op: 'selectMaybeOne', table, where: options?.where, columns: options?.columns });
        return Promise.resolve(results.rows[0] ?? null);
      }),
      count: vi.fn((table: string, options: any) => {
        calls.push({ op: 'count', table, where: options?.where });
        return Promise.resolve(results.count);
      }),
      insert: vi.fn((table: string, row: any) => {
        calls.push({ op: 'insert', table, payload: row });
        return Promise.resolve({ id: 'reg-new', created_at: 'now', updated_at: 'now', ...row });
      }),
      updateWhere: vi.fn((table: string, values: any, options: any) => {
        calls.push({ op: 'updateWhere', table, payload: values, where: options?.where });
        return Promise.resolve();
      }),
      delete: vi.fn((table: string, options: any) => {
        calls.push({ op: 'delete', table, where: options?.where });
        return results.deleteError ? Promise.reject(results.deleteError) : Promise.resolve();
      }),
    },
    withDeadline: resilience.withDeadline,
    orEmpty: resilience.orEmpty,
    orUndefined: resilience.orUndefined,
  };
});

vi.mock('../../config/environment.config', () => ({ isLive: true }));

import {
  RegulationInUseError,
  createRegulation,
  deleteRegulation,
  getRegulationById,
  getRegulationUsageCounts,
  getRegulations,
  summaryByteLength,
  updateRegulation,
  MAX_SUMMARY_BYTES,
} from './regulation.service';

beforeEach(() => {
  calls.length = 0;
  results.rows = [];
  results.byTable = {};
  results.count = 0;
  results.deleteError = null;
});

const row = (over: Record<string, any> = {}) => ({
  id: 'reg-1',
  title: 'Energy labelling',
  reference_code: '(EU) 2019/2016',
  jurisdiction: 'EU',
  notes: null,
  summary_file_name: 'summary.md',
  summary_bytes: 4096,
  summary_uploaded_at: '2026-08-01',
  summary_uploaded_by: 'a@b.com',
  applicable_categories: ['cat-1'],
  status: 'active',
  superseded_by_id: null,
  created_by: 'a@b.com',
  created_at: '2026-08-01',
  updated_at: '2026-08-02',
  ...over,
});

describe('getRegulations', () => {
  it('projects an explicit column list that excludes summary_md', async () => {
    // A summary is up to 400 kB; without this projection, opening the library
    // downloads every one of them.
    results.rows = [row()];
    await getRegulations();
    const read = calls.find((c) => c.op === 'select' && c.table === 'regulations')!;
    expect(read.columns).toBeTruthy();
    expect(read.columns).not.toContain('summary_md');
    expect(read.columns).toContain('summary_bytes');
    // A plain comma-separated list, not PostgREST embed syntax — keeps PORTING.md honest.
    expect(read.columns).not.toMatch(/[()]/);
  });

  it('maps snake_case to camelCase and leaves summaryMd undefined on list rows', async () => {
    results.rows = [row()];
    const [reg] = await getRegulations();
    expect(reg).toMatchObject({
      id: 'reg-1',
      referenceCode: '(EU) 2019/2016',
      jurisdiction: 'EU',
      summaryFileName: 'summary.md',
      summaryBytes: 4096,
      applicableCategories: ['cat-1'],
      status: 'active',
    });
    expect(reg.summaryMd).toBeUndefined();
    expect(reg.notes).toBeUndefined();
  });

  it('filters by status and by category containment', async () => {
    await getRegulations({ status: 'active', categoryId: 'cat-9' });
    const read = calls.find((c) => c.op === 'select' && c.table === 'regulations')!;
    expect(read.where.status).toBe('active');
    expect(read.where.applicable_categories).toEqual({ op: 'arrayContains', value: ['cat-9'] });
  });

  it('omits filters that were not given', async () => {
    await getRegulations();
    const read = calls.find((c) => c.op === 'select' && c.table === 'regulations')!;
    expect(read.where).toEqual({});
  });
});

describe('getRegulationById', () => {
  it('reads all columns, so the summary comes back', async () => {
    results.rows = [row({ summary_md: '# Summary' })];
    const reg = await getRegulationById('reg-1');
    const read = calls.find((c) => c.op === 'selectMaybeOne')!;
    expect(read.columns).toBeUndefined();
    expect(reg?.summaryMd).toBe('# Summary');
  });
});

describe('createRegulation / updateRegulation', () => {
  it('computes summary_bytes and stamps the provenance columns', async () => {
    await createRegulation({
      title: 'T', referenceCode: 'EN 1', summaryMd: '# Heading', summaryFileName: 'en1.md',
    }, 'me@example.com');
    const insert = calls.find((c) => c.op === 'insert')!;
    expect(insert.table).toBe('regulations');
    expect(insert.payload.summary_md).toBe('# Heading');
    expect(insert.payload.summary_bytes).toBe(summaryByteLength('# Heading'));
    expect(insert.payload.summary_file_name).toBe('en1.md');
    expect(insert.payload.summary_uploaded_by).toBe('me@example.com');
    expect(insert.payload.summary_uploaded_at).toBeTruthy();
    expect(insert.payload.created_by).toBe('me@example.com');
  });

  it('counts bytes, not characters, so multi-byte summaries match the DB CHECK', async () => {
    // octet_length is what the constraint uses; '€' is 3 bytes but 1 character.
    expect(summaryByteLength('€')).toBe(3);
    await createRegulation({ title: 'T', referenceCode: 'EN 2', summaryMd: '€€' });
    expect(calls.find((c) => c.op === 'insert')!.payload.summary_bytes).toBe(6);
  });

  it('leaves the summary untouched when the field is omitted', async () => {
    // Editing a title must never silently drop an uploaded summary.
    await updateRegulation('reg-1', { title: 'New title' });
    const payload = calls.find((c) => c.op === 'updateWhere')!.payload;
    expect(payload.title).toBe('New title');
    expect('summary_md' in payload).toBe(false);
    expect('summary_bytes' in payload).toBe(false);
  });

  it('clears the summary and its provenance when passed null', async () => {
    await updateRegulation('reg-1', { summaryMd: null });
    const payload = calls.find((c) => c.op === 'updateWhere')!.payload;
    expect(payload.summary_md).toBeNull();
    expect(payload.summary_bytes).toBe(0);
    expect(payload.summary_file_name).toBeNull();
    expect(payload.summary_uploaded_at).toBeNull();
  });

  it('refuses an over-limit summary before it reaches the database', async () => {
    const huge = 'x'.repeat(MAX_SUMMARY_BYTES + 1);
    await expect(createRegulation({ title: 'T', referenceCode: 'EN 3', summaryMd: huge }))
      .rejects.toThrow(/limit is/);
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });

  it('turns a duplicate reference code into an actionable message', async () => {
    const { db } = await import('../../data');
    vi.mocked(db.insert).mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "uq_regulations_reference_code"'));
    await expect(createRegulation({ title: 'T', referenceCode: 'EN 60335-1' }))
      .rejects.toThrow(/already exists/);
  });

  it('trims the reference code so lookups match what was cited', async () => {
    await createRegulation({ title: '  T  ', referenceCode: '  EN 4 ' });
    const payload = calls.find((c) => c.op === 'insert')!.payload;
    expect(payload.reference_code).toBe('EN 4');
    expect(payload.title).toBe('T');
  });
});

describe('getRegulationUsageCounts', () => {
  it('counts explicit assignments', async () => {
    results.byTable.im_template_regulations = [
      { regulation_id: 'reg-1', template_id: 't1' },
      { regulation_id: 'reg-1', template_id: 't2' },
      { regulation_id: 'reg-2', template_id: 't1' },
    ];
    results.byTable.im_templates = [];
    results.byTable.regulations = [];
    expect(await getRegulationUsageCounts()).toEqual({ 'reg-1': 2, 'reg-2': 1 });
  });

  it('counts templates reached through a ticked category, not just explicit rows', async () => {
    // Under auto-association a regulation marked for a category IS what those templates
    // are checked against; reporting 0 would be a lie the delete guard then acts on.
    results.byTable.im_template_regulations = [];
    results.byTable.im_templates = [
      { id: 't-hob-im', category_id: 'cat-hob' },
      { id: 't-hob-leaflet', category_id: 'cat-hob' },
      { id: 't-blank', category_id: null },
    ];
    results.byTable.regulations = [row({ id: 'reg-1', applicable_categories: ['cat-hob'] })];
    expect(await getRegulationUsageCounts()).toEqual({ 'reg-1': 2 });
  });

  it('counts a template once when it is both explicitly assigned and category-covered', async () => {
    results.byTable.im_template_regulations = [{ regulation_id: 'reg-1', template_id: 't1' }];
    results.byTable.im_templates = [{ id: 't1', category_id: 'cat-hob' }];
    results.byTable.regulations = [row({ id: 'reg-1', applicable_categories: ['cat-hob'] })];
    expect(await getRegulationUsageCounts()).toEqual({ 'reg-1': 1 });
  });
});

describe('deleteRegulation', () => {
  it('refuses while templates are explicitly assigned, and never issues the delete', async () => {
    results.count = 3;
    results.byTable.im_template_regulations = [
      { regulation_id: 'reg-1', template_id: 't1' },
      { regulation_id: 'reg-1', template_id: 't2' },
      { regulation_id: 'reg-1', template_id: 't3' },
    ];
    results.byTable.im_templates = [];
    results.byTable.regulations = [];
    await expect(deleteRegulation('reg-1')).rejects.toThrow(RegulationInUseError);
    await expect(deleteRegulation('reg-1')).rejects.toThrow(/currently answer for this regulation/);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('refuses on category-derived usage alone, which no foreign key protects', async () => {
    // ON DELETE RESTRICT only covers explicit rows, so without this pre-check deleting
    // here would silently empty what two templates are being checked against.
    results.count = 0;
    results.byTable.im_template_regulations = [];
    results.byTable.im_templates = [
      { id: 't-hob-im', category_id: 'cat-hob' },
      { id: 't-hob-leaflet', category_id: 'cat-hob' },
    ];
    results.byTable.regulations = [row({ id: 'reg-1', applicable_categories: ['cat-hob'] })];
    await expect(deleteRegulation('reg-1')).rejects.toThrow(/Untick its categories/);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('deletes when nothing answers for it', async () => {
    results.count = 0;
    results.byTable.im_template_regulations = [];
    results.byTable.im_templates = [{ id: 't1', category_id: 'cat-hob' }];
    results.byTable.regulations = [row({ id: 'reg-1', applicable_categories: [] })];
    await deleteRegulation('reg-1');
    const del = calls.find((c) => c.op === 'delete')!;
    expect(del.table).toBe('regulations');
    expect(del.where).toEqual({ id: 'reg-1' });
  });

  it('maps a foreign-key violation from the race back to RegulationInUseError', async () => {
    results.count = 0;
    results.byTable.im_template_regulations = [];
    results.byTable.im_templates = [];
    results.byTable.regulations = [];
    results.deleteError = new Error('violates foreign key constraint (23503)');
    await expect(deleteRegulation('reg-1')).rejects.toThrow(RegulationInUseError);
  });
});
