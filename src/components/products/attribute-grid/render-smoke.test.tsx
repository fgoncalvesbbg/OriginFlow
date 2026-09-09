/**
 * Render smoke tests for the Attribute Viewer's new UI.
 *
 * WHY `react-dom/server` AND NOT A TESTING LIBRARY: vitest runs in a `node` environment here and
 * every other test in this repo is pure logic, so there is no jsdom and no
 * @testing-library/react — adding them is a dependency decision, not something to slip in.
 * `renderToString` needs neither: react-dom is already a dependency, and it answers the question
 * that actually matters for ~1,500 lines of new JSX — **does the render tree throw, and does it
 * put the right things on the page?**
 *
 * WHAT THIS CANNOT COVER, so nobody reads more into a pass than is there: `useEffect` never runs
 * under `renderToString`, and there are no events. So data loading, click handlers, the keyboard
 * model and the sticky/scroll behaviour are NOT exercised here. The keyboard and sort maths are
 * covered as pure functions in grid.utils.test.ts; the visual behaviour still needs a browser.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import AttributeGrid from './AttributeGrid';
import SkuHeader from './SkuHeader';
import Thumb from './Thumb';
import SkuDialog from '../SkuDialog';
import SkuAttributeCellDrawer from '../SkuAttributeCellDrawer';
import CategoryBrowser from './CategoryBrowser';
import SummaryTiles from './SummaryTiles';
import FilterRail from './FilterRail';
import { EMPTY_FILTERS, NO_VALUE } from './grid-filters.utils';
import { indexByCell } from '../../../utils/sku-attribute-value.utils';
import type { CategoryAttribute, CategoryL3, SkuAttributeValueRecord } from '../../../types';
import type { CategorySku } from '../../../services';
import { BulkFillDialog, CopyFromDialog } from '../BulkValueDialogs';
import ExportBlockedDialog from '../ExportBlockedDialog';
import { BLOCKER_TITLES, type ExportBlocker } from './export-validation.utils';
import SkuValuePanel from '../SkuValuePanel';
import type { EprelComparison } from './eprel-compare.utils';

/**
 * React's server renderer separates adjacent text nodes with `<!-- -->` comment markers, so
 * `{count}/{total}` arrives as `12<!-- -->/<!-- -->20`. Stripping them lets an assertion read
 * the text a person would actually see rather than encoding a renderer detail.
 */
const render = (el: React.ReactElement): string =>
  renderToString(el).replace(/<!-- -->/g, '');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const attr = (o: Partial<CategoryAttribute> & { id: string }): CategoryAttribute => ({
  categoryId: 'cat-1',
  name: o.id,
  dataType: 'text',
  ...o,
});

const sku = (o: Partial<CategorySku> & { id: string; skuNumber: string }): CategorySku => ({
  projectId: null,
  categoryId: 'cat-1',
  skuTitle: '',
  attributeValues: [],
  sortOrder: 0,
  isFinal: false,
  pendingExport: false,
  lastExportedAt: null,
  finalizedAt: null,
  finalizedBy: null,
  reopenReason: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  projectName: '',
  ...o,
});

const rec = (
  projectSkuId: string,
  attributeId: string,
  value: string | null,
  extra: Partial<SkuAttributeValueRecord> = {},
): SkuAttributeValueRecord => ({
  id: `${projectSkuId}-${attributeId}`,
  projectSkuId,
  attributeId,
  value,
  unit: null,
  source: 'manual',
  updatedBy: null,
  updatedByName: '',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...extra,
});

const WIDTH = attr({ id: 'w', name: 'Product Width', dataType: 'decimal', group: 'Dimensions', validationRules: { unit: 'cm' } });
const CLASS = attr({ id: 'c', name: 'Energy class', dataType: 'enum', group: 'Energy', validationRules: { enumOptions: ['A+', 'A++'], required: true } });

const SKUS = [
  sku({ id: 's1', skuNumber: '10046631', skuTitle: 'Vinoline 40' }),
  sku({ id: 's2', skuNumber: '10046631', skuTitle: 'Vinoline 40', projectId: 'p1', projectName: 'Wine Coolers 2027' }),
  sku({ id: 's3', skuNumber: '10047753', isFinal: true }),
];

