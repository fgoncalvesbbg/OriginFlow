import { describe, it, expect } from 'vitest';
import {
  validateExport,
  groupBlockers,
  buildExportRows,
  emptyColumns,
  type ExportableSku,
} from './export-validation.utils';
import { indexByCell } from '../../../utils/sku-attribute-value.utils';
import type { CategoryAttribute, SkuAttributeValueRecord } from '../../../types';

const attr = (o: Partial<CategoryAttribute> & { id: string }): CategoryAttribute => ({
  categoryId: 'cat-1',
  name: o.id,
  dataType: 'text',
  ...o,
});

const rec = (
  projectSkuId: string,
  attributeId: string,
  value: string | null,
  unit: string | null = null,
): SkuAttributeValueRecord => ({
  id: `${projectSkuId}-${attributeId}`,
  projectSkuId,
  attributeId,
  value,
  unit,
  source: 'manual',
  updatedBy: null,
  updatedByName: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const sku = (id: string, skuNumber: string): ExportableSku => ({ id, skuNumber });

const TEXT = attr({ id: 't' });

// ---------------------------------------------------------------------------
// validateExport
// ---------------------------------------------------------------------------

describe('validateExport', () => {
  it('returns [] when everything is fine — the file is safe to build', () => {
    const skus = [sku('s1', '1'), sku('s2', '2')];
    const attributes = [TEXT];
    const byCell = indexByCell([rec('s1', 't', 'x'), rec('s2', 't', 'y')]);
    expect(validateExport(skus, attributes, byCell)).toEqual([]);
  });

  it('"column-collision" when two attributes share an akeneoId', () => {
    // Both attributes carry akeneoId 'width', so the builder would keep the first and
    // silently drop the second's values — the blocker has to name both losers.
    const a = attr({ id: 'a1', name: 'Width A', akeneoId: 'width' });
    const b = attr({ id: 'a2', name: 'Width B', akeneoId: 'width' });
    const blockers = validateExport([], [a, b], new Map());
    const collisions = blockers.filter(x => x.kind === 'column-collision');
    expect(collisions).toHaveLength(1);
    expect(collisions[0].attributeName).toContain('Width A');
    expect(collisions[0].attributeName).toContain('Width B');
  });

  it('"column-collision" when two names slug to the same code', () => {
    // No akeneoId on either, so the code falls back to a name slug — and "Product Width"
    // and "product width" slug identically, which is the trap this blocker exists to catch.
    const a = attr({ id: 'a1', name: 'Product Width' });
    const b = attr({ id: 'a2', name: 'product width' });
    const blockers = validateExport([], [a, b], new Map());
    const collisions = blockers.filter(x => x.kind === 'column-collision');
    expect(collisions).toHaveLength(1);
    expect(collisions[0].attributeName).toContain('Product Width');
    expect(collisions[0].attributeName).toContain('product width');
  });

  it('no collision when codes differ', () => {
    const a = attr({ id: 'a1', name: 'Width', akeneoId: 'width' });
    const b = attr({ id: 'a2', name: 'Height', akeneoId: 'height' });
    const blockers = validateExport([], [a, b], new Map());
    expect(blockers.filter(x => x.kind === 'column-collision')).toEqual([]);
  });

  it('"duplicate-sku-number" when two records share an item number', () => {
    const skus = [sku('s1', '10046631'), sku('s2', '10046631'), sku('s3', '10047753')];
    const blockers = validateExport(skus, [], new Map());
    const dupes = blockers.filter(x => x.kind === 'duplicate-sku-number');
    expect(dupes).toHaveLength(1);
    expect(dupes[0].skuNumber).toBe('10046631');
    expect(dupes[0].detail).toContain('2 separate');
  });

  it('no duplicate blocker when numbers are unique', () => {
    const skus = [sku('s1', '1'), sku('s2', '2'), sku('s3', '3')];
    expect(validateExport(skus, [], new Map()).filter(x => x.kind === 'duplicate-sku-number')).toEqual([]);
  });

  it('"invalid-value" for an enum value not in enumOptions, and the remedy lists the valid options', () => {
    const enumAttr = attr({ id: 'e', dataType: 'enum', validationRules: { enumOptions: ['A', 'B'] } });
    const skus = [sku('s1', '1')];
    const byCell = indexByCell([rec('s1', 'e', 'Z')]);
    const blockers = validateExport(skus, [enumAttr], byCell);
    const invalid = blockers.filter(x => x.kind === 'invalid-value');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].skuNumber).toBe('1');
    expect(invalid[0].attributeName).toBe('e');
    expect(invalid[0].remedy).toContain('A');
    expect(invalid[0].remedy).toContain('B');
  });

  it('"invalid-value" for a non-numeric value in a decimal attribute', () => {
    const decimalAttr = attr({ id: 'd', dataType: 'decimal' });
    const skus = [sku('s1', '1')];
    const byCell = indexByCell([rec('s1', 'd', 'not-a-number')]);
    const blockers = validateExport(skus, [decimalAttr], byCell);
    const invalid = blockers.filter(x => x.kind === 'invalid-value');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].remedy).toContain('Correct the value');
  });

  it('a cleared or absent value is never reported as invalid — those cells are skipped entirely', () => {
    // Both an explicit clear (null) and legacy blank ('   ') mean "no answer here", not "a
    // wrong answer" — the same distinction classifyCell draws elsewhere in this module.
    const enumAttr = attr({ id: 'e', dataType: 'enum', validationRules: { enumOptions: ['A', 'B'] } });
    const skus = [sku('s1', '1'), sku('s2', '2'), sku('s3', '3')];
    const byCell = indexByCell([rec('s1', 'e', null), rec('s2', 'e', '   ')]);
    // s3 has no record at all.
    expect(validateExport(skus, [enumAttr], byCell)).toEqual([]);
  });

  it('"unit-conflict" when two SKUs store the same attribute in different units', () => {
    // The lesson this blocker exists for: a cable-length attribute held some products in
    // centimetres and others in metres, and one header cannot carry both.
    const skus = [sku('s1', '1'), sku('s2', '2')];
    const byCell = indexByCell([rec('s1', 't', '10', 'cm'), rec('s2', 't', '2', 'm')]);
    const blockers = validateExport(skus, [TEXT], byCell);
    const conflicts = blockers.filter(x => x.kind === 'unit-conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('cm');
    expect(conflicts[0].detail).toContain('m');
  });

  it('"unit-conflict" when the stored unit disagrees with the attribute\'s declared unit', () => {
    const declared = attr({ id: 't', validationRules: { unit: 'mm' } });
    const skus = [sku('s1', '1'), sku('s2', '2')];
    const byCell = indexByCell([rec('s1', 't', '1', 'cm'), rec('s2', 't', '2', 'cm')]);
    const blockers = validateExport(skus, [declared], byCell);
    const conflicts = blockers.filter(x => x.kind === 'unit-conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].detail).toContain('cm');
    expect(conflicts[0].detail).toContain('mm');
  });

  it('no unit conflict when the stored unit matches the declared unit', () => {
    const declared = attr({ id: 't', validationRules: { unit: 'cm' } });
    const skus = [sku('s1', '1'), sku('s2', '2')];
    const byCell = indexByCell([rec('s1', 't', '1', 'cm'), rec('s2', 't', '2', 'cm')]);
    expect(validateExport(skus, [declared], byCell).filter(x => x.kind === 'unit-conflict')).toEqual([]);
  });

  it('no unit conflict when records carry no unit at all', () => {
    const skus = [sku('s1', '1'), sku('s2', '2')];
    const byCell = indexByCell([rec('s1', 't', '1', null), rec('s2', 't', '2', null)]);
    expect(validateExport(skus, [TEXT], byCell).filter(x => x.kind === 'unit-conflict')).toEqual([]);
  });

  it('unit comparison is case/whitespace insensitive', () => {
    const skus = [sku('s1', '1'), sku('s2', '2')];
    const byCell = indexByCell([rec('s1', 't', '1', ' CM '), rec('s2', 't', '2', 'cm')]);
    expect(validateExport(skus, [TEXT], byCell).filter(x => x.kind === 'unit-conflict')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// groupBlockers
// ---------------------------------------------------------------------------

describe('groupBlockers', () => {
  it('returns groups in the fixed order, and omits kinds with nothing in them', () => {
    // Fed in a scrambled order deliberately — the grouping owns the order, not the input.
    const blockers = [
      { kind: 'invalid-value' as const, detail: 'd', remedy: 'r' },
      { kind: 'column-collision' as const, detail: 'd', remedy: 'r' },
      { kind: 'duplicate-sku-number' as const, detail: 'd', remedy: 'r' },
    ];
    const groups = groupBlockers(blockers);
    expect(groups.map(g => g.kind)).toEqual(['column-collision', 'duplicate-sku-number', 'invalid-value']);
    // unit-conflict had no blockers, so it never appears at all.
    expect(groups.some(g => g.kind === 'unit-conflict')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildExportRows
// ---------------------------------------------------------------------------

describe('buildExportRows', () => {
  it('headers start with sku, sku_title, then one column per attribute', () => {
    const a = attr({ id: 'a1', name: 'Width', akeneoId: 'width' });
    const b = attr({ id: 'a2', name: 'Height', akeneoId: 'height' });
    const { headers } = buildExportRows([], [a, b], new Map(), new Map());
    expect(headers).toEqual(['sku', 'sku_title', 'width', 'height']);
  });

  it('a cleared value exports as an empty string', () => {
    const skus = [sku('s1', '1')];
    const byCell = indexByCell([rec('s1', 't', null)]);
    const { rows } = buildExportRows(skus, [TEXT], byCell, new Map());
    expect(rows[0]['t']).toBe('');
  });

  it('a boolean true/false exports as 1/0', () => {
    const boolAttr = attr({ id: 'b', dataType: 'boolean' });
    const skus = [sku('s1', '1'), sku('s2', '2')];
    const byCell = indexByCell([rec('s1', 'b', 'true'), rec('s2', 'b', 'false')]);
    const { rows } = buildExportRows(skus, [boolAttr], byCell, new Map());
    expect(rows[0]['b']).toBe('1');
    expect(rows[1]['b']).toBe('0');
  });

  it('a missing record exports as an empty string', () => {
    const skus = [sku('s1', '1')];
    // No record at all for s1/t — nobody has ever touched this cell.
    const { rows } = buildExportRows(skus, [TEXT], new Map(), new Map());
    expect(rows[0]['t']).toBe('');
  });

  it('sku_title comes from the skuTitles map', () => {
    const skus = [sku('s1', '1')];
    const skuTitles = new Map([['s1', 'Widget 3000']]);
    const { rows } = buildExportRows(skus, [], new Map(), skuTitles);
    expect(rows[0]['sku_title']).toBe('Widget 3000');
    expect(rows[0]['sku']).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// emptyColumns
// ---------------------------------------------------------------------------

describe('emptyColumns', () => {
  it('returns an attribute where every SKU has no value', () => {
    const skus = [sku('s1', '1'), sku('s2', '2')];
    const empty = attr({ id: 'e' });
    const filled = attr({ id: 'f' });
    const byCell = indexByCell([rec('s1', 'f', 'x'), rec('s2', 'f', 'y')]);
    // 'e' has no records at all; 'f' is answered for every SKU.
    expect(emptyColumns(skus, [empty, filled], byCell)).toEqual([empty]);
  });

  it('excludes an attribute where any SKU has a value', () => {
    const skus = [sku('s1', '1'), sku('s2', '2')];
    const partial = attr({ id: 'p' });
    const byCell = indexByCell([rec('s1', 'p', 'x')]); // s2 has nothing
    expect(emptyColumns(skus, [partial], byCell)).toEqual([]);
  });

  it('treats a cleared value and a blank value as empty, same as a missing record', () => {
    const skus = [sku('s1', '1'), sku('s2', '2'), sku('s3', '3')];
    const target = attr({ id: 't' });
    const byCell = indexByCell([rec('s1', 't', null), rec('s2', 't', '   ')]);
    // s3 has no record at all — all three count as "no value".
    expect(emptyColumns(skus, [target], byCell)).toEqual([target]);
  });
});

// ---------------------------------------------------------------------------
// CSV formula injection — carried over from the builder this module replaced
// ---------------------------------------------------------------------------

describe('buildExportRows — formula neutralisation', () => {
  it('neutralises a leading = in a value', () => {
    // A supplier-submitted value reaches this export verbatim once somebody saves it. The CSV
    // writer quotes commas for us but does nothing about a leading =, which Excel then RUNS.
    const A = attr({ id: 'a', name: 'Note' });
    const { rows } = buildExportRows(
      [{ id: 's1', skuNumber: '1' }],
      [A],
      indexByCell([rec('s1', 'a', '=1+1')]),
      new Map(),
    );
    expect(rows[0].note).not.toMatch(/^=/);
  });

  it('neutralises the other dangerous leads', () => {
    const A = attr({ id: 'a', name: 'Note' });
    for (const dangerous of ['-1+1', '@SUM(A1)', '\tx']) {
      const { rows } = buildExportRows(
        [{ id: 's1', skuNumber: '1' }],
        [A],
        indexByCell([rec('s1', 'a', dangerous)]),
        new Map(),
      );
      expect(rows[0].note).toBe(`'${dangerous}`);
    }
  });

  it('leaves a SIGNED NUMBER alone — the sign is not a formula trigger', () => {
    // Deliberate exemption in neutralizeCsvFormula: quoting "-5" or "+3.2" would turn a real
    // numeric value into text and break the numeric column downstream. A measurement can
    // legitimately be negative, so this exemption is load-bearing, not an oversight.
    const A = attr({ id: 'a', name: 'Offset', dataType: 'decimal' });
    for (const numeric of ['-5', '+3.2', '-0.44']) {
      const { rows } = buildExportRows(
        [{ id: 's1', skuNumber: '1' }],
        [A],
        indexByCell([rec('s1', 'a', numeric)]),
        new Map(),
      );
      expect(rows[0].offset).toBe(numeric);
    }
  });

  it('neutralises the SKU number and title too', () => {
    const { rows } = buildExportRows(
      [{ id: 's1', skuNumber: '=BAD()' }],
      [],
      new Map(),
      new Map([['s1', '=ALSO_BAD()']]),
    );
    expect(rows[0].sku).not.toMatch(/^=/);
    expect(rows[0].sku_title).not.toMatch(/^=/);
  });

  it('leaves an ordinary value untouched', () => {
    const A = attr({ id: 'a', name: 'Note' });
    const { rows } = buildExportRows(
      [{ id: 's1', skuNumber: '10046631' }],
      [A],
      indexByCell([rec('s1', 'a', 'Stainless Steel')]),
      new Map(),
    );
    expect(rows[0].note).toBe('Stainless Steel');
    expect(rows[0].sku).toBe('10046631');
  });
});
