/**
 * Stored SKU attribute values — the row-level value store behind the Attribute Viewer.
 *
 * `sku_attribute_values` (migration 155) is authoritative: one row per (SKU record,
 * attribute) that anyone has touched, `value NULL` meaning explicitly cleared and no row
 * meaning never touched. `project_skus.attribute_values` is kept as a lossy MIRROR,
 * refreshed by every write here, because it is still read by the ProductToolkit readback
 * API, the IM placeholder wizard, and the supplier/compliance request prefill in
 * ProjectDetail and CreateComplianceRequest (all via getEffectiveSkuValue).
 *
 * WHAT THIS FILE DOES NOT DO, on purpose:
 *
 *  - It does not write the audit trail. A trigger does (migration 158), so a write path
 *    added later cannot forget to log. Same for the actor: it is taken from the session
 *    server-side, so what a caller passes is a fallback for the no-JWT (service role)
 *    path, not the source of truth.
 *  - It does not enforce the signed-off (Final) lock. A trigger does, for the same
 *    reason — the browser talks to PostgREST directly, so a client-side check is a
 *    suggestion. `planBulkFill` still reports Final SKUs as skipped so the UI can say so
 *    before anybody presses anything; the database is what makes it true.
 *  - It decides nothing. Every judgement lives in
 *    utils/sku-attribute-value.utils.ts as a pure function, unit tested there.
 *
 * Phase 1 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type {
  CategoryAttribute,
  SkuAttributeValue,
  SkuAttributeValueRecord,
  SkuValueSource,
} from '../../types';
import {
  cellKey,
  indexByCell,
  isInvalidValue,
  planBulkFill,
  planCopyFrom,
  planJsonbSync,
  validationModeFor,
  type BulkTarget,
  type CopyPlanEntry,
  type FillableSku,
} from '../../utils/sku-attribute-value.utils';
import { validateAttributeValue } from '../../utils/attribute-validation.utils';

const TABLE = 'sku_attribute_values';

/**
 * How many SKU ids to put in one `in (...)` filter. A category can carry ~140 SKUs and a
 * uuid is 36 characters, so an unchunked filter builds a multi-kilobyte query string —
 * fine for PostgREST, not reliably fine for every proxy in front of it.
 */
