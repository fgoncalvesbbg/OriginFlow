import { describe, it, expect } from 'vitest';

import { parseRegulationNotes } from './regulation-notes';

describe('parseRegulationNotes', () => {
  it('splits one bullet per line', () => {
    expect(parseRegulationNotes('Applies to built-in only\nAnnex IV excluded'))
      .toEqual(['Applies to built-in only', 'Annex IV excluded']);
  });

  it('strips Markdown list markers so the bullet is not doubled', () => {
    expect(parseRegulationNotes('- First\n* Second\n• Third'))
      .toEqual(['First', 'Second', 'Third']);
  });

  it('keeps a numeric prefix, rather than silently renumbering an ordered list', () => {
    expect(parseRegulationNotes('1. First\n2. Second'))
      .toEqual(['1. First', '2. Second']);
  });

  it('keeps a leading minus that is a sign, not a bullet', () => {
    // A marker only counts when whitespace follows it.
    expect(parseRegulationNotes('-20°C minimum ambient')).toEqual(['-20°C minimum ambient']);
  });

  it('drops blank lines and trims each bullet', () => {
    expect(parseRegulationNotes('  First  \n\n\n   \n  Second'))
      .toEqual(['First', 'Second']);
  });

  it('handles CRLF line endings from a pasted document', () => {
    expect(parseRegulationNotes('First\r\nSecond')).toEqual(['First', 'Second']);
  });

  it('returns a single entry for a legacy one-paragraph note', () => {
    // Every note written before bullets existed must still read correctly.
    expect(parseRegulationNotes('Scope: household appliances only.'))
      .toEqual(['Scope: household appliances only.']);
  });

  it('returns nothing for empty, whitespace, null or undefined', () => {
    expect(parseRegulationNotes('')).toEqual([]);
    expect(parseRegulationNotes('   \n  ')).toEqual([]);
    expect(parseRegulationNotes(null)).toEqual([]);
    expect(parseRegulationNotes(undefined)).toEqual([]);
  });

  it('does not treat a lone marker as a bullet with content', () => {
    expect(parseRegulationNotes('- \n-\nReal note')).toEqual(['-', 'Real note']);
  });
});
