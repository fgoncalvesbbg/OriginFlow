import { useEffect } from 'react';
import { X } from 'lucide-react';
import { fmtFcff, fmtFp, fmtInt, fmtPct, smTone } from '../format';
import type { Tone } from '../format';
import CompareCombo from './CompareCombo';
import type { RoadmapItemFlag, RoadmapSku } from '../../../types';

/**
 * Slide-over SKU detail with side-by-side compare. One column per SKU, one row per metric — the
 * layout that makes "why is this one priced above that one?" answerable at a glance.
 *
 * This panel is the DENSEST concentration of commercial data in the module, so presentation mode
 * takes the whole of it out — factory price and both Commercial sections — leaving the product
 * identity, the supplier and the roadmap mark. Opening a card in front of a supplier then shows
 * them what we plan for the product, not what we make on it. It says so in place of the numbers
 * rather than silently rendering a shorter table.
 *
 * The source also mounted an `AttributeComparePanel` here, reading Akeneo through ProductToolkit's
 * Attribute Viewer route. That route does not exist in OriginFlow; repointing it at `project_skus`
 * is a deferred, additive change (docs/originflow-roadmap-creator-module.md, decision 6).
 */

type Getter = (r: RoadmapSku) => number | null;
type MetricRow = [string, Getter, (v: number | null) => string, ((v: number | null) => Tone)?];

const METRICS_2025: MetricRow[] = [
  ['NOV 2025', r => r.nov25, fmtInt],
  ['NOV FC 2025', r => r.novfc25, fmtInt],
  ['FC FF NOV 2025', r => r.fcff25, fmtFcff],
  ['NOQ 2025', r => r.noq25, fmtInt],
  ['SM% 2025', r => r.sm25, fmtPct, smTone],
  ['ASP 2025', r => r.asp25, fmtFp],
  ['Claim Rate 2025', r => r.claim25, fmtPct],
];

const METRICS_2026: MetricRow[] = [
  ['NOV 2026', r => r.nov26, fmtInt],
  ['NOV FC 2026', r => r.novfc26, fmtInt],
  ['FC FF NOV 2026', r => r.fcff26, fmtFcff],
  ['NOQ 2026', r => r.noq26, fmtInt],
  ['SM% 2026', r => r.sm26, fmtPct, smTone],
  ['ASP 2026', r => r.asp26, fmtFp],
  ['Claim Rate 2026', r => r.claim26, fmtPct],
];

export interface DetailPanelProps {
  open: boolean;
  skus: RoadmapSku[];
  allSkus: RoadmapSku[];
  flags: RoadmapItemFlag[];
  hideMetrics?: boolean;
  onClose: () => void;
  onAddCompare: (sku: string) => void;
  onRemoveCompare: (sku: string) => void;
}

export default function DetailPanel({
  open,
  skus,
  allSkus,
  flags,
  hideMetrics = false,
  onClose,
  onAddCompare,
  onRemoveCompare,
}: DetailPanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open || !skus.length) return null;

  const compareOptions = allSkus
    .filter(r => !skus.some(s => s.sku === r.sku))
    .sort((a, b) => a.sku.localeCompare(b.sku));

  const row = (
    label: string,
    get: (r: RoadmapSku) => unknown,
    fmt: (v: never) => string,
    tone?: (v: never) => Tone,
  ) => (
    <tr key={label}>
      <td>{label}</td>
      {skus.map(r => {
        const v = get(r) as never;
        return (
          <td key={r.sku} className={tone ? `is-sm-${tone(v)}` : undefined}>
            {fmt(v)}
          </td>
        );
      })}
    </tr>
  );

  return (
    <>
      <div className="rdmp-backdrop" onClick={onClose} />
      <aside className="rdmp-panel" role="dialog" aria-label="SKU detail">
        <header className="rdmp-panel-head">
          <h2>{skus.length > 1 ? `Comparing ${skus.length} SKUs` : `SKU ${skus[0].sku}`}</h2>
          <div className="rdmp-panel-actions">
            <CompareCombo options={compareOptions} onPick={onAddCompare} />
            <button type="button" className="rdmp-btn" onClick={onClose}>
              <X size={13} /> Close
            </button>
          </div>
        </header>

        <div className="rdmp-panel-body">
          <table className="rdmp-cmp">
            <thead>
              <tr>
                <th>Metric</th>
                {skus.map((r, i) => (
                  <th key={r.sku}>
                    {r.sku}
                    {/* The first column is the SKU you opened — it has no ✕, because removing it
                        would leave a comparison with nothing to compare against. */}
                    {i > 0 && (
                      <button
                        type="button"
                        className="rdmp-rm"
                        title="Remove from comparison"
                        aria-label={`Remove ${r.sku} from comparison`}
                        onClick={() => onRemoveCompare(r.sku)}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="rdmp-cmp-prod">
                <td>Product</td>
                {skus.map(r => (
                  <td key={r.sku}>
                    {r.image ? (
                      <img
                        className="rdmp-cmp-img"
                        src={r.image}
                        crossOrigin="anonymous"
                        alt={r.description || r.sku}
                        onError={e => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="rdmp-cmp-img is-empty">no image</div>
                    )}
                    <div className="rdmp-cmp-links">
                      {r.shop && (
                        <a
                          className="rdmp-lnk is-shop"
                          href={r.shop}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Shop ↗
                        </a>
                      )}
                      {r.amazon && (
                        <a
                          className="rdmp-lnk is-amz"
                          href={r.amazon}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Amazon DE ↗
                        </a>
                      )}
                    </div>
                  </td>
                ))}
              </tr>

              {row('Description', r => r.description || '—', String)}
              {row('Family', r => r.family || '—', String)}
              {row('Supplier', r => r.supplier || '—', String)}
              {!hideMetrics && row('Est. Factory Price', r => r.price, fmtFp as (v: never) => string)}
              {/* Spells out WHY a delisted SKU is still here, rather than just saying "No". */}
              {row(
                'In latest file',
                r => (r.isCurrent === false ? 'No — kept from an earlier export' : 'Yes'),
                String,
              )}
              {row(
                'Roadmap mark',
                r => {
                  const f = flags.find(x => x.sku === r.sku);
                  if (!f) return '—';
                  return [f.flag || 'comment only', f.comment].filter(Boolean).join(' — ');
                },
                String,
              )}

              {hideMetrics ? (
                <tr className="rdmp-cmp-sec">
                  <td colSpan={skus.length + 1}>Commercial figures hidden — presentation mode</td>
                </tr>
              ) : (
                <>
                  <tr className="rdmp-cmp-sec">
                    <td colSpan={skus.length + 1}>2025 Commercial</td>
                  </tr>
                  {METRICS_2025.map(([label, get, fmt, tone]) =>
                    row(label, get, fmt as (v: never) => string, tone as (v: never) => Tone),
                  )}

                  <tr className="rdmp-cmp-sec">
                    <td colSpan={skus.length + 1}>2026 Commercial</td>
                  </tr>
                  {METRICS_2026.map(([label, get, fmt, tone]) =>
                    row(label, get, fmt as (v: never) => string, tone as (v: never) => Tone),
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </aside>
    </>
  );
}
