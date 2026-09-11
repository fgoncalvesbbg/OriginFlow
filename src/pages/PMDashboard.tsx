
/** Project-manager dashboard: overview of the PM's projects and pending actions. */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProjects, getSuppliers, getDashboardStats, updateProject, deleteProject, getProfiles, getStepsForProjects, setStepStatuses, lookupJiraIssues, jiraFilterValue, JIRA_NOT_FOUND_LABEL, getCategories } from '../services';
import { Project, ProjectStep, Supplier, User, UserRole, DashboardStats, ProjectOverallStatus, JiraLookup, CategoryL3 } from '../types';
import Layout from '../components/Layout';
import { StatusBadge } from '../components/StatusBadge';
import { JiraStatusBadge } from '../components/JiraStatusBadge';
import { Card } from '../components/common/Card';
import { CategoryTreeFilter, CategoryFilterValue } from '../components/common/CategoryTreeFilter';
import { ChevronRight, Search, Filter, Layout as LayoutIcon, Clock, FileText, Trash2, Archive, MoreHorizontal, AlertTriangle, RefreshCw, ShoppingBag, AlertCircle, ArrowUp, ArrowDown, ChevronsUpDown, LayoutGrid, Table2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRefetchOnFocus } from '../hooks';
import { useInbox } from '../components/inbox/InboxContext';
import {
  BOARD_BUCKETS, BoardBucketId, activePhase, bucketOf, planBucketDrop,
} from './project-board-buckets';

// Column keys used for per-column filtering and sorting in the projects table.
type ProjectColKey = 'name' | 'projectId' | 'pm' | 'supplier' | 'step' | 'status' | 'jira';
type SortDir = 'asc' | 'desc';
type ViewMode = 'kanban' | 'table';

