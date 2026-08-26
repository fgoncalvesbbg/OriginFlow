/**
 * LeafletCoverageTab — answers "which safety leaflet does each SKU get, and which SKUs have
 * none?". Read-only apart from the per-category mode switch; leaflets are ISSUED from the print
 * export dialog, where the operator is already comparing renders.
 *
 * Two shapes per category (see db_migrations/132_create_im_leaflet_issues.sql):
 *
 *   Generic — one leaflet answers for every SKU. Coverage is binary: issued or not, and
 *   issuing once covers SKUs imported years later. This row shows the PDF.
 *
 *   Per-SKU — the PDF carries SKU data, so coverage is a fraction (n of m assigned) and the
 *   row breaks down into the distinct leaflets in play and which SKUs sit behind each.
 *
 * The mode switch is the ONLY write here, and it is non-destructive: it changes what the
 * category is JUDGED against, never which issues resolve. A per-SKU issue outranks the
 * category-wide leaflet in either mode (migration 132, decision 2), so flipping to Generic
 * leaves those SKUs on their own PDF — reported here as overrides, not as stale rows. The
 * reverse matters more: in Per-SKU mode a SKU covered only by the category-wide leaflet is
 * counted as NOT assigned, because a generic PDF cannot carry its data. Calling that "covered"
 * would hide precisely the work this screen exists to surface.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, AlertTriangle, Download, Search, ChevronRight, ChevronDown, Loader2, FileWarning,
} from 'lucide-react';
import {
  getLeafletCoverage,
  setLeafletPolicy,
  type LeafletCoverageRow,
  type LeafletCoverageStatus,
  type LeafletMode,
} from '../../services/im/leaflet-coverage.service';
import { useAuth } from '../../context/AuthContext';

/** Human labels for the derived statuses. Kept beside the badge colours they pair with. */
const STATUS_LABEL: Record<LeafletCoverageStatus, string> = {
  issued: 'Covered',
  unclassified: 'No category',
  no_template: 'No leaflet template',
  category_not_issued: 'Not issued',
  sku_not_assigned: 'Not assigned',
};

const STATUS_CLASS: Record<LeafletCoverageStatus, string> = {
  issued: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  unclassified: 'bg-gray-100 text-gray-500 border-gray-200',
  no_template: 'bg-gray-100 text-gray-600 border-gray-200',
  category_not_issued: 'bg-amber-50 text-amber-700 border-amber-200',
  sku_not_assigned: 'bg-amber-50 text-amber-700 border-amber-200',
};

const StatusBadge: React.FC<{ status: LeafletCoverageStatus }> = ({ status }) => (
  <span
    className={
      'inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ' +
      STATUS_CLASS[status]
    }
  >
    {STATUS_LABEL[status]}
  </span>
);

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

/** A leaflet as seen in the report: the render plus which SKUs resolved to it. */
interface LeafletGroup {
  renderId: string;
  url: string | null;
  imVersion: number | null;
  languages: string[];
  pageSize: string | null;
  issuedAt: string | null;
  skus: LeafletCoverageRow[];
}

interface CategoryGroup {
  categoryId: string | null;
  categoryName: string;
  mode: LeafletMode;
  hasTemplate: boolean;
  rows: LeafletCoverageRow[];
  /** SKUs that resolve to SOME leaflet — individually assigned or via the category-wide one. */
  covered: number;
  /**
   * SKUs resolved by their OWN issue. In a per-SKU category this is the number that matters;
   * in a generic one it counts deliberate exceptions, since a per-SKU issue outranks the
   * category-wide leaflet whatever the mode says (migration 132, decision 2).
   */
  specific: number;
  /** The distinct leaflets covering SKUs in this category, largest group first. */
  leaflets: LeafletGroup[];
}

/**
 * Group the flat view into categories and, within each, into the distinct leaflets in play.
 * A shared render_id across N rows IS "these SKUs get the same PDF" — there is no group
 * entity, by design (migration 132, decision 4), so the grouping is rebuilt here.
 */
