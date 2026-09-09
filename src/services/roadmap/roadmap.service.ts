/**
 * Roadmap Creator — board reads and annotation writes.
 *
 * This module is THE SEAM. In ProductToolkit these were 15 `fetch` calls in `lib/api.js` against
 * an Express server; here they are the same 15 functions against the `db` port. The components
 * above only ever see these signatures, which is why the backend swap did not reach them.
 *
 * WRITES ARE GATED IN THE DATABASE, NOT HERE. Every annotation table's write policy is
 * `is_roadmap_editor()`, and the reference tables have NO write policy at all — their only writer
 * is the SECURITY DEFINER `roadmap_import_skus()`. The `canEditRoadmap` helper below exists so the
 * UI can HIDE controls the caller cannot use; it is not the security boundary and must never be
 * the only check.
 *
 * THE IMPORT IS AN RPC because the `db` port has no transaction and the upsert and the delist pass
 * must be atomic. See db_migrations/167_roadmap_creator.sql for the three defences behind the
 * module's one guarantee.
 */

import { auth, db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ALL_CATEGORIES } from '../../pages/roadmap/roadmap.constants';
import type { ParsedRoadmapRow } from '../../pages/roadmap/parse-workbook';
import type {
  RoadmapApprover,
  RoadmapAuditEntry,
  RoadmapAxisKind,
  RoadmapAxisValue,
  RoadmapBoard,
  RoadmapCategory,
  RoadmapFlag,
  RoadmapImport,
  RoadmapImportResult,
  RoadmapItemFlag,
  RoadmapPlacer,
  RoadmapPlacerType,
  RoadmapStatus,
} from '../../types';
import {
  fromAuditRow,
  fromAxisValueRow,
  fromFlagRow,
  fromImportRow,
  fromPlacerRow,
  fromSkuRow,
  toImportRows,
} from './roadmap-mapping';

/** Who the current write is attributable to. Name where we have it, else email, else the id. */
const actor = async (): Promise<string | null> => {
  const session = await auth.getSession();
  return session?.user?.email ?? session?.user?.id ?? null;
};

/**
 * Whether the signed-in user may edit the roadmap — a UI hint only.
 *
 * Mirrors `is_roadmap_editor()` in migration 167, which reads BOTH role stores because they
 * disagree: `user_roles` holds admin/internal, `profiles.role` holds ADMIN/pm. Fails closed.
 */
export const canEditRoadmap = async (): Promise<boolean> => {
  if (!isLive) return false;
  try {
    return (await db.rpc<boolean>('is_roadmap_editor')) === true;
  } catch {
    return false;
  }
};

/**
 * Who may approve a Summary-tab row: the admins, derived — never a hardcoded list.
 *
 * Editing the roadmap and approving are different rights: every PM marks SKUs, but the decision
 * belongs to the admins, so this is deliberately NARROWER than `canEditRoadmap`. The same
 * definition backs the `roadmap_validate_approver` trigger, so the dropdown and the database
 * cannot drift apart.
 *
 * Degrades to `[]`: a Summary tab with no approver options is worse than useless but recoverable;
 * a Summary tab that will not render at all loses the planner the rest of the page too.
 */
export const getRoadmapApprovers = async (): Promise<RoadmapApprover[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(db.rpc<Row[]>('roadmap_approvers'), '[getRoadmapApprovers]');
  return (rows ?? []).map(r => ({ userId: r.user_id, name: r.name }));
};

// ── Reference data ───────────────────────────────────────────────────────────

/** Every System Index with its SKU counts, for the category picker. */
export const getRoadmapCategories = async (): Promise<RoadmapCategory[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.rpc<Row[]>('roadmap_categories'),
    '[getRoadmapCategories]',
  );
  return (rows ?? []).map(r => ({
    systemIndex: r.system_index,
    skuCount: Number(r.sku_count),
    currentCount: Number(r.current_count),
  }));
};

/**
 * Everything one board needs.
 *
 * `category === ALL_CATEGORIES` reads across every category — History and Summary work that way,
 * while the grid and the ladder (both single-category pivots) show a "pick one category" notice
 * rather than pretending to pivot everything.
 *
 * The four reads go out together. The source did this as four recordsets in one round trip; here
 * they are four requests resolved in parallel, which is the same single wait.
 */
