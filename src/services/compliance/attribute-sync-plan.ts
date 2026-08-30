/**
 * Plans a ProductToolkit → OriginFlow attribute sync, and says what each change would break
 * BEFORE anything is written.
 *
 * Why this exists rather than just re-running the importer: the importer is additive and
 * matches on name/code, so an attribute renamed upstream looks like "a new attribute, plus an
 * old one nobody mentions". Applied blindly that creates a duplicate and strands every stored
 * value pointing at the old row — SKU values, supplier submissions, review flags and IM block
 * conditions all reference an attribute by its OriginFlow uuid, and none of them is protected
 * by a foreign key (values live inside jsonb). Nothing in the database stops an orphan; the
 * only protection is looking first.
 *
 * So: match on ProductToolkit's stable `attributeId` where we have it, fall back to the
 * Akeneo code, then to name-within-group. Classify what actually differs, attach the usage
 * counts, and rank the risk. The caller reviews and can remap anything the matcher got wrong.
 *
 * Pure and dependency-free — usage counts are passed in (see the attribute_usage SQL function
 * from migration 138) so the whole thing is unit-testable.
 */
import type { CategoryAttribute } from '../../types';
import type { ParsedAttributeRow } from '../../utils/attribute-csv-import.utils';
import { PREDEFINED_ATTRIBUTE_GROUPS } from '../../config/compliance.constants';

/** Dependent-record counts for one attribute, as returned by attribute_usage(). */
export interface AttributeUsage {
  skuValues: number;
  requestValues: number;
  reviewFlags: number;
  imRefs: number;
}

export const emptyUsage = (): AttributeUsage => ({ skuValues: 0, requestValues: 0, reviewFlags: 0, imRefs: 0 });
export const usageTotal = (u: AttributeUsage): number =>
  u.skuValues + u.requestValues + u.reviewFlags + u.imRefs;

export type SyncAction = 'create' | 'update' | 'unchanged' | 'absent';

export type RiskLevel = 'info' | 'warning' | 'breaking';

export interface SyncRisk {
  level: RiskLevel;
  code:
    | 'rename'
    | 'group-change'
    | 'scope-demotion'
    | 'scope-promotion'
    | 'type-change'
    | 'options-removed'
    | 'absent-with-data'
    | 'absent'
    | 'code-change';
  message: string;
}

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface SyncItem {
  /** Stable key for React lists and for the caller's remap map. */
  key: string;
  action: SyncAction;
  /** How the incoming row was matched to an existing attribute. */
  matchedBy: 'pt-id' | 'akeneo-code' | 'name-in-group' | 'name' | 'remap' | 'none';
  incoming?: ParsedAttributeRow;
  existing?: CategoryAttribute;
  changes: FieldChange[];
  usage: AttributeUsage;
  risks: SyncRisk[];
}

export interface SyncPlan {
  items: SyncItem[];
  counts: Record<SyncAction, number>;
  /** Items carrying at least one 'breaking' risk — what a reviewer must look at. */
  breakingCount: number;
}

const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** Whether a row will end up global, preferring PT's explicit scope over the group name. */
export const resolvesToGlobal = (row: ParsedAttributeRow): boolean =>
  row.scope ? row.scope === 'global' : PREDEFINED_ATTRIBUTE_GROUPS.includes(row.group);

const isExistingGlobal = (a: CategoryAttribute): boolean => a.categoryId === null;

/**
 * Build the plan.
 *
 * `remap` lets the reviewer override matching: incoming key → existing attribute id, or the
 * empty string to force "create a genuinely new attribute". That is the correction path —
 * pointing a renamed upstream attribute back at the OriginFlow row that already holds the
 * data, instead of creating a second one and orphaning it.
 */
