import { describe, it, expect } from 'vitest';
import { extractRows, findHeaderRow, clean, num, thumbUrl, summarizeRows } from './parse-workbook';
import { REQUIRED_HEADERS } from './roadmap.constants';

// Hand-built arrays-of-arrays: no .xlsx is committed to the repo, so these describe the sheet's
// shape themselves. That is the whole reason extractRows() is split out from parseWorkbook().

/** A header row carrying every required column, plus some noise columns before and after. */
function headerRow(): string[] {
  return ['noise A', ...REQUIRED_HEADERS, 'noise B'];
}

function dataRow(over: Record<string, unknown> = {}): unknown[] {
  const values: Record<string, unknown> = {
    SKU: '10047620',
    Description: 'Ceiling fan 122cm',
    Family: 'Ceiling',
    'System Index': 'Climate-Fans-Ceiling Fans',
    'Product Image': 'https://res.cloudinary.com/x/w_auto/img.jpg',
    'Est. Factory Price': 41.5,
    Supplier: 'ACME',
    'Shop Link': 'https://klarstein.de/p/10047620',
    'Amazon DE Link': 'https://amazon.de/dp/B01',
    NOV_2025: 120000,
    'NOV FC 2025': 130000,
    'FC FF NOV_2025': 0.92,
    NOQ_2025: 4000,
    'SM%_2025': 0.31,
    ASP_2025: 30,
    '2025 Claim Rate': 0.012,
    NOV_2026: 60000,
    'NOV FC 2026': 150000,
    'FC FF NOV_2026': 0.4,
    NOQ_2026: 5000,
    'SM%_2026': 0.28,
    ASP_2026: 30.5,
    '2026 Claim Rate': 0.01,
    'Main Color': 'Black',
    'Segment 01': '122cm',
    'Segment 02': 'DC',
    'Segment 03': '',
    'Segment 04': '',
    'Segment 05': '',
    IoT: 'Yes',
    ...over,
  };
  return ['x', ...REQUIRED_HEADERS.map(k => (k in values ? values[k] : null)), 'y'];
}

describe('cell helpers', () => {
  it('treats "0" as an empty text cell — how this export writes a blank', () => {
    expect(clean('0')).toBe('');
    expect(clean('  spaced  ')).toBe('spaced');
    expect(clean(null)).toBe('');
  });

  it('parses numbers, including comma decimals, and rejects junk', () => {
    expect(num('41,5')).toBe(41.5);
    expect(num(41.5)).toBe(41.5);
    expect(num('n/a')).toBeNull();
    expect(num('')).toBeNull();
  });

  it('requests a thumbnail transform instead of the full-size image', () => {
    expect(thumbUrl('https://x/w_auto/a.jpg')).toBe('https://x/w_240/a.jpg');
    expect(thumbUrl('not-a-url')).toBe('');
  });
});

describe('findHeaderRow', () => {
  it('finds the row carrying both SKU and System Index, whatever its position', () => {
    const aoa = [['title'], [], ['preamble'], headerRow(), dataRow()];
    expect(findHeaderRow(aoa)).toBe(3);
  });

  it('returns -1 when there is no such row', () => {
    expect(findHeaderRow([['a', 'b'], ['c']])).toBe(-1);
  });
});

describe('extractRows', () => {
  it('maps a row into the shape the board and the import RPC share', () => {
    const [r] = extractRows([headerRow(), dataRow()]);
    expect(r.sku).toBe('10047620');
    expect(r.family).toBe('Ceiling');
    expect(r.systemIndex).toBe('Climate-Fans-Ceiling Fans');
    expect(r.price).toBe(41.5);
    expect(r.image).toBe('https://res.cloudinary.com/x/w_240/img.jpg');
    expect(r.nov25).toBe(120000);
    expect(r.sm26).toBe(0.28);
    expect(r.attrs).toEqual({
      'Main Color': 'Black',
      'Segment 01': '122cm',
      'Segment 02': 'DC',
      IoT: 'Yes',
    });
  });

  it('matches columns by header text, not position', () => {
    // Same data, but every column shifted right by three noise columns.
    const header = ['a', 'b', 'c', ...REQUIRED_HEADERS];
    const row = ['a', 'b', 'c', ...dataRow().slice(1, -1)];
    const [r] = extractRows([header, row]);
    expect(r.sku).toBe('10047620');
    expect(r.attrs['Segment 01']).toBe('122cm');
  });

  it('skips rows with no SKU rather than emitting blanks', () => {
    const rows = extractRows([
      headerRow(),
      dataRow(),
      dataRow({ SKU: '' }),
      dataRow({ SKU: '99' }),
    ]);
    expect(rows.map(r => r.sku)).toEqual(['10047620', '99']);
  });

  it('drops a non-http link instead of storing a broken one', () => {
    const [r] = extractRows([headerRow(), dataRow({ 'Shop Link': 'n/a', 'Amazon DE Link': '0' })]);
    expect(r.shop).toBe('');
    expect(r.amazon).toBe('');
  });

  it('names every missing column when the sheet is the wrong table', () => {
    const header = headerRow().filter(h => h !== 'Segment 05' && h !== 'ASP_2026');
    expect(() => extractRows([header, dataRow()])).toThrow(/missing 2 expected column/i);
  });

  it('refuses a sheet with no recognisable header row', () => {
    expect(() => extractRows([['nothing', 'useful']])).toThrow(/FactoryPrice_A header row/i);
  });

  it('refuses a header row with no data under it', () => {
    expect(() => extractRows([headerRow()])).toThrow(/no data rows/i);
  });
});

describe('summarizeRows', () => {
  it('counts rows, categories and families for the upload preview', () => {
    const rows = extractRows([
      headerRow(),
      dataRow(),
      dataRow({ SKU: '2', Family: 'Tower', 'System Index': 'Climate-Fans-Tower Fans' }),
      dataRow({ SKU: '3', Family: 'Tower' }),
    ]);
    expect(summarizeRows(rows)).toEqual({ rowCount: 3, categoryCount: 2, familyCount: 2 });
  });
});
