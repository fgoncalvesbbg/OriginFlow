/**
 * Document codes.
 *
 * The claim this file exists to keep honest: the code identifies exactly one document. A code
 * built from category NAMES does not — across the 132 live L3 categories an L1+L3 abbreviation
 * collapses to 111 distinct codes and an L2+L3 one to 126. The four groups below are the real
 * L2+L3 collisions, taken from the live category tree; the fingerprint has to separate every
 * one of them, or the whole scheme is a lie printed on safety documents.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDocCode,
  categoryFingerprint,
  docCodeKind,
  isValidDocCode,
  DOC_CODE_RE,
  FINGERPRINT_LENGTH,
} from './im-doc-code';

/** [categoryId, l2Name, l3Name] — the live categories whose readable code is identical. */
const REAL_COLLISIONS: Record<string, Array<[string, string, string]>> = {
  'GAR-GARDEN': [
    ['615eb458-f2e3-4b57-8e62-947a6badf1a7', 'Garden Furniture', 'Garden Chairs'],
    ['3787904c-0545-4e30-8390-2aeeaaced281', 'Garden Furniture', 'Garden Tables'],
    ['050ea4ef-572b-4eb2-beee-56963098a7c5', 'Garden Utilities', 'Garden Showers'],
  ],
  'IND-ELECTR': [
    ['0830564c-058b-4074-9b04-0c39483bb9dc', 'Indoor Heaters', 'Electric Radiators'],
    ['43ee35d5-3c00-492d-85e4-5c7fd5958eeb', 'Indoor Heaters', 'Electric Fireplaces'],
  ],
  'KIT-KITCHE': [
    ['da1fce3a-3990-436e-acce-e0ffc0cb166f', 'Kitchen', 'Kitchen Helpers'],
    ['fb233660-2693-4453-8c80-bd64a99e0f4c', 'Kitchen', 'Kitchen Sinks'],
    ['d00c67e5-1595-4994-ac7a-f38684fd00fa', 'Kitchen', 'Kitchen Knives'],
  ],
  'REF-FRIDGE': [
    ['880f6247-c575-4815-bbda-f3df07118062', 'Refrigerators', 'Fridges without Freezers'],
    ['09b463d6-be94-40fa-aa3b-dc0a5e19d796', 'Refrigerators', 'Fridges with Freezers'],
  ],
};

const leafletCode = (id: string, l2: string, l3: string) =>
  buildDocCode({ templateType: 'warning_leaflet', pageSize: 'a5', categoryId: id, l2Name: l2, l3Name: l3 });