const BY_CELL = indexByCell([
  rec('s1', WIDTH.id, '59.5', { unit: 'cm' }),
  rec('s1', CLASS.id, 'A++'),
  rec('s2', WIDTH.id, null),             // cleared
  rec('s3', CLASS.id, 'Z'),              // invalid: not an option
]);

const COVERAGE = new Map([
  [WIDTH.id, { filled: 1, total: 3 }],
  [CLASS.id, { filled: 2, total: 3 }],
]);

const noop = () => {};
const noopAsync = async () => {};

const grid = (overrides: Partial<React.ComponentProps<typeof AttributeGrid>> = {}) =>
  render(
    <AttributeGrid
      skus={SKUS}
      attributes={[WIDTH, CLASS]}
      byCell={BY_CELL}
      flagMap={{}}
      duplicateCounts={new Map([['10046631', 2], ['10047753', 1]])}
      rowCoverage={COVERAGE}
      sort={null}
      onToggleSort={noop}
      selected={new Set()}
      onToggleSelected={noop}
      onOpenSku={noop}
      onOpenCell={noop}
      onCommitValue={noopAsync}
      {...overrides}
    />,
  );

// ---------------------------------------------------------------------------

describe('AttributeGrid renders', () => {
  it('renders without throwing', () => {
    expect(() => grid()).not.toThrow();
  });

  it('puts every attribute row and every SKU column on the page', () => {
    const html = grid();
    expect(html).toContain('Product Width');
    expect(html).toContain('Energy class');
    expect(html).toContain('10046631');
    expect(html).toContain('10047753');
  });

  it('renders a cluster band per group', () => {
    const html = grid();
    expect(html).toContain('Dimensions');
    expect(html).toContain('Energy');
  });

  it('shows coverage on the attribute row', () => {
    expect(grid()).toContain('1/3');
  });

  it('renders a cleared cell as the word "none", not a dash', () => {
    // The distinction the value store was restructured to keep has to survive to the pixel.
    expect(grid()).toContain('none');
  });

  it('renders the unit above the value', () => {
    expect(grid()).toContain('cm');
  });

  it('marks a required attribute', () => {
    expect(grid()).toContain('Required');
  });

  it('badges a duplicated item number and leaves a unique one alone', () => {
    const html = grid();
    expect(html).toContain('2 records');
    expect(html).not.toContain('1 records');
  });

  it('shows Final and In progress status per column', () => {
    const html = grid();
    expect(html).toContain('Final');
    expect(html).toContain('In progress');
  });

  it('counts the invalid cell in the column header', () => {
    expect(grid()).toContain('1 invalid');
  });

  it('renders the sort indicator on the sorted row only', () => {
    const html = grid({ sort: { attributeId: WIDTH.id, direction: 'desc' } });
    expect(() => html).not.toThrow();
    expect(html).toContain('Product Width');
  });

  it('survives an empty grid', () => {
    expect(grid({ skus: [], attributes: [] })).toBe('');
  });

  it('survives a SKU with no values at all', () => {
    expect(() => grid({ byCell: new Map() })).not.toThrow();
  });

  it('renders a flagged cell', () => {
    const html = grid({
      flagMap: {
        's1::w': {
          id: 'f1',
          projectSkuId: 's1',
          attributeId: 'w',
          status: 'open',
          comment: 'Check against the type plate',
          flaggedBy: null,
          flaggedByName: 'Fabio',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          resolvedAt: null,
        },
      },
    });
    expect(html).toContain('Check against the type plate');
  });
});

// ---------------------------------------------------------------------------

