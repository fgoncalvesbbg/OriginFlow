import { describe, it, expect } from 'vitest';
import {
  cellKey,
  classifyCell,
  coverageFor,
  indexByCell,
  isFillTarget,
  isFilled,
  isInvalidValue,
  planBulkFill,
  planCopyFrom,
  planJsonbSync,
  toJsonbMirror,
  validationModeFor,
} from './sku-attribute-value.utils';
import type {
  CategoryAttribute,
  SkuAttributeValue,
  SkuAttributeValueRecord,
} from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const attr = (overrides: Partial<CategoryAttribute> & { id: string }): CategoryAttribute => ({
  categoryId: 'cat-1',
  name: overrides.id,
  dataType: 'text',
  ...overrides,
});

const rec = (
  overrides: Partial<SkuAttributeValueRecord> & { projectSkuId: string; attributeId: string },
): SkuAttributeValueRecord => ({
  id: `${overrides.projectSkuId}-${overrides.attributeId}`,
  value: null,
  unit: null,
  source: 'manual',
  updatedBy: null,
  updatedByName: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const TEXT = attr({ id: 'a-text' });
const NUM = attr({ id: 'a-num', dataType: 'decimal' });
const RANGE = attr({ id: 'a-range', dataType: 'decimal', validationRules: { allowRange: true } });
const ENUM = attr({ id: 'a-enum', dataType: 'enum', validationRules: { enumOptions: ['A+', 'A++'] } });

// ---------------------------------------------------------------------------
// classifyCell — the empty/cleared distinction is the point of the whole table
// ---------------------------------------------------------------------------

describe('classifyCell', () => {
  it('reads a missing record as empty — nobody has touched the cell', () => {
    expect(classifyCell(undefined, TEXT)).toBe('empty');
  });

  it('reads a null value as cleared — somebody emptied it on purpose', () => {
    expect(classifyCell(rec({ projectSkuId: 's1', attributeId: TEXT.id, value: null }), TEXT))
      .toBe('cleared');
  });

  it('does not confuse cleared with empty', () => {
    const cleared = classifyCell(rec({ projectSkuId: 's1', attributeId: TEXT.id, value: null }), TEXT);
    expect(cleared).not.toBe(classifyCell(undefined, TEXT));
  });

  it('reads a stored value as filled', () => {
    expect(classifyCell(rec({ projectSkuId: 's1', attributeId: TEXT.id, value: 'Steel' }), TEXT))
      .toBe('filled');
  });

  it('reads a legacy stored empty string as empty, not cleared', () => {
    // The JSONB era had no way to say "cleared", so '' meant "never filled". Reading it
    // as cleared would invent thousands of deliberate decisions nobody made.
    expect(classifyCell(rec({ projectSkuId: 's1', attributeId: TEXT.id, value: '' }), TEXT))
      .toBe('empty');
    expect(classifyCell(rec({ projectSkuId: 's1', attributeId: TEXT.id, value: '   ' }), TEXT))
      .toBe('empty');
  });

  it('flags an off-list option as invalid', () => {
    expect(classifyCell(rec({ projectSkuId: 's1', attributeId: ENUM.id, value: 'B' }), ENUM))
      .toBe('invalid');
    expect(classifyCell(rec({ projectSkuId: 's1', attributeId: ENUM.id, value: 'A++' }), ENUM))
      .toBe('filled');
  });

  it('flags a non-number in a numeric field as invalid', () => {
    expect(classifyCell(rec({ projectSkuId: 's1', attributeId: NUM.id, value: 'about 40' }), NUM))
      .toBe('invalid');
  });

  it('never calls a cleared cell invalid, even for a required attribute', () => {
    const required = attr({ id: 'a-req', dataType: 'enum', validationRules: { required: true, enumOptions: ['X'] } });
    expect(classifyCell(rec({ projectSkuId: 's1', attributeId: required.id, value: null }), required))
      .toBe('cleared');
  });
});

// ---------------------------------------------------------------------------
// The range false-positive this module tripped on
// ---------------------------------------------------------------------------

describe('validationModeFor / isInvalidValue', () => {
  it('judges a stored range in range mode when the attribute allows one', () => {
    expect(validationModeFor(RANGE, '100-200')).toBe('range');
    expect(isInvalidValue(RANGE, '100-200')).toBe(false);
    expect(classifyCell(rec({ projectSkuId: 's1', attributeId: RANGE.id, value: '100-200' }), RANGE))
      .toBe('filled');
  });

  it('still rejects a range on a numeric attribute that does not allow one', () => {
    expect(validationModeFor(NUM, '100-200')).toBe('text');
    expect(isInvalidValue(NUM, '100-200')).toBe(true);
  });

  it('treats a leading minus as a negative number, not a range', () => {
    expect(validationModeFor(RANGE, '-5')).toBe('text');
    expect(isInvalidValue(RANGE, '-5')).toBe(false);
  });

  it('rejects a range whose bounds are the wrong way round', () => {
    expect(isInvalidValue(RANGE, '200-100')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe('coverageFor', () => {
  it('counts filled cells over the SKUs asked about', () => {
    const byCell = indexByCell([
      rec({ projectSkuId: 's1', attributeId: TEXT.id, value: 'x' }),
      rec({ projectSkuId: 's2', attributeId: TEXT.id, value: null }),
      rec({ projectSkuId: 's3', attributeId: TEXT.id, value: 'y' }),
    ]);
    expect(coverageFor(TEXT, ['s1', 's2', 's3', 's4'], byCell))
      .toEqual({ attributeId: TEXT.id, filled: 2, total: 4 });
  });

  it('counts an invalid value as filled — it is wrong, not missing', () => {
    const byCell = indexByCell([rec({ projectSkuId: 's1', attributeId: ENUM.id, value: 'B' })]);
    expect(isFilled(byCell.get(cellKey('s1', ENUM.id)), ENUM)).toBe(true);
    expect(coverageFor(ENUM, ['s1'], byCell).filled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fill targeting
// ---------------------------------------------------------------------------

describe('isFillTarget', () => {
  it('targets an untouched cell', () => {
    expect(isFillTarget(undefined, TEXT)).toBe(true);
  });

  it('does not target a cleared cell — that overwrites a judgement', () => {
    expect(isFillTarget(rec({ projectSkuId: 's1', attributeId: TEXT.id, value: null }), TEXT))
      .toBe(false);
  });

  it('does not target a filled cell by default', () => {
    expect(isFillTarget(rec({ projectSkuId: 's1', attributeId: TEXT.id, value: 'x' }), TEXT))
      .toBe(false);
  });

  it('targets anything once the operator opts in', () => {
    expect(isFillTarget(rec({ projectSkuId: 's1', attributeId: TEXT.id, value: 'x' }), TEXT, true))
      .toBe(true);
    expect(isFillTarget(rec({ projectSkuId: 's1', attributeId: TEXT.id, value: null }), TEXT, true))
      .toBe(true);
  });
});

// ---------------------------------------------------------------------------
// planBulkFill
// ---------------------------------------------------------------------------

describe('planBulkFill', () => {
  const skus = [
    { id: 's1', isFinal: false },
    { id: 's2', isFinal: false },
    { id: 's3', isFinal: true },
  ];

  it('fills empty cells, skips filled ones, and refuses signed-off SKUs', () => {
    const byCell = indexByCell([rec({ projectSkuId: 's2', attributeId: TEXT.id, value: 'kept' })]);
    expect(planBulkFill(skus, TEXT, 'new', byCell)).toEqual([
      { projectSkuId: 's1', outcome: 'set', value: 'new', unit: null },
      { projectSkuId: 's2', outcome: 'skipped-filled' },
      { projectSkuId: 's3', outcome: 'skipped-final' },
    ]);
  });

  it('reports the sign-off before anything looks at the cell', () => {
    // s3 is Final AND empty. The sign-off is the reason, not "it was empty so we wrote".
    const plan = planBulkFill(skus, TEXT, 'new', indexByCell([]));
    expect(plan.find(t => t.projectSkuId === 's3')?.outcome).toBe('skipped-final');
  });

  it('refuses a value the attribute cannot hold, for every SKU at once', () => {
    const plan = planBulkFill(skus, ENUM, 'not-an-option', indexByCell([]));
    expect(plan.map(t => t.outcome)).toEqual([
      'skipped-invalid',
      'skipped-invalid',
      'skipped-final',
    ]);
  });

  it('overwrites filled cells when asked, but still never a Final SKU', () => {
    const byCell = indexByCell([rec({ projectSkuId: 's2', attributeId: TEXT.id, value: 'old' })]);
    const plan = planBulkFill(skus, TEXT, 'new', byCell, { includeFilled: true });
    expect(plan.find(t => t.projectSkuId === 's2')?.outcome).toBe('set');
    expect(plan.find(t => t.projectSkuId === 's3')?.outcome).toBe('skipped-final');
  });

  it('carries the unit through to what will be written', () => {
    const plan = planBulkFill([{ id: 's1', isFinal: false }], NUM, '1.5', indexByCell([]), { unit: 'm' });
    expect(plan[0]).toEqual({ projectSkuId: 's1', outcome: 'set', value: '1.5', unit: 'm' });
  });
});

// ---------------------------------------------------------------------------
// planCopyFrom
// ---------------------------------------------------------------------------

describe('planCopyFrom', () => {
  const targets = [
    { id: 'src', isFinal: false },
    { id: 't1', isFinal: false },
    { id: 't2', isFinal: false },
  ];

  it('copies only the attributes the source actually holds', () => {
    const byCell = indexByCell([
      rec({ projectSkuId: 'src', attributeId: TEXT.id, value: 'Steel' }),
      rec({ projectSkuId: 'src', attributeId: NUM.id, value: null }),      // cleared: not copied
      // ENUM: source has no record at all — not copied
    ]);
    const plan = planCopyFrom('src', targets, [TEXT, NUM, ENUM], byCell);
    expect(plan.map(p => p.attributeId)).toEqual([TEXT.id]);
  });

  it('never proposes to clear a target — a cleared source copies nothing', () => {
    const byCell = indexByCell([rec({ projectSkuId: 'src', attributeId: TEXT.id, value: null })]);
    expect(planCopyFrom('src', targets, [TEXT], byCell)).toEqual([]);
  });

  it('excludes the source SKU from its own copy', () => {
    const byCell = indexByCell([rec({ projectSkuId: 'src', attributeId: TEXT.id, value: 'Steel' })]);
    const plan = planCopyFrom('src', targets, [TEXT], byCell);
    expect(plan[0].targets.map(t => t.projectSkuId)).toEqual(['t1', 't2']);
  });

  it('carries the source cell unit onto the copies', () => {
    const byCell = indexByCell([
      rec({ projectSkuId: 'src', attributeId: NUM.id, value: '150', unit: 'cm' }),
    ]);
    const plan = planCopyFrom('src', targets, [NUM], byCell);
    expect(plan[0].targets[0]).toMatchObject({ outcome: 'set', value: '150', unit: 'cm' });
  });
});

// ---------------------------------------------------------------------------
// planJsonbSync — the bridge that must not invent clears or lose them
// ---------------------------------------------------------------------------

describe('planJsonbSync', () => {
  const jsonb = (...entries: [string, string][]): SkuAttributeValue[] =>
    entries.map(([attributeId, value]) => ({ attributeId, name: attributeId, value }));

  it('writes nothing for a blank entry with no existing record — that is scaffolding', () => {
    // This is the shape of all 141 live JSONB entries: placeholders, never filled.
    expect(planJsonbSync(jsonb([TEXT.id, ''], [NUM.id, '   ']), []))
      .toEqual({ upserts: [], clears: [] });
  });

  it('treats a blank entry over an existing value as an explicit clear', () => {
    const existing = [rec({ projectSkuId: 's1', attributeId: TEXT.id, value: 'was here' })];
    expect(planJsonbSync(jsonb([TEXT.id, '']), existing))
      .toEqual({ upserts: [], clears: [TEXT.id] });
  });

  it('does not re-clear an already-cleared cell', () => {
    const existing = [rec({ projectSkuId: 's1', attributeId: TEXT.id, value: null })];
    expect(planJsonbSync(jsonb([TEXT.id, '']), existing))
      .toEqual({ upserts: [], clears: [] });
  });

  it('upserts a new value', () => {
    expect(planJsonbSync(jsonb([TEXT.id, 'Steel']), []))
      .toEqual({ upserts: [{ attributeId: TEXT.id, value: 'Steel' }], clears: [] });
  });

  it('writes nothing when the value has not changed', () => {
    const existing = [rec({ projectSkuId: 's1', attributeId: TEXT.id, value: 'Steel' })];
    expect(planJsonbSync(jsonb([TEXT.id, 'Steel']), existing))
      .toEqual({ upserts: [], clears: [] });
  });

  it('upserts over a cleared cell — refilling is a change', () => {
    const existing = [rec({ projectSkuId: 's1', attributeId: TEXT.id, value: null })];
    expect(planJsonbSync(jsonb([TEXT.id, 'Steel']), existing))
      .toEqual({ upserts: [{ attributeId: TEXT.id, value: 'Steel' }], clears: [] });
  });

  it('ignores entries with no attribute id', () => {
    expect(planJsonbSync([{ attributeId: '', name: 'x', value: 'y' }], []))
      .toEqual({ upserts: [], clears: [] });
  });
});

// ---------------------------------------------------------------------------
// toJsonbMirror
// ---------------------------------------------------------------------------

describe('toJsonbMirror', () => {
  it('mirrors a cleared cell as an empty string — the array cannot say "cleared"', () => {
    const mirror = toJsonbMirror(
      [rec({ projectSkuId: 's1', attributeId: TEXT.id, value: null })],
      [TEXT],
    );
    expect(mirror).toEqual([{ attributeId: TEXT.id, name: TEXT.name, value: '', type: 'text' }]);
  });

  it('carries the attribute name and data type the readers expect', () => {
    const mirror = toJsonbMirror(
      [rec({ projectSkuId: 's1', attributeId: NUM.id, value: '42' })],
      [attr({ id: NUM.id, name: 'Total Power [W]', dataType: 'decimal' })],
    );
    expect(mirror).toEqual([
      { attributeId: NUM.id, name: 'Total Power [W]', value: '42', type: 'decimal' },
    ]);
  });

  it('still mirrors a value whose attribute is no longer defined', () => {
    // An orphaned value must not vanish from the mirror just because its attribute was
    // deleted — 102 of the live JSONB entries are exactly this case.
    expect(toJsonbMirror([rec({ projectSkuId: 's1', attributeId: 'gone', value: 'x' })], []))
      .toEqual([{ attributeId: 'gone', name: '', value: 'x' }]);
  });
});
