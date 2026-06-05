/**
 * BindableField — a configuration field that can be filled either by manual input OR by linking
 * one or more of the project's attributes (whose values join, in order). Used for placeholders,
 * value-conditions, and bound spec tokens.
 *
 * Extracted from ProjectIMGenerator.tsx.
 */

import React, { useState } from 'react';
import { CategoryAttribute } from '../../../types';
import { Link2, AlertCircle, CheckCircle, Type, Search, CheckSquare, Square, X, RotateCw } from 'lucide-react';
import { joinAttrValues } from './im-layout.utils';

export interface BindableFieldProps {
  label: React.ReactNode;
  badge?: { text: string; className: string };
  multiline?: boolean;
  placeholder?: string;
  unit?: string;
  /** Explicit manual value (formData[fieldId]); undefined = not set. */
  manualValue?: string;
  /** Value inherited downstream when no manual value & not bound (e.g. submitted attr). */
  inheritedValue?: string;
  attributes: CategoryAttribute[];
  submittedAttrValues: Record<string, string>;
  /** Linked attribute ids; undefined = manual mode. */
  boundAttrIds?: string[];
  onManualChange: (v: string) => void;
  onClearManual: () => void;
  onSetMode: (mode: 'manual' | 'attributes') => void;
  onToggleAttr: (attrId: string) => void;
}

export const BindableField: React.FC<BindableFieldProps> = ({
  label, badge, multiline, placeholder, unit, manualValue, inheritedValue,
  attributes, submittedAttrValues, boundAttrIds,
  onManualChange, onClearManual, onSetMode, onToggleAttr,
}) => {
  const [search, setSearch] = useState('');
  const isBound = boundAttrIds !== undefined;
  const isExplicit = manualValue !== undefined;
  const displayValue = manualValue ?? inheritedValue ?? '';
  const resolved = isBound ? joinAttrValues(boundAttrIds!, submittedAttrValues) : '';
  const filled = isBound ? !!resolved : displayValue !== '';

  const filteredAttrs = search.trim()
    ? attributes.filter(a => a.name.toLowerCase().includes(search.trim().toLowerCase()))
    : attributes;

  const badgeBase = 'text-[10px] font-bold flex items-center gap-1 px-1.5 py-0.5 rounded';
  const status = isBound
    ? (filled
        ? <span className={`${badgeBase} text-emerald-600 bg-emerald-50`}><Link2 size={10} /> Linked</span>
        : <span className={`${badgeBase} text-orange-500 bg-amber-50`}><AlertCircle size={10} /> No values</span>)
    : (isExplicit && manualValue !== ''
        ? <span className={`${badgeBase} text-emerald-600 bg-emerald-50`}><CheckCircle size={10} /> Filled</span>
        : (!isExplicit && inheritedValue
            ? <span className={`${badgeBase} text-emerald-600 bg-emerald-50`}><CheckCircle size={10} /> From supplier</span>
            : <span className={`${badgeBase} text-orange-500 bg-amber-50`}><AlertCircle size={10} /> Needs value</span>));

  return (
    <div>
      <div className="flex justify-between items-center mb-1.5 gap-2">
        <label className="text-xs font-bold text-muted uppercase tracking-wide flex items-center gap-1 min-w-0">
          {badge && <span className={`px-1.5 py-0.5 rounded text-[10px] ${badge.className}`}>{badge.text}</span>}
          <span className="truncate">{label}</span>
        </label>
        <div className="flex items-center gap-1.5 shrink-0">
          {status}
          <div className="flex rounded-md border border-gray-200 overflow-hidden">
            <button type="button" onClick={() => onSetMode('manual')} title="Manual input"
              className={`px-1.5 py-0.5 ${!isBound ? 'bg-indigo-600 text-white' : 'bg-white text-gray-400 hover:bg-gray-50'}`}><Type size={11} /></button>
            <button type="button" onClick={() => onSetMode('attributes')} title="Link project attributes"
              className={`px-1.5 py-0.5 ${isBound ? 'bg-indigo-600 text-white' : 'bg-white text-gray-400 hover:bg-gray-50'}`}><Link2 size={11} /></button>
          </div>
        </div>
      </div>

      {isBound ? (
        <div className="border border-indigo-200 rounded-lg p-2 bg-indigo-50/40 space-y-2">
          <div className="text-xs">
            <span className="text-muted">Resolves to: </span>
            {resolved
              ? <span className="font-medium text-gray-800">{resolved}{unit}</span>
              : <span className="italic text-gray-400">select attribute(s) below…</span>}
          </div>
          {boundAttrIds!.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {boundAttrIds!.map(id => {
                const a = attributes.find(x => x.id === id);
                const v = submittedAttrValues[id];
                return (
                  <span key={id} className="inline-flex items-center gap-1 bg-white border border-indigo-200 rounded-full pl-2 pr-1 py-0.5 text-[11px]">
                    <span className="font-medium text-indigo-700">{a?.name ?? id}</span>
                    <span className="text-gray-400">{v ? `: ${v}` : ': —'}</span>
                    <button type="button" onClick={() => onToggleAttr(id)} className="text-gray-300 hover:text-rose-500"><X size={11} /></button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search attributes…"
              className="w-full border border-gray-200 rounded pl-6 pr-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>
          <div className="max-h-36 overflow-y-auto space-y-0.5">
            {filteredAttrs.map(a => {
              const selected = boundAttrIds!.includes(a.id);
              const v = submittedAttrValues[a.id];
              return (
                <button type="button" key={a.id} onClick={() => onToggleAttr(a.id)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-xs text-left transition-colors ${selected ? 'bg-indigo-100 text-indigo-800' : 'hover:bg-white text-gray-600'}`}>
                  <span className="flex items-center gap-1.5 min-w-0">
                    {selected ? <CheckSquare size={12} className="shrink-0" /> : <Square size={12} className="shrink-0 text-gray-300" />}
                    <span className="truncate">{a.name}</span>
                  </span>
                  <span className={`shrink-0 ${v ? 'text-gray-500' : 'text-amber-500 italic'}`}>{v ?? 'no value'}</span>
                </button>
              );
            })}
            {filteredAttrs.length === 0 && <p className="text-xs text-gray-400 italic px-2 py-1">No attributes match.</p>}
          </div>
          <p className="text-[10px] text-gray-400">Pick one or more — values join in order, separated by a space.</p>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          {multiline ? (
            <textarea rows={2} placeholder={placeholder ?? 'Content…'} value={displayValue} onChange={e => onManualChange(e.target.value)}
              className={`flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${filled ? 'border-gray-300 bg-light' : 'border-amber-200 bg-white'}`} />
          ) : (
            <input placeholder={placeholder ?? (inheritedValue || 'Enter value…')} value={displayValue} onChange={e => onManualChange(e.target.value)}
              className={`flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${filled ? 'border-gray-300 bg-light' : 'border-amber-200 bg-white'}`} />
          )}
          {unit && <span className="text-xs text-muted whitespace-nowrap mt-2.5">{unit}</span>}
          {isExplicit && inheritedValue !== undefined && manualValue !== inheritedValue && (
            <button type="button" onClick={onClearManual} title={`Reset to supplier value “${inheritedValue}”`}
              className="text-gray-300 hover:text-indigo-600 mt-2.5"><RotateCw size={13} /></button>
          )}
        </div>
      )}
    </div>
  );
};
