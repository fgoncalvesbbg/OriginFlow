import React from 'react';
import { CategoryAttribute } from '../../types';

interface AttributeInputProps {
  attribute: CategoryAttribute;
  value: string;
  onChange: (value: string) => void;
  mode: 'fixed' | 'range' | 'text';
  onModeChange?: (mode: 'fixed' | 'range') => void;
  disabled?: boolean;
  error?: string;
  /** When true, always renders range (min/max) inputs and hides the Fixed/Range toggle.
   *  Used in RFQ creation context where numeric specs are always expressed as ranges. */
  forceRange?: boolean;
  /** Selected options for multi-select enum. When provided alongside onValuesChange,
   *  the enum field renders as checkboxes instead of a single dropdown. */
  values?: string[];
  onValuesChange?: (vals: string[]) => void;
}

const inputClass = 'w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50';
const errorClass = 'border-rose-400 focus:ring-rose-400';

const AttributeInput: React.FC<AttributeInputProps> = ({
  attribute,
  value,
  onChange,
  mode,
  onModeChange,
  disabled,
  error,
  forceRange,
  values,
  onValuesChange,
}) => {
  const rules = attribute.validationRules;
  const isNumeric = attribute.dataType === 'integer' || attribute.dataType === 'decimal';
  const effectiveMode = forceRange ? 'range' : mode;
  const placeholder = rules?.placeholder || (isNumeric && effectiveMode === 'range' ? 'e.g. 100-200' : 'Enter value');
  const unitLabel = rules?.unit ? (
    <span className="ml-2 text-xs text-gray-500 shrink-0">{rules.unit}</span>
  ) : null;

  const fieldClass = `${inputClass} ${error ? errorClass : ''}`;

  const renderToggle = () => {
    // Hide toggle when forceRange is on or when it's not applicable
    if (forceRange || !isNumeric || !rules?.allowRange || !onModeChange) return null;
    return (
      <div className="flex bg-gray-100 rounded p-0.5 text-[10px] font-bold mb-1 w-fit">
        <button
          type="button"
          onClick={() => onModeChange('fixed')}
          disabled={disabled}
          className={`px-2 py-0.5 rounded transition-colors ${effectiveMode === 'fixed' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}
        >
          Fixed
        </button>
        <button
          type="button"
          onClick={() => onModeChange('range')}
          disabled={disabled}
          className={`px-2 py-0.5 rounded transition-colors ${effectiveMode === 'range' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}
        >
          Range
        </button>
      </div>
    );
  };

  const renderInput = () => {
    // ── Enum: multi-select checkboxes (RFQ creation) ────────────────────────
    if (attribute.dataType === 'enum' && onValuesChange) {
      const options = rules?.enumOptions ?? [];
      const selected = values ?? [];
      return (
        <div className={`space-y-1.5 ${error ? 'p-2 border rounded ' + errorClass : ''}`}>
          {options.length === 0 && (
            <p className="text-xs text-gray-400 italic">No options defined for this attribute.</p>
          )}
          {options.map(opt => (
            <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer hover:text-indigo-700">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                disabled={disabled}
                onChange={e => {
                  const next = e.target.checked
                    ? [...selected, opt]
                    : selected.filter(v => v !== opt);
                  onValuesChange(next);
                }}
                className="accent-indigo-600 w-3.5 h-3.5"
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }

    // ── Enum: single select (backwards compat / supplier view) ──────────────
    if (attribute.dataType === 'enum') {
      const options = rules?.enumOptions ?? [];
      return (
        <select
          className={fieldClass}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">-- Select --</option>
          {options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }

    // ── Boolean ─────────────────────────────────────────────────────────────
    if (attribute.dataType === 'boolean') {
      return (
        <select
          className={fieldClass}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">-- Select --</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }

    // ── Numeric range (includes forceRange) ──────────────────────────────────
    if (isNumeric && effectiveMode === 'range') {
      const [lo, hi] = value.split('-');
      const updateRange = (side: 'lo' | 'hi', v: string) => {
        if (side === 'lo') onChange(`${v}-${hi ?? ''}`);
        else onChange(`${lo ?? ''}-${v}`);
      };
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step={rules?.step ?? (attribute.dataType === 'decimal' ? 'any' : '1')}
            min={rules?.min}
            max={rules?.max}
            className={fieldClass}
            placeholder="Min"
            value={lo ?? ''}
            onChange={e => updateRange('lo', e.target.value)}
            disabled={disabled}
          />
          <span className="text-gray-400 shrink-0">–</span>
          <input
            type="number"
            step={rules?.step ?? (attribute.dataType === 'decimal' ? 'any' : '1')}
            min={rules?.min}
            max={rules?.max}
            className={fieldClass}
            placeholder="Max"
            value={hi ?? ''}
            onChange={e => updateRange('hi', e.target.value)}
            disabled={disabled}
          />
          {unitLabel}
        </div>
      );
    }

    // ── Numeric fixed ────────────────────────────────────────────────────────
    if (isNumeric) {
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step={rules?.step ?? (attribute.dataType === 'decimal' ? 'any' : '1')}
            min={rules?.min}
            max={rules?.max}
            className={fieldClass}
            placeholder={placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
          />
          {unitLabel}
        </div>
      );
    }

    // ── Text ─────────────────────────────────────────────────────────────────
    return (
      <input
        type="text"
        className={fieldClass}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      />
    );
  };

  return (
    <div>
      {renderToggle()}
      {renderInput()}
      {error && <p className="text-xs text-rose-500 mt-1">{error}</p>}
    </div>
  );
};

export default AttributeInput;
