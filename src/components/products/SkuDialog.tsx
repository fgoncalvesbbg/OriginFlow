/**
 * One SKU's own surface: what it is, where it is up to, and everything that has happened to it.
 *
 * Absorbed from the SKU Catalog page, which carried finalize/unlock, delete and the change-log
 * viewer as separate row controls in a grid that no longer exists. They belong to the SKU
 * rather than to a cell, so they live together here — reached by clicking the item number in a
 * column header.
 *
 * Phase 3 of docs/originflow-attribute-viewer-merge-plan.md.
 */
import React, { useEffect, useState } from 'react';
import type {
  CategoryAttribute,
  SkuAttributeFlag,
  SkuAttributeValueRecord,
  SkuChangeLogEntry,
} from '../../types';
import type { CategorySku } from '../../services';
import { getSkuChangeLog } from '../../services';
import { Button } from '../common/Button';
import Thumb from './attribute-grid/Thumb';
import SkuValuePanel from './SkuValuePanel';
import type { EprelComparison } from './attribute-grid/eprel-compare.utils';
import { X, Lock, Unlock, Trash2, Loader2, History } from 'lucide-react';

interface Props {
  sku: CategorySku;
  /** Other records sharing this item number. Named rather than merged. */
  duplicates: readonly CategorySku[];
  /** Everything needed to fill this SKU in from empty, one field at a time. */
  attributes: readonly CategoryAttribute[];
  byCell: Map<string, SkuAttributeValueRecord>;
  flagMap: Record<string, SkuAttributeFlag>;
  eprelByCell?: Map<string, EprelComparison>;
  onSaveValue: (attribute: CategoryAttribute, value: string) => Promise<void>;
  onClearValue: (attribute: CategoryAttribute) => Promise<void>;
  onOpenCell: (attributeId: string) => void;
  onSetFinal: (isFinal: boolean, reason: string) => Promise<void>;
  onRename: (skuNumber: string, skuTitle: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

/** How each logged action reads, and how loud it should be. */
const ACTION_STYLES: Record<string, { label: string; className: string }> = {
  create: { label: 'Created', className: 'bg-blue-50 text-blue-700' },
  value: { label: 'Value', className: 'bg-gray-100 text-gray-700' },
  clear: { label: 'Cleared', className: 'bg-rose-50 text-rose-700' },
  update: { label: 'Updated', className: 'bg-gray-100 text-gray-700' },
  finalize: { label: 'Finalized', className: 'bg-emerald-50 text-emerald-700' },
  unlock: { label: 'Unlocked', className: 'bg-amber-50 text-amber-700' },
  export: { label: 'Exported', className: 'bg-indigo-50 text-indigo-700' },
  delete: { label: 'Deleted', className: 'bg-red-50 text-red-700' },
};

const SkuDialog: React.FC<Props> = ({
  sku,
  duplicates,
  attributes,
  byCell,
  flagMap,
  eprelByCell,
  onSaveValue,
  onClearValue,
  onOpenCell,
  onSetFinal,
  onRename,
  onDelete,
  onClose,
}) => {
  const [entries, setEntries] = useState<SkuChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'final' | 'delete' | 'rename'>(null);
  const [number, setNumber] = useState(sku.skuNumber);
  const [title, setTitle] = useState(sku.skuTitle);
  const [reason, setReason] = useState('');
  const [askingReason, setAskingReason] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      const log = await getSkuChangeLog(sku.id);
      if (mounted) {
        setEntries(log);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [sku.id]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="animate-scaleIn relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <Thumb skuNumbers={[sku.skuNumber]} size={48} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-primary">
                {sku.skuNumber || '(no SKU number)'}
              </p>
              <p className="truncate text-xs text-gray-400">
                {sku.skuTitle || sku.projectName || 'Catalog SKU'}
              </p>
              <span
                className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  sku.isFinal ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {sku.isFinal ? <Lock size={9} /> : null}
                {sku.isFinal ? 'Final' : 'In progress'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {/* An item number can name several records. Saying which is which is the honest
              alternative to picking one — nothing anywhere merges them. */}
          {duplicates.length > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-amber-800">
                {duplicates.length + 1} records share this item number
              </h3>
              <p className="mt-1 text-[11px] text-amber-700">
                Each is a separate product record with its own values. Nothing merges them, and
                an import that cannot tell which one you mean will propose nothing.
              </p>
              <ul className="mt-2 space-y-0.5 text-[11px] text-amber-900">
                <li>• {sku.projectName || 'Catalog SKU'} — this one</li>
                {duplicates.map(d => (
                  <li key={d.id}>• {d.projectName || 'Catalog SKU'}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Editing the number and title lived in the SKU Catalog's grid, which no longer
              exists. They are SKU-level facts rather than attribute values, so they belong here
              and not in a cell. Locked while the SKU is Final, like everything else about it. */}
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
              Identity
            </h3>
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-gray-600">
                  Item number
                </label>
                <input
                  value={number}
                  onChange={e => setNumber(e.target.value)}
                  disabled={sku.isFinal}
                  className="w-full rounded border border-gray-300 p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-gray-600">Title</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  disabled={sku.isFinal}
                  className="w-full rounded border border-gray-300 p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>
              {(number !== sku.skuNumber || title !== sku.skuTitle) && (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => run('rename', () => onRename(number.trim(), title.trim()))}
                    loading={busy === 'rename'}
                    disabled={busy !== null || number.trim() === ''}
                  >
                    Save
                  </Button>
                  <button
                    onClick={() => {
                      setNumber(sku.skuNumber);
                      setTitle(sku.skuTitle);
                    }}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Placed above Review status because filling the product in is why most people open
              this panel; signing it off is what they do once. */}
          <section className="border-t border-gray-100 pt-5">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
              Values
            </h3>
            <SkuValuePanel
              sku={sku}
              attributes={attributes}
              byCell={byCell}
              flagMap={flagMap}
              eprelByCell={eprelByCell}
              onSaveValue={onSaveValue}
              onClearValue={onClearValue}
              onOpenCell={onOpenCell}
            />
          </section>

          <section className="border-t border-gray-100 pt-5">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
              Review status
            </h3>

            {sku.isFinal ? (
              <>
                <p className="mb-2 text-[11px] text-gray-500">
                  This SKU is signed off. Its attribute values are locked — the database refuses
                  a write until it is unlocked, so this is not just a dialog.
                  {sku.finalizedAt && ` Finalized ${new Date(sku.finalizedAt).toLocaleString()}.`}
                </p>
                {askingReason ? (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-medium text-gray-600">
                      Why is this being reopened? Shown on its column header.
                    </label>
                    <input
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="e.g. supplier corrected the air-flow figures"
                      className="w-full rounded border border-gray-300 p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() =>
                          run('final', async () => {
                            await onSetFinal(false, reason);
                            setAskingReason(false);
                            setReason('');
                          })
                        }
                        loading={busy === 'final'}
                        leftIcon={<Unlock size={14} />}
                        disabled={busy !== null}
                      >
                        Unlock
                      </Button>
                      <button
                        onClick={() => setAskingReason(false)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => setAskingReason(true)}
                    leftIcon={<Unlock size={14} />}
                    disabled={busy !== null}
                  >
                    Unlock for editing
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="mb-2 text-[11px] text-gray-500">
                  Marking a SKU final locks its values against further edits until it is
                  unlocked, and is what makes it exportable.
                </p>
                {sku.reopenReason && (
                  <p className="mb-2 text-[11px] italic text-amber-700">
                    Reopened: {sku.reopenReason}
                  </p>
                )}
                <Button
                  onClick={() => run('final', () => onSetFinal(true, ''))}
                  loading={busy === 'final'}
                  leftIcon={<Lock size={14} />}
                  disabled={busy !== null}
                >
                  Mark as final
                </Button>
              </>
            )}
          </section>

          <section className="border-t border-gray-100 pt-5">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
              <History size={12} /> History
              {entries.length > 0 && (
                <span className="font-normal normal-case text-gray-400">
                  {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
                </span>
              )}
            </h3>

            {loading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-gray-400">
                <Loader2 className="animate-spin" size={14} /> Loading history…
              </div>
            ) : entries.length === 0 ? (
              <p className="py-2 text-xs text-gray-400">
                Nothing recorded against this SKU yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {entries.map(e => {
                  const style = ACTION_STYLES[e.action] ?? {
                    label: e.action,
                    className: 'bg-gray-100 text-gray-700',
                  };
                  return (
                    <li key={e.id} className="rounded border border-gray-100 p-2 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${style.className}`}
                        >
                          {style.label}
                        </span>
                        {e.field && <span className="font-medium text-gray-700">{e.field}</span>}
                        <span className="ml-auto shrink-0 text-gray-400">
                          {new Date(e.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {(e.oldValue || e.newValue) && (
                        <div className="mt-1 break-words text-gray-600">
                          <span className="text-gray-400 line-through">{e.oldValue || '—'}</span>
                          {' → '}
                          <span className="font-medium">{e.newValue || '—'}</span>
                        </div>
                      )}
                      {e.note && <div className="mt-0.5 italic text-gray-500">{e.note}</div>}
                      <div className="mt-0.5 text-gray-400">
                        {e.changedByName || 'someone'}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="border-t border-gray-100 pt-5">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
              Danger zone
            </h3>
            <p className="mb-2 text-[11px] text-gray-500">
              Deleting removes the SKU and every value stored against it. The history above is
              kept — its entries survive the SKU they describe.
            </p>
            <Button
              variant="danger"
              onClick={() => run('delete', onDelete)}
              loading={busy === 'delete'}
              leftIcon={<Trash2 size={14} />}
              disabled={busy !== null || sku.isFinal}
              title={sku.isFinal ? 'Unlock the SKU before deleting it' : undefined}
            >
              Delete SKU
            </Button>
            {sku.isFinal && (
              <p className="mt-1 text-[11px] text-gray-400">
                Unlock it first — a signed-off SKU is not deleted by accident.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default SkuDialog;
