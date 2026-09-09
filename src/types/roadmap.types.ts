/**
 * Roadmap Creator — domain types (migration 167).
 *
 * Ported from ProductToolkit's `server/apps/roadmap/mapping.js`. The FIELD NAMES ARE LOAD-BEARING
 * and deliberately terse (`nov25`, `sm26`, `asp25` rather than `netOperatingValue2025`): the pure
 * grid/chart/summary logic and every card in the UI were written against exactly these names, and
 * renaming them would mean rewriting ~700 lines of tested logic to no benefit. They are the
 * prototype's own vocabulary, and the spreadsheet's.
 *
 * The split below mirrors the schema's two halves, which must never damage each other:
 * `RoadmapSku` and `RoadmapImport` are REFERENCE data, replaced by an upload and written only by
 * `roadmap_import_skus()`; everything else is an ANNOTATION, written only by a person. See
 * db_migrations/167_roadmap_creator.sql and docs/originflow-roadmap-creator-module.md.
 */

/** Per-SKU mark. `null` on a flag row means "a comment with no mark" — a real, rendered state. */
export type RoadmapFlag = 'replace' | 'eol' | 'aeol' | 'upcoming';

/** Placeholder card dropped into an empty grid cell for a product that does not exist yet. */
export type RoadmapPlacerType = 'new' | 'upcoming';

/** Summary-tab review state for a New Project / Replacement / EOL row. */
export type RoadmapStatus = 'pending' | 'approved' | 'rejected';

/** What a hand-added axis value is: a family band, a Y-axis row, or an X-axis column. */
export type RoadmapAxisKind = 'family' | 'row' | 'col';

export type RoadmapAuditEntity = 'flag' | 'placer' | 'axis' | 'import';
export type RoadmapAuditAction = 'set' | 'clear' | 'add' | 'remove' | 'edit' | 'import';

/**
 * The 7 axis attributes (Main Color, Segment 01-05, IoT), stored as one `attrs_json` object.
 * Open-keyed on purpose: adding an 8th axis is an edit to AXIS_FIELDS with no DDL and no type
 * change.
 */
export type RoadmapAttrs = Record<string, string>;

/** One SKU of reference data. Every numeric field is nullable — the export has real gaps. */
export interface RoadmapSku {
  sku: string;
  description: string;
  family: string;
  /** The export's System Index — the "category" a board is built for. */
  systemIndex: string;
  image: string;
  /** Estimated factory price. */
  price: number | null;
  supplier: string;
  shop: string;
  amazon: string;
  attrs: RoadmapAttrs;
  // 2025 actuals
  nov25: number | null;
  novfc25: number | null;
  fcff25: number | null;
  noq25: number | null;
  sm25: number | null;
  asp25: number | null;
  claim25: number | null;
  // 2026 forecast
  nov26: number | null;
  novfc26: number | null;
  fcff26: number | null;
  noq26: number | null;
  sm26: number | null;
  asp26: number | null;
  claim26: number | null;
  /**
   * False once the SKU stops appearing in the latest import. The row is NEVER deleted — it
   * renders dimmed with a "not in latest file" tag, so an EOL note written against it survives.
   * This is the visible half of the schema's load-bearing guarantee.
   */
  isCurrent: boolean;
  lastSeenAt: string | null;
}

export interface RoadmapItemFlag {
  sku: string;
  flag: RoadmapFlag | null;
  comment: string;
  projectCode: string;
  status: RoadmapStatus;
  approvedBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface RoadmapPlacer {
  id: number;
  category: string;
  /** The six-part cell address. Stored as real columns so the orphan report is a plain query. */
  yField: string;
  xField: string;
  family: string;
  yValue: string;
  xValue: string;
  type: RoadmapPlacerType;
  comment: string;
  projectCode: string;
  /** Manual revenue estimate for a SKU that does not exist yet; summed once Approved. */
  expected2027Nic: number | null;
  status: RoadmapStatus;
  approvedBy: string | null;
  sortOrder: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface RoadmapAxisValue {
  id: number;
  kind: RoadmapAxisKind;
  category: string;
  /** The axis field a row/col belongs to. Null for a family. */
  field: string | null;
  value: string;
  createdBy: string | null;
}

export interface RoadmapImport {
  importId: number;
  fileName: string;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  delistedCount: number;
  importedAt: string | null;
  importedBy: string | null;
}

export interface RoadmapAuditEntry {
  id: number;
  entity: RoadmapAuditEntity;
  entityKey: string;
  action: RoadmapAuditAction;
  category: string;
  sku: string;
  before: unknown;
  after: unknown;
  changedAt: string | null;
  changedBy: string | null;
}

/** Everything one board needs, fetched together. */
export interface RoadmapBoard {
  /** The selected category, or ALL_CATEGORIES. */
  category: string;
  skus: RoadmapSku[];
  flags: RoadmapItemFlag[];
  placers: RoadmapPlacer[];
  axisValues: RoadmapAxisValue[];
}

/**
 * Someone who may approve a Summary-tab row — an admin, derived from `profiles.role`, never a
 * hardcoded list (the source hardcoded two names in two files).
 *
 * The `approved_by` column stores the NAME, not the id: it is a snapshot of who decided, so an
 * approval still reads correctly after that person is renamed, loses admin, or leaves.
 */
export interface RoadmapApprover {
  userId: string;
  name: string;
}

/** What `roadmap_categories()` returns for the category picker. */
export interface RoadmapCategory {
  systemIndex: string;
  skuCount: number;
  currentCount: number;
}

/** What `roadmap_import_skus()` returns. */
export interface RoadmapImportResult {
  importId: number;
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  delistedCount: number;
}

/**
 * An annotation that no longer has a SKU behind it — the History tab's orphan report. These are
 * the rows that only the union rule's "referenced by an existing placer" clause is keeping
 * visible on the board (see grid.ts).
 */
export interface RoadmapOrphan {
  kind: 'placer' | 'axis';
  id: number;
  category: string;
  label: string;
  detail: string;
}
