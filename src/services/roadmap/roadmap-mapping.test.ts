import { describe, it, expect } from 'vitest';
import {
  toImportRows,
  toAttrsJson,
  fromAttrsJson,
  fromSkuRow,
  fromFlagRow,
  fromPlacerRow,
  fromAxisValueRow,
  fromImportRow,
  fromAuditRow,
} from './roadmap-mapping';
import type { ParsedRoadmapRow } from '../../pages/roadmap/parse-workbook';

const parsed = (over: Partial<ParsedRoadmapRow> = {}): ParsedRoadmapRow => ({
  sku: '10047620',
  description: 'Ceiling fan 122cm',
  family: 'Ceiling',
  systemIndex: 'Climate-Fans-Ceiling Fans',
  image: 'https://x/w_240/a.jpg',
  price: 41.5,
  supplier: 'ACME',
  shop: 'https://klarstein.de/p/1',
  amazon: '',
  nov25: 120000, novfc25: 130000, fcff25: 0.92, noq25: 4000, sm25: 0.31, asp25: 30, claim25: 0.012,
  nov26: 60000, novfc26: 150000, fcff26: 0.4, noq26: 5000, sm26: 0.28, asp26: 30.5, claim26: 0.01,
  attrs: { 'Main Color': 'Black', 'Segment 01': '122cm' },
  ...over,
});

describe('toAttrsJson', () => {
  it('keeps only the known axis fields', () => {
    expect(toAttrsJson({ 'Main Color': 'Black', Nonsense: 'x' })).toEqual({ 'Main Color': 'Black' });
  });

  it('drops empty values rather than storing blanks', () => {
    expect(toAttrsJson({ 'Main Color': 'Black', 'Segment 01': '   ' })).toEqual({
      'Main Color': 'Black',
    });
  });

  it('is an empty object, never null, when nothing is set', () => {
    expect(toAttrsJson(undefined)).toEqual({});
  });
});

describe('fromAttrsJson', () => {
  it('passes a parsed object straight through', () => {
    expect(fromAttrsJson({ 'Main Color': 'Black' })).toEqual({ 'Main Color': 'Black' });
  });

  it('parses a JSON string, for a driver that hands one back', () => {
    expect(fromAttrsJson('{"IoT":"Yes"}')).toEqual({ IoT: 'Yes' });
  });

  it('degrades to an empty object rather than taking down the board', () => {
    expect(fromAttrsJson('{ truncated')).toEqual({});
    expect(fromAttrsJson(null)).toEqual({});
    expect(fromAttrsJson(42)).toEqual({});
  });
});