const groupRows = (rows: LeafletCoverageRow[]): CategoryGroup[] => {
  const byCategory = new Map<string, LeafletCoverageRow[]>();
  for (const r of rows) {
    const key = r.categoryId ?? '__none__';
    const arr = byCategory.get(key) ?? [];
    arr.push(r);
    byCategory.set(key, arr);
  }

  const out: CategoryGroup[] = [];
  for (const [key, catRows] of byCategory) {
    const byRender = new Map<string, LeafletGroup>();
    for (const r of catRows) {
      if (!r.renderId) continue;
      const g = byRender.get(r.renderId) ?? {
        renderId: r.renderId,
        url: r.renderUrl,
        imVersion: r.imVersion,
        languages: r.languages,
        pageSize: r.pageSize,
        issuedAt: r.issuedAt,
        skus: [],
      };
      g.skus.push(r);
      byRender.set(r.renderId, g);
    }
    out.push({
      categoryId: key === '__none__' ? null : key,
      categoryName: catRows[0]?.categoryName ?? (key === '__none__' ? 'No category' : key),
      mode: catRows[0]?.mode ?? 'category',
      hasTemplate: !!catRows[0]?.templateId,
      rows: catRows,
      covered: catRows.filter((r) => r.status === 'issued').length,
      specific: catRows.filter((r) => r.isSkuSpecific).length,
      leaflets: [...byRender.values()].sort((a, b) => b.skus.length - a.skus.length),
    });
  }
  // Worst first — the point of the screen is finding gaps, not browsing. What a category
  // still owes depends on its mode: a per-SKU one is not done just because a generic leaflet
  // happens to cover the remainder.
  const owed = (g: CategoryGroup) =>
    g.mode === 'sku' ? g.rows.length - g.specific : g.rows.length - g.covered;
  return out.sort((a, b) => {
    const d = owed(b) - owed(a);
    return d !== 0 ? d : a.categoryName.localeCompare(b.categoryName);
  });
};

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/**
 * The list packaging and ops actually need: one line per SKU with the PDF it gets.
 * Client-side blob download, the same idiom the generator uses for its JSON exports.
 */
const exportCsv = (rows: LeafletCoverageRow[]) => {
  const header = [
    'sku_number', 'sku_title', 'category', 'mode', 'scope', 'status',
    'leaflet_version', 'languages', 'page_size', 'pages', 'issued_at', 'url',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.skuNumber,
      r.skuTitle,
      r.categoryName ?? '',
      r.mode,
      r.renderId ? (r.isSkuSpecific ? 'sku' : 'category') : '',
      r.status,
      r.imVersion ?? '',
      r.languages.join(' '),
      r.pageSize ?? '',
      r.pages ?? '',
      r.issuedAt ?? '',
      r.renderUrl ?? '',
    ].map(csvCell).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'leaflet-coverage.csv';
  a.click();
  URL.revokeObjectURL(url);
};