export const getRoadmapBoard = async (
  category: string,
  signal?: AbortSignal,
): Promise<RoadmapBoard> => {
  const empty: RoadmapBoard = { category, skus: [], flags: [], placers: [], axisValues: [] };
  if (!isLive) return empty;

  const all = category === ALL_CATEGORIES;
  const scope = all ? undefined : category;

  const [skuRows, placerRows, axisRows] = await Promise.all([
    orEmpty(
      db.select<Row>('roadmap_sku', { where: { system_index: scope }, signal }),
      '[getRoadmapBoard.skus]',
    ),
    orEmpty(
      db.select<Row>('roadmap_placer', {
        where: { category: scope },
        order: { column: 'sort_order' },
        signal,
      }),
      '[getRoadmapBoard.placers]',
    ),
    orEmpty(
      db.select<Row>('roadmap_axis_value', { where: { category: scope }, signal }),
      '[getRoadmapBoard.axisValues]',
    ),
  ]);

  const skus = skuRows.map(fromSkuRow);

  // Flags are keyed by SKU with no category column of their own — the schema has no FK to
  // roadmap_sku on purpose, so there is nothing to embed. Scope them by the SKUs we just read.
  // Reading the whole flag table when a category is chosen would leak other categories' notes
  // into this board's summary counts.
  const flagRows = all
    ? await orEmpty(db.select<Row>('roadmap_item_flag', { signal }), '[getRoadmapBoard.flags]')
    : skus.length
      ? await orEmpty(
          db.select<Row>('roadmap_item_flag', {
            where: { sku: skus.map(s => s.sku) },
            signal,
          }),
          '[getRoadmapBoard.flags]',
        )
      : [];

  return {
    category,
    skus,
    flags: flagRows.map(fromFlagRow),
    placers: placerRows.map(fromPlacerRow),
    axisValues: axisRows.map(fromAxisValueRow),
  };
};

/** The upload history, newest first. */
export const getRoadmapImports = async (limit = 50): Promise<RoadmapImport[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('roadmap_import', {
      order: { column: 'imported_at', ascending: false },
      limit: Math.min(Math.max(limit, 1), 200),
    }),
    '[getRoadmapImports]',
  );
  return rows.map(fromImportRow);
};

/**
 * The audit log. Scoped to one category when given — but imports are always included, because an
 * import is the event most likely to explain what a planner is looking at.
 */
export const getRoadmapAudit = async (
  category?: string,
  limit = 200,
): Promise<RoadmapAuditEntry[]> => {
  if (!isLive) return [];
  const capped = Math.min(Math.max(limit, 1), 1000);
  const order = { column: 'changed_at', ascending: false } as const;

  if (!category || category === ALL_CATEGORIES) {
    const rows = await orEmpty(
      db.select<Row>('roadmap_audit', { order, limit: capped }),
      '[getRoadmapAudit]',
    );
    return rows.map(fromAuditRow);
  }

  // The port has no OR, and this is "this category's changes plus every import". Two reads,
  // merged and re-sorted here — cheaper to explain than an OR added to the port for one caller.
  const [scoped, imports] = await Promise.all([
    orEmpty(
      db.select<Row>('roadmap_audit', { where: { category }, order, limit: capped }),
      '[getRoadmapAudit.category]',
    ),
    orEmpty(
      db.select<Row>('roadmap_audit', { where: { entity: 'import' }, order, limit: capped }),
      '[getRoadmapAudit.imports]',
    ),
  ]);
  const byId = new Map<number, RoadmapAuditEntry>();
  for (const r of [...scoped, ...imports].map(fromAuditRow)) byId.set(r.id, r);
  return [...byId.values()]
    .sort((a, b) => (b.changedAt ?? '').localeCompare(a.changedAt ?? '') || b.id - a.id)
    .slice(0, capped);
};

/**
 * Refresh the reference data from a parsed workbook.
 *
 * One RPC, one transaction. Everything that decides what a cell MEANS happened in
 * `toImportRows()` — including the sku dedupe, without which the upsert raises.
 *
 * This deliberately does NOT degrade: an import that half-worked is worse than one that failed,
 * and the caller shows the database's own message.
 */
