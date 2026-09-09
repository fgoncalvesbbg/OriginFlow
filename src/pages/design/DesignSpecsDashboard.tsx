/**
 * All Design Specs — the design team's work queue.
 *
 * A table and a kanban board over the same rows, toggled and remembered, exactly as the
 * All Manuals board works. The board is a VISUALIZATION of the derived statuses, not an
 * editor of them: a card cannot be dragged between columns, because a spec moves by
 * uploading, sending or issuing — never by someone declaring it moved. That is the whole
 * reason only Backlog and Cancelled are stored (see design-spec-status.ts).
 *
 * Projects WITHOUT a spec are listed too, synthesised into the Backlog column. Without them
 * the board answers "how are my specs doing" but not "which projects still need one", and
 * the second question is the one that catches a launch with no design spec at all.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, LayoutGrid, Table2, Plus, RefreshCw, Search, AlertTriangle, Eye, CheckCircle2,
  Circle, PenLine, Ban,
} from 'lucide-react';
import {
  getDesignSpecs, getVersionsBySpec, getDesignSpecRounds, canEditDesignSpecs,
  createDesignSpec, getProjects,
} from '../../services';
import type { DesignSpec, DesignSpecVersion } from '../../types/design-spec.types';
import type { Project } from '../../types';
import {
  designSpecStatusOf, designSpecStatusClasses, designSpecStatusLabel, designSpecNextAction,
  groupByDesignSpecStatus, currentVersionOf, isReviewClosed,
  DESIGN_SPEC_STATUS_META, DESIGN_SPEC_STATUS_ORDER,
  type DesignSpecStatus, type DesignSpecRoundInput,
} from './design-spec-status';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';

/** One icon per step, matching the All Manuals board's vocabulary. */
const STATUS_ICON: Record<DesignSpecStatus, React.ReactNode> = {
  backlog: <Circle size={10} />,
  in_progress: <PenLine size={10} />,
  in_review: <Eye size={10} />,
  final: <CheckCircle2 size={10} />,
  cancelled: <Ban size={10} />,
  unknown: <AlertTriangle size={10} />,
};

/**
 * A row on the board: either a real spec, or a project that has none yet.
 *
 * The synthesised kind carries no spec id, which is what the "Start a spec" action keys off.
 */
interface Row {
  key: string;
  projectId: string;
  projectName: string;
  spec: DesignSpec | null;
  versions: DesignSpecVersion[];
  round: DesignSpecRoundInput | null | undefined;
}

/** The status input for a project with no spec row at all. */
const NO_SPEC = { state: 'backlog' as const, finalVersionId: null, versions: [] };

const statusOfRow = (row: Row): DesignSpecStatus => row.spec
  ? designSpecStatusOf(
    { state: row.spec.state, finalVersionId: row.spec.finalVersionId, versions: row.versions },
    row.round,
  )
  : 'backlog';

