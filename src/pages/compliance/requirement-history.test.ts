import { describe, it, expect } from 'vitest';
import {
  fieldLabel,
  formatHistoryValue,
  historyDiffRows,
  summarizeHistoryEntry,
} from './requirement-history';
import type { ComplianceRequirementHistoryEntry } from '../../types';

const entry = (
  over: Partial<ComplianceRequirementHistoryEntry>,
): ComplianceRequirementHistoryEntry => ({
  id: 1,
  categoryId: 'cat-1',
  requirementId: 'req-1',
  action: 'update',
  title: 'LVD Report',
  section: 'Electrical Safety',
  reason: null,
  before: null,
  after: null,
  changedFields: [],
  linkedCategoryIds: [],
  changedAt: '2026-09-10T08:30:00Z',
  changedBy: 'Fabio Goncalves',
  ...over,
});

describe('formatHistoryValue', () => {
  it('spells out booleans rather than printing true/false', () => {
    expect(formatHistoryValue('is_mandatory', true)).toBe('Yes');
    expect(formatHistoryValue('is_mandatory', false)).toBe('No');
  });

  it('renders an absent value as a dash, never as empty', () => {
    expect(formatHistoryValue('description', null)).toBe('—');
    expect(formatHistoryValue('description', undefined)).toBe('—');
    expect(formatHistoryValue('description', '   ')).toBe('—');
  });

  it('translates the coded columns into the words the library uses', () => {
    expect(formatHistoryValue('timing_type', 'POST_ETD')).toBe('After ETD');
    expect(formatHistoryValue('test_report_origin', 'supplier_inhouse')).toBe('In-house accepted');
  });

  it('leaves an unrecognised code alone instead of blanking it', () => {
    expect(formatHistoryValue('timing_type', 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('resolves an id to its name, and falls back to the raw id when it cannot', () => {
    const resolve = (id: string) => (id === 'reg-1' ? 'EN 60335-1' : undefined);
    expect(formatHistoryValue('regulation_id', 'reg-1', resolve)).toBe('EN 60335-1');
    expect(formatHistoryValue('regulation_id', 'reg-gone', resolve)).toBe('reg-gone');
  });

  it('never rewrites a non-id column through the resolver', () => {
    // A title that happens to match a known id must stay the title it was.
    const resolve = () => 'EN 60335-1';
    expect(formatHistoryValue('title', 'reg-1', resolve)).toBe('reg-1');
  });

  it('flattens the condition object without inventing attribute names', () => {
    const out = formatHistoryValue('condition', { requires_feature: 'attr-9', requires_feature_label: 'Yes' });
    expect(out).toContain('requires_feature: attr-9');
    expect(out).toContain('requires_feature_label: Yes');
  });
});

describe('historyDiffRows', () => {
  it('follows the fields the DATABASE recorded, not a re-comparison', () => {
    // before/after disagree on description too, but changed_fields is the record — the diff
    // must show exactly what was written, or the UI and the audit trail tell different stories.
    const rows = historyDiffRows(entry({
      changedFields: ['is_mandatory'],
      before: { is_mandatory: false, description: 'old text' },
      after: { is_mandatory: true, description: 'new text' },
    }));
    expect(rows.map(r => r.column)).toEqual(['is_mandatory']);
    expect(rows[0]).toMatchObject({ label: 'Mandatory', before: 'No', after: 'Yes' });
  });

  it('shows an unrecognised column under its raw name rather than dropping it', () => {
    const rows = historyDiffRows(entry({
      changedFields: ['some_new_column'],
      before: { some_new_column: 'a' },
      after: { some_new_column: 'b' },
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('some_new_column');
  });

  it('lists the whole row for a create, skipping the columns that hold nothing', () => {
    const rows = historyDiffRows(entry({
      action: 'create',
      before: null,
      after: {
        id: 'req-1', title: 'LVD Report', description: '', is_mandatory: true,
        clause_id: null, condition_feature_ids: [],
      },
    }));
    const cols = rows.map(r => r.column);
    expect(cols).toContain('title');
    expect(cols).toContain('is_mandatory');
    // The row's own id is never a "change"; empties would bury the fields that matter.
    expect(cols).not.toContain('id');
    expect(cols).not.toContain('description');
    expect(cols).not.toContain('clause_id');
    expect(cols).not.toContain('condition_feature_ids');
  });

  it('lists the deleted row from its before-snapshot', () => {
    const rows = historyDiffRows(entry({
      action: 'delete',
      before: { id: 'req-1', title: 'LVD Report', is_mandatory: true },
      after: null,
    }));
    expect(rows.map(r => r.column).sort()).toEqual(['is_mandatory', 'title']);
  });

  it('gives lock and release no diff — their reason is the record', () => {
    expect(historyDiffRows(entry({ action: 'lock', after: { is_finalized: true } }))).toEqual([]);
    expect(historyDiffRows(entry({ action: 'release', reason: 'standard superseded' }))).toEqual([]);
  });
});

describe('summarizeHistoryEntry', () => {
  it('names the requirement for a requirement change', () => {
    expect(summarizeHistoryEntry(entry({}))).toBe('LVD Report');
  });

  it('names the category for a lock or release', () => {
    expect(summarizeHistoryEntry(entry({ action: 'lock', title: 'Angled Hoods' })))
      .toBe('Angled Hoods — requirements marked FINAL');
    expect(summarizeHistoryEntry(entry({ action: 'release', title: 'Angled Hoods' })))
      .toBe('Angled Hoods — released for editing');
  });

  it('never returns an empty label, which would read as a rendering bug', () => {
    expect(summarizeHistoryEntry(entry({ title: null }))).toBe('Untitled requirement');
    expect(summarizeHistoryEntry(entry({ title: '  ', action: 'lock' }))).toBe('Requirements marked FINAL');
  });
});

describe('fieldLabel', () => {
  it('labels the columns an operator sees in the library', () => {
    expect(fieldLabel('test_report_origin')).toBe('Test report origin');
    expect(fieldLabel('condition')).toBe('Applies if');
  });
});