export const LeafletCoverageTab: React.FC = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<LeafletCoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savingMode, setSavingMode] = useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getLeafletCoverage());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load leaflet coverage.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A SKU search spans categories, so it filters the rows BEFORE grouping — typing a number
  // collapses the screen to the one category that answers for it.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.skuNumber.toLowerCase().includes(q) ||
        r.skuTitle.toLowerCase().includes(q) ||
        (r.categoryName ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  const groups = useMemo(() => groupRows(filtered), [filtered]);

  const totals = useMemo(() => {
    const covered = rows.filter((r) => r.status === 'issued').length;
    return { total: rows.length, covered, gap: rows.length - covered };
  }, [rows]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const changeMode = async (categoryId: string, mode: LeafletMode) => {
    setSavingMode(categoryId);
    try {
      await setLeafletPolicy(categoryId, mode, user?.email ?? null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the mode.');
    } finally {
      setSavingMode(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-16 text-gray-400 flex items-center justify-center gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading leaflet coverage…
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary + controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1.5 text-sm">
          <ShieldCheck size={16} className="text-emerald-600" />
          <span className="font-semibold">{totals.covered}</span>
          <span className="text-muted">of {totals.total} SKUs covered</span>
        </div>
        {totals.gap > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-amber-700">
            <AlertTriangle size={16} />
            <span className="font-semibold">{totals.gap}</span>
            <span>without a leaflet</span>
          </div>
        )}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a SKU number…"
            className="pl-8 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm w-64"
          />
        </div>
        <button
          onClick={() => exportCsv(filtered)}
          disabled={!filtered.length}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {!groups.length && (
        <div className="text-center py-16 text-gray-400">
          {query ? 'No SKU matches that search.' : 'No SKUs yet — import a roster from the SKU catalog.'}
        </div>
      )}

      <div className="space-y-2">
        {groups.map((g) => {
          const key = g.categoryId ?? '__none__';
          const open = expanded.has(key);
          // In a per-SKU category, a SKU covered only by a category-wide leaflet is NOT
          // individually assigned. Reporting it as assigned would hide exactly the work this
          // screen exists to surface, so the two are counted separately.
          const fallbackCovered = g.mode === 'sku' ? g.covered - g.specific : 0;
          const exceptions = g.mode === 'category' ? g.specific : 0;
          // What the category still owes. A per-SKU category is not done just because a
          // generic leaflet happens to cover the remainder.
          const outstanding =
            g.mode === 'sku' ? g.rows.length - g.specific : g.rows.length - g.covered;
          return (
            <div key={key} className="border border-gray-200 rounded-lg bg-white">
              <div className="flex items-start gap-3 p-3">
                <button onClick={() => toggle(key)} className="mt-0.5 text-gray-400 hover:text-gray-600">
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-primary">{g.categoryName}</span>
                    <span className="text-xs text-muted">
                      {g.rows.length} SKU{g.rows.length === 1 ? '' : 's'}
                    </span>
                    {outstanding === 0 && g.rows.length > 0
                      ? <StatusBadge status="issued" />
                      : g.categoryId == null
                        ? <StatusBadge status="unclassified" />
                        : !g.hasTemplate
                          ? <StatusBadge status="no_template" />
                          : <StatusBadge status={g.mode === 'sku' ? 'sku_not_assigned' : 'category_not_issued'} />}
                  </div>

                  {/* Coverage reads differently per mode: binary for a generic leaflet,
                      a fraction of individually-assigned SKUs for a per-SKU one. */}
                  <p className="text-xs text-muted mt-1">
                    {g.mode === 'sku'
                      ? g.specific + ' of ' + g.rows.length + ' SKUs individually assigned'
                      : g.covered === g.rows.length && g.rows.length > 0
                        ? 'One generic leaflet covers every SKU'
                        : 'No leaflet issued for this category yet'}
                    {g.leaflets.length > 1 && ' · ' + g.leaflets.length + ' leaflets in play'}
                  </p>

                  {fallbackCovered > 0 && (
                    <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                      <FileWarning size={12} />
                      {fallbackCovered} more fall back to this category&rsquo;s generic leaflet —
                      which carries no SKU data
                    </p>
                  )}

                  {exceptions > 0 && (
                    <p className="text-xs text-indigo-700 mt-1 flex items-center gap-1">
                      <FileWarning size={12} />
                      {exceptions} SKU{exceptions === 1 ? '' : 's'} override the generic leaflet
                      with their own
                    </p>
                  )}

                  {/* The leaflets themselves — one line each, with its SKU count. */}
                  {g.leaflets.map((lf) => (
                    <div key={lf.renderId} className="mt-2 flex items-center gap-2 text-xs flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
                        {lf.skus.length} SKU{lf.skus.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-gray-600 uppercase font-medium">{lf.languages.join(', ')}</span>
                      {lf.pageSize && <span className="text-gray-400">{lf.pageSize.toUpperCase()}</span>}
                      {lf.imVersion != null && <span className="text-gray-400">v{lf.imVersion}</span>}
                      <span className="text-gray-400">issued {fmtDate(lf.issuedAt)}</span>
                      {lf.url && (
                        <a
                          href={lf.url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-0.5 border rounded hover:bg-gray-50"
                        >
                          Download
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                {/* Mode switch — the only write on this screen. */}
                {g.categoryId && (
                  <div className="shrink-0 flex items-center gap-1 text-xs">
                    {(['category', 'sku'] as LeafletMode[]).map((m) => (
                      <button
                        key={m}
                        disabled={savingMode === g.categoryId || g.mode === m}
                        onClick={() => changeMode(g.categoryId as string, m)}
                        title={m === 'category'
                          ? 'One generic leaflet answers for every SKU in this category'
                          : 'The leaflet carries SKU data, so each SKU or group needs its own'}
                        className={
                          'px-2 py-1 rounded border font-medium ' +
                          (g.mode === m
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50') +
                          (savingMode === g.categoryId ? ' opacity-50' : '')
                        }
                      >
                        {m === 'category' ? 'Generic' : 'Per-SKU'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {open && (
                <div className="border-t divide-y max-h-72 overflow-auto">
                  {g.rows.map((r) => (
                    <div key={r.skuId} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                      <span className="font-mono font-medium text-gray-700 w-28 shrink-0">{r.skuNumber}</span>
                      <span className="text-gray-500 truncate flex-1">{r.skuTitle}</span>
                      {r.renderId && r.isSkuSpecific && (
                        <span className="text-[10px] text-indigo-600 font-semibold">SKU-specific</span>
                      )}
                      {r.imVersion != null && <span className="text-gray-400">v{r.imVersion}</span>}
                      <StatusBadge status={r.status} />
                      {r.renderUrl && (
                        <a
                          href={r.renderUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline"
                        >
                          PDF
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
