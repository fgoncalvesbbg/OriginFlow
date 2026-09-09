/**
 * One SKU column header.
 *
 * Ordered the way it answers "which product is this, and where is it up to":
 * tick box → thumbnail → item number → title → status → counts. Plus a colour BAND down the
 * side in the same palette as the column's cells — a band rather than a badge because it has
 * to be readable while scanning a hundred columns, and the header is already full.
 *
 * Recognising a product by its picture is far faster than reading a name, which is half the
 * reason the grid is transposed: none of this fits beside a row.
 */
import React from 'react';
import Thumb from './Thumb';
import { CELL_STATES } from './cell-state';
import { Lock, Users } from 'lucide-react';

export interface SkuHeaderCounts {
  filled: number;
  total: number;
  invalid: number;
  flags: number;
}

interface Props {
  skuNumber: string;
  skuTitle: string;
  projectName: string;
  isFinal: boolean;
  reopenReason?: string | null;
  /** How many other SKU records share this item number. 0 = it is unique. */
  duplicateCount: number;
  counts: SkuHeaderCounts;
  selected: boolean;
  onToggleSelected: () => void;
  onOpenSku: () => void;
}

const SkuHeader: React.FC<Props> = ({
  skuNumber,
  skuTitle,
  projectName,
  isFinal,
  reopenReason,
  duplicateCount,
  counts,
  selected,
  onToggleSelected,
  onOpenSku,
}) => {
  // The band takes the colour of whatever most needs attention in this column: a wrong value
  // first, then a complete column, then work still to do. Nothing to say ⇒ gray, per
  // State-Not-Decoration.
  const band =
    counts.invalid > 0
      ? CELL_STATES.invalid.cell
      : counts.filled === counts.total && counts.total > 0
        ? 'bg-emerald-500'
        : counts.filled === 0
          ? 'bg-gray-200'
          : 'bg-indigo-300';

  return (
    <div className="flex items-stretch gap-2 min-w-[150px]">
      <span className={`w-1 rounded-full shrink-0 ${band}`} aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`Select ${skuNumber || 'SKU'} for comparison`}
            className="mt-0.5 shrink-0 accent-indigo-600"
          />
          <Thumb skuNumbers={[skuNumber]} size={34} />
        </div>

        <button
          onClick={onOpenSku}
          className="mt-1 block max-w-full truncate text-left text-sm font-semibold text-indigo-700 hover:underline"
          title={`Open ${skuNumber}`}
        >
          {skuNumber || '—'}
        </button>

        <div
          className="truncate text-[11px] font-normal text-gray-400"
          title={skuTitle || projectName}
        >
          {skuTitle || projectName || '—'}
        </div>

        {/* An item number is NOT unique in OriginFlow: the same number can name two different
            records. Saying so on the header is the honest alternative to picking one — nothing
            here merges them. */}
        {duplicateCount > 0 && (
          <span
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
            title={`This item number names ${duplicateCount + 1} separate records. ${
              projectName ? `This one belongs to ${projectName}.` : 'This one is a catalog SKU.'
            } They are shown as separate columns and nothing merges them.`}
          >
            <Users size={9} />
            {duplicateCount + 1} records
          </span>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              isFinal ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {isFinal && <Lock size={9} />}
            {isFinal ? 'Final' : 'In progress'}
          </span>

          <span className="text-[10px] tabular-nums text-gray-400" title="Filled of total">
            {counts.filled}/{counts.total}
          </span>

          {counts.invalid > 0 && (
            <span
              className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
              title={`${counts.invalid} value${counts.invalid === 1 ? '' : 's'} this attribute cannot hold`}
            >
              {counts.invalid} invalid
            </span>
          )}

          {counts.flags > 0 && (
            <span
              className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
              title={`${counts.flags} open flag${counts.flags === 1 ? '' : 's'}`}
            >
              {counts.flags} flagged
            </span>
          )}
        </div>

        {/* Why a signed-off SKU is open again, on the header — the question a reader scanning
            a hundred columns actually asks. */}
        {!isFinal && reopenReason && (
          <div
            className="mt-1 truncate text-[10px] italic text-amber-700"
            title={`Reopened: ${reopenReason}`}
          >
            Reopened: {reopenReason}
          </div>
        )}
      </div>
    </div>
  );
};

export default SkuHeader;