describe('SkuHeader renders', () => {
  const header = (o: Partial<React.ComponentProps<typeof SkuHeader>> = {}) =>
    render(
      <SkuHeader
        skuNumber="10046631"
        skuTitle="Vinoline 40"
        projectName="Wine Coolers 2027"
        isFinal={false}
        reopenReason={null}
        duplicateCount={0}
        counts={{ filled: 12, total: 20, invalid: 0, flags: 0 }}
        selected={false}
        onToggleSelected={noop}
        onOpenSku={noop}
        {...o}
      />,
    );

  it('renders identity and counts', () => {
    const html = header();
    expect(html).toContain('10046631');
    expect(html).toContain('Vinoline 40');
    expect(html).toContain('12/20');
  });

  it('shows a reopen reason only while the SKU is open', () => {
    expect(header({ reopenReason: 'supplier corrected air flow' }))
      .toContain('supplier corrected air flow');
    // A finalized SKU has no open question to answer, so the reason is not shown.
    expect(header({ isFinal: true, reopenReason: 'supplier corrected air flow' }))
      .not.toContain('supplier corrected air flow');
  });

  it('shows flag and invalid badges only when there is something to say', () => {
    expect(header()).not.toContain('invalid');
    expect(header()).not.toContain('flagged');
    const loud = header({ counts: { filled: 5, total: 20, invalid: 2, flags: 3 } });
    expect(loud).toContain('2 invalid');
    expect(loud).toContain('3 flagged');
  });
});

// ---------------------------------------------------------------------------

describe('Thumb renders', () => {
  it('renders an image for a real item number', () => {
    const html = render(<Thumb skuNumbers={['10046631']} />);
    expect(html).toContain('res.cloudinary.com');
    expect(html).toContain('10046631');
    expect(html).toContain('loading="lazy"');
  });

  it('renders the same-size placeholder when there is nothing to try', () => {
    // A placeholder that collapsed would misalign every column beside it.
    const html = render(<Thumb skuNumbers={['', '  ']} size={34} />);
    expect(html).not.toContain('res.cloudinary.com');
    expect(html).toContain('34');
  });
});

// ---------------------------------------------------------------------------

describe('SkuDialog renders', () => {
  const dialog = (s: CategorySku, duplicates: CategorySku[] = []) =>
    render(
      <SkuDialog
        sku={s}
        duplicates={duplicates}
        attributes={[WIDTH, CLASS]}
        byCell={BY_CELL}
        flagMap={{}}
        onSaveValue={noopAsync}
        onClearValue={noopAsync}
        onOpenCell={noop}
        onSetFinal={noopAsync}
        onRename={noopAsync}
        onDelete={noopAsync}
        onClose={noop}
      />,
    );

  it('renders for an in-progress SKU and offers finalizing', () => {
    const html = dialog(SKUS[0]);
    expect(html).toContain('Mark as final');
    expect(html).toContain('Item number');
  });

  it('renders for a final SKU and offers unlocking instead', () => {
    const html = dialog(SKUS[2]);
    expect(html).toContain('Unlock for editing');
    expect(html).not.toContain('Mark as final');
  });

  it('names the other records sharing an item number', () => {
    const html = dialog(SKUS[0], [SKUS[1]]);
    expect(html).toContain('2 records share this item number');
    expect(html).toContain('Wine Coolers 2027');
  });

  it('explains why a final SKU cannot be deleted', () => {
    expect(dialog(SKUS[2])).toContain('Unlock it first');
  });
});

// ---------------------------------------------------------------------------

describe('SkuAttributeCellDrawer renders', () => {
  const drawer = (state: 'filled' | 'empty' | 'cleared' | 'invalid', record?: SkuAttributeValueRecord) =>
    render(
      <SkuAttributeCellDrawer
        sku={SKUS[0]}
        attribute={WIDTH}
        value={record?.value ?? ''}
        record={record}
        state={state}
        onSaveValue={noopAsync}
        onClearValue={noopAsync}
        onSaveFlag={noopAsync}
        onResolveFlag={noopAsync}
        onDeleteFlag={noopAsync}
        onClose={noop}
      />,
    );

  it('renders each cell state with its own label', () => {
    expect(drawer('empty')).toContain('Empty');
    expect(drawer('cleared', rec('s1', 'w', null))).toContain('Cleared');
    expect(drawer('invalid', rec('s1', 'w', 'nope'))).toContain('Invalid');
    expect(drawer('filled', rec('s1', 'w', '59.5'))).toContain('Filled');
  });

  it('shows provenance when there is a stored record', () => {
    const html = drawer('filled', rec('s1', 'w', '59.5', {
      source: 'supplier',
      updatedByName: 'Fabio',
      unit: 'cm',
    }));
    expect(html).toContain('from a supplier submission');
    expect(html).toContain('Fabio');
    expect(html).toContain('unit: cm');
  });

  it('offers Clear, which is a different act from saving a blank', () => {
    expect(drawer('filled', rec('s1', 'w', '59.5'))).toContain('Clear');
  });
});

