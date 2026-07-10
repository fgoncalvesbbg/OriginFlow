/** IM (Information Memorandum) dashboard: browse templates and project IMs. */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import {
  getCategories, getIMTemplates, createIMTemplate, updateIMTemplate, getAllProjectIMs,
  getStaleProjectIMDetails, republishProjectIM, stalenessKey
} from '../../services';
import type { StaleManual } from '../../services';
import type { ProjectIMSummary } from '../../services/im/project-im.service';
import { CategoryL3, IMTemplate, IMTemplateType, IM_TEMPLATE_TYPE_LABELS } from '../../types';
import {
  BookOpen, Plus, FileText, ArrowRight, CheckCircle2, Lock, Unlock,
  FileEdit, Search, Clock, Layers, AlertTriangle, Eye, RefreshCw, FileJson
} from 'lucide-react';
import { IMViewerTab } from './IMViewerTab';
import { ImImportDialog } from './ImImportDialog';
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

const STATUS_CONFIG = {
  generated: { label: 'Generated', classes: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  draft:     { label: 'Draft',     classes: 'bg-amber-100  text-amber-700  border-amber-200'  },
} as const;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

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
  // Published manuals whose source changed since publish, keyed by
  // `projectId::templateType` → drill-down reasons. Computed after mount.
  const [staleInfo, setStaleInfo] = useState<Map<string, StaleManual>>(new Map());
  // Bulk re-publish selection (by ProjectIMSummary id) + in-flight flag.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [republishing, setRepublishing] = useState(false);

  const refreshStaleness = () =>
    getStaleProjectIMDetails().then(setStaleInfo).catch(() => {});

  useEffect(() => {
    let active = true;
    getStaleProjectIMDetails().then(info => { if (active) setStaleInfo(info); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]));

  // Derive used categories for the filter dropdown
  const usedCatIds = [...new Set(ims.map(im => im.categoryId).filter(Boolean))] as string[];

  const isStale = (im: ProjectIMSummary) =>
    im.status === 'generated' && staleInfo.has(stalenessKey(im.projectId, im.templateType));
  const staleReasons = (im: ProjectIMSummary) =>
    staleInfo.get(stalenessKey(im.projectId, im.templateType))?.reasons ?? [];

  const filtered = ims.filter(im => {
    if (filterStatus === 'stale') { if (!isStale(im)) return false; }
    else if (filterStatus !== 'all' && im.status !== filterStatus) return false;
    if (filterCat !== 'all' && im.categoryId !== filterCat) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        im.projectName.toLowerCase().includes(q) ||
        (im.templateName ?? '').toLowerCase().includes(q) ||
        (im.categoryId ? catMap[im.categoryId] ?? '' : '').toLowerCase().includes(q) ||
        im.skus.some(s => s.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // Only published ('generated') manuals can be re-published.
  const selectableRows = filtered.filter(im => im.status === 'generated');
  const allSelected = selectableRows.length > 0 && selectableRows.every(im => selectedIds.has(im.id));
  const toggleRow = (id: string) =>
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(selectableRows.map(im => im.id)));

  const handleRepublishSelected = async () => {
    const targets = ims.filter(im => selectedIds.has(im.id));
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
            placeholder="Search by project, SKU, template or category…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="generated">Generated</option>
          <option value="draft">Draft</option>
          <option value="stale">Needs re-publish{staleInfo.size ? ` (${staleInfo.size})` : ''}</option>
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
      </div>

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

      {/* Empty */}
      {filtered.length === 0 && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl text-gray-400 bg-light">
          {ims.length === 0
            ? 'No manuals created yet. Open a project and generate its IM.'
            : 'No manuals match the current filters.'}
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 && (
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
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Template</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(im => {
                const sc = STATUS_CONFIG[im.status] ?? STATUS_CONFIG.draft;
                const catName = im.categoryId ? (catMap[im.categoryId] ?? '—') : '—';
                return (
                  <tr key={im.id} className="hover:bg-light/60 transition-colors group">
                    <td className="px-4 py-3">
                      {im.status === 'generated' && (
                        <input
                          type="checkbox"
                          className="accent-indigo-600 cursor-pointer"
                          checked={selectedIds.has(im.id)}
                          onChange={() => toggleRow(im.id)}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-800">{im.projectName}</span>
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
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${sc.classes}`}>
                          {im.status === 'generated' ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                          {sc.label}
                        </span>
                        {isStale(im) && (() => {
                          const reasons = staleReasons(im);
                          const blocks = reasons.filter(r => r.type === 'block').map(r => r.label);
                          const others = reasons.filter(r => r.type !== 'block').map(r => r.label);
                          const summary = [blocks.length ? `Block${blocks.length > 1 ? 's' : ''}: ${blocks.join(', ')}` : '', ...others].filter(Boolean).join(' · ');
                          return (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-orange-100 text-orange-700 border-orange-200"
                              title={`Changed since last publish — ${summary}. Re-publish to update.`}
                            >
                              <RefreshCw size={10} /> Needs re-publish
                            </span>
                          );
                        })()}
                      </div>
                      {isStale(im) && (() => {
                        const reasons = staleReasons(im);
                        const blocks = reasons.filter(r => r.type === 'block').map(r => r.label);
                        const others = reasons.filter(r => r.type !== 'block').map(r => r.label);
                        const summary = [blocks.length ? `block${blocks.length > 1 ? 's' : ''}: ${blocks.join(', ')}` : '', ...others.map(o => o.toLowerCase())].filter(Boolean).join(' · ');
                        return <div className="text-[10px] text-orange-600/80 mt-1 max-w-[220px] truncate" title={summary}>↳ {summary}</div>;
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
          </table>
        </div>
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
}

const TemplateRow: React.FC<TemplateRowProps> = ({
  category, type, template, creating, toggling, onCreate, onToggleFinalized
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
            <Link
              to={editorPath(category.id, type)}
              className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-blue-800"
            >
              Edit <ArrowRight size={14} />
            </Link>
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
  categories, templates, creatingId, togglingId, onCreate, onToggleFinalized, onImport
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
    </Layout>
  );
};

export default IMDashboard;