const ID_CHUNK = 100;

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export const mapSkuAttributeValue = (r: any): SkuAttributeValueRecord => ({
  id: r.id,
  projectSkuId: r.project_sku_id,
  attributeId: r.attribute_id,
  // Deliberately NOT `?? ''`. Null is a fact here — the cell was cleared — and collapsing
  // it to an empty string destroys the distinction the whole table exists to keep.
  value: r.value ?? null,
  unit: r.unit ?? null,
  source: (r.source ?? 'manual') as SkuValueSource,
  updatedBy: r.updated_by ?? null,
  updatedByName: r.updated_by_name ?? '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Every stored value for the given SKU records. `[]` when there are none, or on failure. */
export const getValuesForSkus = async (
  projectSkuIds: readonly string[],
): Promise<SkuAttributeValueRecord[]> => {
  if (!isLive || projectSkuIds.length === 0) return [];
  const batches = await Promise.all(
    chunk(projectSkuIds, ID_CHUNK).map(ids =>
      orEmpty(
        db.select<Row>(TABLE, { where: { project_sku_id: ids } }),
        'getValuesForSkus',
      ),
    ),
  );
  return batches.flat().map(mapSkuAttributeValue);
};

/** Every stored value for one attribute, across every SKU — the Catalogue panel's read. */
export const getValuesForAttribute = async (
  attributeId: string,
): Promise<SkuAttributeValueRecord[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>(TABLE, { where: { attribute_id: attributeId } }),
    'getValuesForAttribute',
  );
  return rows.map(mapSkuAttributeValue);
};

/**
 * Which attributes a SKU has been deliberately CLEARED on — the "this product genuinely has
 * none" set.
 *
 * Reads the row store directly, because this is precisely the fact the JSONB mirror cannot
 * express: a cleared cell mirrors as `''` and reads as "not filled in yet" to everything that
 * looks at the array.
 *
 * Its first use is to stop supplier attribute requests re-asking for those fields, which is why
 * it returns the ids rather than the records: the caller needs a set to exclude by.
 */
export const getClearedAttributeIds = async (projectSkuId: string): Promise<Set<string>> => {
  if (!isLive || !projectSkuId) return new Set();
  const rows = await orEmpty(
    db.select<Row>(TABLE, {
      columns: 'attribute_id, value',
      where: { project_sku_id: projectSkuId },
    }),
    'getClearedAttributeIds',
  );
  // Only a NULL value is a deliberate clear. A blank string is legacy JSONB-era shape meaning
  // "never filled", and treating it as a decision would exclude fields nobody ruled out.
  return new Set(
    rows.filter(r => r.value === null).map(r => r.attribute_id as string),
  );
};

// ─────────────────────────────────────────────────────────────────────────────────────
// The mirror
// ─────────────────────────────────────────────────────────────────────────────────────

/** One SKU's worth of mirror edits: attribute id → new value, or null for a clear. */
type MirrorPatch = Map<string, string | null>;

/**
 * Fold value changes into `project_skus.attribute_values` for the SKUs they touch.
 *
 * Reads the affected SKUs in one query and writes them back in one, so a 40-SKU bulk fill
 * costs two round trips rather than eighty. `sku_number` is carried through the upsert
 * only to keep the payload a valid row shape — every id here already exists, so the
 * statement is an update in practice.
 *
 * The mirror is lossy by design: it has no way to spell "cleared", so a cleared cell
 * mirrors as `''`. That loss is the reason the row table was added, not a bug in it.
 */
const patchMirrors = async (
  patches: Map<string, MirrorPatch>,
  attributes: readonly CategoryAttribute[],
): Promise<void> => {
  if (patches.size === 0) return;
  const byId = new Map(attributes.map(a => [a.id, a]));
  const now = new Date().toISOString();

  const rows = (
    await Promise.all(
      chunk([...patches.keys()], ID_CHUNK).map(ids =>
        orEmpty(
          db.select<Row>('project_skus', {
            columns: 'id, sku_number, attribute_values',
            where: { id: ids },
          }),
          'patchMirrors.read',
        ),
      ),
    )
  ).flat();

  const payload = rows.map(row => {
    const patch = patches.get(row.id) ?? new Map<string, string | null>();
    const current: SkuAttributeValue[] = Array.isArray(row.attribute_values)
      ? row.attribute_values
      : [];
    const next = current.map(entry =>
      patch.has(entry.attributeId)
        ? { ...entry, value: patch.get(entry.attributeId) ?? '' }
        : entry,
    );
    // A cell edited for the first time has no entry in the array yet, so append one
    // rather than dropping the value from the mirror.
    for (const [attributeId, value] of patch) {
      if (current.some(e => e.attributeId === attributeId)) continue;
      const attribute = byId.get(attributeId);
      next.push({
        attributeId,
        name: attribute?.name ?? '',
        value: value ?? '',
        ...(attribute?.dataType ? { type: attribute.dataType } : {}),
      });
    }
    return {
      id: row.id,
      sku_number: row.sku_number,
      attribute_values: next,
      updated_at: now,
      pending_export: true,
    };
  });

  if (payload.length === 0) return;
  await db.upsert('project_skus', payload, { onConflict: 'id' });
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────────────

export interface ValueActor {
  id: string | null;
  name: string;
}

const NO_ACTOR: ValueActor = { id: null, name: '' };

/**
 * Set one cell.
 *
 * Rejects a value the attribute cannot hold, using the same validator the editors use, so
 * nothing can enter the store invalid through this path. Cells DO still render as
 * `invalid` — that happens when a definition changes underneath stored values (an option
 * dropped from an enum, a tightened min/max), which is a real problem worth showing
 * rather than one to hide by never checking.
 */
export const setSkuAttributeValue = async (params: {
  projectSkuId: string;
  attribute: CategoryAttribute;
  value: string;
  unit?: string | null;
  source?: SkuValueSource;
  actor?: ValueActor;
  /** Refresh `project_skus.attribute_values` too. Only off for a caller that batches it. */
  mirror?: boolean;
}): Promise<SkuAttributeValueRecord> => {
  if (!isLive) throw new Error('Database not configured.');
  const { projectSkuId, attribute, value, unit = null, source = 'manual' } = params;
  const actor = params.actor ?? NO_ACTOR;

  const problem = validateAttributeValue(attribute, value, validationModeFor(attribute, value));
  if (problem) throw new Error(`${attribute.name}: ${problem}`);

  const saved = await db.upsertReturning<Row>(
    TABLE,
    {
      project_sku_id: projectSkuId,
      attribute_id: attribute.id,
      value,
      unit,
      source,
      updated_by: actor.id,
      updated_by_name: actor.name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_sku_id,attribute_id' },
  );

  if (params.mirror !== false) {
    await patchMirrors(new Map([[projectSkuId, new Map([[attribute.id, value]])]]), [attribute]);
  }
  return mapSkuAttributeValue(saved);
};

/**
 * Empty one cell on purpose — a row holding `null`, which is NOT the same as deleting the
 * row. Deleting it would say "nobody ever touched this", throwing away the fact that
 * somebody looked at this product and decided it has none of this attribute.
 */
export const clearSkuAttributeValue = async (params: {
  projectSkuId: string;
  attribute: CategoryAttribute;
  source?: SkuValueSource;
  actor?: ValueActor;
  mirror?: boolean;
}): Promise<SkuAttributeValueRecord> => {
  if (!isLive) throw new Error('Database not configured.');
  const { projectSkuId, attribute, source = 'manual' } = params;
  const actor = params.actor ?? NO_ACTOR;

  const saved = await db.upsertReturning<Row>(
    TABLE,
    {
      project_sku_id: projectSkuId,
      attribute_id: attribute.id,
      value: null,
      unit: null,
      source,
      updated_by: actor.id,
      updated_by_name: actor.name,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_sku_id,attribute_id' },
  );

  if (params.mirror !== false) {
    await patchMirrors(new Map([[projectSkuId, new Map([[attribute.id, null]])]]), [attribute]);
  }
  return mapSkuAttributeValue(saved);
};

/** What a bulk write actually did, per SKU. The panel renders this verbatim. */
export interface BulkWriteResult {
  attributeId: string;
  targets: BulkTarget[];
}

/**
 * Set one attribute across many SKUs, writing only what `planBulkFill` said it would.
 *
 * The plan is computed first and returned, so what the operator was shown and what was
 * written are the same list — including the per-SKU reasons for every skip.
 */
export const bulkSetSkuAttributeValue = async (params: {
  skus: readonly FillableSku[];
  attribute: CategoryAttribute;
  value: string;
  unit?: string | null;
  includeFilled?: boolean;
  source?: SkuValueSource;
  actor?: ValueActor;
  /** Current stored values for these SKUs, so the plan can judge what is already filled. */
  existing: readonly SkuAttributeValueRecord[];
}): Promise<BulkWriteResult> => {
  if (!isLive) throw new Error('Database not configured.');
  const { skus, attribute, value, unit = null, source = 'manual' } = params;
  const actor = params.actor ?? NO_ACTOR;

  const targets = planBulkFill(skus, attribute, value, indexByCell(params.existing), {
    includeFilled: params.includeFilled,
    unit,
  });
  const writes = targets.filter(t => t.outcome === 'set');
  if (writes.length === 0) return { attributeId: attribute.id, targets };

  const now = new Date().toISOString();
  await db.upsert(
    TABLE,
    writes.map(t => ({
      project_sku_id: t.projectSkuId,
      attribute_id: attribute.id,
      value: t.value,
      unit: t.unit ?? null,
      source,
      updated_by: actor.id,
      updated_by_name: actor.name,
      updated_at: now,
    })),
    { onConflict: 'project_sku_id,attribute_id' },
  );

  await patchMirrors(
    new Map(writes.map(t => [t.projectSkuId, new Map([[attribute.id, t.value ?? null]])])),
    [attribute],
  );
  return { attributeId: attribute.id, targets };
};

/**
 * Copy a reference SKU's values onto other SKUs, cluster by cluster.
 *
 * Only attributes the source actually holds are copied — a cleared or absent source cell
 * proposes nothing, because copying "none" across forty products is a mass clear wearing
 * the clothes of a copy.
 */
export const copySkuAttributeValues = async (params: {
  sourceSkuId: string;
  targets: readonly FillableSku[];
  attributes: readonly CategoryAttribute[];
  includeFilled?: boolean;
  source?: SkuValueSource;
  actor?: ValueActor;
  existing: readonly SkuAttributeValueRecord[];
}): Promise<CopyPlanEntry[]> => {
  if (!isLive) throw new Error('Database not configured.');
  const { sourceSkuId, targets, attributes, source = 'manual' } = params;
  const actor = params.actor ?? NO_ACTOR;
  const byCell = indexByCell(params.existing);

  const plan = planCopyFrom(sourceSkuId, targets, attributes, byCell, {
    includeFilled: params.includeFilled,
  });

  const rows: object[] = [];
  const mirrors = new Map<string, MirrorPatch>();
  const now = new Date().toISOString();

  for (const entry of plan) {
    for (const t of entry.targets) {
      if (t.outcome !== 'set') continue;
      rows.push({
        project_sku_id: t.projectSkuId,
        attribute_id: entry.attributeId,
        value: t.value,
        unit: t.unit ?? null,
        source,
        updated_by: actor.id,
        updated_by_name: actor.name,
        updated_at: now,
      });
      const patch = mirrors.get(t.projectSkuId) ?? new Map<string, string | null>();
      patch.set(entry.attributeId, t.value ?? null);
      mirrors.set(t.projectSkuId, patch);
    }
  }

  if (rows.length === 0) return plan;
  await db.upsert(TABLE, rows, { onConflict: 'project_sku_id,attribute_id' });
  await patchMirrors(mirrors, attributes);
  return plan;
};

/**
 * Bring the row store in line with a whole `project_skus.attribute_values` array.
 *
 * This is the bridge that stops the SKU Catalog's array-at-a-time grid save from drifting
 * away from the row table while both exist. `planJsonbSync` owns the rule that matters —
 * a blank entry over an existing value is a deliberate CLEAR, a blank entry with no
 * record behind it is scaffolding and writes nothing.
 *
 * Does NOT touch the mirror: the caller is the one writing it. Resolves the attribute
 * definitions itself rather than taking them as an argument, so no call site can forget
 * to pass them and quietly stop syncing.
 */
export const syncValueRowsFromJsonb = async (params: {
  projectSkuId: string;
  values: readonly SkuAttributeValue[];
  source?: SkuValueSource;
  actor?: ValueActor;
}): Promise<void> => {
  if (!isLive) return;
  const { projectSkuId, values, source = 'manual' } = params;
  const actor = params.actor ?? NO_ACTOR;

  const existing = await getValuesForSkus([projectSkuId]);
  const plan = planJsonbSync(values, existing);
  if (plan.upserts.length === 0 && plan.clears.length === 0) return;

  // Which of the referenced attributes still exist. The row table has a foreign key to
  // category_attributes, so one orphaned id would fail the whole batch — and orphans are
  // not hypothetical here: 102 of the live JSONB entries point at attributes deleted on
  // 2026-08-28. They stay in the JSONB, which is not being dropped, so nothing is lost.
  const referenced = [...new Set([...plan.upserts.map(u => u.attributeId), ...plan.clears])];
  const defined = new Set(
    (
      await orEmpty(
        db.select<Row>('category_attributes', { columns: 'id', where: { id: referenced } }),
        'syncValueRowsFromJsonb.attributes',
      )
    ).map(r => r.id as string),
  );

  const now = new Date().toISOString();
  const rows: object[] = [];

  for (const u of plan.upserts) {
    if (!defined.has(u.attributeId)) continue;
    rows.push({
      project_sku_id: projectSkuId,
      attribute_id: u.attributeId,
      value: u.value,
      unit: null,
      source,
      updated_by: actor.id,
      updated_by_name: actor.name,
      updated_at: now,
    });
  }

  for (const attributeId of plan.clears) {
    if (!defined.has(attributeId)) continue;
    rows.push({
      project_sku_id: projectSkuId,
      attribute_id: attributeId,
      value: null,
      unit: null,
      source,
      updated_by: actor.id,
      updated_by_name: actor.name,
      updated_at: now,
    });
  }

  if (rows.length === 0) return;
  await db.upsert(TABLE, rows, { onConflict: 'project_sku_id,attribute_id' });
};

/**
 * Whether the row store is reachable at all.
 *
 * Migration 155 has to be applied before any of this works, and the failure mode
 * otherwise is a PostgREST 404 on an unknown relation — which `orEmpty` turns into an
 * empty grid that looks like "this category has no values". One cheap probe lets a caller
 * say "the value store is not deployed" instead of showing a wrong answer confidently.
 */
export const isValueStoreAvailable = async (): Promise<boolean> => {
  if (!isLive) return false;
  try {
    await db.select<Row>(TABLE, { columns: 'id', limit: 1 });
    return true;
  } catch {
    return false;
  }
};
