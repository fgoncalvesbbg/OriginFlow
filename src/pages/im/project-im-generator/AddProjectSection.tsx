/**
 * AddProjectSection — control to create a project-only section under a chosen parent (or at root).
 * Extracted from ProjectIMGenerator.tsx.
 */

import React, { useState } from 'react';
import { IMSection } from '../../../types';
import { FilePlus2, Plus } from 'lucide-react';

interface AddProjectSectionProps {
  sections: IMSection[];
  onAdd: (parentId: string | null) => void;
}

export const AddProjectSection: React.FC<AddProjectSectionProps> = ({ sections, onAdd }) => {
  const [parentId, setParentId] = useState<string>('');
  return (
    <div className="border border-dashed border-emerald-300 rounded-xl p-3 bg-emerald-50/40">
      <div className="text-xs font-bold text-emerald-700 mb-2 flex items-center gap-1"><FilePlus2 size={13} /> Add chapter (with header)</div>
      <div className="flex items-center gap-2">
        <select
          value={parentId}
          onChange={e => setParentId(e.target.value)}
          className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-400"
        >
          <option value="">At document root</option>
          {sections.map(s => <option key={s.id} value={s.id}>Under: {s.title}</option>)}
        </select>
        <button
          onClick={() => onAdd(parentId || null)}
          className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700"
        ><Plus size={13} /> Add</button>
      </div>
    </div>
  );
};
