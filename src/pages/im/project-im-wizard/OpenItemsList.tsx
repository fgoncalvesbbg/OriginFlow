/**
 * OpenItemsList — every still-open wizard question, grouped by chapter, click to jump.
 *
 * Reused both inside the wizard (as an alternate view to the per-section nav) and,
 * potentially, on the project view outside the wizard (the plan's §8) — it takes only a
 * flat `PendingItem[]` and a jump callback, no wizard-specific state, so either host can
 * feed it.
 */
import React from 'react';
import { AlertCircle, ChevronRight } from 'lucide-react';
import { groupPendingItems, PendingItem, PendingItemTier } from './pending-items.utils';

const TIER_BADGE: Record<PendingItemTier, string> = {
  regulatory: 'bg-rose-100 text-rose-700',
  recommended: 'bg-amber-100 text-amber-700',
  optional: 'bg-gray-100 text-gray-500',
};

interface OpenItemsListProps {
  items: PendingItem[];
  onJump: (key: string) => void;
}

const OpenItemsList: React.FC<OpenItemsListProps> = ({ items, onJump }) => {
  const groups = groupPendingItems(items);

  if (groups.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic px-2 py-4">
        Nothing open — every visible question is answered or marked not applicable.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1 px-1">
            {group.sectionTitle}
          </div>
          <div className="space-y-1">
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onJump(item.key)}
                className="w-full flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-light text-sm text-gray-700"
              >
                <span className={`shrink-0 flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${TIER_BADGE[item.tier]}`}>
                  {item.tier === 'regulatory' && <AlertCircle size={9} />}
                  {item.tier}
                </span>
                <span className="flex-1 min-w-0 truncate">
                  {item.label}
                  {item.skuNumber && <span className="text-gray-400"> (SKU {item.skuNumber})</span>}
                </span>
                <ChevronRight size={14} className="text-gray-300 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default OpenItemsList;
