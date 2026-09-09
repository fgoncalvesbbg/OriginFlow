import { MoreVertical } from 'lucide-react';
import { fmtFp, fmtK, fmtPct, smTone, yoyOf, yoyTone } from '../format';
import { ITEM_FLAGS } from '../roadmap.constants';
import type { ItemFlagOption } from '../roadmap.constants';
import type { RoadmapFlag, RoadmapItemFlag, RoadmapSku } from '../../../types';

/**
 * One SKU, rendered identically on the roadmap grid and the step-up chart — `variant` only
 * changes the image height. Purely presentational: every action is raised to the board.
 *
 * `hideMetrics` is PRESENTATION MODE. The card keeps everything that identifies the product
 * (image, SKU, description, supplier) and everything the roadmap is ABOUT (marks, comments), and
 * drops everything commercial — ASP, factory price, steering margin, the NOV table, and the YoY
 * badge derived from it. That set is deliberate: those are the figures we cannot show a supplier
 * sitting in the room. See prefs.ts for why the setting is persisted rather than held in state.
 */

const OVERLAY = Object.fromEntries(ITEM_FLAGS.map(f => [f.key, f])) as Record<
  RoadmapFlag,
  ItemFlagOption
>;

export interface SkuCardProps {
  sku: RoadmapSku;
  flag?: RoadmapItemFlag | null;
  /** 'step' is the ladder's card — the name the CSS uses (.rdmp-card-step). Only changes
   *  image height; everything else renders identically on both surfaces. */
  variant?: 'grid' | 'step';
  hideMetrics?: boolean;
  onOpen?: (sku: string) => void;
  /** Omitted for a read-only viewer, which is what hides the ⋮ button entirely. */
  onMenu?: (sku: string, anchor: DOMRect) => void;
  style?: React.CSSProperties;
  id?: string;
}

export default function SkuCard({
  sku,
  flag,
  variant = 'grid',
  hideMetrics = false,
  onOpen,
  onMenu,
  style,
  id,
}: SkuCardProps) {
  const growth = hideMetrics ? null : yoyOf(sku);
  const mark = flag?.flag ? OVERLAY[flag.flag] : null;
  const stale = sku.isCurrent === false;

  return (
    <div
      className={`rdmp-card rdmp-card-${variant}${stale ? ' is-stale' : ''}`}
      id={id}
      style={style}
      onClick={e => {
        if ((e.target as HTMLElement).closest('.rdmp-card-menu')) return;
        onOpen?.(sku.sku);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(sku.sku);
        }
      }}
    >
      {onMenu && (
        <button
          type="button"
          className="rdmp-card-menu"
          title="Actions"
          aria-label={`Actions for ${sku.sku}`}
          onClick={e => {
            e.stopPropagation();
            onMenu(sku.sku, e.currentTarget.getBoundingClientRect());
          }}
        >
          <MoreVertical size={14} />
        </button>
      )}

      {growth != null && (
        <div className={`rdmp-yoy is-${yoyTone(growth)}`}>
          {growth >= 0 ? '▲' : '▼'} {Math.abs(growth * 100).toFixed(0)}%
        </div>
      )}

      {sku.image ? (
        <div className="rdmp-card-img">
          <img
            src={sku.image}
            // Required by html2canvas for the PDF export — without it the canvas is tainted and
            // every card image comes out blank.
            crossOrigin="anonymous"
            alt={sku.description || sku.sku}
            loading="lazy"
            onError={e => {
              // A dead image hides itself rather than collapsing the card's layout.
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      ) : (
        <div className="rdmp-card-noimg">no image</div>
      )}

      <div className="rdmp-card-sku">{sku.sku}</div>
      <div className="rdmp-card-desc">{sku.description}</div>

      {!hideMetrics && (
        <>
          <div className="rdmp-kv">
            <span className="k">2026 Net ASP</span>
            <span className="v is-asp">{fmtFp(sku.asp26)}</span>
          </div>
          <div className="rdmp-kv">
            <span className="k">FP</span>
            <span className="v is-fp">{fmtFp(sku.price)}</span>
          </div>
        </>
      )}

      {/* Supplier survives presentation mode: it identifies the product, it is not a figure. */}
      <div className="rdmp-kv">
        <span className="k">Supplier</span>
        <span className="v">{sku.supplier || '—'}</span>
      </div>

      {!hideMetrics && (
        <>
          <div className="rdmp-kv">
            <span className="k">SM% 26</span>
            <span className={`v is-sm-${smTone(sku.sm26)}`}>{fmtPct(sku.sm26)}</span>
          </div>

          <table className="rdmp-novtab">
            <thead>
              <tr>
                <th>2025</th>
                <th>2026 FC</th>
                <th>2026 YTD</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{fmtK(sku.nov25)}</td>
                <td>{fmtK(sku.novfc26)}</td>
                <td>{fmtK(sku.nov26)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {flag?.comment && <div className="rdmp-card-note">💬 {flag.comment}</div>}

      {/* The visible half of the guarantee: a delisted SKU is dimmed and labelled, never gone. */}
      {stale && <div className="rdmp-stale-tag">not in latest file</div>}
      {mark && <div className={`rdmp-overlay is-${mark.tone}`}>{mark.overlay}</div>}
    </div>
  );
}