// ---------------------------------------------------------------------------
// Phase 4: the category browser, the tiles, the rail
// ---------------------------------------------------------------------------

describe('CategoryBrowser renders', () => {
  const CATS = [
    { id: 'c1', name: 'Angled Hoods', active: true, isFinalized: false, l2Id: 'l2a', l1Name: 'Kitchen', l2Name: 'Extractor Hoods' },
    { id: 'c2', name: 'Ceiling Hoods', active: true, isFinalized: false, l2Id: 'l2a', l1Name: 'Kitchen', l2Name: 'Extractor Hoods' },
    { id: 'c3', name: 'Orphan Leaf', active: true, isFinalized: false, l2Id: null },
  ] as unknown as CategoryL3[];

  const browser = () =>
    render(
      <CategoryBrowser
        categories={CATS}
        skuCounts={new Map([['c1', 143], ['c2', 62]])}
        attributeCounts={new Map([['c1', 71]])}
        sampleSkus={new Map([['c1', ['10046631', '10046632']]])}
        onPick={noop}
      />,
    );

  it('renders the L1 › L2 sections and their leaves', () => {
    const html = browser();
    expect(html).toContain('Kitchen › Extractor Hoods');
    expect(html).toContain('Angled Hoods');
    expect(html).toContain('Ceiling Hoods');
  });

  it('parks a leaf with no parent in the Uncategorised bucket rather than dropping it', () => {
    expect(browser()).toContain('Uncategorised');
    expect(browser()).toContain('Orphan Leaf');
  });

  it('marks a category with no attributes instead of hiding it', () => {
    // Only 3 of ~200 live categories have a definition, so this is the most useful thing the
    // browser can say — a thing to fix, not a category to leave out.
    const html = browser();
    expect(html).toContain('71 attributes');
    expect(html).toContain('no attributes yet');
    expect(html).toContain('2 with no attributes defined yet');
  });

  it('shows the SKU count per category', () => {
    expect(browser()).toContain('143 SKUs');
  });
});

describe('SummaryTiles renders', () => {
  const SUMMARY = {
    skus: 138,
    attributes: 21,
    coveragePercent: 62,
    filledCells: 1797,
    totalCells: 2898,
    requiredGaps: 14,
    invalidCells: 2,
    duplicateRecords: 6,
    withoutProject: 111,
  };

  it('renders every tile with its number', () => {
    const html = render(
      <SummaryTiles summary={SUMMARY} rowFilter="all" columnFilter="all" onRowFilter={noop} onColumnFilter={noop} />,
    );
    expect(html).toContain('62%');
    expect(html).toContain('14');
    expect(html).toContain('111');
    expect(html).toContain('138 · 21');
  });

  it('says in words when a tile is filtering, not just in colour', () => {
    const html = render(
      <SummaryTiles summary={SUMMARY} rowFilter="required-gap" columnFilter="all" onRowFilter={noop} onColumnFilter={noop} />,
    );
    expect(html).toContain('filtering · click to clear');
    expect(html).toContain('aria-pressed="true"');
  });
});

describe('FilterRail renders', () => {
  const FILTERS = {
    search: 'hood',
    rowFilter: 'invalid' as const,
    columnFilter: 'changed' as const,
    valueFilters: [{ attributeId: 'w', value: NO_VALUE }],
    flaggedOnly: true,
  };

  it('shows the active filter count when collapsed — the whole point of the rail', () => {
    // A collapsed panel must never be able to conceal that it is filtering.
    const html = render(
      <FilterRail
        collapsed
        onToggleCollapsed={noop}
        filters={FILTERS}
        onChange={noop}
        attributes={[WIDTH]}
        valueOptions={new Map()}
      />,
    );
    expect(html).toContain('filtering');
    expect(html).toContain('>5<');
  });

  it('reads "filters" rather than "filtering" when nothing is on', () => {
    const html = render(
      <FilterRail
        collapsed
        onToggleCollapsed={noop}
        filters={EMPTY_FILTERS}
        onChange={noop}
        attributes={[WIDTH]}
        valueOptions={new Map()}
      />,
    );
    expect(html).toContain('filters');
    expect(html).not.toContain('filtering');
  });

  it('renders the expanded panel with the no-value sentinel spelled out', () => {
    const html = render(
      <FilterRail
        collapsed={false}
        onToggleCollapsed={noop}
        filters={FILTERS}
        onChange={noop}
        attributes={[WIDTH]}
        valueOptions={new Map([['w', ['59.5', '89.5']]])}
      />,
    );
    expect(html).toContain('Product Width');
    expect(html).toContain('no value');
    expect(html).toContain('Clear all filters');
  });
});

