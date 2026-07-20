import { describe, it, expect } from 'vitest';
import { parseAttributeCsv, ParsedAttributeRow } from './attribute-csv-import.utils';

// Mirrors the shape of docs/beverage coolers.csv: blank lead-in rows, header on a later row,
// blank separator rows, and the various type/group/option cases we must normalize.
const CSV = [
  ',,,,,',
  ',,,,,',
  'Attribute,Type,Akeneo Code,Suggested Data Type,Options / Range,Notes',
  'Segment 1,Category & Segmentation,segment_1,Simple select,Thermo; Compressor,',
  'Variation 2 - Value,Listing & Data,VARIATION 2 - VALUE,Simple select,Black; White; Silver,',
  'Refrigerant weight [g],1 . Category Specific Attributes,coolant_weight,Number,Observed range: 17–42 (g),',
  'No. of Bottles,1 . Category Specific Attributes,bottle_capacity_zone_1,Number (integer),Observed range: 18–336,',
  'Adjustable Shelves Height [Y/N],1 . Category Specific Attributes,has_adjustable_shelves,Boolean (Yes/No),Yes; No,',
  'Number of shelfs,1 . Category Specific Attributes,NEW3,Number (integer),Observed range: 1–5,placeholder',
  'Door Material,1 . Category Specific Attributes,main_door_material,Reference entity (single link),Solid; Glass; Metal,',
  'Energy efficiency class,2. Standard Specs,energy_efficiency_scale,Simple select,A; B; C; D; E; F; G,',
  'Product Height [cm],3. Product Dimensions,hoehe,Number,Observed range: 30.3–192,',
  'Type of batteries main unit,4. Battery Information,battery_type,Simple select,No data — recommend standard set,No data yet',
  ',,,,,',
  "Box 1 - Content,5. Packaging,package_1_contents,Text,Free text,",
  "Box 2 - Content,5. Packaging,package_1_contents,Text,Free text,",
].join('\n');

const byName = (rows: ParsedAttributeRow[], name: string) => rows.find(r => r.name === name)!;

describe('parseAttributeCsv', () => {
  const rows = parseAttributeCsv(CSV);

  it('skips the blank lead-in, header, and blank separator rows', () => {
    expect(rows).toHaveLength(12);
    expect(rows.every(r => r.name.trim().length > 0)).toBe(true);
  });

  it('maps CSV sections to the correct groups (incl. the new category-scoped groups)', () => {
    expect(byName(rows, 'Segment 1').group).toBe('Segmentation');
    expect(byName(rows, 'Variation 2 - Value').group).toBe('Variation Axes');
    expect(byName(rows, 'No. of Bottles').group).toBe('Category Specific');
    expect(byName(rows, 'Energy efficiency class').group).toBe('Standard Electric Specs');
    expect(byName(rows, 'Product Height').group).toBe('Product Dimensions');
    expect(byName(rows, 'Box 1 - Content').group).toBe('Packaging');
  });

  it('maps suggested data types, including reference entity -> enum', () => {
    expect(byName(rows, 'Refrigerant weight').dataType).toBe('decimal');
    expect(byName(rows, 'No. of Bottles').dataType).toBe('integer');
    expect(byName(rows, 'Adjustable Shelves Height [Y/N]').dataType).toBe('boolean');
    expect(byName(rows, 'Segment 1').dataType).toBe('enum');
    expect(byName(rows, 'Door Material').dataType).toBe('enum');
    expect(byName(rows, 'Box 1 - Content').dataType).toBe('text');
  });

  it('splits enum options on semicolons', () => {
    expect(byName(rows, 'Energy efficiency class').enumOptions).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(byName(rows, 'Door Material').enumOptions).toEqual(['Solid', 'Glass', 'Metal']);
  });

  it('extracts units from numeric labels and strips them from the name; no min/max set', () => {
    const w = byName(rows, 'Refrigerant weight');
    expect(w.unit).toBe('g');
    const h = byName(rows, 'Product Height');
    expect(h.unit).toBe('cm');
  });

  it('does NOT treat non-numeric bracket hints as units', () => {
    expect(byName(rows, 'Adjustable Shelves Height [Y/N]').unit).toBeUndefined();
  });

  it('flags placeholder codes, prose option cells, and duplicate codes', () => {
    expect(byName(rows, 'Number of shelfs').flags.some(f => /placeholder/i.test(f))).toBe(true);
    const battery = byName(rows, 'Type of batteries main unit');
    expect(battery.enumOptions ?? []).toHaveLength(0);
    expect(battery.flags.some(f => /no usable options/i.test(f))).toBe(true);
    expect(byName(rows, 'Box 2 - Content').flags.some(f => /duplicate akeneo code/i.test(f))).toBe(true);
  });
});
