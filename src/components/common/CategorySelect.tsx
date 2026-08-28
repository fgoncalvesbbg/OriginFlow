/**
 * Category picker for the L3 leaf list, grouped into "L1 › L2" optgroups.
 *
 * A flat list of ~130 leaves is unusable in a native select, and the leaf names alone are
 * ambiguous ("Electric Grills" exists under both Small Appliances and Garden › Grills), so
 * the group heading is what actually disambiguates the choice. The value is still a plain
 * categories_l3 id — this changes how the list is presented, never what gets stored.
 */

import React from 'react';
import { CategoryL3 } from '../../types';
import { groupByL1L2 } from '../../utils/category-tree.utils';

interface CategorySelectProps {
  categories: CategoryL3[];
  value: string;
  onChange: (categoryId: string) => void;
  /** Shown as the empty option. Omit to make the select required-looking. */
  placeholder?: string;
  /** Hide inactive leaves. On by default: retired categories should not be pickable. */
  activeOnly?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
}

export const CategorySelect: React.FC<CategorySelectProps> = ({
  categories,
  value,
  onChange,
  placeholder = 'Select a category…',
  activeOnly = true,
  disabled = false,
  required = false,
  className = '',
  id,
}) => {
  // An inactive category that is already selected stays in the list, otherwise editing an
  // existing record would silently blank its category.
  const visible = activeOnly
    ? categories.filter(c => c.active || c.id === value)
    : categories;

  const groups = groupByL1L2(visible);

  return (
    <select
      id={id}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      required={required}
      className={className || 'w-full p-2.5 border border-gray-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-400'}
    >
      <option value="">{placeholder}</option>
      {groups.map(g => (
        <optgroup key={g.key} label={g.label}>
          {g.categories.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}{c.active ? '' : ' (inactive)'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
};