export const importRoadmapSkus = async (
  rows: readonly ParsedRoadmapRow[],
  fileName: string,
): Promise<RoadmapImportResult> => {
  if (!isLive) throw new Error('Database not configured.');
  const payload = toImportRows(rows);
  if (!payload.length) {
    // Caught here as well as in SQL so the planner gets a sentence rather than a Postgres code.
    throw new Error('That file produced no usable rows — nothing was imported.');
  }
  const result = await db.rpc<Row[] | Row>('roadmap_import_skus', {
    p_rows: payload,
    p_file_name: fileName,
  });
  const r = Array.isArray(result) ? result[0] : result;
  return {
    importId: r.import_id,
    rowCount: r.row_count,
    insertedCount: r.inserted_count,
    updatedCount: r.updated_count,
    delistedCount: r.delisted_count,
  };
};

// ── Annotations ──────────────────────────────────────────────────────────────

const audit = async (entry: {
  entity: 'flag' | 'placer' | 'axis';
  entityKey: string;
  action: 'set' | 'clear' | 'add' | 'remove' | 'edit';
  category?: string | null;
  sku?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> => {
  // The log must never be the reason a save fails — the annotation is the thing the planner
  // asked for. A dropped audit row is visible in History; a rejected mark loses their work.
  try {
    await db.insert('roadmap_audit', {
      entity: entry.entity,
      entity_key: entry.entityKey,
      action: entry.action,
      category: entry.category ?? null,
      sku: entry.sku ?? null,
      before_json: entry.before ?? null,
      after_json: entry.after ?? null,
      changed_by: await actor(),
    });
  } catch (err) {
    console.warn('[roadmap.audit] failed', err);
  }
};

/**
 * Set or clear a SKU's mark and comment.
 *
 * A row with neither a flag nor a comment is DELETED rather than stored empty, so "no annotation"
 * has one representation and the orphan report cannot count blanks.
 */
export const setRoadmapFlag = async (
  sku: string,
  values: { flag?: RoadmapFlag | null; comment?: string | null },
  context?: { category?: string; before?: RoadmapItemFlag | null },
): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  const flag = values.flag ?? null;
  const comment = (values.comment ?? '').trim();

  if (!flag && !comment) {
    await db.delete('roadmap_item_flag', { where: { sku } });
    await audit({
      entity: 'flag', entityKey: sku, action: 'clear', sku,
      category: context?.category, before: context?.before ?? null,
    });
    return;
  }

  await db.upsert(
    'roadmap_item_flag',
    { sku, flag, comment: comment || null, updated_at: new Date().toISOString(), updated_by: await actor() },
    { onConflict: 'sku' },
  );
  await audit({
    entity: 'flag', entityKey: sku, action: 'set', sku,
    category: context?.category, before: context?.before ?? null, after: { flag, comment },
  });
};

export const clearRoadmapFlag = (
  sku: string,
  context?: { category?: string; before?: RoadmapItemFlag | null },
): Promise<void> => setRoadmapFlag(sku, { flag: null, comment: '' }, context);

/** The Summary tab's review decision. Status and approver are set independently, on purpose. */
export const setRoadmapFlagStatus = async (
  sku: string,
  values: { status?: RoadmapStatus; approvedBy?: string | null; projectCode?: string | null },
): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: await actor() };
  // Only what was passed — picking an approver must never reset the decision, or vice versa.
  if (values.status !== undefined) patch.status = values.status;
  if (values.approvedBy !== undefined) patch.approved_by = values.approvedBy;
  if (values.projectCode !== undefined) patch.project_code = values.projectCode || null;

  await db.updateWhere('roadmap_item_flag', patch, { where: { sku } });
  await audit({ entity: 'flag', entityKey: sku, action: 'edit', sku, after: values });
};

