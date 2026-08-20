/** IM (Information Memorandum) dashboard: browse templates and project IMs. */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import {
  getCategories, getIMTemplates, createIMTemplate, duplicateIMTemplate, updateIMTemplate, getAllProjectIMs,
  getStaleProjectIMDetails, republishProjectIM, stalenessKey,
  getLatestRendersByManual, checkMarkupReviewStatus, isMarkupReviewAvailable
} from '../../services';
import type { StaleManual, MarkupReviewStatus } from '../../services';
import type { ProjectIMSummary } from '../../services/im/project-im.service';
import { CategoryL3, IMTemplate, IMTemplateType, IM_TEMPLATE_TYPE_LABELS } from '../../types';
import {
  BookOpen, Plus, FileText, ArrowRight, CheckCircle2, Lock, Unlock,
  FileEdit, Search, Clock, Layers, AlertTriangle, Eye, RefreshCw, FileJson, Copy, Loader2, X,
  List, Kanban
} from 'lucide-react';
import {
  MANUAL_STATUS_META, MANUAL_STATUS_ORDER, groupByStatus, manualStatusOf, nextActionOf, isInReview, type ManualStatus,
} from './im-manual-status';
import { IMViewerTab } from './IMViewerTab';
import { ImImportDialog } from './ImImportDialog';
import PublishDiffModal from './PublishDiffModal';
import type { ImImportResult } from '../../services';

const TEMPLATE_TYPE_ORDER: IMTemplateType[] = ['im', 'warning_leaflet'];

const editorPath = (categoryId: string, type: IMTemplateType) =>
  type === 'im' ? `/im/template/${categoryId}` : `/im/template/${categoryId}/${type}`;

const defaultTemplateName = (categoryName: string, type: IMTemplateType) =>
  type === 'im' ? `${categoryName} Manual Template` : `${categoryName} Warning Leaflet`;
import { BlockLibraryContent } from './IMBlockLibrary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Icon per derived status. Kept here because im-manual-status.ts stays JSX-free. */
const STATUS_ICON: Record<ManualStatus, React.ReactNode> = {
  final: <Lock size={10} />,
  needs_republish: <RefreshCw size={10} />,
  unknown: <AlertTriangle size={10} />,
  review_done: <CheckCircle2 size={10} />,
  in_review: <Eye size={10} />,
  published: <CheckCircle2 size={10} />,
  draft: <Clock size={10} />,
};

// ---------------------------------------------------------------------------
// All Manuals tab
// ---------------------------------------------------------------------------

interface AllManualsTabProps {
  ims: ProjectIMSummary[];
  categories: CategoryL3[];
  loading: boolean;
}