const DesignSpecsDashboard: React.FC = () => {
  const [specs, setSpecs] = useState<DesignSpec[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [versionsBySpec, setVersionsBySpec] = useState<Map<string, DesignSpecVersion[]>>(new Map());
  /** null = the round query FAILED. Distinct from an empty map, which means "no rounds". */
  const [rounds, setRounds] = useState<Map<string, DesignSpecRoundInput> | null>(new Map());
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DesignSpecStatus | 'all'>('all');
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'table' | 'board'>(() => {
    try { return localStorage.getItem('design-specs-view') === 'board' ? 'board' : 'table'; }
    catch { return 'table'; }
  });
  const switchView = (mode: 'table' | 'board') => {
    setViewMode(mode);
    try { localStorage.setItem('design-specs-view', mode); } catch { /* ignore */ }
  };

  const load = async () => {
    setError('');
    try {
      const [specRows, projectRows, editable] = await Promise.all([
        getDesignSpecs(),
        getProjects(),
        canEditDesignSpecs(),
      ]);
      setSpecs(specRows);
      setProjects(projectRows);
      setCanEdit(editable);
      setVersionsBySpec(await getVersionsBySpec(specRows.map(s => s.id)));
      // Deliberately last and separately: a failed round query must show as "Status
      // unknown" on the affected cards, not take the whole board down.
      setRounds(await getDesignSpecRounds());
    } catch (e) {
      console.error('[DesignSpecsDashboard] load failed:', e);
      setError('Could not load design specs. Try again.');
    }
  };

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const startSpec = async (project: Project) => {
    setCreatingFor(project.id);
    try {
      await createDesignSpec(project.id, `${project.name} — design spec`);
      await load();
    } catch (e: any) {
      console.error('[DesignSpecsDashboard] createDesignSpec failed:', e);
      setError(e?.message ?? 'Could not start that design spec.');
    } finally {
      setCreatingFor(null);
    }
  };

  const rows = useMemo<Row[]>(() => {
    const byProject = new Map(specs.map(s => [s.projectId, s]));
    const projectName = new Map(projects.map(p => [p.id, p.name]));

    const specRows: Row[] = specs.map(spec => {
      const versions = versionsBySpec.get(spec.id) ?? [];
      const current = versions.find(v => v.version === currentVersionOf(versions));
      return {
        key: spec.id,
        projectId: spec.projectId,
        projectName: projectName.get(spec.projectId) ?? '—',
        spec,
        versions,
        // A round belongs to a VERSION, so only the current version's round describes the
        // spec now. `null` propagates the failed-query state through to the badge.
        round: rounds === null ? null : (current ? rounds.get(current.id) : undefined),
      };
    });

    const without: Row[] = projects
      .filter(p => !byProject.has(p.id))
      .map(p => ({
        key: `project:${p.id}`,
        projectId: p.id,
        projectName: p.name,
        spec: null,
        versions: [],
        round: undefined,
      }));

    return [...specRows, ...without];
  }, [specs, projects, versionsBySpec, rounds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(row => {
      if (statusFilter !== 'all' && statusOfRow(row) !== statusFilter) return false;
      if (!q) return true;
      return row.projectName.toLowerCase().includes(q)
        || (row.spec?.specCode ?? '').toLowerCase().includes(q)
        || (row.spec?.title ?? '').toLowerCase().includes(q);
    });
  }, [rows, query, statusFilter]);

  const counts = useMemo(() => {
    const map = new Map<DesignSpecStatus, number>();
    for (const row of rows) {
      const s = statusOfRow(row);
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return map;
  }, [rows]);

  const groups = useMemo(
    () => groupByDesignSpecStatus(
      filtered.map(r => ({
        ...(r.spec
          ? { state: r.spec.state, finalVersionId: r.spec.finalVersionId, versions: r.versions }
          : NO_SPEC),
        row: r,
      })),
      item => item.row.round,
    ),
    [filtered],
  );

  const StatusBadge: React.FC<{ row: Row }> = ({ row }) => {
    const status = statusOfRow(row);
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-medium ${designSpecStatusClasses(status, row.round)}`}>
        {STATUS_ICON[status]}
        {isReviewClosed(row.round) ? designSpecStatusLabel(status, row.round) : DESIGN_SPEC_STATUS_META[status].label}
      </span>
    );
  };

  const RowActions: React.FC<{ row: Row }> = ({ row }) => row.spec
    ? (
      <Link to={`/project/${row.projectId}?tab=design`} className="text-indigo-600 hover:underline text-xs font-medium">
        Open
      </Link>
    )
    : canEdit
      ? (
        <Button
          size="sm"
          variant="ghost"
          loading={creatingFor === row.projectId}
          leftIcon={<Plus size={12} />}
          onClick={() => void startSpec(projects.find(p => p.id === row.projectId)!)}
        >
          Start a spec
        </Button>
      )
      : <span className="text-xs text-gray-400">No spec</span>;

  if (loading) {
    return <div className="p-8 text-sm text-gray-400">Loading design specs…</div>;
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
            <ClipboardList size={22} /> Design Specs
          </h1>
          <p className="text-sm text-muted mt-1">
            One spec per project. Upload a draft, send it to the supplier for markup, then
            issue the final.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" loading={refreshing} leftIcon={<RefreshCw size={13} />} onClick={() => void refresh()}>
            Refresh
          </Button>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => switchView('table')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${viewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <Table2 size={14} /> Table
            </button>
            <button
              onClick={() => switchView('board')}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${viewMode === 'board' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <LayoutGrid size={14} /> Board
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-sm">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {rounds === null && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 text-amber-800 text-sm">
          <AlertTriangle size={14} />
          The review-round check failed, so specs out with a supplier read “Status unknown”
          rather than being shown as healthy.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search project, code or title…"
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg w-64 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium ${statusFilter === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
        >
          All {rows.length}
        </button>
        {DESIGN_SPEC_STATUS_ORDER.filter(s => (counts.get(s) ?? 0) > 0).map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            title={DESIGN_SPEC_STATUS_META[status].hint}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium ${statusFilter === status ? 'bg-indigo-600 text-white border-indigo-600' : `${DESIGN_SPEC_STATUS_META[status].classes} hover:opacity-80`}`}
          >
            {DESIGN_SPEC_STATUS_META[status].label} {counts.get(status)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-xl p-10 text-center text-sm text-gray-400">
          Nothing matches that filter.
        </div>
      ) : viewMode === 'table' ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-bold">Spec</th>
                <th className="text-left px-4 py-2 font-bold">Project</th>
                <th className="text-left px-4 py-2 font-bold">Status</th>
                <th className="text-left px-4 py-2 font-bold">Version</th>
                <th className="text-left px-4 py-2 font-bold">Next</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(row => {
                const current = currentVersionOf(row.versions);
                const next = row.spec
                  ? designSpecNextAction(
                    { state: row.spec.state, finalVersionId: row.spec.finalVersionId, versions: row.versions },
                    row.round,
                    null,
                  )
                  : 'no spec yet — start one to begin';
                return (
                  <tr key={row.key} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      {row.spec ? (
                        <>
                          <span className="font-mono text-[11px] text-gray-500">{row.spec.specCode}</span>
                          <div className="text-gray-800">{row.spec.title}</div>
                        </>
                      ) : (
                        <span className="text-gray-400 italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{row.projectName}</td>
                    <td className="px-4 py-2.5"><StatusBadge row={row} /></td>
                    <td className="px-4 py-2.5 text-gray-500">
                      {current != null ? `v${current}` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[11px] text-gray-500">{next ?? ''}</td>
                    <td className="px-4 py-2.5 text-right"><RowActions row={row} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {groups.map(group => (
            <div key={group.status} className="w-72 shrink-0">
              <div className={`px-3 py-2 rounded-t-xl border text-xs font-bold flex items-center justify-between ${DESIGN_SPEC_STATUS_META[group.status].classes}`}>
                <span className="flex items-center gap-1.5">
                  {STATUS_ICON[group.status]} {DESIGN_SPEC_STATUS_META[group.status].label}
                </span>
                <span>{group.items.length}</span>
              </div>
              <p className="px-3 py-2 text-[10px] text-gray-500 bg-gray-50 border-x border-gray-200">
                {DESIGN_SPEC_STATUS_META[group.status].hint}
              </p>
              <div className="border-x border-b border-gray-200 rounded-b-xl bg-gray-50 p-2 space-y-2 min-h-[120px]">
                {group.items.map(({ row }) => {
                  const current = currentVersionOf(row.versions);
                  const next = row.spec
                    ? designSpecNextAction(
                      { state: row.spec.state, finalVersionId: row.spec.finalVersionId, versions: row.versions },
                      row.round,
                      null,
                    )
                    : null;
                  return (
                    <div key={row.key} className="bg-white border border-gray-200 rounded-lg p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-800 leading-tight">
                          {row.projectName}
                        </span>
                        {current != null && (
                          <Badge tone="gray">v{current}</Badge>
                        )}
                      </div>
                      {row.spec && (
                        <div className="font-mono text-[10px] text-gray-400 mt-0.5">{row.spec.specCode}</div>
                      )}
                      {next && <p className="text-[10px] text-gray-500 mt-1.5">{next}</p>}
                      <div className="mt-2"><RowActions row={row} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DesignSpecsDashboard;