export const planAttributeSync = (
  existing: CategoryAttribute[],
  incoming: ParsedAttributeRow[],
  usageById: Record<string, AttributeUsage>,
  categoryId: string,
  remap: Record<string, string> = {},
): SyncPlan => {
  const items: SyncItem[] = [];
  const consumed = new Set<string>();

  const keyOf = (row: ParsedAttributeRow) =>
    row.ptAttributeId != null ? `pt:${row.ptAttributeId}` : `code:${norm(row.akeneoId) || norm(row.name)}`;

  for (const row of incoming) {
    const key = keyOf(row);
    let match: CategoryAttribute | undefined;
    let matchedBy: SyncItem['matchedBy'] = 'none';

    const override = remap[key];
    if (override !== undefined) {
      // Explicit reviewer decision — '' means "definitely new, do not match anything".
      match = override ? existing.find(a => a.id === override) : undefined;
      matchedBy = match ? 'remap' : 'none';
    } else if (row.ptAttributeId != null) {
      match = existing.find(a => a.ptAttributeId === row.ptAttributeId && !consumed.has(a.id));
      if (match) matchedBy = 'pt-id';
    }
    if (!match && override === undefined && norm(row.akeneoId)) {
      match = existing.find(a => norm(a.akeneoId) === norm(row.akeneoId) && !consumed.has(a.id));
      if (match) matchedBy = 'akeneo-code';
    }
    if (!match && override === undefined) {
      match = existing.find(
        a => a.group === row.group && norm(a.name) === norm(row.name) && !consumed.has(a.id),
      );
      if (match) matchedBy = 'name-in-group';
    }
    if (!match && override === undefined) {
      // Same name, different group. Moving an attribute between clusters is a normal upstream
      // edit, and requiring the group to match would report it as "new one + abandoned one" —
      // the exact duplicate-and-strand outcome this planner exists to prevent. Weakest match,
      // so it is reported as such and the reviewer can override it.
      match = existing.find(a => norm(a.name) === norm(row.name) && !consumed.has(a.id));
      if (match) matchedBy = 'name';
    }

    const usage = (match && usageById[match.id]) || emptyUsage();
    const changes: FieldChange[] = [];
    const risks: SyncRisk[] = [];

    if (!match) {
      items.push({ key, action: 'create', matchedBy: 'none', incoming: row, changes, usage, risks });
      continue;
    }
    consumed.add(match.id);

    const add = (field: string, from: string, to: string) => {
      if (from !== to) changes.push({ field, from, to });
      return from !== to;
    };

    if (add('name', match.name, row.name)) {
      risks.push({
        level: usageTotal(usage) > 0 ? 'warning' : 'info',
        code: 'rename',
        message:
          `Renamed upstream: "${match.name}" → "${row.name}".` +
          (usageTotal(usage) > 0
            ? ` ${usageTotal(usage)} stored record(s) point at this attribute; they keep working because they reference its id, but the label they display will change.`
            : ''),
      });
    }

    if (add('akeneoId', match.akeneoId ?? '—', row.akeneoId ?? '—')) {
      risks.push({
        level: 'warning',
        code: 'code-change',
        message:
          `Akeneo code changes ${match.akeneoId ?? '(none)'} → ${row.akeneoId ?? '(none)'}. ` +
          `Anything exporting by code (the SKU read API, the Akeneo CSV export) will emit the new one.`,
      });
    }

    add('group', match.group ?? 'Category Specific', row.group);
    add('dataType', match.dataType, row.dataType);

    if (match.dataType !== row.dataType && usageTotal(usage) > 0) {
      risks.push({
        level: 'breaking',
        code: 'type-change',
        message:
          `Type changes ${match.dataType} → ${row.dataType} with ${usageTotal(usage)} stored record(s). ` +
          `Existing values are kept as text but may no longer validate — check them before applying.`,
      });
    }

    // Scope. This is the one that silently breaks OTHER categories.
    const willBeGlobal = resolvesToGlobal(row);
    const wasGlobal = isExistingGlobal(match);
    if (wasGlobal !== willBeGlobal) {
      add('scope', wasGlobal ? 'global' : 'category', willBeGlobal ? 'global' : 'category');
      if (wasGlobal && !willBeGlobal) {
        const shared = (match.assignedCategoryIds ?? []).length;
        risks.push({
          level: 'breaking',
          code: 'scope-demotion',
          message:
            `Currently global (applies to every category); the definition makes it specific to this one. ` +
            `It would stop applying elsewhere` +
            (shared ? `, including ${shared} category/categories it is explicitly shared into` : '') +
            (usageTotal(usage) > 0 ? `, and ${usageTotal(usage)} stored record(s) reference it` : '') +
            `. Values captured under other categories would be stranded.`,
        });
      } else {
        risks.push({
          level: 'info',
          code: 'scope-promotion',
          message: `Becomes global — it will start applying to every category, not just this one.`,
        });
      }
    }

    // Enum options that disappear can invalidate stored values.
    const beforeOpts = match.validationRules?.enumOptions ?? [];
    const afterOpts = row.enumOptions ?? [];
    if (row.dataType === 'enum' && beforeOpts.length) {
      const removed = beforeOpts.filter(o => !afterOpts.includes(o));
      if (removed.length) {
        add('options', `${beforeOpts.length} option(s)`, `${afterOpts.length} option(s)`);
        risks.push({
          level: usageTotal(usage) > 0 ? 'breaking' : 'warning',
          code: 'options-removed',
          message:
            `${removed.length} option(s) removed (${removed.slice(0, 4).join(', ')}${removed.length > 4 ? '…' : ''}). ` +
            `Any SKU already holding one of those keeps a value that is no longer selectable.`,
        });
      } else if (afterOpts.length !== beforeOpts.length) {
        add('options', `${beforeOpts.length} option(s)`, `${afterOpts.length} option(s)`);
      }
    }

    if (row.supplierVisible !== undefined) {
      add('supplierVisible', String(match.supplierVisible !== false), String(row.supplierVisible !== false));
    }
    if (row.sortOrder !== undefined) add('sortOrder', String(match.sortOrder ?? 0), String(row.sortOrder));

    items.push({
      key,
      action: changes.length ? 'update' : 'unchanged',
      matchedBy,
      incoming: row,
      existing: match,
      changes,
      usage,
      risks,
    });
  }

  // Attributes this category has that the definition no longer mentions. Not deleted by an
  // additive sync, but the reviewer needs to see them: in a Replace they WOULD go, and if one
  // is actually the old side of a rename the matcher missed, this is where it shows up.
  for (const a of existing) {
    if (consumed.has(a.id)) continue;
    const appliesHere =
      a.categoryId === categoryId || (a.assignedCategoryIds ?? []).includes(categoryId);
    if (!appliesHere) continue; // globals from elsewhere are not this category's business

    const usage = usageById[a.id] ?? emptyUsage();
    const total = usageTotal(usage);
    items.push({
      key: `absent:${a.id}`,
      action: 'absent',
      matchedBy: 'none',
      existing: a,
      changes: [],
      usage,
      risks: [{
        level: total > 0 ? 'breaking' : 'info',
        code: total > 0 ? 'absent-with-data' : 'absent',
        message: total > 0
          ? `Not in the definition any more, but ${total} stored record(s) still reference it. ` +
            `Removing it would strand them. If it was renamed upstream, remap the new attribute onto this one instead.`
          : `Not in the definition any more. Nothing references it, so removing it is safe.`,
      }],
    });
  }

  const counts: Record<SyncAction, number> = { create: 0, update: 0, unchanged: 0, absent: 0 };
  for (const i of items) counts[i.action]++;

  return {
    items,
    counts,
    breakingCount: items.filter(i => i.risks.some(r => r.level === 'breaking')).length,
  };
};

