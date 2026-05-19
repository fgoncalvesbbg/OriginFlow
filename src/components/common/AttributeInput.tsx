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
}) => {
  const rules = attribute.validationRules;
  const isNumeric = attribute.dataType === 'integer' || attribute.dataType === 'decimal';
  const placeholder = rules?.placeholder || (isNumeric && mode === 'range' ? 'e.g. 100-200' : 'Enter value');
  const unitLabel = rules?.unit ? (
    <span className="ml-2 text-xs text-gray-500 shrink-0">{rules.unit}</span>
  ) : null;

  const fieldClass = `${inputClass} ${error ? errorClass : ''}`;

  const renderToggle = () => {
    if (!isNumeric || !rules?.allowRange || !onModeChange) return null;
    return (
      <div className="flex bg-gray-100 rounded p-0.5 text-[10px] font-bold mb-1 w-fit">
        <button
          type="button"
          onClick={() => onModeChange('fixed')}
          disabled={disabled}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'fixed' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}
        >
          Fixed
        </button>
        <button
          type="button"
          onClick={() => onModeChange('range')}
          disabled={disabled}
          className={`px-2 py-0.5 rounded transition-colors ${mode === 'range' ? 'bg-white shadow text-indigo-600' : 'text-gray-500'}`}
        >
          Range
        </button>
      </div>
    );
  };

  const renderInput = () => {
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

    if (isNumeric && mode === 'range') {
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