describe('buildDocCode', () => {
  it('reads as type, family, category, fingerprint, page size', () => {
    // Large Appliances / Range Hoods / Angled Hoods — the leaflet this layout was built against.
    expect(leafletCode('afe42b9b-92ab-474b-859b-a73a0ca81459', 'Range Hoods', 'Angled Hoods')).toBe(
      'WL-RAN-ANGLED-8MJ-A5',
    );
  });

  it('distinguishes a leaflet from a manual, and A4 from A5', () => {
    const id = '63eefd85-a97d-40f0-a2be-be72ab765dab';
    expect(buildDocCode({ templateType: 'warning_leaflet', pageSize: 'a5', categoryId: id, l2Name: 'Hobs', l3Name: 'Gas Hobs' })).toBe('WL-HOB-GASHOB-3ZT-A5');
    expect(buildDocCode({ templateType: 'im', pageSize: 'a4', categoryId: id, l2Name: 'Hobs', l3Name: 'Gas Hobs' })).toBe('IM-HOB-GASHOB-3ZT-A4');
  });

  it('separates every real category collision the readable half cannot', () => {
    for (const [readable, members] of Object.entries(REAL_COLLISIONS)) {
      const codes = members.map(([id, l2, l3]) => leafletCode(id, l2, l3));
      // All members really do share the readable half — otherwise this fixture is stale and
      // the test would be proving nothing.
      for (const code of codes) expect(code).toContain(readable);
      expect(new Set(codes).size).toBe(members.length);
    }
  });

  it('is unique across every live category, not just the colliding ones', () => {
    const all = Object.values(REAL_COLLISIONS).flat();
    const codes = all.map(([id, l2, l3]) => leafletCode(id, l2, l3));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('is stable — the same inputs always give the same code', () => {
    const args = ['4270ecd7-4ddf-4993-9c30-cc49daa7a4a4', 'Hobs', 'Induction Hobs'] as const;
    expect(leafletCode(...args)).toBe(leafletCode(...args));
    expect(leafletCode(...args)).toBe('WL-HOB-INDUCT-RES-A5');
  });

  it('keeps the fingerprint when the category is RENAMED', () => {
    // Category names change — six live ones were renamed in a single day in August 2026. The
    // readable half may drift, but an old printed code must still resolve to the right
    // category, so the fingerprint half has to be name-independent.
    const id = '6a75a2ac-c143-49c6-a288-e76744d11a20';
    const fp = categoryFingerprint(id);
    const before = leafletCode(id, 'Indoor Heaters', 'Convectors');
    // A rename big enough to move the readable half.
    const renamed = leafletCode(id, 'Room Heating', 'Panel Convectors');
    expect(before).toBe(`WL-IND-CONVEC-${fp}-A5`);
    expect(renamed).toBe(`WL-ROO-PANELC-${fp}-A5`);
    expect(before).not.toBe(renamed);
    // The half that identifies the category is the same in both, so an old printed code still
    // resolves — which is the whole reason the fingerprint is there.
    expect(before).toContain(fp);
    expect(renamed).toContain(fp);
  });

  it('is unchanged by a rename too small to move the abbreviation', () => {
    // "Indoor Heaters" -> "Indoor Heating" keeps IND, "Convectors" -> "Convector Heaters"
    // keeps CONVEC. Desirable: a copy-edit to a category name must not invalidate printed
    // stock.
    const id = '6a75a2ac-c143-49c6-a288-e76744d11a20';
    expect(leafletCode(id, 'Indoor Heating', 'Convector Heaters')).toBe(
      leafletCode(id, 'Indoor Heaters', 'Convectors'),
    );
  });

  it('drops non-letters from names instead of emitting them', () => {
    // "Kids' Water Bottles" (curly apostrophe), "Waste & Storage", "Under-Cabinet Hoods".
    const code = leafletCode('c1ae1062-3f02-4b6f-b9d6-fca913896bc2', 'Dining & Tableware', 'Kids’ Water Bottles');
    expect(code).toMatch(DOC_CODE_RE);
    expect(code).toContain('-DIN-KIDSWA-');
  });

  it('degrades to placeholders rather than throwing when a name is missing', () => {
    const code = buildDocCode({ templateType: 'warning_leaflet', pageSize: 'a5', categoryId: 'abc' });
    expect(code).toBe(`WL-XXX-XXXXXX-${categoryFingerprint('abc')}-A5`);
    expect(code).toMatch(DOC_CODE_RE);
  });

  it('returns nothing when there is no category — a code with no category is a lie', () => {
    expect(buildDocCode({ templateType: 'warning_leaflet', pageSize: 'a5', categoryId: '' })).toBe('');
    expect(buildDocCode({ templateType: 'warning_leaflet', pageSize: 'a5', categoryId: '   ' })).toBe('');
  });
});

describe('categoryFingerprint', () => {
  it('avoids look-alike characters, because codes get read off paper and typed back', () => {
    const ids = Array.from({ length: 400 }, (_, i) => `cat-${i}-${i * 7919}`);
    for (const id of ids) {
      expect(categoryFingerprint(id)).toHaveLength(FINGERPRINT_LENGTH);
      expect(categoryFingerprint(id)).not.toMatch(/[ILOU01]/);
    }
  });

  it('spreads ids across the space instead of clustering', () => {
    // Not a distribution proof, just a guard against a hash that ignores most of its input —
    // e.g. one that only reads the first characters of a uuid, which share a prefix pattern.
    const ids = Array.from({ length: 500 }, (_, i) => `9f2de5bf-7534-40b1-82cb-6f5fc3ae${String(i).padStart(4, '0')}`);
    const seen = new Set(ids.map((id) => categoryFingerprint(id)));
    expect(seen.size).toBeGreaterThan(450);
  });
});

describe('docCodeKind', () => {
  it('is WL for leaflets and IM for everything else', () => {
    expect(docCodeKind('warning_leaflet')).toBe('WL');
    expect(docCodeKind('im')).toBe('IM');
  });
});

describe('isValidDocCode', () => {
  it('accepts what buildDocCode produces', () => {
    expect(isValidDocCode('WL-RAN-ANGLED-8MJ-A5')).toBe(true);
    expect(isValidDocCode('IM-HOB-GASHOB-3ZT-A4')).toBe(true);
  });

  it('rejects anything else, so only a real code can be stamped on a PDF', () => {
    for (const bad of [
      '',
      'WL-RAN-ANGLED-8MJ',            // no page size
      'WL-RAN-ANGLED-8MJ-A3',         // not a page size we print
      'XX-RAN-ANGLED-8MJ-A5',         // unknown document type
      'WL-RAN-ANGLED-8M-A5',          // short fingerprint
      'WL-RAN-ANGLED-8MI-A5',         // look-alike character
      'WL-RAN-ANGLEDHOODS-8MJ-A5',    // over-long category segment
      'WL-RAN-ANGLED-8MJ-A5 <script>',
      null,
      undefined,
      42,
    ]) {
      expect(isValidDocCode(bad)).toBe(false);
    }
  });
});
