import { X } from 'lucide-react';
import { PLACER_TYPES } from '../roadmap.constants';
import type { RoadmapPlacer, RoadmapPlacerType } from '../../../types';

/**
 * A card-sized placeholder for a product that does not exist yet: the planner's "something
 * belongs here". Stacks in a cell alongside real SKU cards.
 *
 * Note it carries no commercial figures at all, so presentation mode has nothing to strip — a
 * placeholder is entirely a statement of intent.
 */

const TITLES = Object.fromEntries(PLACER_TYPES.map(t => [t.key, t.title])) as Record<
  RoadmapPlacerType,
  string
>;

export interface PlacerCardProps {
  placer: RoadmapPlacer;
  onEdit?: (placer: RoadmapPlacer) => void;
  onRemove?: (placer: RoadmapPlacer) => void;
}

export default function PlacerCard({ placer, onEdit, onRemove }: PlacerCardProps) {
  return (
    <div
      className={`rdmp-placer is-${placer.type}`}
      onClick={e => {
        if ((e.target as HTMLElement).closest('.rdmp-placer-rm')) return;
        onEdit?.(placer);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit?.(placer);
        }
      }}
    >
      {onRemove && (
        <button
          type="button"
          className="rdmp-placer-rm"
          title="Remove this placeholder"
          aria-label="Remove this placeholder"
          onClick={e => {
            e.stopPropagation();
            onRemove(placer);
          }}
        >
          <X size={12} />
        </button>
      )}
      <span className="rdmp-placer-title">{TITLES[placer.type] || 'ITEM'}</span>
      {placer.comment ? (
        <div className="rdmp-placer-note">💬 {placer.comment}</div>
      ) : (
        <div className="rdmp-placer-edit">+ add comment</div>
      )}
      {placer.updatedBy && <div className="rdmp-placer-by">{placer.updatedBy}</div>}
    </div>
  );
}
