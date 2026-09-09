import { forwardRef } from 'react';
import { X, Plus } from 'lucide-react';
import SkuCard from './SkuCard';
import PlacerCard from './PlacerCard';
import type { GridModel } from '../grid';
import type { RoadmapAxisKind, RoadmapPlacer } from '../../../types';

/**
 * The board itself: a CSS grid whose columns are (row label) + one block of X-axis columns per
 * family band.
 *
 * Purely presentational. `grid` (from grid.ts) has ALREADY decided which rows, columns and
 * families exist — including the ones that only survive because a placer points at them. This
 * component must never filter that list, or the union rule stops protecting anything.
 */

const CELL_W = 138;
const LABEL_W = 130;

export interface RoadmapGridProps {
  grid: GridModel;
  hideMetrics?: boolean;
  onOpenSku?: (sku: string) => void;
  onSkuMenu?: (sku: string, anchor: DOMRect) => void;
  onAddPlacer?: (
    cell: { family: string; yValue: string; xValue: string },
    anchor: DOMRect,
  ) => void;
  onEditPlacer?: (placer: RoadmapPlacer) => void;
  onRemovePlacer?: (placer: RoadmapPlacer) => void;
  onRemoveAxisValue?: (kind: RoadmapAxisKind, value: string) => void;
}

const RoadmapGrid = forwardRef<HTMLDivElement, RoadmapGridProps>(function RoadmapGrid(
  {
    grid,
    hideMetrics = false,
    onOpenSku,
    onSkuMenu,
    onAddPlacer,
    onEditPlacer,
    onRemovePlacer,
    onRemoveAxisValue,
  },
  ref,
) {
  const { families, xValues, yValues, yField, xField } = grid;

  const templateColumns = `${LABEL_W}px ${families
    .map(() => `repeat(${xValues.length}, ${CELL_W}px)`)
    .join(' ')}`;

  return (
    <div className="rdmp-board" ref={ref} style={{ gridTemplateColumns: templateColumns }}>
      <div className="rdmp-corner" style={{ gridRow: '1 / span 2' }} />

      {/* family band headers */}
      {families.map((family, fi) => (
        <div
          key={`fam-${family}`}
          className={`rdmp-famname${fi < families.length - 1 ? ' is-bandend' : ''}`}
          style={{ gridColumn: `span ${xValues.length}` }}
        >
          <span className="rdmp-famname-text">{family}</span>
          {/* Only hand-added bands carry the tag and the ✕ — a data-derived one has no ✕
              because removing it would mean removing SKUs, which this screen cannot do. */}
          {grid.isAddedFamily(family) && (
            <>
              <span className="rdmp-tag">PLANNED</span>
              {onRemoveAxisValue && (
                <button
                  type="button"
                  className="rdmp-rm"
                  title="Remove this family"
                  aria-label={`Remove family ${family}`}
                  onClick={() => onRemoveAxisValue('family', family)}
                >
                  <X size={12} />
                </button>
              )}
            </>
          )}
        </div>
      ))}

      {/* x-axis headers, repeated per family band */}
      {families.map((family, fi) =>
        xValues.map((xv, xi) => (
          <div
            key={`xh-${family}-${xv}`}
            className={`rdmp-xhdr${
              fi < families.length - 1 && xi === xValues.length - 1 ? ' is-bandend' : ''
            }`}
          >
            <span>{xv}</span>
            {/* The ✕ appears once, on the first band, not once per repetition. */}
            {fi === 0 && grid.isAddedCol(xv) && onRemoveAxisValue && (
              <button
                type="button"
                className="rdmp-rm"
                title={`Remove this ${xField} column`}
                aria-label={`Remove column ${xv}`}
                onClick={() => onRemoveAxisValue('col', xv)}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )),
      )}

      {yValues.map(yv => (
        <RowGroup
          key={`row-${yv}`}
          yv={yv}
          yField={yField}
          xValues={xValues}
          families={families}
          grid={grid}
          hideMetrics={hideMetrics}
          onOpenSku={onOpenSku}
          onSkuMenu={onSkuMenu}
          onAddPlacer={onAddPlacer}
          onEditPlacer={onEditPlacer}
          onRemovePlacer={onRemovePlacer}
          onRemoveAxisValue={onRemoveAxisValue}
        />
      ))}
    </div>
  );
});

interface RowGroupProps extends Omit<RoadmapGridProps, 'grid'> {
  yv: string;
  yField: string;
  xValues: string[];
  families: string[];
  grid: GridModel;
}

function RowGroup({
  yv,
  yField,
  xValues,
  families,
  grid,
  hideMetrics,
  onOpenSku,
  onSkuMenu,
  onAddPlacer,
  onEditPlacer,
  onRemovePlacer,
  onRemoveAxisValue,
}: RowGroupProps) {
  return (
    <>
      <div className="rdmp-ylabel">
        <span>{yv}</span>
        {grid.isAddedRow(yv) && onRemoveAxisValue && (
          <button
            type="button"
            className="rdmp-rm"
            title={`Remove this ${yField} row`}
            aria-label={`Remove row ${yv}`}
            onClick={() => onRemoveAxisValue('row', yv)}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {families.map((family, fi) =>
        xValues.map((xv, xi) => {
          const items = grid.itemsAt(family, yv, xv);
          const placers = grid.placersAt(family, yv, xv);
          const bandEnd = fi < families.length - 1 && xi === xValues.length - 1;
          return (
            <div
              key={`cell-${family}-${yv}-${xv}`}
              className={`rdmp-cell${bandEnd ? ' is-bandend' : ''}`}
            >
              {items.map(item => (
                <SkuCard
                  key={item.sku}
                  // The id the "Jump to SKU" box scrolls to. The chart uses a different prefix
                  // so the same SKU on both tabs does not produce a duplicate id.
                  id={`rdmp-sku-${item.sku}`}
                  sku={item}
                  flag={grid.flagFor(item.sku)}
                  hideMetrics={hideMetrics}
                  onOpen={onOpenSku}
                  onMenu={onSkuMenu}
                />
              ))}
              {placers.map(p => (
                <PlacerCard
                  key={p.id}
                  placer={p}
                  onEdit={onEditPlacer}
                  onRemove={onRemovePlacer}
                />
              ))}
              {onAddPlacer && (
                <button
                  type="button"
                  className="rdmp-addplacer"
                  onClick={e =>
                    onAddPlacer(
                      { family, yValue: yv, xValue: xv },
                      e.currentTarget.getBoundingClientRect(),
                    )
                  }
                >
                  <Plus size={11} /> flag item
                </button>
              )}
            </div>
          );
        }),
      )}
    </>
  );
}

export default RoadmapGrid;
