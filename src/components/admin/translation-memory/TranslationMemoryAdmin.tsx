/**
 * Admin console → Translation Memory: browse, correct, approve and retire the corpus.
 *
 * WHY this screen exists. Migration 113 built a segment-level translation memory with a
 * governance model, and then nothing could ever be approved, because approval had no UI.
 * Only `status='approved'` segments may auto-apply, so the memory filled with machine
 * output that could serve as a fuzzy reference but could never avoid a model call. This is
 * the missing half: the place a human looks at what was remembered and decides.
 *
 * THE RULES BELOW ARE NOT UI POLISH. Each one is here because TM poisoning — one bad
 * translation approved and then propagated across every market and every future product —
 * is the dominant risk, well ahead of cache misses, and there is no un-poisoning pass:
 *
 *  - Nothing is selected by default, ever. The realistic way this corpus gets ruined is an
 *    operator facing thousands of machine rows, hitting select-all, and approving.
 *  - Approval requires a single target locale to be chosen first. `approveTmSegments`
 *    refuses a mixed-locale batch anyway; making the locale a precondition of the button
 *    means the operator is reviewing one language at a time by construction, rather than
 *    discovering the rule as an error.
 *  - Selection is capped at TM_APPROVAL_BATCH_LIMIT. Reviewing fifty segments is
 *    plausible; reviewing five thousand in one click is not.
 *  - Approval runs here, in the browser, under the admin's own JWT, so RLS and the
 *    governance trigger both apply. It must never move behind a service-role endpoint —
 *    that connection bypasses the trigger entirely.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, RefreshCw, CheckCircle2, Archive, Pencil, ChevronLeft, ChevronRight,
  Languages, AlertTriangle, X,
} from 'lucide-react';
import { Button } from '../../common/Button';
import { Badge } from '../../common/Badge';
import { useToast } from '../../../hooks/useToast';
import { useAuth } from '../../../context/AuthContext';
import { useRefetchOnFocus } from '../../../hooks/useRefetchOnFocus';
import { isLive } from '../../../config/environment.config';
import { IM_LANGUAGE_NAMES } from '../../../config/im-languages';
import {
  browseTmSegments,
  getTmStats,
  approveTmSegments,
  deprecateTmSegments,
  TM_APPROVAL_BATCH_LIMIT,
  type TmSegmentRecord,
  type TmStatsRow,
  type TmStatus,
  type TmBrowseSort,
} from '../../../services';
import { MarkerText } from './tm-markers';
import { TmSegmentEditModal } from './TmSegmentEditModal';
import { TmLeveragePanel } from './TmLeveragePanel';

const PAGE_SIZE = 25;

const STATUS_TONE: Record<TmStatus, 'amber' | 'emerald' | 'rose'> = {
  unreviewed: 'amber',
  approved: 'emerald',
  deprecated: 'rose',
};

const localeLabel = (code: string) => {
  const base = code.split('-')[0];
  const name = IM_LANGUAGE_NAMES[base];
  return name ? `${code} — ${name}` : code;
};

export const TranslationMemoryAdmin: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();

  const [rows, setRows] = useState<TmSegmentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<TmStatsRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState<TmStatus | 'all'>('unreviewed');
  const [locale, setLocale] = useState<string>('');
  const [origin, setOrigin] = useState<string>('');
  const [sort, setSort] = useState<TmBrowseSort>('queue');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TmSegmentRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [deprecating, setDeprecating] = useState(false);
  const [deprecateReason, setDeprecateReason] = useState('');

  // Debounce the search box: each keystroke is a round trip otherwise.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Guards against an out-of-order response overwriting a newer one when the operator
  // changes filters faster than the network answers.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const [pageData, statsData] = await Promise.all([
      browseTmSegments(
        {
          status: status === 'all' ? undefined : [status],
          targetLocales: locale ? [locale] : undefined,
          origins: origin ? [origin] : undefined,
          search,
          sort,
        },
        { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      ),
      getTmStats(),
    ]);
    if (id !== requestId.current) return;
    setRows(pageData.rows);
    setTotal(pageData.total);
    setStats(statsData);
    setLoading(false);
  }, [status, locale, origin, search, sort, page]);

  useEffect(() => { void load(); }, [load]);
  useRefetchOnFocus(load);

  // A row that scrolls out of the filtered set must not stay silently selected — the
  // count above the table would then describe rows the operator can no longer see.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const locales = useMemo(
    () => [...new Set(stats.map((s) => s.targetLocale))].sort(),
    [stats],
  );
  const origins = useMemo(
    () => [...new Set(stats.map((s) => s.origin))].sort(),
    [stats],
  );
  const countFor = useCallback(
    (s: TmStatus) => stats.filter((r) => r.status === s).reduce((sum, r) => sum + r.count, 0),
    [stats],
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selectedApprovable = selectedRows.filter((r) => r.status === 'unreviewed');
  const overBatchLimit = selected.size > TM_APPROVAL_BATCH_LIMIT;
  const canApprove =
    !!locale && selectedApprovable.length > 0 && !overBatchLimit && !busy && !!user?.email;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const handleApprove = async () => {
    if (!canApprove || !user?.email) return;
    setBusy(true);
    try {
      const n = await approveTmSegments(selectedApprovable.map((r) => r.id), { email: user.email });
      if (n === 0 && !isLive) toast.error('Not connected to a database — nothing was approved.');
      else if (n === 0) toast.info('Nothing to approve — those segments were already approved.');
      else toast.success(`${n} segment${n === 1 ? '' : 's'} approved. They can now be applied automatically.`);
      clearSelection();
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Approval failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeprecate = async () => {
    if (!deprecateReason.trim() || selected.size === 0) return;
    setBusy(true);
    try {
      const n = await deprecateTmSegments([...selected], deprecateReason.trim());
      if (n === 0 && !isLive) toast.error('Not connected to a database — nothing was retired.');
      else toast.success(`${n} segment${n === 1 ? '' : 's'} retired from future retrieval.`);
      setDeprecating(false);
      setDeprecateReason('');
      clearSelection();
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not retire the selection.');
    } finally {
      setBusy(false);
    }
  };

  const selectClass =
    'border border-gray-300 rounded-md text-sm px-2.5 py-2 bg-white focus:ring-2 focus:ring-indigo-500 outline-none';

  return (
    <div>
      <div className="px-6 py-4 bg-light border-b border-gray-200">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Languages size={17} className="text-indigo-600" /> Translation memory
        </h3>
        <p className="text-xs text-muted mt-0.5 max-w-3xl">
          Every sentence the system has translated before, and the decision about whether it may be
          reused. Only approved segments are ever applied automatically — everything else is a
          reference for a translator or the model.
        </p>
      </div>

      <div className="p-5 space-y-4">
      {!isLive && (
        <div className="flex gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>
            No database connection is configured, so the memory cannot be read or changed. Actions on this
            screen will appear to succeed while doing nothing.
          </div>
        </div>
      )}

      {/* Stats strip. Approved is the number that matters: until it is non-zero, the
          memory is advisory only and no translation is ever served from it. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          ['Unreviewed', countFor('unreviewed'), 'amber'],
          ['Approved', countFor('approved'), 'emerald'],
          ['Deprecated', countFor('deprecated'), 'rose'],
          ['Target locales', locales.length, 'indigo'],
        ] as const).map(([label, value, tone]) => (
          <div key={label} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
            <div className={`text-2xl font-semibold mt-0.5 ${
              tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700'
              : tone === 'rose' ? 'text-rose-700' : 'text-gray-900'
            }`}>
              {value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {countFor('approved') === 0 && countFor('unreviewed') > 0 && (
        <div className="flex gap-2.5 p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-sm text-indigo-900">
          <Languages size={16} className="shrink-0 mt-0.5" />
          <div>
            Nothing in the memory is approved yet, so no translation is currently served from it — every
            segment is machine output waiting for review. Pick a target locale, read a batch, and approve
            what is correct.
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(0); }} className={selectClass}>
          <option value="unreviewed">Unreviewed</option>
          <option value="approved">Approved</option>
          <option value="deprecated">Deprecated</option>
          <option value="all">All statuses</option>
        </select>

        <select value={locale} onChange={(e) => { setLocale(e.target.value); setPage(0); clearSelection(); }} className={selectClass}>
          <option value="">All target locales</option>
          {locales.map((l) => <option key={l} value={l}>{localeLabel(l)}</option>)}
        </select>

        <select value={origin} onChange={(e) => { setOrigin(e.target.value); setPage(0); }} className={selectClass}>
          <option value="">Any origin</option>
          {origins.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>

        <select value={sort} onChange={(e) => { setSort(e.target.value as TmBrowseSort); setPage(0); }} className={selectClass}>
          <option value="queue">Most used first</option>
          <option value="recent">Recently changed</option>
          <option value="oldest">Oldest first</option>
        </select>

        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search source or translation…"
            className="w-full border border-gray-300 rounded-md text-sm pl-8 pr-2.5 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <Button variant="secondary" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {/* Selection bar. Only appears once the operator has selected something — nothing is
          ever selected for them. */}
      {selected.size > 0 && (
        <div className="bg-white rounded-xl shadow border border-indigo-200 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-800">{selected.size} selected</span>
          <button onClick={clearSelection} className="text-xs text-muted hover:text-gray-700 flex items-center gap-1">
            <X size={12} /> clear
          </button>
          <div className="flex-1" />
          {overBatchLimit && (
            <span className="text-xs text-rose-700 max-w-md">
              Approve at most {TM_APPROVAL_BATCH_LIMIT} at a time — bulk-approving machine output is how a
              memory gets poisoned, and it cannot be undone for content already published.
            </span>
          )}
          {!locale && !overBatchLimit && (
            <span className="text-xs text-amber-700">
              Choose a single target locale to approve — one language is reviewed at a time.
            </span>
          )}
          <Button variant="secondary" size="sm" leftIcon={<Archive size={14} />} onClick={() => setDeprecating(true)} disabled={busy}>
            Retire…
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<CheckCircle2 size={14} />}
            onClick={handleApprove}
            disabled={!canApprove}
            loading={busy}
          >
            Approve {selectedApprovable.length > 0 ? selectedApprovable.length : ''}
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-light">
          <span className="text-sm text-muted">
            {loading ? 'Loading…' : `${total.toLocaleString()} segment${total === 1 ? '' : 's'}`}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Page {page + 1} of {pageCount}</span>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="Previous page"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1 || loading}
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-40 disabled:hover:bg-transparent"
              aria-label="Next page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-light border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 w-10" />
                <th className="px-4 py-3 font-semibold text-gray-700 w-[38%]">Source</th>
                <th className="px-4 py-3 font-semibold text-gray-700 w-[38%]">Translation</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Locale</th>
                <th className="px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="px-4 py-3 font-semibold text-gray-700 text-right">Used</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-muted">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted italic">
                    {search ? `Nothing matches "${search}".` : 'No segments match these filters.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className={`group hover:bg-light ${selected.has(r.id) ? 'bg-indigo-50/60' : ''}`}>
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        className="mt-0.5 rounded border-gray-300"
                        aria-label="Select segment"
                      />
                    </td>
                    <td className="px-4 py-3 align-top text-gray-700 leading-relaxed">
                      <MarkerText text={r.placeholderedSource} />
                    </td>
                    <td className="px-4 py-3 align-top text-gray-900 leading-relaxed">
                      <MarkerText text={r.targetText} />
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-gray-700">{r.targetLocale}</td>
                    <td className="px-4 py-3 align-top">
                      <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-3 align-top text-right tabular-nums text-muted">{r.usageCount}</td>
                    <td className="px-4 py-3 align-top">
                      <button
                        onClick={() => setEditing(r)}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded hover:bg-gray-200 text-muted hover:text-gray-800"
                        aria-label="Edit segment"
                        title={r.status === 'approved' ? 'Correct (deprecates and replaces)' : 'Edit'}
                      >
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <TmLeveragePanel />

      {editing && (
        <TmSegmentEditModal
          segment={editing}
          onClose={() => setEditing(null)}
          onSaved={(m) => { toast.success(m); void load(); }}
          onError={(m) => toast.error(m)}
        />
      )}

      {deprecating && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-900">Retire {selected.size} segment{selected.size === 1 ? '' : 's'}</h3>
              <button onClick={() => setDeprecating(false)} className="text-muted hover:text-gray-700" aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Retired segments are never retrieved again. Manuals already published keep the wording they were
              produced with — this does not rewrite them.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-rose-600">*</span>
            </label>
            <input
              autoFocus
              value={deprecateReason}
              onChange={(e) => setDeprecateReason(e.target.value)}
              placeholder="e.g. supplier wording superseded by the 2026 regulation"
              className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <p className="mt-1 text-xs text-muted">Stored on each row — it is the audit trail.</p>
            <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setDeprecating(false)}>Cancel</Button>
              <Button variant="danger" onClick={handleDeprecate} disabled={!deprecateReason.trim() || busy} loading={busy}>
                Retire
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default TranslationMemoryAdmin;
