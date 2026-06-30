/**
 * Right-side drawer for one (SKU, attribute) cell in the Attribute Viewer. Lets a reviewer edit the
 * value (written back to the SKU) and flag the cell with a comment / resolve / remove the flag.
 */
import React, { useState } from 'react';
import { CategoryAttribute, SkuAttributeFlag } from '../../types';
import { CategorySku } from '../../services';
import AttributeInput from '../common/AttributeInput';
import { Button } from '../common/Button';
import { X, Flag, CheckCircle2, Trash2 } from 'lucide-react';

interface Props {
  sku: CategorySku;
  attribute: CategoryAttribute;
  value: string;
  flag?: SkuAttributeFlag;
  onSaveValue: (newValue: string) => Promise<void>;
  onSaveFlag: (comment: string) => Promise<void>;
  onResolveFlag: (resolved: boolean) => Promise<void>;
  onDeleteFlag: () => Promise<void>;
  onClose: () => void;
}

const isNumeric = (attr: CategoryAttribute) =>
  attr.dataType === 'integer' || attr.dataType === 'decimal';

const SkuAttributeCellDrawer: React.FC<Props> = ({
  sku,
  attribute,
  value,
  flag,
  onSaveValue,
  onSaveFlag,
  onResolveFlag,
  onDeleteFlag,
  onClose,
}) => {
  const [editValue, setEditValue] = useState(value);
  // Range mode only matters for numeric attributes that allow it; detect from an existing "lo-hi".
  const initialRange = isNumeric(attribute) && /^-?\d/.test(value) && value.includes('-') && value[0] !== '-';
  const [mode, setMode] = useState<'fixed' | 'range' | 'text'>(
    isNumeric(attribute) ? (initialRange ? 'range' : 'fixed') : 'text',
  );
  const [comment, setComment] = useState(flag?.comment ?? '');
  const [busy, setBusy] = useState<null | 'value' | 'flag' | 'resolve' | 'delete'>(null);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const valueDirty = editValue !== value;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-scaleIn">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide">{attribute.name}</p>
            <p className="text-sm font-semibold text-primary truncate">{sku.skuNumber || '(no SKU number)'}</p>
            <p className="text-xs text-gray-400 truncate">{sku.skuTitle || sku.projectName}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Edit value */}
          <section>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Value</h3>
            <AttributeInput
              attribute={attribute}
              value={editValue}
              onChange={setEditValue}
              mode={mode}
              onModeChange={isNumeric(attribute) ? setMode : undefined}
            />
            <div className="mt-3 flex items-center gap-2">
              <Button
                onClick={() => run('value', () => onSaveValue(editValue))}
                loading={busy === 'value'}
                disabled={!valueDirty || busy !== null}
              >
                Save value
              </Button>
              {valueDirty && (
                <button
                  onClick={() => setEditValue(value)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Reset
                </button>
              )}
            </div>
          </section>

          {/* Flag / comment */}
          <section className="border-t border-gray-100 pt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Review flag</h3>
              {flag && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    flag.status === 'open' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {flag.status === 'open' ? 'Flagged' : 'Resolved'}
                </span>
              )}
            </div>

            {flag && (
              <p className="text-[11px] text-gray-400 mb-2">
                Flagged by {flag.flaggedByName || 'someone'} ·{' '}
                {new Date(flag.createdAt).toLocaleDateString()}
              </p>
            )}

            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder="Describe what's wrong with this value…"
              className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                onClick={() => run('flag', () => onSaveFlag(comment))}
                loading={busy === 'flag'}
                leftIcon={<Flag size={14} />}
                disabled={busy !== null || !comment.trim()}
              >
                {flag ? 'Update flag' : 'Flag value'}
              </Button>

              {flag && flag.status === 'open' && (
                <Button
                  variant="secondary"
                  onClick={() => run('resolve', () => onResolveFlag(true))}
                  loading={busy === 'resolve'}
                  leftIcon={<CheckCircle2 size={14} />}
                  disabled={busy !== null}
                >
                  Resolve
                </Button>
              )}
              {flag && flag.status === 'resolved' && (
                <Button
                  variant="secondary"
                  onClick={() => run('resolve', () => onResolveFlag(false))}
                  loading={busy === 'resolve'}
                  disabled={busy !== null}
                >
                  Re-open
                </Button>
              )}
              {flag && (
                <Button
                  variant="danger"
                  onClick={() => run('delete', onDeleteFlag)}
                  loading={busy === 'delete'}
                  leftIcon={<Trash2 size={14} />}
                  disabled={busy !== null}
                >
                  Remove
                </Button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SkuAttributeCellDrawer;