/**
 * What applying one item would write. Kept separate from the write itself so the caller can
 * show it, test it, and diff it without a database.
 *
 * The critical property: an 'update' REUSES the existing attribute's id. Every SKU value,
 * supplier submission, review flag and IM condition references that id, so preserving it is
 * what turns "rename upstream" from a data-loss event into a label change.
 */
export const buildSyncWrite = (item: SyncItem, categoryId: string): CategoryAttribute | null => {
  const row = item.incoming;
  if (!row || (item.action !== 'create' && item.action !== 'update')) return null;

  const global = resolvesToGlobal(row);
  const validationRules: CategoryAttribute['validationRules'] = {
    ...(item.existing?.validationRules ?? {}),
  };
  if (row.unit) validationRules.unit = row.unit;
  if (row.dataType === 'enum') validationRules.enumOptions = row.enumOptions ?? [];
  if (row.required !== undefined) validationRules.required = row.required || undefined;

  return {
    // Reuse the existing row on update; only a genuine create gets a new identity.
    id: item.existing?.id ?? '',
    categoryId: global ? null : categoryId,
    assignedCategoryIds: item.existing?.assignedCategoryIds ?? [],
    name: row.name,
    dataType: row.dataType,
    validationRules: Object.keys(validationRules).length ? validationRules : undefined,
    group: row.group,
    akeneoId: row.akeneoId,
    supplierVisible: row.supplierVisible !== false,
    sortOrder: row.sortOrder ?? item.existing?.sortOrder ?? 0,
    ptAttributeId: row.ptAttributeId ?? item.existing?.ptAttributeId ?? null,
    eprelId: row.eprelId ?? item.existing?.eprelId ?? null,
  };
};