describe('toImportRows', () => {
  it('renames every field to its database column', () => {
    const [r] = toImportRows([parsed()]);
    expect(r).toMatchObject({
      sku: '10047620',
      system_index: 'Climate-Fans-Ceiling Fans',
      image_url: 'https://x/w_240/a.jpg',
      factory_price: 41.5,
      shop_link: 'https://klarstein.de/p/1',
      sm_pct_2026: 0.28,
      claim_rate_2025: 0.012,
    });
    expect(r.attrs_json).toEqual({ 'Main Color': 'Black', 'Segment 01': '122cm' });
  });

  it('writes an empty string as null, not as ""', () => {
    const [r] = toImportRows([parsed({ amazon: '', supplier: '   ' })]);
    expect(r.amazon_link).toBeNull();
    expect(r.supplier).toBeNull();
  });

  it('never emits NaN for an unparseable number', () => {
    const [r] = toImportRows([parsed({ price: 'n/a' as unknown as number })]);
    expect(r.factory_price).toBeNull();
  });

  it('accepts a comma decimal', () => {
    const [r] = toImportRows([parsed({ price: '41,5' as unknown as number })]);
    expect(r.factory_price).toBe(41.5);
  });

  it('truncates an over-long value rather than shipping it whole', () => {
    const [r] = toImportRows([parsed({ description: 'x'.repeat(600) })]);
    expect(r.description).toHaveLength(512);
  });

  it('skips a row with no SKU', () => {
    expect(toImportRows([parsed({ sku: '   ' }), parsed({ sku: '2' })]).map(r => r.sku)).toEqual([
      '2',
    ]);
  });

  // Not cosmetic: ON CONFLICT raises "cannot affect row a second time" if one statement touches
  // the same key twice, and that error tells a planner nothing they can act on.
  it('dedupes on sku, last one wins', () => {
    const rows = toImportRows([
      parsed({ sku: '1', description: 'first' }),
      parsed({ sku: '2' }),
      parsed({ sku: '1', description: 'second' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.sku === '1')?.description).toBe('second');
  });

  it('handles an empty or missing input without throwing', () => {
    expect(toImportRows([])).toEqual([]);
    expect(toImportRows(undefined)).toEqual([]);
  });
});

describe('row mappers', () => {
  it('coerces every numeric column and defaults isCurrent to true', () => {
    const s = fromSkuRow({
      sku: '1',
      factory_price: '41.5000',
      nov_2025: '120000.00',
      sm_pct_2026: '0.280000',
      attrs_json: { IoT: 'Yes' },
    });
    expect(s.price).toBe(41.5);
    expect(s.nov25).toBe(120000);
    expect(s.sm26).toBe(0.28);
    expect(s.attrs).toEqual({ IoT: 'Yes' });
    expect(s.isCurrent).toBe(true);
    expect(s.description).toBe('');
  });

  it('reads a delisted SKU as not current', () => {
    expect(fromSkuRow({ sku: '1', is_current: false }).isCurrent).toBe(false);
  });

  it('maps a flag row, defaulting the review status', () => {
    const f = fromFlagRow({ sku: '1', flag: 'eol', comment: 'runs out Q3' });
    expect(f).toMatchObject({ sku: '1', flag: 'eol', comment: 'runs out Q3', status: 'pending' });
    expect(f.approvedBy).toBeNull();
  });

  it('maps a placer row including its six-part cell address', () => {
    const p = fromPlacerRow({
      placer_id: 7,
      category: 'Fans',
      y_field: 'Main Color',
      x_field: 'Segment 01',
      family: 'Ceiling',
      y_value: 'Black',
      x_value: '122cm',
      type: 'new',
      expected_2027_nic: '25000.00',
      sort_order: 2,
    });
    expect(p).toMatchObject({
      id: 7,
      yField: 'Main Color',
      xValue: '122cm',
      type: 'new',
      expected2027Nic: 25000,
      sortOrder: 2,
      status: 'pending',
    });
  });

  it('maps an axis value, keeping a null field for a family', () => {
    expect(fromAxisValueRow({ axis_value_id: 3, kind: 'family', value: 'Planned', field: null }))
      .toMatchObject({ id: 3, kind: 'family', value: 'Planned', field: null });
  });

  it('maps an import row with its counts', () => {
    expect(
      fromImportRow({
        import_id: 4,
        file_name: 'x.xlsx',
        row_count: 10,
        inserted_count: 3,
        updated_count: 7,
        delisted_count: 1,
      }),
    ).toMatchObject({ importId: 4, rowCount: 10, insertedCount: 3, delistedCount: 1 });
  });

  it('maps an audit row, passing jsonb payloads through untouched', () => {
    const a = fromAuditRow({
      audit_id: '900',
      entity: 'flag',
      action: 'set',
      before_json: { flag: null },
      after_json: { flag: 'eol' },
    });
    expect(a.id).toBe(900);
    expect(a.after).toEqual({ flag: 'eol' });
    expect(a.category).toBe('');
  });

  it('normalises timestamps to ISO, and null when absent', () => {
    expect(fromFlagRow({ sku: '1', updated_at: '2026-09-09T10:00:00Z' }).updatedAt).toBe(
      '2026-09-09T10:00:00.000Z',
    );
    expect(fromFlagRow({ sku: '1' }).updatedAt).toBeNull();
  });
});