const AllManualsTab: React.FC<AllManualsTabProps> = ({ ims, categories, loading }) => {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterCat, setFilterCat] = useState<string>('all');
  const [filterProject, setFilterProject] = useState('');
  // Published manuals whose source changed since publish, keyed by
  // `projectId::templateType` → drill-down reasons. Computed after mount.
  const [staleInfo, setStaleInfo] = useState<Map<string, StaleManual>>(new Map());
  // True when the staleness check itself FAILED — rendered as "Status unknown", never as
  // a green "Published" (an error must not read as a clean bill of health).
  const [staleCheckFailed, setStaleCheckFailed] = useState(false);
  // Bulk re-publish selection (by ProjectIMSummary id) + in-flight flag.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [republishing, setRepublishing] = useState(false);
  // "What changed?" drill-down target (opens PublishDiffModal on a stale row).
  const [diffTarget, setDiffTarget] = useState<{ projectId: string; templateType: ProjectIMSummary['templateType']; title: string } | null>(null);
  // Table vs. kanban board. The board is a VISUALIZATION of the derived statuses —
  // they can't be dragged between columns (you publish/finalize, you don't drag to
  // "Published") — so there is deliberately no drag-and-drop. Preference persists.
  const [viewMode, setViewMode] = useState<'table' | 'board'>(() => {
    try { return localStorage.getItem('im-manuals-view') === 'board' ? 'board' : 'table'; } catch { return 'table'; }
  });
  const switchView = (mode: 'table' | 'board') => {
    setViewMode(mode);
    try { localStorage.setItem('im-manuals-view', mode); } catch { /* ignore */ }
  };

  const refreshStaleness = () =>
    getStaleProjectIMDetails()
      .then(info => { setStaleInfo(info); setStaleCheckFailed(false); })
      .catch(e => { console.error('[IMDashboard] staleness check failed:', e); setStaleCheckFailed(true); });

  useEffect(() => {
    let active = true;
    getStaleProjectIMDetails()
      .then(info => { if (active) { setStaleInfo(info); setStaleCheckFailed(false); } })
      .catch(e => { console.error('[IMDashboard] staleness check failed:', e); if (active) setStaleCheckFailed(true); });
    return () => { active = false; };
  }, []);

  // Print freshness: newest render per manual, so a published row can say
  // "printed v3, current v5" / "never printed". null = not loaded (say nothing).
  const [latestRenders, setLatestRenders] = useState<Map<string, { imVersion: number | null; createdAt: string }> | null>(null);
  useEffect(() => {
    let active = true;
    getLatestRendersByManual()
      .then(m => { if (active) setLatestRenders(m); })
      .catch(e => console.error('[IMDashboard] latest renders failed:', e));
    return () => { active = false; };
  }, []);

  // Live Markup.io review outcomes for the rows currently in review — polled via the
  // markup-review-status function (which also caches the result on the manual, so the
  // next dashboard load starts from the cached value). Small pool, best-effort.
  const [reviewChecks, setReviewChecks] = useState<Map<string, MarkupReviewStatus>>(new Map());
  useEffect(() => {
    if (!isMarkupReviewAvailable()) return;
    const targets = ims.filter(im => isInReview(im) && im.reviewDone !== true).slice(0, 12);
    if (!targets.length) return;
    let active = true;
    let cursor = 0;
    const worker = async () => {
      while (active && cursor < targets.length) {
        const im = targets[cursor++];
        try {
          const res = await checkMarkupReviewStatus(im.projectId, im.templateType);
          if (active) setReviewChecks(prev => new Map(prev).set(im.id, res));
        } catch { /* best-effort: the cached/derived state stands */ }
      }
    };
    Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
    return () => { active = false; };
  }, [ims]);

  /** Row's review outcome: live check first, then the cached column. */
  const reviewStateOf = (im: ProjectIMSummary) => {
    const live = reviewChecks.get(im.id);
    return {
      reviewDone: live ? live.done : im.reviewDone,
      activeThreads: live ? live.activeThreads : im.reviewActiveThreads,
    };
  };

  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

  // Derive used categories for the filter dropdown
  const usedCatIds = [...new Set(ims.map(im => im.categoryId).filter(Boolean))] as string[];

  // null = the check failed (status renders as "unknown"), not "up to date".
  const isStale = (im: ProjectIMSummary): boolean | null => {
    if (im.status !== 'generated') return false;
    if (staleCheckFailed) return null;
    return staleInfo.has(stalenessKey(im.projectId, im.templateType));
  };
  const staleReasons = (im: ProjectIMSummary) =>
    staleInfo.get(stalenessKey(im.projectId, im.templateType))?.reasons ?? [];

  /** Mutually-exclusive display status used for the badge, the filter and the grouping. */
  const statusOf = (im: ProjectIMSummary) =>
    manualStatusOf({ ...im, reviewDone: reviewStateOf(im).reviewDone }, isStale(im));

  /** One-line "what next" hint per row (null = nothing actionable — stay quiet). */
  const nextAction = (im: ProjectIMSummary): string | null => {
    const review = reviewStateOf(im);
    return nextActionOf({
      status: statusOf(im),
      version: im.version,
      reviewRequestedAt: im.reviewRequestedAt,
      reviewActiveThreads: review.activeThreads,
      printedVersion: latestRenders ? (latestRenders.get(stalenessKey(im.projectId, im.templateType))?.imVersion ?? null) : undefined,
    });
  };

  const filtered = ims.filter(im => {
    // Filter on the DERIVED status so the dropdown, the badges and the groups agree.
    if (filterStatus !== 'all' && statusOf(im) !== filterStatus) return false;
    if (filterCat !== 'all' && im.categoryId !== filterCat) return false;
    if (filterProject) {
      const pq = filterProject.toLowerCase();
      if (!(im.projectCode ?? '').toLowerCase().includes(pq) && !im.projectName.toLowerCase().includes(pq)) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (
        im.projectName.toLowerCase().includes(q) ||
        (im.projectCode ?? '').toLowerCase().includes(q) ||
        (im.templateName ?? '').toLowerCase().includes(q) ||
        (im.categoryId ? catMap[im.categoryId] ?? '' : '').toLowerCase().includes(q) ||
        im.skus.some(s => s.toLowerCase().includes(q))
      );
    }
    return true;
  });

  /**
   * Only published manuals can be re-published, and NOT if they are final.
   *
   * Re-publishing regenerates the published artifact from the current template and shared
   * blocks, so running it on a signed-off manual would silently replace the very output the
   * FINAL lock exists to preserve. republishProjectIM refuses FINAL manuals at the service
   * level too (and migration 102 locks the row server-side); this filter just keeps them
   * out of the selection UI.
   */
  const selectableRows = filtered.filter(im => im.status === 'generated' && !im.isFinalized);
  const isSelectable = (im: ProjectIMSummary) => im.status === 'generated' && !im.isFinalized;
  const allSelected = selectableRows.length > 0 && selectableRows.every(im => selectedIds.has(im.id));
  const toggleRow = (id: string) =>
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(selectableRows.map(im => im.id)));

  const handleRepublishSelected = async () => {
    // Re-check selectability: a manual could have been finalized in another tab since selection.
    const targets = ims.filter(im => selectedIds.has(im.id) && isSelectable(im));
    if (!targets.length) return;
    setRepublishing(true);
    let ok = 0; const failures: string[] = [];
    for (const im of targets) {
      try { await republishProjectIM(im.projectId, im.templateType); ok++; }
      catch (e) { console.error('[IMDashboard] re-publish failed', im, e); failures.push(im.projectName); }
    }
    await refreshStaleness();
    setSelectedIds(new Set());
    setRepublishing(false);
    alert(`Re-published ${ok} manual${ok !== 1 ? 's' : ''}.${failures.length ? `\nFailed: ${failures.join(', ')} (see console).` : ''}`);
  };

  if (loading) {
    return <div className="text-center py-16 text-gray-400">Loading manuals…</div>;
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Search by project, ID, SKU, template or category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <input
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white w-44 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Filter by Project ID…"
          value={filterProject}
          onChange={e => setFilterProject(e.target.value)}
        />
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          {MANUAL_STATUS_ORDER.map(status => {
            const count = ims.filter(im => statusOf(im) === status).length;
            return (
              <option key={status} value={status}>
                {MANUAL_STATUS_META[status].label}{count ? ` (${count})` : ''}
              </option>
            );
          })}
        </select>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
        >
          <option value="all">All categories</option>
          {usedCatIds.map(id => (
            <option key={id} value={id}>{catMap[id] ?? id}</option>
          ))}
        </select>
        {/* Table ⇄ board toggle */}
        <div className="flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden shrink-0">
          <button
            onClick={() => switchView('table')}
            title="Table view (grouped by status; bulk re-publish lives here)"
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
          ><List size={14} /> Table</button>
          <div className="w-px h-5 bg-gray-200" />
          <button
            onClick={() => switchView('board')}
            title="Board view — one column per status, including empty ones"
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${viewMode === 'board' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
          ><Kanban size={14} /> Board</button>
        </div>
      </div>

      {/* The staleness check failed — say so instead of quietly showing everything as fine. */}
      {staleCheckFailed && (
        <div className="flex items-center gap-3 mb-4 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900">
          <AlertTriangle size={16} className="shrink-0 text-amber-600" />
          <span className="text-sm flex-1">
            Couldn't check which manuals are out of date — published manuals below show as
            <strong> Status unknown</strong> rather than falsely "Published".
          </span>
          <button
            onClick={refreshStaleness}
            className="flex items-center gap-1.5 bg-white border border-amber-300 text-amber-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-amber-100"
          >
            <RefreshCw size={13} /> Retry check
          </button>
        </div>
      )}

      {/* Count + bulk action bar */}
      <div className="flex items-center justify-between gap-3 mb-4 min-h-[32px]">
        <p className="text-xs text-gray-400">
          {filtered.length} manual{filtered.length !== 1 ? 's' : ''}
          {filtered.length !== ims.length && ` (${ims.length} total)`}
        </p>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500">{selectedIds.size} selected</span>
            <button
              onClick={() => setSelectedIds(new Set())}
              disabled={republishing}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            >Clear</button>
            <button
              onClick={handleRepublishSelected}
              disabled={republishing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              <RefreshCw size={12} className={republishing ? 'animate-spin' : ''} />
              {republishing ? 'Re-publishing…' : `Re-publish ${selectedIds.size}`}
            </button>
          </div>
        )}
      </div>

      {/* Empty (table view only — the board always renders its columns, empty or not) */}
      {viewMode === 'table' && filtered.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl text-gray-400 bg-light">
          {ims.length === 0
            ? 'No manuals created yet. Open a project and generate its IM.'
            : 'No manuals match the current filters.'}
        </div>
      )}

      {/* Table */}
      {viewMode === 'table' && filtered.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-light border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    className="accent-indigo-600 cursor-pointer"
                    checked={allSelected}
                    disabled={selectableRows.length === 0}
                    onChange={toggleAll}
                    title="Select all published manuals"
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Project</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Project ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Template</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            {/* One tbody per status group: keeps a single table (so columns stay aligned)
                while giving each group a spanning header row. */}
            {/* Rows carry the LIVE review outcome so grouping agrees with statusOf. */}
            {groupByStatus(filtered.map(im => ({ ...im, reviewDone: reviewStateOf(im).reviewDone })), isStale).map(({ status, items }) => {
              const meta = MANUAL_STATUS_META[status];
              return (
              <tbody key={status} className="divide-y divide-gray-50">
                <tr className="border-y border-gray-100 bg-light/80">
                  {/* `rowgroup`, not `colgroup`: this heading labels the rows that follow. */}
                  <th colSpan={9} scope="rowgroup" className="px-4 py-2 text-left font-normal">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.classes}`}>
                        {STATUS_ICON[status]} {meta.label}
                      </span>
                      <span className="text-xs font-semibold text-gray-700">
                        {items.length} manual{items.length !== 1 ? 's' : ''}
                      </span>
                      {/* gray-500, not gray-400: this is prose on a tinted surface and has to
                          clear 4.5:1, which gray-400 does not. */}
                      <span className="text-[11px] text-gray-500">{meta.hint}</span>
                    </div>
                  </th>
                </tr>
                {items.map(im => {
                const catName = im.categoryId ? (catMap[im.categoryId] ?? '—') : '—';
                return (
                  <tr key={im.id} className="hover:bg-light/60 transition-colors group">
                    <td className="px-4 py-3">
                      {isSelectable(im) ? (
                        <input
                          type="checkbox"
                          className="accent-indigo-600 cursor-pointer"
                          checked={selectedIds.has(im.id)}
                          onChange={() => toggleRow(im.id)}
                        />
                      ) : im.isFinalized ? (
                        <span title="Final: unlock it in the editor before re-publishing">
                          <Lock size={12} className="text-gray-300" aria-label="Locked" />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-800">{im.projectName}</span>
                    </td>
                    <td className="px-4 py-3">
                      {im.projectCode
                        ? <span className="text-[11px] font-mono text-gray-500">{im.projectCode}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {im.skus.length === 0 ? (
                        <span className="text-gray-300 text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {im.skus.map(sku => (
                            <span key={sku} className="text-[11px] font-mono bg-sky-50 text-sky-700 border border-sky-100 px-1.5 py-0.5 rounded">
                              {sku}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                        {catName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      <div className="flex items-center gap-2">
                        <span>{im.templateName ?? <span className="text-gray-400 italic">—</span>}</span>
                        {im.templateType === 'warning_leaflet' && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
                            <AlertTriangle size={9} /> Leaflet
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(() => {
                          const s = statusOf(im);
                          return (
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${MANUAL_STATUS_META[s].classes}`}
                              title={
                                im.isFinalized && im.finalizedAt ? `Marked final on ${fmtDate(im.finalizedAt)}`
                                : s === 'in_review' && im.reviewRequestedAt ? `Sent for review on ${fmtDate(im.reviewRequestedAt)}`
                                : undefined
                              }
                            >
                              {STATUS_ICON[s]} {MANUAL_STATUS_META[s].label}
                            </span>
                          );
                        })()}
                        {statusOf(im) === 'in_review' && im.reviewUrl && (
                          <a
                            href={im.reviewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] font-semibold text-sky-700 underline hover:text-sky-900"
                            title="Open the Markup.io review"
                          >Open review</a>
                        )}
                        {/* A final manual keeps its underlying publish state visible: "Final"
                            says it's locked, not whether it was ever published. */}
                        {im.isFinalized && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                            {im.status === 'generated' ? 'Published' : 'Draft'}
                          </span>
                        )}
                        {/* Only as a SECONDARY signal: when the row's own status is
                            'needs_republish' the primary badge already says so. This is for a
                            final manual whose sources drifted — locked, but out of date. */}
                        {im.isFinalized && isStale(im) && (() => {
                          const reasons = staleReasons(im);
                          const blocks = reasons.filter(r => r.type === 'block').map(r => r.label);
                          const others = reasons.filter(r => r.type !== 'block').map(r => r.label);
                          const summary = [blocks.length ? `Block${blocks.length > 1 ? 's' : ''}: ${blocks.join(', ')}` : '', ...others].filter(Boolean).join(' · ');
                          return (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-orange-100 text-orange-700 border-orange-200"
                              title={`Changed since last publish — ${summary}. Unlock and re-publish to update.`}
                            >
                              <RefreshCw size={10} /> Out of date
                            </span>
                          );
                        })()}
                      </div>
                      {isStale(im) && (() => {
                        const reasons = staleReasons(im);
                        const blocks = reasons.filter(r => r.type === 'block').map(r => r.label);
                        const others = reasons.filter(r => r.type !== 'block').map(r => r.label);
                        const summary = [blocks.length ? `block${blocks.length > 1 ? 's' : ''}: ${blocks.join(', ')}` : '', ...others.map(o => o.toLowerCase())].filter(Boolean).join(' · ');
                        return (
                          <div className="text-[10px] text-orange-600/80 mt-1 max-w-[220px] flex items-center gap-1.5">
                            <span className="truncate" title={summary}>↳ {summary}</span>
                            <button
                              onClick={() => setDiffTarget({ projectId: im.projectId, templateType: im.templateType, title: `${im.projectName}${im.templateType === 'warning_leaflet' ? ' — Warning Leaflet' : ''}` })}
                              className="shrink-0 underline font-semibold hover:text-orange-800"
                              title="Show which sections a re-publish would change, per language"
                            >What changed?</button>
                          </div>
                        );
                      })()}
                      {/* "What next" hint — quiet (null) when nothing is actionable. */}
                      {(() => {
                        const hint = nextAction(im);
                        return hint ? (
                          <div className="text-[10px] text-gray-400 mt-1 max-w-[220px] truncate" title={hint}>↳ {hint}</div>
                        ) : null;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{fmtDate(im.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/project/${im.projectId}/im-generator${im.templateType === 'warning_leaflet' ? '/warning_leaflet' : ''}`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors"
                      >
                        <FileEdit size={12} /> {im.templateType === 'warning_leaflet' ? 'Open Leaflet' : 'Open IM'}
                      </Link>
                    </td>
                  </tr>
                );
                })}
              </tbody>
              );
            })}
          </table>
        </div>
      )}

      {/* Board — one column per derived status, ALWAYS all columns (an empty step is
          information: nothing is waiting there). Statuses are derived, so cards are
          not draggable; each card links into the generator where the action happens. */}
      {viewMode === 'board' && (() => {
        const decorated = filtered.map(im => ({ ...im, reviewDone: reviewStateOf(im).reviewDone }));
        const byStatus = new Map<ManualStatus, typeof decorated>();
        for (const im of decorated) {
          const s = manualStatusOf(im, isStale(im));
          if (!byStatus.has(s)) byStatus.set(s, []);
          byStatus.get(s)!.push(im);
        }
        return (
          <div className="flex gap-3 overflow-x-auto pb-3 items-start">
            {MANUAL_STATUS_ORDER.map(status => {
              const meta = MANUAL_STATUS_META[status];
              const items = byStatus.get(status) ?? [];
              return (
                <div key={status} className="w-[250px] shrink-0 bg-light/70 border border-gray-200 rounded-xl flex flex-col max-h-[calc(100vh-330px)] min-h-[140px]">
                  <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2" title={meta.hint}>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.classes}`}>
                      {STATUS_ICON[status]} {meta.label}
                    </span>
                    <span className="text-xs font-semibold text-gray-500 ml-auto">{items.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {items.length === 0 ? (
                      <div className="text-[11px] text-gray-400 italic text-center border border-dashed border-gray-200 rounded-lg py-6 px-2">
                        No manuals at this step
                      </div>
                    ) : items.map(im => {
                      const hint = nextAction(im);
                      return (
                        <div key={im.id} className="bg-white border border-gray-200 rounded-lg p-2.5 shadow-sm hover:shadow transition-shadow">
                          <div className="flex items-center gap-1.5 mb-1">
                            {im.templateType === 'warning_leaflet'
                              ? <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"><AlertTriangle size={9} /> LEAFLET</span>
                              : <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100"><FileText size={9} /> IM</span>}
                            {im.version > 0 && <span className="text-[9px] font-bold text-gray-400">v{im.version}</span>}
                            <span className="text-[9px] text-gray-300 ml-auto">{fmtDate(im.updatedAt)}</span>
                          </div>
                          <Link
                            to={`/project/${im.projectId}/im-generator${im.templateType === 'warning_leaflet' ? '/warning_leaflet' : ''}`}
                            className="block font-semibold text-sm text-gray-800 hover:text-indigo-700 truncate"
                            title={`${im.projectName} — open in the generator`}
                          >
                            {im.projectCode ? `${im.projectCode} — ` : ''}{im.projectName}
                          </Link>
                          <div className="text-[10px] text-gray-400 truncate">
                            {im.categoryId ? (catMap[im.categoryId] ?? '') : ''}
                            {im.skus.length ? ` · ${im.skus.slice(0, 2).join(', ')}${im.skus.length > 2 ? ` +${im.skus.length - 2}` : ''}` : ''}
                          </div>
                          {isStale(im) && (
                            <button
                              onClick={() => setDiffTarget({ projectId: im.projectId, templateType: im.templateType, title: `${im.projectName}${im.templateType === 'warning_leaflet' ? ' — Warning Leaflet' : ''}` })}
                              className="text-[10px] text-orange-600 underline font-semibold mt-1 hover:text-orange-800"
                              title="Show which sections a re-publish would change, per language"
                            >What changed?</button>
                          )}
                          {hint && <div className="text-[10px] text-gray-500 mt-1 truncate" title={hint}>↳ {hint}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {diffTarget && (
        <PublishDiffModal
          projectId={diffTarget.projectId}
          templateType={diffTarget.templateType}
          title={diffTarget.title}
          onClose={() => setDiffTarget(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Templates tab (existing functionality, preserved as-is)
// ---------------------------------------------------------------------------

interface TemplatesTabProps {
  categories: CategoryL3[];
  templates: IMTemplate[];
  creatingId: string | null;   // composite key `${categoryId}:${type}` of the row being created
  togglingId: string | null;   // template id whose finalized state is updating
  onCreate: (cat: CategoryL3, type: IMTemplateType) => void;
  onToggleFinalized: (t: IMTemplate) => void;
  onDuplicate: (t: IMTemplate) => void;
  onImport: () => void;
}

// One row per template type within a category card.
interface TemplateRowProps {
  category: CategoryL3;
  type: IMTemplateType;
  template?: IMTemplate;
  creating: boolean;
  toggling: boolean;
  onCreate: (cat: CategoryL3, type: IMTemplateType) => void;
  onToggleFinalized: (t: IMTemplate) => void;
  onDuplicate: (t: IMTemplate) => void;
}

const TemplateRow: React.FC<TemplateRowProps> = ({
  category, type, template, creating, toggling, onCreate, onToggleFinalized, onDuplicate
}) => {
  const Icon = type === 'warning_leaflet' ? AlertTriangle : FileText;
  const accent = type === 'warning_leaflet' ? 'text-amber-600' : 'text-indigo-600';
  return (
    <div className="border border-gray-100 rounded-lg p-3 bg-light/50">
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 text-xs font-bold ${accent}`}>
          <Icon size={13} /> {IM_TEMPLATE_TYPE_LABELS[type]}
        </span>
        {template?.isFinalized && (
          <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1">
            <CheckCircle2 size={10} /> FINAL
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        {template ? (
          <>
            <span className="flex items-center gap-2">
              <Link
                to={editorPath(category.id, type)}
                className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-blue-800"
              >
                Edit <ArrowRight size={14} />
              </Link>
              <button
                onClick={() => onDuplicate(template)}
                title="Duplicate this template — sections and all — into another category"
                className="p-1 text-gray-300 hover:text-indigo-600"
              >
                <Copy size={13} />
              </button>
            </span>
            <button
              onClick={() => onToggleFinalized(template)}
              disabled={toggling}
              className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded transition-colors ${
                template.isFinalized
                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
              }`}
            >
              {toggling ? 'Updating…' : (
                template.isFinalized ? <><Unlock size={12} /> Reopen</> : <><Lock size={12} /> Mark Final</>
              )}
            </button>
          </>
        ) : (
          <button
            onClick={() => onCreate(category, type)}
            disabled={creating}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-indigo-600 disabled:opacity-50"
          >
            {creating ? 'Creating…' : <><Plus size={16} /> Create</>}
          </button>
        )}
      </div>
    </div>
  );
};

const TemplatesTab: React.FC<TemplatesTabProps> = ({
  categories, templates, creatingId, togglingId, onCreate, onToggleFinalized, onDuplicate, onImport
}) => (
  <div>
    <div className="flex items-center justify-between mb-4">
      <p className="text-xs text-gray-400">
        Author a template per category, or import a reviewed IM from JSON for categories without one.
      </p>
      <button
        onClick={onImport}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
      >
        <FileJson size={13} /> Import from JSON
      </button>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {categories.map(cat => (
        <div key={cat.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow flex flex-col hover:shadow-md transition-all">
          <h3 className="text-lg font-bold text-gray-800 mb-3">{cat.name}</h3>
          <div className="flex flex-col gap-2">
            {TEMPLATE_TYPE_ORDER.map(type => (
              <TemplateRow
                key={type}
                category={cat}
                type={type}
                template={templates.find(t => t.categoryId === cat.id && t.templateType === type)}
                creating={creatingId === `${cat.id}:${type}`}
                toggling={!!templates.find(t => t.categoryId === cat.id && t.templateType === type && t.id === togglingId)}
                onCreate={onCreate}
                onToggleFinalized={onToggleFinalized}
                onDuplicate={onDuplicate}
              />
            ))}
          </div>
        </div>
      ))}

      {categories.length === 0 && (
        <div className="col-span-3 text-center py-12 text-gray-400 bg-light border border-dashed border-gray-200 rounded-xl">
          No product categories defined. Go to Admin Console to add categories.
        </div>
      )}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

type Tab = 'templates' | 'manuals' | 'blocks' | 'viewer';

const IMDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('manuals');

  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [templates, setTemplates] = useState<IMTemplate[]>([]);
  const [allIMs, setAllIMs] = useState<ProjectIMSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingIMs, setLoadingIMs] = useState(true);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  // "Duplicate template into another category" modal state.
  const [dupSource, setDupSource] = useState<IMTemplate | null>(null);
  const [dupTargetCatId, setDupTargetCatId] = useState('');
  const [duplicating, setDuplicating] = useState(false);

  const handleDuplicate = async () => {
    if (!dupSource || !dupTargetCatId || duplicating) return;
    const targetCat = categories.find(c => c.id === dupTargetCatId);
    if (!targetCat) return;
    setDuplicating(true);
    try {
      await duplicateIMTemplate(dupSource.id, targetCat.id, defaultTemplateName(targetCat.name, dupSource.templateType));
      setDupSource(null);
      await loadTemplateData();
      navigate(editorPath(targetCat.id, dupSource.templateType));
    } catch (e) {
      alert(`Duplicating the template failed: ${e instanceof Error ? e.message : String(e)}`);
      // Keep the modal open; the error says whether a partial clone exists.
      await loadTemplateData();
    } finally {
      setDuplicating(false);
    }
  };

  useEffect(() => {
    loadTemplateData();
    loadIMData();
  }, []);

  const loadTemplateData = async () => {
    try {
      const [cats, temps] = await Promise.all([getCategories(), getIMTemplates()]);
      setCategories(cats);
      setTemplates(temps);
    } catch (e) {
      console.error('[IMDashboard] loadTemplateData failed:', e);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const loadIMData = async () => {
    try {
      const ims = await getAllProjectIMs();
      setAllIMs(ims);
    } catch (e) {
      console.error('[IMDashboard] loadIMData failed:', e);
    } finally {
      setLoadingIMs(false);
    }
  };

  const handleCreate = async (cat: CategoryL3, type: IMTemplateType) => {
    setCreatingId(`${cat.id}:${type}`);
    try {
      await createIMTemplate(cat.id, defaultTemplateName(cat.name, type), type);
      navigate(editorPath(cat.id, type));
    } catch (e: any) {
      console.error(e);
      alert(`Failed to create template: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
      setCreatingId(null);
    }
  };

  const handleImported = (result: ImImportResult) => {
    setShowImport(false);
    loadTemplateData();
    navigate(editorPath(result.categoryId, result.templateType));
  };

  const handleToggleFinalized = async (template: IMTemplate) => {
    setTogglingId(template.id);
    const newStatus = !template.isFinalized;
    try {
      await updateIMTemplate(template.id, {
        isFinalized: newStatus,
        // null (not undefined) so reopening actually clears the timestamp.
        finalizedAt: newStatus ? new Date().toISOString() : null
      });
      await loadTemplateData();
    } catch (e) {
      alert('Failed to update template status.');
    } finally {
      setTogglingId(null);
    }
  };

  const tabs: { id: Tab; label: string; count?: number; icon: React.ReactNode }[] = [
    { id: 'manuals',   label: 'All Manuals',        count: allIMs.length, icon: <Layers size={15} /> },
    { id: 'templates', label: 'Category Templates',                        icon: <FileText size={15} /> },
    { id: 'blocks',    label: 'Block Library',                             icon: <BookOpen size={15} /> },
    { id: 'viewer',    label: 'Viewer',                                    icon: <Eye size={15} /> },
  ];

  return (
    <Layout>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
          <BookOpen className="text-indigo-600" /> Instruction Manuals
        </h1>
        <p className="text-muted mt-1">Author templates and manage all generated product manuals.</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                activeTab === tab.id ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'manuals' && (
        <AllManualsTab
          ims={allIMs}
          categories={categories}
          loading={loadingIMs || loadingTemplates}
        />
      )}
      {activeTab === 'templates' && (
        loadingTemplates
          ? <div className="text-center py-16 text-gray-400">Loading templates…</div>
          : <TemplatesTab
              categories={categories}
              templates={templates}
              creatingId={creatingId}
              togglingId={togglingId}
              onCreate={handleCreate}
              onToggleFinalized={handleToggleFinalized}
              onDuplicate={(t) => { setDupSource(t); setDupTargetCatId(''); }}
              onImport={() => setShowImport(true)}
            />
      )}
      {activeTab === 'blocks' && <BlockLibraryContent />}
      {activeTab === 'viewer' && <IMViewerTab ims={allIMs} />}

      {showImport && (
        <ImImportDialog
          categories={categories}
          onClose={() => setShowImport(false)}
          onImported={handleImported}
        />
      )}

      {/* Duplicate template into another category — offered only for categories that
          don't already have a template of this type (one template per category+type). */}
      {dupSource && (() => {
        const sourceCat = categories.find(c => c.id === dupSource.categoryId);
        const eligible = categories.filter(c =>
          c.id !== dupSource.categoryId
          && !templates.some(t => t.categoryId === c.id && t.templateType === dupSource.templateType));
        return (
          <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => !duplicating && setDupSource(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-3.5 border-b">
                <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <Copy size={16} /> Duplicate template
                </h3>
                <button onClick={() => !duplicating && setDupSource(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
              </div>
              <div className="px-5 py-4 space-y-3 text-sm">
                <p className="text-gray-600">
                  Copy <strong>{dupSource.name}</strong>{sourceCat ? <> ({sourceCat.name})</> : null} — all sections,
                  languages and settings — into another category. Shared blocks stay references to the same block
                  library; the copy starts unlocked (not FINAL) with no projects attached.
                </p>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Target category</label>
                  <select
                    value={dupTargetCatId}
                    onChange={(e) => setDupTargetCatId(e.target.value)}
                    className="w-full text-sm border rounded px-2 py-1.5 mt-1 bg-white"
                  >
                    <option value="">Choose a category…</option>
                    {eligible.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {eligible.length === 0 && (
                    <p className="text-[11px] text-amber-600 mt-1.5">
                      Every other category already has a {IM_TEMPLATE_TYPE_LABELS[dupSource.templateType]} template —
                      a category holds at most one per type.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 px-5 py-3 border-t">
                <button onClick={() => setDupSource(null)} disabled={duplicating} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                <button
                  onClick={handleDuplicate}
                  disabled={!dupTargetCatId || duplicating}
                  className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1.5"
                >
                  {duplicating ? <><Loader2 size={14} className="animate-spin" /> Copying sections…</> : 'Duplicate'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </Layout>
  );
};

export default IMDashboard;