/** Clickable table header that toggles sorting for its column. */
const SortableTh: React.FC<{
  label: string;
  colKey: ProjectColKey;
  sortKey: ProjectColKey;
  sortDir: SortDir;
  onSort: (k: ProjectColKey) => void;
  className?: string;
}> = ({ label, colKey, sortKey, sortDir, onSort, className }) => {
  const active = sortKey === colKey;
  return (
    <th className={`px-6 py-4 font-semibold text-gray-700 ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={`inline-flex items-center gap-1 hover:text-indigo-600 transition-colors ${active ? 'text-indigo-600' : ''}`}
      >
        {label}
        {active ? (sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ChevronsUpDown size={13} className="text-gray-300" />}
      </button>
    </th>
  );
};

const PMDashboard: React.FC = () => {
  const { user } = useAuth();
  // The open-work counters come from the app shell's inbox snapshot, not from a second
  // query, so the tile and the drawer always agree. Null when rendered outside Layout.
  const inboxCtx = useInbox();
  const [projects, setProjects] = useState<Project[]>([]);
  // Every visible project's chapters, keyed by project id. The board's columns ARE the
  // chapters, so it groups on these statuses rather than on the overall project status.
  const [chapters, setChapters] = useState<Record<string, ProjectStep[]>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [profiles, setProfiles] = useState<User[]>([]);
  // The category tree, for the L1/L2/L3 filter below — fails soft to [] if the role can't
  // read it, in which case the filter button just has nothing to offer.
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [stats, setStats] = useState<(DashboardStats & { newProposals: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  // The tree node (L1, L2 or L3) picked in the top-bar Category filter — matches every leaf
  // under it, so picking an L1 doesn't require enumerating its L2/L3 descendants.
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterValue | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // Kanban grouped by status is the default landing view; Table is the detailed,
  // filterable/sortable alternative.
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [dragOverBucket, setDragOverBucket] = useState<BoardBucketId | null>(null);
  // Per-column filters + sort state for the projects table.
  const [colFilters, setColFilters] = useState<Record<ProjectColKey, string>>({ name: '', projectId: '', pm: '', supplier: '', step: '', status: 'all', jira: 'all' });
  const [sortKey, setSortKey] = useState<ProjectColKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Jira is looked up live and never stored — see src/services/project/jira.service.ts.
  // It loads separately from the project data so a slow or broken Jira never delays
  // (or breaks) the dashboard.
  const [jira, setJira] = useState<Record<string, JiraLookup>>({});
  const [jiraConfigured, setJiraConfigured] = useState(false);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState('');

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [pData, sData, statsData, profileData, categoryData] = await Promise.all([
        getProjects(),
        getSuppliers(),
        getDashboardStats(),
        getProfiles().catch(() => [] as User[]),
        getCategories().catch(() => [] as CategoryL3[])
      ]);
      setProjects(pData);
      setSuppliers(sData);
      setProfiles(profileData);
      setStats(statsData);
      setCategories(categoryData);
      // Awaited, unlike Jira: without the chapters the board cannot place a card, and a
      // half-placed board is worse than a moment more of the spinner. One indexed query for
      // every project, and it returns {} rather than throwing if the role cannot read them.
      setChapters(await getStepsForProjects(pData.map(p => p.id)));
      // Deliberately not awaited: the table renders immediately and the Jira
      // column fills in when Atlassian answers.
      void refreshJira(pData);
    } catch (e: any) {
      console.error("Failed to load dashboard data", e);
      setErrorMsg(e.message || "Failed to load data.");
    } finally {
      setLoading(false);
    }
  };

  useRefetchOnFocus(loadData);

  /**
   * Re-read every project's Jira status straight from Jira. Called on load, on the
   * "Refresh Jira" button, and on focus-refetch via loadData. Nothing is cached or
   * persisted, so this is always the live answer.
   */
  const refreshJira = async (list: Project[]) => {
    const codes = list.map(p => p.projectId).filter(Boolean);
    if (codes.length === 0) { setJira({}); return; }
    setJiraLoading(true);
    const res = await lookupJiraIssues(codes);
    setJira(res.results);
    setJiraConfigured(res.configured);
    setJiraError(res.error || '');
    setJiraLoading(false);
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || 'Unknown';
  const getPmName = (id: string) => {
    const u = profiles.find(p => p.id === id);
    return u?.name || u?.email || (id ? 'Unassigned' : 'Unassigned');
  };

  /**
   * The chapter a project is working, as a number — the same rule the board groups on, so the
   * table's "Current Step" column agrees with the column a card sits in. It reads the chapter
   * statuses, not `projects.current_step`: that column is written once at creation and never
   * advanced, so before this it showed "Step 1" for every project in the database.
   */
  const phaseNumber = (p: Project): number => {
    const list = chapters[p.id] ?? [];
    const position = activePhase(list);
    if (position.kind === 'phase') return position.phase;
    if (position.kind === 'finished') return Math.max(...list.map(s => s.stepNumber));
    return p.currentStep || 1;
  };

  /** The chapter row behind that number, for its name and its own status. */
  const activeChapter = (p: Project): ProjectStep | undefined =>
    (chapters[p.id] ?? []).find(s => s.stepNumber === phaseNumber(p));

  // Per-column accessors — string values used for both filtering and sorting.
  const colValue = (p: Project, key: ProjectColKey): string => {
    switch (key) {
      case 'name': return p.name;
      case 'projectId': return p.projectId;
      case 'pm': return getPmName(p.pmId);
      case 'supplier': return getSupplierName(p.supplierId);
      case 'step': return String(phaseNumber(p));
      case 'status': return p.status;
      // Sorts/filters on the same words the cell shows — the Epic's own Jira status.
      case 'jira': return jiraFilterValue(jira[p.projectId]);
    }
  };

  // Distinct PMs and statuses present, for the dropdown filters.
  const pmOptions = [...new Set(projects.map(p => getPmName(p.pmId)))].sort((a, b) => a.localeCompare(b));
  const statusOptions = [...new Set(projects.map(p => p.status))];
  // Built from the Epics actually loaded rather than hardcoded: the PL workflow's status
  // names are configured in Jira and would drift out of sync with any list kept here.
  // "Not on Jira" is appended only when some project really has no Epic.
  const jiraOptions = (() => {
    const present = [...new Set(projects.map(p => jira[p.projectId]?.issue?.status).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b));
    const anyMissing = projects.some(p => jira[p.projectId] && !jira[p.projectId].issue);
    return anyMissing ? [...present, JIRA_NOT_FOUND_LABEL] : present;
  })();

  const setFilter = (key: ProjectColKey, value: string) =>
    setColFilters(prev => ({ ...prev, [key]: value }));

  const categoryById = new Map(categories.map(c => [c.id, c]));

  /** A project matches a picked L1/L2 node when its own L3 category rolls up under it. */
  const matchesCategoryFilter = (p: Project): boolean => {
    if (!categoryFilter) return true;
    if (!p.categoryId) return false;
    if (categoryFilter.level === 'l3') return p.categoryId === categoryFilter.id;
    const own = categoryById.get(p.categoryId);
    if (categoryFilter.level === 'l2') return own?.l2Id === categoryFilter.id;
    return own?.l1Id === categoryFilter.id;
  };

  const onSort = (key: ProjectColKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  // Search + archived toggle only — shared base for both views.
  // RLS policies on the database handle PM access control server-side.
  const searchFiltered = projects.filter(p => {
    if (!showArchived && p.status === ProjectOverallStatus.ARCHIVED) return false;
    if (showArchived && p.status !== ProjectOverallStatus.ARCHIVED) return false;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.projectId.toLowerCase().includes(q)) return false;
    }

    // PM and Category are top-bar filters, so they apply to the board as well as the table —
    // the table's own PM column filter below reads/writes this same colFilters.pm state.
    if (colFilters.pm && colFilters.pm !== 'all' && getPmName(p.pmId).toLowerCase() !== colFilters.pm.toLowerCase()) return false;
    if (!matchesCategoryFilter(p)) return false;

    return true;
  });

  const filteredProjects = searchFiltered
    .filter(p => {
      // Per-column filters. Status/PM are exact-match dropdowns ('all' = no filter); the rest are substring.
      for (const key of ['name', 'projectId', 'pm', 'supplier', 'step', 'status', 'jira'] as ProjectColKey[]) {
        const f = colFilters[key];
        if (!f || f === 'all') continue;
        const v = colValue(p, key).toLowerCase();
        if (key === 'status' || key === 'pm' || key === 'jira') { if (v !== f.toLowerCase()) return false; }
        else if (!v.includes(f.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'step') return (phaseNumber(a) - phaseNumber(b)) * dir;
      return colValue(a, sortKey).localeCompare(colValue(b, sortKey), undefined, { numeric: true }) * dir;
    });

  // The board's five buckets are fixed and always all rendered, in order, however empty —
  // see project-board-buckets.ts. Archived projects still get their own single-column board
  // via the same "Show Archived" toggle the table uses.
  const kanbanProjects = [...searchFiltered].sort((a, b) => a.name.localeCompare(b.name));
  const projectsByBucket = BOARD_BUCKETS.reduce<Record<string, Project[]>>((acc, bucket) => {
    acc[bucket.id] = kanbanProjects.filter(p => bucketOf(p, chapters[p.id] ?? []) === bucket.id);
    return acc;
  }, {});

  /**
   * Drop a card onto a column. The move is applied optimistically to both the project and its
   * chapters, and rolled back as a pair if either write fails — a card that moved on screen
   * while the chapter statuses stayed put would make the board disagree with the project page.
   */
  const handleKanbanDrop = async (target: BoardBucketId) => {
    const id = dragProjectId;
    setDragProjectId(null);
    setDragOverBucket(null);
    if (!id) return;
    const project = projects.find(p => p.id === id);
    if (!project) return;

    const prevChapters = chapters[id] ?? [];
    const drop = planBucketDrop(project, prevChapters, target);
    if (drop.kind === 'noop') return;
    if (drop.kind === 'unsupported') { setErrorMsg(drop.reason); return; }

    setErrorMsg('');
    const moved = { ...project };
    if (drop.status !== null) moved.status = drop.status;
    if (drop.currentStep !== null) moved.currentStep = drop.currentStep;
    const movedChapters = prevChapters.map(c => {
      const write = drop.steps.find(s => s.id === c.id);
      return write ? { ...c, status: write.status } : c;
    });

    setProjects(prev => prev.map(p => (p.id === id ? moved : p)));
    setChapters(prev => ({ ...prev, [id]: movedChapters }));
    try {
      if (drop.steps.length > 0) await setStepStatuses(drop.steps);
      if (drop.status !== null || drop.currentStep !== null) {
        await updateProject(id, {
          ...(drop.status !== null ? { status: drop.status } : {}),
          ...(drop.currentStep !== null ? { currentStep: drop.currentStep } : {}),
        });
      }
    } catch (e: any) {
      setProjects(prev => prev.map(p => (p.id === id ? project : p)));
      setChapters(prev => ({ ...prev, [id]: prevChapters }));
      setErrorMsg(e.message || 'Failed to move the project.');
    }
  };

  // Fall back to the old narrow count only when the page renders outside the app shell.
  const reviewCount = inboxCtx?.inbox.reviewCount ?? stats?.pendingReviews ?? 0;
  const waitingCount = inboxCtx?.inbox.waitingCount ?? 0;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  /**
   * One card on the board, shared by the pipeline columns and the archived board.
   *
   * The badge is the point of the card: in a pipeline column it is the status of the chapter
   * that column stands for, straight off the project page, so the board answers "how is the
   * RFQ going" and not just "it is in RFQ". Live and Cancelled / On Hold are not chapters, so
   * their cards show the overall status instead, with the chapter reached named underneath.
   */
  const renderBoardCard = (project: Project, draggable: boolean) => {
    const chapter = activeChapter(project);
    const bucket = bucketOf(project, chapters[project.id] ?? []);
    const inPipeline = bucket === 'rfq' || bucket === 'development' || bucket === 'production';
    return (
      <div
        key={project.id}
        draggable={draggable}
        onDragStart={(e) => { setDragProjectId(project.id); e.dataTransfer.setData('text/plain', project.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { setDragProjectId(null); setDragOverBucket(null); }}
        className={`bg-white border border-gray-200 rounded-lg p-3 hover:border-indigo-300 hover:shadow-sm transition-all ${
          draggable ? 'cursor-grab active:cursor-grabbing' : ''
        } ${dragProjectId === project.id ? 'opacity-50' : ''}`}
      >
        <div className="font-bold text-primary text-sm mb-1">{project.name}</div>
        <div className="text-[11px] text-muted font-mono mb-2">{project.projectId}</div>
        <div className="flex items-center justify-between text-xs text-gray-500 mb-2 gap-2">
          <span className="truncate">{getPmName(project.pmId)}</span>
          {inPipeline && chapter ? (
            <span className="flex-shrink-0" title={`Phase ${chapter.stepNumber}: ${chapter.name}`}>
              <StatusBadge status={chapter.status} type="step" />
            </span>
          ) : (
            <span className="flex-shrink-0">
              <StatusBadge status={project.status} type="project" />
            </span>
          )}
        </div>
        {!inPipeline && chapter && (
          <div className="text-[11px] text-muted truncate mb-2">Phase {chapter.stepNumber} · {chapter.name}</div>
        )}
        <div className="text-xs text-gray-500 truncate mb-2">{getSupplierName(project.supplierId)}</div>
        {jiraConfigured && (
          <div className="mb-2">
            <JiraStatusBadge lookup={jira[project.projectId]} loading={jiraLoading && !jira[project.projectId]} />
          </div>
        )}
        <div className="flex justify-end pt-1 border-t border-gray-100">
          <Link
            to={`/project/${project.id}`}
            className="inline-flex items-center text-indigo-600 hover:text-blue-800 text-xs font-bold gap-0.5"
          >
            View <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-primary mb-1">Projects Dashboard</h1>
          <p className="text-sm text-muted">Overview of your product pipeline.</p>
        </div>
        {!showArchived && stats && stats.overdueCount > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2 flex items-center gap-3 animate-pulse shadow">
            <AlertCircle className="text-rose-600" size={20} />
            <span className="text-sm font-bold text-rose-700">{stats.overdueCount} Critical Overdue Task{stats.overdueCount !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 px-4 py-2 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">
          {errorMsg}
        </div>
      )}

      {/* ACTION WIDGETS */}
      {stats && !showArchived && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="p-6 flex items-center justify-between group hover:border-indigo-300 transition-colors">
            <div>
              <p className="text-sm font-medium text-muted mb-1">Active Projects</p>
              <h3 className="text-3xl font-bold text-primary">{stats.activeProjects}</h3>
            </div>
            <div className="p-4 bg-indigo-50 rounded-full text-indigo-600 group-hover:scale-110 transition-transform">
              <LayoutIcon size={24} />
            </div>
          </Card>

          {/* Open work, from the inbox snapshot. The old number here counted only
              project_documents at status 'uploaded' — one of six places a supplier can
              answer — so it read 0 while TCF responses, attribute submissions and new
              proposals were all waiting. Clicking opens the drawer that lists them. */}
          <Card
            role={inboxCtx ? 'button' : undefined}
            tabIndex={inboxCtx ? 0 : undefined}
            onClick={() => inboxCtx?.openInbox()}
            onKeyDown={(e) => {
              if (!inboxCtx) return;
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inboxCtx.openInbox(); }
            }}
            aria-label={inboxCtx ? 'Open project inbox' : undefined}
            className={`p-6 flex items-center justify-between group transition-colors hover:border-indigo-200 ${
              inboxCtx ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent' : ''
            }`}
          >
            <div>
              <p className="text-sm font-medium text-muted mb-1">Awaiting Your Review</p>
              <h3 className="text-3xl font-bold text-primary">{reviewCount}</h3>
              {reviewCount > 0 && (
                 <p className="text-xs text-amber-700 font-medium mt-1">Supplier has responded</p>
              )}
              {waitingCount > 0 && (
                 <p className="text-xs text-muted mt-1">{waitingCount} awaiting supplier</p>
              )}
            </div>
            <div className={`p-4 rounded-full group-hover:scale-110 transition-transform ${reviewCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-light text-gray-400'}`}>
              <FileText size={24} />
            </div>
          </Card>

          <Card className="p-6 flex items-center justify-between group hover:border-rose-200 transition-colors">
            <div>
              <p className="text-sm font-medium text-muted mb-1">Overdue Items</p>
              <h3 className={`text-3xl font-bold ${stats.overdueCount > 0 ? 'text-rose-600' : 'text-primary'}`}>{stats.overdueCount}</h3>
              {stats.overdueCount > 0 && (
                <p className="text-xs text-rose-600 font-bold mt-1">Immediate Action</p>
              )}
            </div>
            <div className={`p-4 rounded-full group-hover:scale-110 transition-transform ${stats.overdueCount > 0 ? 'bg-rose-50 text-rose-600' : 'bg-light text-gray-400'}`}>
              <AlertTriangle size={24} />
            </div>
          </Card>

          <Card className="p-5 flex flex-col group hover:border-indigo-300 transition-colors">
            <div className="flex items-center justify-between mb-3">
               <p className="text-sm font-medium text-muted flex items-center gap-1">
                 <Clock size={14} /> Near Deadlines (14d)
               </p>
               <span className={`text-xs px-2 py-0.5 rounded-full ${stats.upcomingDeadlines.length > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                 {stats.upcomingDeadlines.length}
               </span>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[80px] space-y-2 pr-1 custom-scrollbar">
              {stats.upcomingDeadlines.length === 0 ? (
                <div className="text-xs text-gray-400 italic py-2">No immediate deadlines.</div>
              ) : (
                stats.upcomingDeadlines.map(d => (
                  <Link key={d.id} to={d.type === 'tcf' ? `/compliance/request/${d.id}` : `/project/${d.projectId}`} className="flex items-start justify-between group/item cursor-pointer hover:bg-light p-1 rounded transition-colors">
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="text-[10px] font-bold text-gray-700 truncate group-hover/item:text-indigo-600">{d.title}</div>
                      <div className="text-[8px] text-gray-400 truncate uppercase tracking-tight">{d.projectName}</div>
                    </div>
                    <div className={`text-[9px] font-bold whitespace-nowrap flex flex-col items-end ${d.daysLeft < 0 ? 'text-rose-600 font-black' : d.daysLeft < 3 ? 'text-amber-600' : 'text-gray-600'}`}>
                      <span>{formatDate(d.deadline)}</span>
                      <span className="text-[8px] font-normal opacity-80 uppercase">
                        {d.daysLeft === 0 ? 'Today' : d.daysLeft < 0 ? 'Overdue' : `${d.daysLeft}d left`}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4 mb-6 flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center w-full lg:w-auto lg:flex-1">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search projects or IDs..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <select
            value={colFilters.pm}
            onChange={(e) => setFilter('pm', e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All PMs</option>
            {pmOptions.map(pm => <option key={pm} value={pm}>{pm}</option>)}
          </select>
          <CategoryTreeFilter categories={categories} value={categoryFilter} onChange={setCategoryFilter} />
          {(colFilters.pm || categoryFilter) && (
            <button
              type="button"
              onClick={() => { setFilter('pm', ''); setCategoryFilter(null); }}
              className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="flex gap-2 w-full lg:w-auto items-center">
          <div className="flex items-center bg-light border border-gray-200 rounded-lg p-0.5 mr-2">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              aria-pressed={viewMode === 'kanban'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'kanban' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <LayoutGrid size={15} /> Board
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'table' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Table2 size={15} /> Table
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer mr-2 select-none">
             <input 
               type="checkbox" 
               checked={showArchived} 
               onChange={(e) => { setShowArchived(e.target.checked); setActiveDropdown(null); }} 
               className="rounded text-indigo-600"
             />
             Show Archived
          </label>
          <Link 
            to="/create"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow transition-all hover:scale-105"
          >
            + New Project
          </Link>
        </div>
      </Card>

      {/* Board — default view. Five fixed pipeline columns, in order, always all present. */}
      {viewMode === 'kanban' && (
        loading ? (
          <Card className="p-12 flex flex-col items-center gap-2 text-muted">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span>Loading projects...</span>
          </Card>
        ) : showArchived ? (
          // Archived keeps a board of its own: its cards have left the pipeline, so the five
          // columns say nothing about them, and there is nowhere on it to drop a card.
          <div className="flex gap-4 overflow-x-auto pb-2">
            <div className="flex-shrink-0 w-80 rounded-xl border border-gray-200 bg-light">
              <div className="px-4 py-3 flex items-center justify-between border-b border-gray-200">
                <span className="text-sm font-bold text-primary">Archived</span>
                <span className="text-xs font-semibold text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5">
                  {kanbanProjects.length}
                </span>
              </div>
              <div className="p-3 space-y-3 min-h-[140px] max-h-[calc(100vh-360px)] overflow-y-auto">
                {kanbanProjects.length === 0 ? (
                  <div className="text-xs text-gray-400 italic text-center py-6">No archived projects</div>
                ) : kanbanProjects.map(project => renderBoardCard(project, false))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {kanbanProjects.length === 0 && (
              <p className="mb-3 text-sm text-muted flex items-center gap-2">
                <Search size={14} /> No projects match these filters — the pipeline is shown empty.
              </p>
            )}
            <div className="flex gap-4 overflow-x-auto pb-2">
              {BOARD_BUCKETS.map(bucket => {
                const items = projectsByBucket[bucket.id] ?? [];
                return (
                  <div
                    key={bucket.id}
                    onDragOver={(e) => { e.preventDefault(); setDragOverBucket(bucket.id); }}
                    onDragLeave={() => setDragOverBucket(prev => (prev === bucket.id ? null : prev))}
                    onDrop={(e) => { e.preventDefault(); void handleKanbanDrop(bucket.id); }}
                    className={`flex-shrink-0 w-80 rounded-xl border transition-colors ${
                      dragOverBucket === bucket.id ? 'border-indigo-400 bg-indigo-50/40' : 'border-gray-200 bg-light'
                    }`}
                  >
                    <div className="px-4 py-3 flex items-center justify-between gap-2 border-b border-gray-200" title={bucket.hint}>
                      <span className="text-sm font-bold text-primary leading-tight">{bucket.label}</span>
                      <span className="text-xs font-semibold text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5 flex-shrink-0">
                        {items.length}
                      </span>
                    </div>
                    <div className="p-3 space-y-3 min-h-[140px] max-h-[calc(100vh-360px)] overflow-y-auto">
                      {items.length === 0 ? (
                        <div className="text-xs text-gray-400 italic text-center py-6">No projects</div>
                      ) : items.map(project => renderBoardCard(project, true))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )
      )}

      {/* Table */}
      {viewMode === 'table' && (
      <Card className="overflow-hidden min-h-[400px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-light border-b border-gray-200">
              <tr>
                <SortableTh label="Project" colKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableTh label="Project ID" colKey="projectId" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableTh label="PM" colKey="pm" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableTh label="Supplier" colKey="supplier" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableTh label="Current Step" colKey="step" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <SortableTh label="Status" colKey="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                {jiraConfigured && (
                  <th className="px-6 py-4 font-semibold text-gray-700">
                    <span className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onSort('jira')}
                        className={`inline-flex items-center gap-1 hover:text-indigo-600 transition-colors ${sortKey === 'jira' ? 'text-indigo-600' : ''}`}
                      >
                        Jira
                        {sortKey === 'jira' ? (sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ChevronsUpDown size={13} className="text-gray-300" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void refreshJira(projects)}
                        disabled={jiraLoading}
                        title={jiraError || 'Re-read every status from Jira now'}
                        className="text-gray-400 hover:text-indigo-600 disabled:opacity-40 transition-colors"
                      >
                        <RefreshCw size={13} className={jiraLoading ? 'animate-spin' : ''} />
                      </button>
                      {jiraError && <AlertTriangle size={13} className="text-amber-500" aria-label={jiraError} />}
                    </span>
                  </th>
                )}
                <th className="px-6 py-4 font-semibold text-gray-700"></th>
              </tr>
              {/* Per-column filter row */}
              <tr className="border-t border-gray-100 bg-white/60">
                <th className="px-6 py-2">
                  <input value={colFilters.name} onChange={e => setFilter('name', e.target.value)} placeholder="Filter…"
                    className="w-full font-normal border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                </th>
                <th className="px-6 py-2">
                  <input value={colFilters.projectId} onChange={e => setFilter('projectId', e.target.value)} placeholder="Filter…"
                    className="w-full font-normal border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                </th>
                <th className="px-6 py-2">
                  <select value={colFilters.pm} onChange={e => setFilter('pm', e.target.value)}
                    className="w-full font-normal border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
                    <option value="">All PMs</option>
                    {pmOptions.map(pm => <option key={pm} value={pm}>{pm}</option>)}
                  </select>
                </th>
                <th className="px-6 py-2">
                  <input value={colFilters.supplier} onChange={e => setFilter('supplier', e.target.value)} placeholder="Filter…"
                    className="w-full font-normal border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                </th>
                <th className="px-6 py-2">
                  <input value={colFilters.step} onChange={e => setFilter('step', e.target.value)} placeholder="Filter…"
                    className="w-full font-normal border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                </th>
                <th className="px-6 py-2">
                  <select value={colFilters.status} onChange={e => setFilter('status', e.target.value)}
                    className="w-full font-normal border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
                    <option value="all">All</option>
                    {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </th>
                {jiraConfigured && (
                  <th className="px-6 py-2">
                    <select value={colFilters.jira} onChange={e => setFilter('jira', e.target.value)}
                      className="w-full font-normal border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
                      <option value="all">All</option>
                      {jiraOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </th>
                )}
                <th className="px-6 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={jiraConfigured ? 8 : 7} className="px-6 py-12 text-center text-muted">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                      <span>Loading projects...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={jiraConfigured ? 8 : 7} className="px-6 py-12 text-center text-muted">
                    <div className="flex flex-col items-center gap-2 opacity-50">
                       <Search size={32} />
                       <span>No projects found.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProjects.map((project) => (
                  <tr key={project.id} className="hover:bg-light transition-colors group relative">
                    <td className="px-6 py-4">
                      <div className="font-bold text-primary">{project.name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs text-muted font-mono tracking-tight">{project.projectId}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {getPmName(project.pmId)}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {getSupplierName(project.supplierId)}
                    </td>
                    <td className="px-6 py-4">
                      {/* The chapter the project is actually working, same rule as the board. */}
                      <span
                        title={activeChapter(project)?.name}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100"
                      >
                        Step {phaseNumber(project)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={project.status} type="project" />
                    </td>
                    {jiraConfigured && (
                      <td className="px-6 py-4">
                        <JiraStatusBadge lookup={jira[project.projectId]} loading={jiraLoading && !jira[project.projectId]} />
                      </td>
                    )}
                    <td className="px-6 py-4 text-right">
                      <Link 
                        to={`/project/${project.id}`} 
                        className="inline-flex items-center text-indigo-600 hover:text-blue-800 font-bold px-3 py-1.5 rounded-xl hover:bg-indigo-50 transition-all gap-1"
                      >
                        View <ChevronRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      )}
    </Layout>
  );
};

export default PMDashboard;
