import { forwardRef } from 'react';
import SkuCard from './SkuCard';
import { LABEL_W, ROW_GAP, TOP_PAD, cardHeight, priceLabel } from '../chart';
import type { ChartModel, PriceMode } from '../chart';
import { fmtFp, fmtPct, smTone } from '../format';

/**
 * The price ladder: every SKU placed on a shared horizontal price axis, grouped into lanes.
 * All positions come from chart.ts — this only paints them.
 *
 * In presentation mode the ladder keeps its SHAPE and loses its NUMBERS. Cards stay exactly where
 * the price scale put them, so "this one sits above that one" still reads, but the tick values,
 * the lane averages and the price-band range come off. Naming the axis is enough to make the
 * ordering legible without publishing what anything actually costs or earns.
 */

export interface StepUpChartProps {
  chart: ChartModel;
  priceMode: PriceMode;
  hideMetrics?: boolean;
  onOpenSku?: (sku: string) => void;
}

const StepUpChart = forwardRef<HTMLDivElement, StepUpChartProps>(function StepUpChart(
  { chart, priceMode, hideMetrics = false, onOpenSku },
  ref,
) {
  const { lanes, totalWidth, ticks, xOf, dropped } = chart;
  // Must be the same height buildChart stacked the lanes with, or the levels drift apart.
  const cardH = cardHeight(hideMetrics);

  return (
    <div className="rdmp-chart-inner" ref={ref} style={{ width: totalWidth }}>
      {dropped > 0 && (
        <p className="rdmp-note" style={{ paddingLeft: LABEL_W }}>
          {dropped} SKU{dropped > 1 ? 's' : ''} hidden — no {priceLabel(priceMode)} value.
        </p>
      )}

      {lanes.map(lane => (
        <div
          className="rdmp-lane"
          key={lane.label}
          style={{ height: lane.height, width: totalWidth }}
        >
          <div className="rdmp-lane-label" style={{ height: lane.height, width: LABEL_W }}>
            <div className="rdmp-lane-name">{lane.label}</div>
            <div className="rdmp-lane-stat">
              {lane.stats!.n} SKU{lane.stats!.n > 1 ? 's' : ''}
            </div>
            {/* The lane's own economics — the first thing to go in presentation mode. */}
            {!hideMetrics && (
              <>
                <div className="rdmp-lane-stat">avg {fmtFp(lane.stats!.avgPrice)}</div>
                <div className="rdmp-lane-stat">
                  avg SM%{' '}
                  <b className={`is-sm-${smTone(lane.stats!.avgSm)}`}>{fmtPct(lane.stats!.avgSm)}</b>
                </div>
                <div className="rdmp-lane-stat">
                  {fmtFp(lane.stats!.min)} – {fmtFp(lane.stats!.max)}
                </div>
              </>
            )}
          </div>

          {lane.placed!.map(p => (
            <SkuCard
              key={p.r.sku}
              // A different id prefix from the board's, so the same SKU on both tabs never
              // produces a duplicate element id — and Jump to SKU finds the right one.
              id={`rdmp-step-${p.r.sku}`}
              sku={p.r}
              variant="step"
              hideMetrics={hideMetrics}
              onOpen={onOpenSku}
              style={{
                position: 'absolute',
                left: Math.round(p.x),
                top: TOP_PAD + p.level * (cardH + ROW_GAP),
              }}
            />
          ))}
        </div>
      ))}

      <div className="rdmp-axis" style={{ width: totalWidth }}>
        <span className="rdmp-axis-title">
          {hideMetrics ? `${priceLabel(priceMode)} (hidden)` : priceLabel(priceMode)} →
        </span>
        {/* Ticks keep their POSITIONS in presentation mode and lose their labels: the spacing is
            what makes the ladder readable, the numbers are what cannot be shown. */}
        {ticks.map(t => (
          <div className="rdmp-tick" key={t} style={{ left: Math.round(xOf(t)) }}>
            {!hideMetrics && <span>{fmtFp(t)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
});

export default StepUpChart;