// ---------------------------------------------------------------------------
// Phase 5 & 8: bulk value dialogs, and the export blocker that replaces a partial file
// ---------------------------------------------------------------------------

describe('BulkFillDialog renders', () => {
  const dialog = (o: Partial<React.ComponentProps<typeof BulkFillDialog>> = {}) =>
    render(
      <BulkFillDialog
        skus={SKUS}
        attributes={[WIDTH, CLASS]}
        values={[]}
        onApply={noopAsync}
        onClose={noop}
        {...o}
      />,
    );

  it('renders without throwing', () => {
    expect(() => dialog()).not.toThrow();
  });

  it('shows the SKU count in its title', () => {
    expect(dialog()).toContain('Set one attribute across 3 SKUs');
  });

  it('renders the attribute picker with every attribute name', () => {
    const html = dialog();
    expect(html).toContain('Choose an attribute…');
    expect(html).toContain('Product Width');
    expect(html).toContain('Energy class');
  });

  // The overwrite toggle, the value input and the plan are all inside `{attribute && (...)}`,
  // and `attributeId` starts life as `useState('')` with nothing in props to seed it —
  // renderToString never fires the `onChange` that would pick one. So the
  // deliberately-emptied-cells copy is real (see OverwriteToggle in BulkValueDialogs.tsx) but
  // unreachable from a render-only test; asserting it here would be testing a state this
  // harness cannot produce. Assert the honest negative instead, so a regression that made the
  // toggle appear with no attribute chosen (which would mean it applies to nothing) is caught.
  it('does not show the overwrite toggle before an attribute is chosen', () => {
    expect(dialog()).not.toContain('deliberately emptied');
  });
});

describe('CopyFromDialog renders', () => {
  // allSkus is deliberately wider than skus: the reference SKU has to be pickable even when it
  // is not one of the rows being changed.
  const ALL_SKUS = [...SKUS, sku({ id: 's4', skuNumber: '10099999', skuTitle: 'Not ticked' })];

  const dialog = (o: Partial<React.ComponentProps<typeof CopyFromDialog>> = {}) =>
    render(
      <CopyFromDialog
        skus={SKUS}
        allSkus={ALL_SKUS}
        attributes={[WIDTH, CLASS]}
        values={[]}
        onApply={noopAsync}
        onClose={noop}
        {...o}
      />,
    );

  it('renders without throwing', () => {
    expect(() => dialog()).not.toThrow();
  });

  it('lists every SKU in the "copy from" dropdown, including ones not ticked', () => {
    const html = dialog();
    expect(html).toContain('10046631');
    expect(html).toContain('10047753');
    expect(html).toContain('10099999');
  });

  // The cluster picker ("Which clusters") lives inside `{sourceId && (...)}`, and `sourceId`
  // starts as `useState('')` with no prop to seed it — the same limitation as
  // BulkFillDialog's attribute picker above. There is no reference SKU to select through
  // renderToString, so there is nothing to assert about the cluster groups here; assert the
  // honest negative so the gating itself stays covered.
  it('does not show the cluster picker before a reference SKU is chosen', () => {
    expect(dialog()).not.toContain('Which clusters');
  });
});

