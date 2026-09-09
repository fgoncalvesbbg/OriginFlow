/**
 * Roadmap Creator — row <-> domain translation.
 *
 * Pure, unit-tested, no I/O: `roadmap.service.ts` only ever sees these shapes. Ported from
 * ProductToolkit's `server/apps/roadmap/mapping.js`, which ran server-side because the Express
 * backend could not import from the frontend. Here it is client-side, so the axis list and the
 * status vocabulary exist exactly once (in `roadmap.constants.ts`) rather than in two copies that
 * could drift.
 *
 * `toImportRows()` is the payload builder for the `roadmap_import_skus` RPC. It emits DB COLUMN
 * NAMES, not the domain's camelCase, because the function reads the payload straight through
 * `jsonb_to_recordset` — putting the rename here means the SQL does no cleaning at all, so there
 * is exactly one place that decides what a cell means.
 */
import type { Row } from '../../data';
import type {
  RoadmapAttrs,
  RoadmapAuditEntry,
  RoadmapAxisValue,
  RoadmapImport,
  RoadmapItemFlag,
  RoadmapPlacer,
  RoadmapSku,
  RoadmapStatus,
} from '../../types';
import { AXIS_FIELDS } from '../../pages/roadmap/roadmap.constants';
import type { ParsedRoadmapRow } from '../../pages/roadmap/parse-workbook';

/**
 * A finite number, or null. NEVER NaN — a NaN in the payload becomes a confusing Postgres cast
 * error rather than an empty cell.
 */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Trimmed text capped to `max`, or null.
 *
 * The cap was originally about SQL Server column widths; the Postgres columns are unbounded
 * `text`, so it no longer prevents an error. It is kept because it still bounds the request: one
 * absurd cell in a 2,500-row export should not turn a ~2MB import into something the browser has
 * to think about. The widths are the source's, so the truncation behaviour is unchanged.
 */
function text(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/** The 7 axis attributes as a compact object, empty values dropped. */
export function toAttrsJson(attrs: RoadmapAttrs | undefined): RoadmapAttrs {
  const out: RoadmapAttrs = {};
  for (const f of AXIS_FIELDS) {
    const v = text(attrs?.[f], 256);
    if (v) out[f] = v;
  }
  return out;
}

/** `attrs_json` comes back as a parsed object from PostgREST; tolerate a string or junk anyway. */
export function fromAttrsJson(value: unknown): RoadmapAttrs {
  if (!value) return {};
  if (typeof value === 'object') return value as RoadmapAttrs;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as RoadmapAttrs) : {};
    } catch {
      // A hand-edited or truncated blob must not take down the whole board.
      return {};
    }
  }
  return {};
}

/** One row of the `roadmap_import_skus` payload — keys are `roadmap_sku` column names. */
export interface RoadmapImportRow {
  sku: string;
  description: string | null;
  family: string | null;
  system_index: string | null;
  image_url: string | null;
  factory_price: number | null;
  supplier: string | null;
  shop_link: string | null;
  amazon_link: string | null;
  attrs_json: RoadmapAttrs;
  nov_2025: number | null;
  nov_fc_2025: number | null;
  fc_ff_2025: number | null;
  noq_2025: number | null;
  sm_pct_2025: number | null;
  asp_2025: number | null;
  claim_rate_2025: number | null;
  nov_2026: number | null;
  nov_fc_2026: number | null;
  fc_ff_2026: number | null;
  noq_2026: number | null;
  sm_pct_2026: number | null;
  asp_2026: number | null;
  claim_rate_2026: number | null;
}

/**
 * Parsed workbook rows -> the import payload.
 *
 * DEDUPES ON `sku`, LAST ONE WINS. This is not optional: the RPC's `INSERT .. ON CONFLICT` raises
 * "cannot affect row a second time" if one statement touches the same key twice, and that error
 * tells a planner nothing they can act on. The real export has no duplicates (verified 2,510 rows,
 * 0 duplicates) but a hand-edited file is not guaranteed clean. The SQL has a `distinct on` net
 * behind this; this is the one that decides WHICH row survives.
 */