export const addRoadmapPlacer = async (input: {
  category: string;
  yField: string;
  xField: string;
  family: string;
  yValue: string;
  xValue: string;
  type: RoadmapPlacerType;
  comment?: string;
}): Promise<RoadmapPlacer> => {
  if (!isLive) throw new Error('Database not configured.');
  const who = await actor();
  const row = await db.insert<Row>('roadmap_placer', {
    category: input.category,
    y_field: input.yField,
    x_field: input.xField,
    family: input.family,
    y_value: input.yValue,
    x_value: input.xValue,
    type: input.type,
    comment: input.comment?.trim() || null,
    created_by: who,
    updated_by: who,
  });
  const placer = fromPlacerRow(row);
  await audit({
    entity: 'placer', entityKey: String(placer.id), action: 'add',
    category: input.category, after: input,
  });
  return placer;
};

export const updateRoadmapPlacer = async (
  id: number,
  values: {
    comment?: string | null;
    type?: RoadmapPlacerType;
    projectCode?: string | null;
    expected2027Nic?: number | null;
    status?: RoadmapStatus;
    approvedBy?: string | null;
  },
  context?: { category?: string },
): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: await actor() };
  if (values.comment !== undefined) patch.comment = values.comment?.trim() || null;
  if (values.type !== undefined) patch.type = values.type;
  if (values.projectCode !== undefined) patch.project_code = values.projectCode || null;
  if (values.expected2027Nic !== undefined) patch.expected_2027_nic = values.expected2027Nic;
  if (values.status !== undefined) patch.status = values.status;
  if (values.approvedBy !== undefined) patch.approved_by = values.approvedBy;

  await db.updateWhere('roadmap_placer', patch, { where: { placer_id: id } });
  await audit({
    entity: 'placer', entityKey: String(id), action: 'edit',
    category: context?.category, after: values,
  });
};

export const removeRoadmapPlacer = async (
  id: number,
  context?: { category?: string; before?: RoadmapPlacer },
): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  await db.delete('roadmap_placer', { where: { placer_id: id } });
  await audit({
    entity: 'placer', entityKey: String(id), action: 'remove',
    category: context?.category, before: context?.before,
  });
};

/**
 * Add a family band, or a row/column on one axis.
 *
 * A family carries no field; a row or column must name the axis it belongs to — an added "Copper"
 * row only means anything while Main Color is the Y axis. The database enforces both shapes
 * through the two partial unique indexes.
 */
export const addRoadmapAxisValue = async (input: {
  kind: RoadmapAxisKind;
  category: string;
  field?: string | null;
  value: string;
}): Promise<RoadmapAxisValue> => {
  if (!isLive) throw new Error('Database not configured.');
  const field = input.kind === 'family' ? null : (input.field ?? null);
  if (input.kind !== 'family' && !field) {
    throw new Error('A row or column must belong to an axis field.');
  }
  const row = await db.insert<Row>('roadmap_axis_value', {
    kind: input.kind,
    category: input.category,
    field,
    value: input.value.trim(),
    created_by: await actor(),
  });
  const axisValue = fromAxisValueRow(row);
  await audit({
    entity: 'axis', entityKey: String(axisValue.id), action: 'add',
    category: input.category, after: { kind: input.kind, field, value: axisValue.value },
  });
  return axisValue;
};

export const removeRoadmapAxisValue = async (
  id: number,
  context?: { category?: string; before?: RoadmapAxisValue },
): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  await db.delete('roadmap_axis_value', { where: { axis_value_id: id } });
  await audit({
    entity: 'axis', entityKey: String(id), action: 'remove',
    category: context?.category, before: context?.before,
  });
};

/**
 * Wipe every mark and placeholder in ONE category.
 *
 * Scoped deliberately: the prototype's equivalent wiped every category from a per-category
 * screen. Reference data is untouched — this cannot reach `roadmap_sku`, and RLS would refuse it
 * if it tried.
 */
export const clearRoadmapCategory = async (category: string): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  if (!category || category === ALL_CATEGORIES) {
    throw new Error('Clearing marks needs one specific category.');
  }
  const skus = await orEmpty(
    db.select<Row>('roadmap_sku', { columns: 'sku', where: { system_index: category } }),
    '[clearRoadmapCategory.skus]',
  );
  if (skus.length) {
    await db.delete('roadmap_item_flag', { where: { sku: skus.map(s => s.sku) } });
  }
  await db.delete('roadmap_placer', { where: { category } });
  await audit({
    entity: 'flag', entityKey: category, action: 'clear', category,
    after: { clearedFlagsFor: skus.length },
  });
};