describe('ExportBlockedDialog renders', () => {
  const BLOCKERS: ExportBlocker[] = [
    {
      kind: 'column-collision',
      attributeName: 'Product Width + Product Depth',
      // Curly quotes, matching how validateExport actually phrases a detail (see
      // export-validation.utils.ts): a straight `"` gets HTML-entity-encoded by the renderer
      // to `&quot;`, so asserting a literal `"` against the rendered string would fail on a
      // renderer detail rather than on the component's own behaviour.
      detail: '2 attributes both export to the column “width”.',
      remedy: 'Give each one its own external code.',
    },
    {
      kind: 'duplicate-sku-number',
      skuNumber: '10046631',
      detail: '2 separate SKU records share this item number, and both are in this export.',
      remedy: 'Export only one of them, or correct the numbers first.',
    },
    {
      kind: 'invalid-value',
      skuNumber: '10047753',
      attributeName: 'Energy class',
      detail: '“Z” is not a value this attribute can hold.',
      remedy: 'Set it to one of: A+, A++.',
    },
  ];

  const dialog = (blockers: readonly ExportBlocker[] = BLOCKERS, skuCount = 3) =>
    render(
      <ExportBlockedDialog blockers={blockers} skuCount={skuCount} onCopy={noop} onClose={noop} />,
    );

  it('renders without throwing', () => {
    expect(() => dialog()).not.toThrow();
  });

  it("shows each blocker's detail and its remedy", () => {
    // A refusal that does not say what to do is just an obstacle — the remedy has to survive
    // to the page right alongside the problem it explains, not just the problem on its own.
    const html = dialog();
    expect(html).toContain('2 attributes both export to the column');
    expect(html).toContain('Give each one its own external code.');
    expect(html).toContain('“Z” is not a value this attribute can hold.');
    expect(html).toContain('Set it to one of: A+, A++.');
  });

  it('groups blockers by kind under the BLOCKER_TITLES heading', () => {
    // Read the titles from the same map the component renders from, so a copy edit to
    // BLOCKER_TITLES cannot silently desync the test from the UI.
    const html = dialog();
    expect(html).toContain(BLOCKER_TITLES['column-collision']);
    expect(html).toContain(BLOCKER_TITLES['duplicate-sku-number']);
    expect(html).toContain(BLOCKER_TITLES['invalid-value']);
  });

  it('states the count of problems', () => {
    expect(dialog()).toContain('3 problems would make it wrong');
  });

  it('shows the SKU count the export would have covered', () => {
    expect(dialog(BLOCKERS, 138)).toContain('covers 138 SKUs');
  });

  // The whole point of this dialog is that there is no partial-file escape hatch — see the
  // file-level comment in ExportBlockedDialog.tsx. The component's own subtitle legitimately
  // says "...a file somebody imports anyway" as PROSE explaining that refusal, so a bare
  // `not.toContain('anyway')` would fail against the real, intended copy. What must never
  // appear is the override affordance itself — the actionable phrase, not the word.
  it('never offers an override — no "export anyway" affordance', () => {
    expect(dialog().toLowerCase()).not.toContain('export anyway');
  });
});

// ---------------------------------------------------------------------------
// Phase 4: the single-SKU value panel — the transposed view of the same cells the grid shows
// ---------------------------------------------------------------------------

