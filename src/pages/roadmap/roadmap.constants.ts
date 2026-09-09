/**
 * Roadmap Creator — the source-file contract and the board's closed vocabularies.
 *
 * The columns this module reads out of the `ProductFactoryPrices_Analysis` export. Columns are
 * matched by header TEXT on the "Working Tab" sheet, NEVER by position, so inserting a column
 * upstream does not break the parser.
 *
 * Adding an 8th axis field is an edit to AXIS_FIELDS here and nothing else — the axis attributes
 * are stored as one `attrs_json` object, so there is no DDL to change. (The source had to mirror
 * this list server-side in `mapping.js` because the backend could not import from the frontend;
 * here the mapping is client-side too, so there is exactly one copy.)
 *
 * The enum-ish values below are duplicated as CHECK constraints in
 * db_migrations/167_roadmap_creator.sql. Keep the two in step.
 */
import type { RoadmapFlag, RoadmapPlacerType, RoadmapStatus } from '../../types';

/** The attributes offered as grid axes, chart lanes and chart filters. */
export const AXIS_FIELDS = [
  'Main Color',
  'Segment 01',
  'Segment 02',
  'Segment 03',
  'Segment 04',
  'Segment 05',
  'IoT',
] as const;

/**
 * Every header the parser insists on. A missing one fails the import LOUDLY rather than silently
 * producing a board full of blanks — which is the difference between "this file is wrong" and a
 * planner quietly making decisions against empty cards.
 */
export const REQUIRED_HEADERS: readonly string[] = [
  'SKU',
  'Description',
  'Family',
  'System Index',
  'Product Image',
  'Est. Factory Price',
  'Supplier',
  'Shop Link',
  'Amazon DE Link',
  'NOV_2025',
  'NOV FC 2025',
  'FC FF NOV_2025',
  'NOQ_2025',
  'SM%_2025',
  'ASP_2025',
  '2025 Claim Rate',
  'NOV_2026',
  'NOV FC 2026',
  'FC FF NOV_2026',
  'NOQ_2026',
  'SM%_2026',
  'ASP_2026',
  '2026 Claim Rate',
  ...AXIS_FIELDS,
];

/** The sheet the table lives on. Matched case-insensitively; falls back to the first sheet. */
export const SHEET_NAME = 'Working Tab';

export interface ItemFlagOption {
  key: RoadmapFlag;
  label: string;
  overlay: string;
  /** CSS tone suffix — drives the `--rep-*` / `--eol-*` custom-property pairs in styles.css. */
  tone: string;
}

/**
 * Per-SKU marks. `key` is what the database stores; `label` is what the board shows.
 *
 * Board status hues are a SEPARATE VOCABULARY from the action colour: Replace uses indigo, not
 * the coral accent, specifically so "this card is selected" can never read as "this is a Replace
 * SKU". Every mark pairs its hue with a text label — colour alone never carries state.
 */
export const ITEM_FLAGS: readonly ItemFlagOption[] = [
  { key: 'replace', label: 'Replace', overlay: 'REPLACE', tone: 'rep' },
  { key: 'eol', label: 'EOL', overlay: 'EOL', tone: 'eol' },
  { key: 'aeol', label: 'Already EOL', overlay: 'ALREADY EOL', tone: 'aeol' },
  { key: 'upcoming', label: 'Upcoming item', overlay: 'UPCOMING ITEM', tone: 'upc' },
];

export interface PlacerTypeOption {
  key: RoadmapPlacerType;
  label: string;
  title: string;
}

/** Placeholder cards dropped into an empty cell for a product that does not exist yet. */
export const PLACER_TYPES: readonly PlacerTypeOption[] = [
  { key: 'new', label: 'New item', title: 'NEW ITEM' },
  { key: 'upcoming', label: 'Upcoming item', title: 'UPCOMING ITEM' },
];

/** Default axes — the pair with the best fill rate in the real export. */
export const DEFAULT_Y_FIELD = 'Main Color';
export const DEFAULT_X_FIELD = 'Segment 01';

export const STATUSES: readonly RoadmapStatus[] = ['pending', 'approved', 'rejected'];

export const STATUS_LABELS: Record<RoadmapStatus, string> = {
  pending: 'To be Reviewed',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * Sentinel `category` value meaning "every category". Understood by the board hook (which fetches
 * the cross-category board) and by the page, which then restricts the SKU Roadmap and Step-Up
 * Chart tabs — both single-category pivots — to a "pick one category" notice, and lets only
 * History and Summary, which read flat lists rather than a pivoted grid, work across everything.
 * Never a real System Index value, so it cannot collide.
 */
export const ALL_CATEGORIES = '__all__';
export const ALL_CATEGORIES_LABEL = 'All categories';
