/**
 * Turning an audit row into something a compliance officer can read.
 *
 * The history table stores raw `compliance_requirements` snapshots, because that is the only
 * shape guaranteed to still make sense in two years — a trigger cannot know what the UI calls
 * a column, and a pre-formatted sentence would freeze today's vocabulary into the record.
 * Translation is therefore this module's job, and it is deliberately pure: no database, no
 * React, so the one part that is easy to get quietly wrong (a diff that omits a changed field)
 * is unit-testable.
 *
 * The guiding rule: NEVER hide a change. An unrecognised column shows with its raw name
 * rather than being dropped, because a diff that silently skips what it does not understand
 * is worse than one that looks untidy.
 */

import type { ComplianceRequirementHistoryEntry } from '../../types';

/** Human labels for the `compliance_requirements` columns the history can carry. */
const FIELD_LABELS: Record<string, string> = {
  category_id: 'Category',
  assigned_category_ids: 'Shared with',
  section: 'Section group',
  title: 'Title',
  description: 'Description',
  is_mandatory: 'Mandatory',
  reference_code: 'Reference code',
  regulation_id: 'Regulation',
  clause_id: 'Clause',
  applies_by_default: 'Applies by default',
  condition: 'Applies if',
  condition_feature_ids: 'Applies if (legacy)',
  timing_type: 'Timing',
  timing_weeks: 'Timing (weeks)',
  self_declaration_accepted: 'Self-declaration accepted',
  test_report_origin: 'Test report origin',
  sort_order: 'Sort order',
};

/** Values these columns hold are codes, not prose. Spelled out so a diff reads as English. */
const VALUE_LABELS: Record<string, Record<string, string>> = {
  timing_type: { ETD: 'At ETD', POST_ETD: 'After ETD' },
  test_report_origin: {
    third_party_mandatory: '3rd party lab only',
    supplier_inhouse: 'In-house accepted',
  },
};

export const fieldLabel = (column: string): string => FIELD_LABELS[column] ?? column;

/**
 * The columns that hold ids rather than prose, and are therefore the only ones `resolveId`
 * is applied to. Keeping this explicit means a `title` that happens to match a known id is
 * never silently rewritten into a regulation's name.
 */
const ID_COLUMNS = new Set(['regulation_id', 'clause_id', 'category_id', 'assigned_category_ids']);

/**
 * How a stored value is shown in the diff.
 *
 * `resolveId` is how a uuid becomes a name (a regulation's reference code, a category's
 * name). It is passed in rather than looked up here so this module stays pure — and when it
 * cannot resolve one, the uuid itself is shown. A raw id is ugly; a blank is a lie.
 */
export const formatHistoryValue = (
  column: string,
  value: unknown,
  resolveId?: (id: string) => string | undefined,
): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';

  if (typeof value === 'string') {
    const mapped = VALUE_LABELS[column]?.[value];
    if (mapped) return mapped;
    // Only the columns that actually hold ids get the resolver, so a title that happens to
    // look like a uuid is never rewritten into something else.
    if (resolveId && ID_COLUMNS.has(column)) return resolveId(value) ?? value;
    return value.trim() === '' ? '—' : value;
  }

  if (Array.isArray(value)) {
    // `assigned_category_ids` is the one array of ids (migration 173), and it is the whole
    // point of a link/unlink diff — showing it as a row of uuids would make the most
    // interesting change in the history the least readable one.
    if (!value.length) return '—';
    const resolveEach = resolveId && ID_COLUMNS.has(column);
    return value
      .map(v => (resolveEach ? resolveId!(String(v)) ?? String(v) : String(v)))
      .join(', ');
  }

  if (typeof value === 'object') {
    // `condition` is the only object column. Its own renderer lives in the library
    // (describeRequirementCondition, which needs the attribute list); here it is enough to
    // show the shape changed and what it changed to, without pretending to name attributes.
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== '');
    return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ') : '—';
  }

  return String(value);
};

export interface HistoryDiffRow {
  column: string;
  label: string;
  before: string;
  after: string;
}

/**
 * The field-by-field diff for one entry.
 *
 * For an `update` this follows `changedFields`, which the database computed — not a
 * re-comparison here, so the list in the UI is exactly the list that was recorded. For a
 * `create` or `delete` it lists the whole row (skipping empties, which would otherwise bury
 * the three fields that matter under a dozen "—"). Lock and release events have no diff:
 * their reason is the record.
 */
export const historyDiffRows = (
  entry: ComplianceRequirementHistoryEntry,
  resolveId?: (id: string) => string | undefined,
): HistoryDiffRow[] => {
  const row = (column: string): HistoryDiffRow => ({
    column,
    label: fieldLabel(column),
    before: formatHistoryValue(column, entry.before?.[column] ?? null, resolveId),
    after: formatHistoryValue(column, entry.after?.[column] ?? null, resolveId),
  });

  if (entry.action === 'update') {
    return entry.changedFields.map(row);
  }

  if (entry.action === 'create' || entry.action === 'delete') {
    const snapshot = entry.after ?? entry.before ?? {};
    return Object.keys(snapshot)
      .filter(k => k !== 'id')
      .filter(k => {
        const v = snapshot[k];
        return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
      })
      .sort((a, b) => fieldLabel(a).localeCompare(fieldLabel(b)))
      .map(row);
  }

  return [];
};

/** Badge wording and tone per action. Kept beside the diff so the two cannot drift apart. */
export const HISTORY_ACTION_META: Record<
  ComplianceRequirementHistoryEntry['action'],
  { label: string; className: string }
> = {
  create: { label: 'Added', className: 'bg-emerald-100 text-emerald-700' },
  update: { label: 'Edited', className: 'bg-indigo-100 text-indigo-700' },
  delete: { label: 'Removed', className: 'bg-rose-100 text-rose-700' },
  lock: { label: 'Locked FINAL', className: 'bg-gray-800 text-white' },
  release: { label: 'Released', className: 'bg-amber-100 text-amber-800' },
};

/**
 * One-line summary of an entry, for the collapsed row.
 *
 * A lock or release names the category; a requirement change names the requirement. Both fall
 * back to a phrase rather than to an empty string, because a history row with no label reads
 * as a rendering bug even when the record itself is fine.
 */
export const summarizeHistoryEntry = (entry: ComplianceRequirementHistoryEntry): string => {
  const name = entry.title?.trim();
  switch (entry.action) {
    case 'lock':
      return name ? `${name} — requirements marked FINAL` : 'Requirements marked FINAL';
    case 'release':
      return name ? `${name} — released for editing` : 'Released for editing';
    default:
      return name || 'Untitled requirement';
  }
};
