/**
 * What the memory actually saved, from the append-only reuse log.
 *
 * Deliberately NOT a single "TM saved you 43%" number. `im_tm_leverage` returns rows per
 * (locale, domain, tier) and offers no blended percentage, because averaging a perfect
 * match together with a fuzzy suggestion produces a figure that means nothing and quietly
 * overstates the win. The two distinctions that matter are kept visible instead:
 *
 *  - by TIER, because only the auto-applicable tiers avoided a model call at all;
 *  - APPLIED vs logged, because a reference match was shown to a translator, not used.
 *
 * `chars` is source characters — the denominator the log was designed around.
 */

import React, { useEffect, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { getTmLeverage, type TmLeverageRow } from '../../../services';

/** Ordered best-to-worst; `perfect`/`exact`/`fuzzy_high` are the auto-applicable ones. */
const TIER_ORDER = ['perfect', 'exact', 'fuzzy_high', 'fuzzy_low', 'miss'];
const TIER_LABELS: Record<string, string> = {
  perfect: 'Perfect (in context)',
  exact: 'Exact',
  fuzzy_high: 'Fuzzy — auto-applied',
  fuzzy_low: 'Fuzzy — suggestion only',
  miss: 'No match',
};

const RANGES = [
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time', days: 0 },
] as const;

const num = (n: number) => n.toLocaleString();

export const TmLeveragePanel: React.FC = () => {
  const [rows, setRows] = useState<TmLeverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('30d');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const days = RANGES.find((r) => r.key === range)?.days ?? 0;
      const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
      const data = await getTmLeverage({ from });
      if (!cancelled) {
        setRows(data);
        setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [range]);

  const byTier = TIER_ORDER.map((tier) => {
    const matching = rows.filter((r) => r.tier === tier);
    return {
      tier,
      events: matching.reduce((s, r) => s + r.events, 0),
      chars: matching.reduce((s, r) => s + r.chars, 0),
      appliedEvents: matching.reduce((s, r) => s + r.appliedEvents, 0),
      appliedChars: matching.reduce((s, r) => s + r.appliedChars, 0),
    };
  }).filter((t) => t.events > 0);

  const totalEvents = byTier.reduce((s, t) => s + t.events, 0);
  const appliedChars = byTier.reduce((s, t) => s + t.appliedChars, 0);

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 bg-light">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <BarChart3 size={16} /> Reuse leverage
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                range === r.key ? 'bg-accent text-white' : 'text-muted hover:bg-gray-100'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="px-5 py-8 text-center text-muted text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : totalEvents === 0 ? (
        <div className="px-5 py-8 text-center text-muted text-sm">
          No lookups recorded in this period. The log fills when a template is translated or exported to XLIFF.
        </div>
      ) : (
        <>
          <div className="px-5 py-3 border-b border-gray-100 text-sm text-gray-700">
            <strong className="font-semibold">{num(appliedChars)}</strong> source characters were served from
            memory without a model call, across <strong className="font-semibold">{num(totalEvents)}</strong> lookups.
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-light border-b border-gray-200">
              <tr>
                <th className="px-5 py-2.5 font-semibold text-gray-700">Match tier</th>
                <th className="px-5 py-2.5 font-semibold text-gray-700 text-right">Lookups</th>
                <th className="px-5 py-2.5 font-semibold text-gray-700 text-right">Applied</th>
                <th className="px-5 py-2.5 font-semibold text-gray-700 text-right">Chars</th>
                <th className="px-5 py-2.5 font-semibold text-gray-700 text-right">Chars applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byTier.map((t) => (
                <tr key={t.tier} className="hover:bg-light">
                  <td className="px-5 py-2.5 text-gray-800">{TIER_LABELS[t.tier] ?? t.tier}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-700">{num(t.events)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-700">{num(t.appliedEvents)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-muted">{num(t.chars)}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-gray-700">{num(t.appliedChars)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 py-3 text-xs text-muted border-t border-gray-100">
            "Applied" means the stored translation was used as-is. The remainder was shown to a translator or
            model as a reference — counted here, but it did not avoid the work.
          </p>
        </>
      )}
    </div>
  );
};
