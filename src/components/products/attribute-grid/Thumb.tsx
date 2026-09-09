/**
 * A product thumbnail that handles its own failure rather than avoiding it.
 *
 * The URL is a deterministic Cloudinary convention, so 138 of these cost **zero** API calls —
 * but not every item has a hero image and there is no way to know without asking. So a 404 is
 * an ordinary outcome here, not an error, and everything below is about that.
 *
 * Three behaviours are load-bearing, each learned the hard way upstream:
 *
 *  1. **The placeholder keeps the same box size.** A missing image that collapsed would
 *     misalign every column beside it, turning one absent picture into a broken grid.
 *  2. **The element is KEYED on the current candidate.** Swapping only `src` on an `<img>`
 *     that has already failed does not reliably re-fire `onError`, so the fallback chain
 *     silently stops at the first miss. Changing the key replaces the element instead.
 *  3. **Multiple candidates.** Where a picture stands for a whole category, any of its items
 *     will do — which one provides it does not matter, only that something loads.
 */
import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface Props {
  /** Item numbers to try, in order. The first that loads wins. */
  skuNumbers: readonly string[];
  size?: number;
  width?: number;
  className?: string;
}

/** Cloudinary product thumbnail for an item number. Deterministic — no lookup, no API call. */
const skuThumbnailUrl = (skuNumber: string, width = 120): string => {
  const sku = skuNumber.trim();
  if (!sku) return '';
  return `https://res.cloudinary.com/chal-tec/image/upload/w_${width},q_auto,f_auto,dpr_2.0/bbg/${sku}/Gallery/${sku}_yy_0001_titel___`;
};

const Thumb: React.FC<Props> = ({ skuNumbers, size = 40, width = 120, className = '' }) => {
  const candidates = skuNumbers.filter(n => n.trim() !== '');
  const [index, setIndex] = useState(0);
  const current = candidates[index];

  const box = { width: size, height: size };

  if (!current) {
    return (
      <div
        style={box}
        className={`flex items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-300 shrink-0 ${className}`}
        aria-hidden="true"
      >
        <ImageOff size={Math.round(size * 0.4)} />
      </div>
    );
  }

  return (
    <img
      // Keyed on the candidate, so falling through REPLACES the element. See note 2 above.
      key={current}
      src={skuThumbnailUrl(current, width)}
      alt=""
      loading="lazy"
      style={box}
      onError={() => setIndex(i => i + 1)}
      className={`rounded border border-gray-200 bg-gray-50 object-cover shrink-0 ${className}`}
    />
  );
};

export default Thumb;