export function toImportRows(rows: readonly ParsedRoadmapRow[] | undefined): RoadmapImportRow[] {
  const bySku = new Map<string, RoadmapImportRow>();
  for (const r of rows || []) {
    const sku = text(r.sku, 64);
    if (!sku) continue;
    bySku.set(sku, {
      sku,
      description: text(r.description, 512),
      family: text(r.family, 256),
      system_index: text(r.systemIndex, 256),
      image_url: text(r.image, 1000),
      factory_price: num(r.price),
      supplier: text(r.supplier, 128),
      shop_link: text(r.shop, 1000),
      amazon_link: text(r.amazon, 1000),
      attrs_json: toAttrsJson(r.attrs),
      nov_2025: num(r.nov25),
      nov_fc_2025: num(r.novfc25),
      fc_ff_2025: num(r.fcff25),
      noq_2025: num(r.noq25),
      sm_pct_2025: num(r.sm25),
      asp_2025: num(r.asp25),
      claim_rate_2025: num(r.claim25),
      nov_2026: num(r.nov26),
      nov_fc_2026: num(r.novfc26),
      fc_ff_2026: num(r.fcff26),
      noq_2026: num(r.noq26),
      sm_pct_2026: num(r.sm26),
      asp_2026: num(r.asp26),
      claim_rate_2026: num(r.claim26),
    });
  }
  return [...bySku.values()];
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const asStatus = (v: unknown): RoadmapStatus => (v as RoadmapStatus) || 'pending';

export function fromSkuRow(row: Row): RoadmapSku {
  return {
    sku: row.sku,
    description: row.description || '',
    family: row.family || '',
    systemIndex: row.system_index || '',
    image: row.image_url || '',
    price: row.factory_price == null ? null : Number(row.factory_price),
    supplier: row.supplier || '',
    shop: row.shop_link || '',
    amazon: row.amazon_link || '',
    attrs: fromAttrsJson(row.attrs_json),
    nov25: row.nov_2025 == null ? null : Number(row.nov_2025),
    novfc25: row.nov_fc_2025 == null ? null : Number(row.nov_fc_2025),
    fcff25: row.fc_ff_2025 == null ? null : Number(row.fc_ff_2025),
    noq25: row.noq_2025 == null ? null : Number(row.noq_2025),
    sm25: row.sm_pct_2025 == null ? null : Number(row.sm_pct_2025),
    asp25: row.asp_2025 == null ? null : Number(row.asp_2025),
    claim25: row.claim_rate_2025 == null ? null : Number(row.claim_rate_2025),
    nov26: row.nov_2026 == null ? null : Number(row.nov_2026),
    novfc26: row.nov_fc_2026 == null ? null : Number(row.nov_fc_2026),
    fcff26: row.fc_ff_2026 == null ? null : Number(row.fc_ff_2026),
    noq26: row.noq_2026 == null ? null : Number(row.noq_2026),
    sm26: row.sm_pct_2026 == null ? null : Number(row.sm_pct_2026),
    asp26: row.asp_2026 == null ? null : Number(row.asp_2026),
    claim26: row.claim_rate_2026 == null ? null : Number(row.claim_rate_2026),
    isCurrent: row.is_current !== false,
    lastSeenAt: iso(row.last_seen_at),
  };
}

export function fromFlagRow(row: Row): RoadmapItemFlag {
  return {
    sku: row.sku,
    flag: row.flag || null,
    comment: row.comment || '',
    projectCode: row.project_code || '',
    status: asStatus(row.status),
    approvedBy: row.approved_by || null,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by || null,
  };
}

export function fromPlacerRow(row: Row): RoadmapPlacer {
  return {
    id: row.placer_id,
    category: row.category,
    yField: row.y_field,
    xField: row.x_field,
    family: row.family,
    yValue: row.y_value,
    xValue: row.x_value,
    type: row.type,
    comment: row.comment || '',
    projectCode: row.project_code || '',
    expected2027Nic: row.expected_2027_nic == null ? null : Number(row.expected_2027_nic),
    status: asStatus(row.status),
    approvedBy: row.approved_by || null,
    sortOrder: row.sort_order ?? 0,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by || null,
  };
}

export function fromAxisValueRow(row: Row): RoadmapAxisValue {
  return {
    id: row.axis_value_id,
    kind: row.kind,
    category: row.category,
    field: row.field || null,
    value: row.value,
    createdBy: row.created_by || null,
  };
}

export function fromImportRow(row: Row): RoadmapImport {
  return {
    importId: row.import_id,
    fileName: row.file_name || '',
    rowCount: row.row_count,
    insertedCount: row.inserted_count,
    updatedCount: row.updated_count,
    delistedCount: row.delisted_count,
    importedAt: iso(row.imported_at),
    importedBy: row.imported_by || null,
  };
}

export function fromAuditRow(row: Row): RoadmapAuditEntry {
  return {
    id: Number(row.audit_id),
    entity: row.entity,
    entityKey: row.entity_key || '',
    action: row.action,
    category: row.category || '',
    sku: row.sku || '',
    before: row.before_json ?? null,
    after: row.after_json ?? null,
    changedAt: iso(row.changed_at),
    changedBy: row.changed_by || null,
  };
}
