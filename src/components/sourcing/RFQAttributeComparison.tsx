/** Side-by-side comparison of a buyer's RFQ attribute requirements and the supplier's proposed values. */
import React from 'react';
import { RFQAttributeValue } from '../../types';
import { Sliders, List } from 'lucide-react';

interface Props {
  attributes: RFQAttributeValue[];
  responses: Record<string, string>;
  onChange: (attributeId: string, value: string) => void;
}

const RFQAttributeComparison: React.FC<Props> = ({ attributes, responses, onChange }) => {
  if (!attributes || attributes.length === 0) return null;

  // Buyer's required value (left column).
  const renderRequirement = (attr: RFQAttributeValue) => {
    if (attr.type === 'multi-select' && attr.values?.length) {
      return (
        <div className="flex flex-wrap gap-1">
          {attr.values.map(v => (
            <span key={v} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium border border-indigo-200">{v}</span>
          ))}
        </div>
      );
    }
    if (attr.type === 'range') {
      return (
        <span className="text-gray-800 font-semibold text-sm">
          {attr.value.replace('-', ' – ')}
          <span className="text-xs text-gray-400 font-normal ml-1">(range)</span>
        </span>
      );
    }
    return <span className="text-gray-800 font-semibold text-sm">{attr.value || '—'}</span>;
  };

  // Supplier's proposed value input (right column).
  const renderResponseInput = (attr: RFQAttributeValue) => {
    const val = responses[attr.attributeId] ?? '';
    if (attr.type === 'multi-select' && attr.values?.length) {
      return (
        <select
          className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
          value={val}
          onChange={e => onChange(attr.attributeId, e.target.value)}
        >
          <option value="">-- Select your option --</option>
          {attr.values.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      );
    }
    if (attr.type === 'range') {
      return (
        <input
          type="number"
          step="any"
          className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          placeholder={`e.g. ${attr.value.replace('-', ' to ')}`}
          value={val}
          onChange={e => onChange(attr.attributeId, e.target.value)}
        />
      );
    }
    return (
      <input
        type="text"
        className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
        placeholder={attr.value || 'Enter your value'}
        value={val}
        onChange={e => onChange(attr.attributeId, e.target.value)}
      />
    );
  };

  return (
    <div className="border border-indigo-100 rounded-xl overflow-hidden">
      <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-100">
        <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <Sliders size={16} /> Specifications
        </h4>
        <p className="text-xs text-gray-500 mt-1">
          Review each requirement set by the buyer and enter your proposed value alongside it. Values must fall within the accepted range or options.
        </p>
      </div>

      {/* Column headers (desktop only) */}
      <div className="hidden sm:grid grid-cols-2 gap-4 px-4 py-2 bg-gray-50 border-b border-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-500">
        <span className="flex items-center gap-1"><List size={12} /> Buyer Requirement</span>
        <span>Your Quote</span>
      </div>

      <div className="divide-y divide-gray-100">
        {attributes.map(attr => (
          <div key={attr.attributeId} className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 px-4 py-3">
            {/* Buyer requirement */}
            <div className="sm:border-r sm:border-gray-100 sm:pr-4">
              <span className="block text-xs text-indigo-600 font-semibold uppercase mb-1">{attr.name}</span>
              {renderRequirement(attr)}
            </div>
            {/* Supplier's proposed value */}
            <div>
              <span className="block sm:hidden text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Your Quote</span>
              {renderResponseInput(attr)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RFQAttributeComparison;