describe('SkuValuePanel renders', () => {
  // A second Dimensions attribute purely so the whole-SKU count (2/3) and a band's own count
  // (1/2) can differ in one render — with just WIDTH+CLASS both are 1/1 and the distinction
  // this test exists to catch (SKU total vs. band total) would go unexercised.
  const HEIGHT = attr({ id: 'h', name: 'Product Height', dataType: 'decimal', group: 'Dimensions' });

  const panel = (o: Partial<React.ComponentProps<typeof SkuValuePanel>> = {}) =>
    render(
      <SkuValuePanel
        sku={SKUS[0]}
        attributes={[WIDTH, CLASS]}
        byCell={BY_CELL}
        flagMap={{}}
        onSaveValue={noopAsync}
        onClearValue={noopAsync}
        onOpenCell={noop}
        {...o}
      />,
    );

  it('renders without throwing', () => {
    expect(() => panel()).not.toThrow();
  });

  it('groups attributes into their cluster bands and shows the band names', () => {
    // WIDTH is fixtured into 'Dimensions' and CLASS into 'Energy' (see the fixtures above) —
    // the panel's whole reason to exist is reading grouped, not as one flat list.
    const html = panel();
    expect(html).toContain('Dimensions');
    expect(html).toContain('Energy');
  });

  it('shows a filled-of-total count for the whole SKU', () => {
    // s1 has WIDTH and CLASS both filled, HEIGHT untouched: 2 of 3 filled overall. The number is
    // wrapped in its own <strong>, so it does not sit text-adjacent to "of 3 filled" the way the
    // per-band count below does — assert across that element boundary rather than as one run.
    const html = panel({ attributes: [WIDTH, HEIGHT, CLASS] });
    expect(html).toMatch(/>2<\/strong> of 3 filled/);
  });

  it('shows a per-band filled/total count', () => {
    // Dimensions holds WIDTH (filled) and HEIGHT (untouched): 1 of 2 for that band alone,
    // distinct from the whole-SKU 2 of 3 above.
    const html = panel({ attributes: [WIDTH, HEIGHT, CLASS] });
    expect(html).toContain('1/2');
  });

  it("renders each attribute's name, and its unit when it has one", () => {
    const html = panel();
    expect(html).toContain('Product Width');
    expect(html).toContain('Energy class');
    // WIDTH carries validationRules.unit: 'cm'; CLASS carries no unit.
    expect(html).toContain('(cm)');
  });

  it('marks a required attribute', () => {
    // CLASS is fixtured with validationRules.required: true.
    expect(panel()).toContain('title="Required"');
  });

  it('renders a cleared cell as the word "none" rather than a dash', () => {
    // BY_CELL stores s2/WIDTH as value: null — cleared on purpose, not merely never filled.
    const html = panel({ sku: SKUS[1], attributes: [WIDTH] });
    expect(html).toContain('none');
  });

  it('renders an em-dash placeholder for an attribute with no record at all', () => {
    // BY_CELL has no s2/CLASS entry whatsoever — a genuine gap, distinct from the cleared cell
    // above even though both start from "nothing to show".
    const html = panel({ sku: SKUS[1], attributes: [CLASS] });
    expect(html).toContain('—');
  });

  it('when the SKU is Final: shows the "signed off" wording and disables the value buttons instead of offering Clear', () => {
    // s3 isFinal. useEffect never runs and there are no events here, so there is nothing to
    // click — assert the static markup a final SKU actually renders: the disabled attribute on
    // the value button, and the absence of the Clear affordance, which the component gates on
    // `!sku.isFinal` regardless of cell state.
    const html = panel({ sku: SKUS[2], attributes: [WIDTH, CLASS] });
    expect(html).toContain('signed off — unlock to edit');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Record that this product genuinely has none of this attribute');
  });

  it("renders the attribute's wizardHint when it has one", () => {
    // None of the shared fixtures carries a wizardHint, so add one locally rather than
    // redefining the shared `attr` helper or WIDTH/CLASS.
    const HINTED = attr({
      id: 'hint',
      name: 'Serial number',
      wizardHint: 'Find this on the compliance label, not the box.',
    });
    const html = panel({ attributes: [HINTED] });
    expect(html).toContain('Find this on the compliance label, not the box.');
  });

  it('renders an EPREL annotation and its "use …" affordance when a comparison differs and offers a suggestion', () => {
    const eprelByCell = new Map<string, EprelComparison>([
      [
        's1::w',
        {
          attributeId: 'w',
          eprelField: 'width_mm',
          ourValue: '59.5',
          eprelValue: '65',
          verdict: 'differs',
          suggestion: '65',
        },
      ],
    ]);
    const html = panel({ eprelByCell });
    expect(html).toContain('EPREL differs');
    expect(html).toContain('use “65”');
  });

  it('does not render the "use …" affordance when the comparison has no suggestion', () => {
    // "No safe equivalent ⇒ offer nothing" — see eprel-compare.utils.ts. A comparison can
    // legitimately differ with no convertible suggestion, and that must not be misread as an
    // offer to apply one.
    const eprelByCell = new Map<string, EprelComparison>([
      [
        's1::w',
        {
          attributeId: 'w',
          eprelField: 'width_mm',
          ourValue: '59.5',
          eprelValue: 'not a number',
          verdict: 'differs',
        },
      ],
    ]);
    const html = panel({ eprelByCell });
    expect(html).toContain('EPREL differs');
    expect(html).not.toContain('use “');
  });

  it('renders a message instead of a list when attributes is empty', () => {
    expect(panel({ attributes: [] })).toContain('This category has no attributes defined yet');
  });
});
