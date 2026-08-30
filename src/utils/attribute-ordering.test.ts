/**
 * Covers compareAttributes — the single ordering rule every attribute list uses: group
 * position, then explicit sort_order within the group, then name.
 */
import { describe, it, expect } from 'vitest';
import { compareAttributes, attributeGroupRank } from '../config/compliance.constants';

const a = (name: string, group: string, sortOrder?: number) => ({ name, group, sortOrder });
const order = (rows: { name: string; group?: string; sortOrder?: number }[]) =>
  [...rows].sort(compareAttributes).map(r => r.name);

describe('compareAttributes', () => {
  it('puts group order ahead of everything else', () => {
    // 'Global' ranks first, so its row leads even though its name sorts last.
    expect(order([
      a('Zulu', 'Category Specific'),
      a('Alpha', 'Global'),
    ])).toEqual(['Alpha', 'Zulu']);
    expect(attributeGroupRank('Global')).toBeLessThan(attributeGroupRank('Category Specific'));
  });

  it('honours explicit sort_order within a group, over the name', () => {
    expect(order([
      a('Airflow min', 'Category Specific', 30),
      a('Airflow max', 'Category Specific', 20),
      a('Motor Power', 'Category Specific', 10),
    ])).toEqual(['Motor Power', 'Airflow max', 'Airflow min']);
  });

  it('falls back to name when the group is unordered (all zero)', () => {
    // Pre-migration behaviour: nothing has an explicit order, so it reads alphabetically.
    expect(order([
      a('Motor Power', 'Category Specific'),
      a('Airflow max', 'Category Specific'),
      a('Boost Levels', 'Category Specific'),
    ])).toEqual(['Airflow max', 'Boost Levels', 'Motor Power']);
  });

  it('sorts an ordered row above an unordered one in the same group', () => {
    // 0 means "unordered", so anything explicitly numbered sits after it only if its number
    // is higher — a row moved to the top gets 10 and must lead.
    expect(order([
      a('Unordered', 'Category Specific', 0),
      a('Moved to top', 'Category Specific', 10),
    ])).toEqual(['Unordered', 'Moved to top']);
  });

  it('keeps groups intact even when sort numbers collide across them', () => {
    expect(order([
      a('Cat B', 'Category Specific', 10),
      a('Glob B', 'Global', 20),
      a('Cat A', 'Category Specific', 5),
      a('Glob A', 'Global', 10),
    ])).toEqual(['Glob A', 'Glob B', 'Cat A', 'Cat B']);
  });

  it('treats a missing sortOrder as 0 rather than sorting it last', () => {
    expect(order([
      a('Has order', 'Global', 10),
      { name: 'No order', group: 'Global' },
    ])).toEqual(['No order', 'Has order']);
  });

  it('is a stable, total order — sorting twice changes nothing', () => {
    const rows = [
      a('B', 'Global', 10), a('A', 'Global', 10), a('C', 'Packaging'), a('D', 'Global', 5),
    ];
    const once = [...rows].sort(compareAttributes);
    const twice = [...once].sort(compareAttributes);
    expect(twice.map(r => r.name)).toEqual(once.map(r => r.name));
    expect(once.map(r => r.name)).toEqual(['D', 'A', 'B', 'C']);
  });
});
