/**
 * SKU finalization + change log. A "final" SKU is locked (is_final = true): the UI blocks edits,
 * bulk overwrite and delete until it is unlocked. Finalize, unlock and value changes are written
 * to the append-only `sku_change_log` (see db_migrations/94_sku_finalization_and_log.sql).
 */
import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { SkuChangeLogEntry } from '../../types';

export interface ChangeActor { id?: string | null; name?: string | null }

/** One value change to record: which field, and its before/after. */
export interface SkuFieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

const mapLog = (r: any): SkuChangeLogEntry => ({
  id: r.id,
  projectSkuId: r.project_sku_id ?? null,
  skuNumber: r.sku_number ?? '',
  action: r.action,
  field: r.field ?? null,
  oldValue: r.old_value ?? null,
  newValue: r.new_value ?? null,
  note: r.note ?? '',
  changedBy: r.changed_by ?? null,
  changedByName: r.changed_by_name ?? '',
  createdAt: r.created_at,
});

const insertRows = async (rows: Record<string, any>[]): Promise<void> => {
  if (!isLive || rows.length === 0) return;
  const { error } = await supabase.from('sku_change_log').insert(rows);
  if (error) console.error('sku_change_log insert error:', error);
};

const baseRow = (skuId: string | null, skuNumber: string, actor: ChangeActor) => ({
  project_sku_id: skuId,
  sku_number: skuNumber,
  changed_by: actor.id ?? null,
  changed_by_name: actor.name ?? '',
});

/** Toggle a SKU's final/locked state and record it. */
export const setSkuFinal = async (
  skuId: string,
  skuNumber: string,
  isFinal: boolean,
  actor: ChangeActor,
  note = '',
): Promise<void> => {
  if (!isLive) throw new Error('Database not configured.');
  const { error } = await supabase
    .from('project_skus')
    .update({ is_final: isFinal, updated_at: new Date().toISOString() })
    .eq('id', skuId);
  if (error) throw new Error(error.message || 'Failed to update SKU lock state');
  await insertRows([{ ...baseRow(skuId, skuNumber, actor), action: isFinal ? 'finalize' : 'unlock', note }]);
};

/** Record a batch of value changes for one SKU (called after a successful save). */
export const logSkuChanges = async (
  skuId: string,
  skuNumber: string,
  changes: SkuFieldChange[],
  actor: ChangeActor,
  note = '',
): Promise<void> => {
  if (changes.length === 0) return;
  await insertRows(changes.map(c => ({
    ...baseRow(skuId, skuNumber, actor),
    action: 'update',
    field: c.field,
    old_value: c.oldValue,
    new_value: c.newValue,
    note,
  })));
};

export const logSkuCreated = async (skuId: string, skuNumber: string, actor: ChangeActor, note = ''): Promise<void> =>
  insertRows([{ ...baseRow(skuId, skuNumber, actor), action: 'create', note }]);

export const logSkuDeleted = async (skuId: string, skuNumber: string, actor: ChangeActor, note = ''): Promise<void> =>
  insertRows([{ ...baseRow(skuId, skuNumber, actor), action: 'delete', note }]);

/**
 * Mark SKUs as exported to Akeneo: clears their pending_export flag, stamps last_exported_at,
 * and writes an 'export' entry to the change log for each. Call after an export file is produced.
 */
export const markSkusExported = async (
  skus: { id: string; skuNumber: string }[],
  actor: ChangeActor,
  note = '',
): Promise<void> => {
  if (!isLive || skus.length === 0) return;
  const ids = skus.map(s => s.id);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('project_skus')
    .update({ pending_export: false, last_exported_at: now })
    .in('id', ids);
  if (error) throw new Error(error.message || 'Failed to mark SKUs as exported');
  await insertRows(skus.map(s => ({ ...baseRow(s.id, s.skuNumber, actor), action: 'export', note })));
};

/** Full change history for a SKU, newest first. */
export const getSkuChangeLog = async (skuId: string): Promise<SkuChangeLogEntry[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase
    .from('sku_change_log')
    .select('*')
    .eq('project_sku_id', skuId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getSkuChangeLog error:', error); return []; }
  return (data || []).map(mapLog);
};
