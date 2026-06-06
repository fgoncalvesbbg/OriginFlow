/** Polymorphic input that renders the correct control for a category attribute's data type. */
import React from 'react';
import { CategoryAttribute } from '../../types';
import { uploadIMAsset } from '../../services/im/im-asset.service';
import { ImageIcon, Upload, Loader2, X, Lock } from 'lucide-react';

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
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadIMAsset(file, 'sku');
      onChange(url);
    } catch (err: any) {
      alert(err?.message || 'Image upload failed');
    } finally {
      setUploading(false);
    }
  };

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
    // ── Image: single upload, replaceable ────────────────────────────────────
    // One image per attribute. When `disabled`, the existing image is shown
    // read-only (suppliers can set it once; only a PM/internal user replaces it).
    if (attribute.dataType === 'image') {
      return (
        <div className={`${error ? 'p-2 border rounded ' + errorClass : ''}`}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageFile}
            disabled={disabled || uploading}
          />
          {value ? (
            <div className="flex items-start gap-3">
              <img
                src={value}
                alt={attribute.name}
                className="h-24 w-24 object-cover rounded-lg border border-gray-200 bg-gray-50"
              />
              {disabled ? (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400 mt-1">
                  <Lock size={12} /> Locked — only a PM can replace
                </span>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded border border-indigo-100 disabled:opacity-50"
                  >
                    {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                    {uploading ? 'Uploading…' : 'Replace'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange('')}
                    disabled={uploading}
                    className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 rounded border border-transparent hover:border-rose-100 disabled:opacity-50"
                  >
                    <X size={13} /> Remove
                  </button>
                </div>
              )}
            </div>
          ) : disabled ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg px-3 py-4 justify-center">
              <ImageIcon size={16} /> No image uploaded
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 border border-dashed border-indigo-300 rounded-lg px-3 py-4 disabled:opacity-50"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading ? 'Uploading…' : 'Upload image'}
            </button>
          )}
        </div>
      );
    }

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
