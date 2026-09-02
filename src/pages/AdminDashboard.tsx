/** Admin dashboard page: user/role management and administrative overview. */
import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import {
  getProfiles, updateUserRole,
  getSuppliers, createSupplier, ensureSupplierToken, updateSupplier,
  getCategories, getCategoryTree, saveCategory,
  deleteCategory, assignPMToCategory,
  getCategoryAttributes, saveCategoryAttribute, deleteCategoryAttribute,
  importCategoryAttributes, replaceCategoryAttributes,
  getProductToolkitDefinitions, getProductToolkitDefinition, mapProductToolkitAttributes,
  planAttributeSync, applyAttributeSync, getAttributeUsage, usageTotal, resolvesToGlobal,
  ProductToolkitUnavailableError,
  unassignAttributeFromCategory, makeAttributeGlobal, assignAttributeToCategory,
  assignSupplierToPMs, getSupplierPMs,
  reassignProjectPM, getProjects, deleteProject,
  ATTRIBUTE_GROUPS, PREDEFINED_ATTRIBUTE_GROUPS, attributeGroupRank, groupsInOrder, compareAttributes,
  getAIPrompts, updateAIPrompt,
  getPromptLibrary, createPromptLibraryEntry, updatePromptLibraryEntry, deletePromptLibraryEntry,
  getTranslationVerbatims, createTranslationVerbatim, updateTranslationVerbatim, deleteTranslationVerbatim,
  getIMMarkets, saveIMMarket, deleteIMMarket
} from '../services';
import type { IMMarket, ReplaceAttributesResult, SyncPlan } from '../services';
import { generateUUID, getAttributesForCategory, parseAttributeCsv } from '../utils';
import type { ParsedAttributeRow } from '../utils';
import { distinctL1, distinctL2, filterCategories, UNCATEGORISED_LABEL } from '../utils/category-tree.utils';
import { User, UserRole, Supplier, CategoryL3, CategoryTree, CategoryAttribute, AttributeDataType, AIPrompt, PromptLibraryEntry, TranslationVerbatim } from '../types';
import { Users, Truck, ShieldCheck, Plus, CheckCircle, ChevronUp, ChevronDown, Link as LinkIcon, Edit2, ArrowLeft, Layers, Trash2, SlidersHorizontal, X, RefreshCw, Package, Search, Sparkles, Copy, ExternalLink, BookOpen, Upload, AlertTriangle, Globe, Loader2, Type, Languages, MessageSquarePlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { IM_LANGUAGES } from '../config/im-languages';
import { useRefetchOnFocus } from '../hooks';
import { ConfirmationModal } from '../components/common/ConfirmationModal';
import PrintSettingsAdminSection from '../components/admin/PrintSettingsAdminSection';
import TranslationMemoryAdmin from '../components/admin/translation-memory/TranslationMemoryAdmin';
import FeedbackAdminSection from '../components/admin/FeedbackAdminSection';

/**
 * Markets admin — the market → language mapping the print-export dialog offers as
 * one-click presets ("DACH → DE, EN"). Which languages a market's manuals must
 * include is a compliance decision, so it is maintained here by admins, not typed
 * ad hoc per export. Stored in im_markets (migration 107).
 */
const MarketsAdminSection: React.FC = () => {
  const [markets, setMarkets] = useState<IMMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // null = list view; 'new' or an IMMarket id = the edit form.
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<{ code: string; name: string; languages: string[] }>({ code: '', name: '', languages: [] });
  const [deleteTarget, setDeleteTarget] = useState<IMMarket | null>(null);

  const load = async () => {
    setLoading(true);
    try { setMarkets(await getIMMarkets()); }
    catch (e) { console.error('[AdminDashboard] loading markets failed:', e); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const startEdit = (m?: IMMarket) => {
    setEditing(m?.id ?? 'new');
    setForm(m ? { code: m.code, name: m.name, languages: [...m.languages] } : { code: '', name: '', languages: [] });
  };

  const toggleLang = (code: string) =>
    setForm(prev => ({
      ...prev,
      languages: prev.languages.includes(code) ? prev.languages.filter(l => l !== code) : [...prev.languages, code],
    }));

  const save = async () => {
    if (!form.code.trim() || !form.name.trim() || !form.languages.length || saving) return;
    setSaving(true);
    try {
      await saveIMMarket({
        id: editing === 'new' ? undefined : editing ?? undefined,
        code: form.code,
        name: form.name,
        languages: form.languages,
        sort: editing === 'new' ? markets.length : markets.find(m => m.id === editing)?.sort,
      });
      setEditing(null);
      await load();
    } catch (e: any) {
      alert(`Failed to save market: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteIMMarket(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      alert(`Failed to delete market: ${e?.message ?? e}`);
    }
  };

  return (
    <div>
      <div className="px-6 py-4 bg-light border-b border-gray-200 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-gray-800">Markets</h3>
          <p className="text-xs text-muted mt-0.5">
            Which languages each market's manuals must include. The print-export dialog offers these
            as one-click presets and records the chosen market on every generated PDF.
          </p>
        </div>
        <button onClick={() => startEdit()} className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700">
          <Plus size={15} /> Add market
        </button>
      </div>

      {editing !== null && (
        <div className="px-6 py-4 border-b border-gray-100 bg-indigo-50/40">
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Code (short, stable)</label>
              <input
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-32 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="DACH"
                value={form.code}
                onChange={e => setForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                disabled={editing !== 'new'}
                title={editing !== 'new' ? 'The code is stamped on existing render history — it cannot be changed' : undefined}
              />
            </div>
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Name</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Germany / Austria / Switzerland"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
          </div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Languages this market's manuals must include</label>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {IM_LANGUAGES.map(l => {
              const on = form.languages.includes(l.code);
              return (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => toggleLang(l.code)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}
                  title={l.name}
                >{l.code.toUpperCase()}</button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || !form.code.trim() || !form.name.trim() || !form.languages.length}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} {editing === 'new' ? 'Create market' : 'Save changes'}
            </button>
            <button onClick={() => setEditing(null)} disabled={saving} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="px-6 py-10 text-center text-gray-400 text-sm">Loading markets…</div>
      ) : markets.length === 0 ? (
        <div className="px-6 py-10 text-center text-gray-400 text-sm">
          No markets configured yet. Add one — e.g. code <span className="font-mono">DACH</span> with DE + EN —
          and the print-export dialog will offer it as a preset.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-light border-b border-gray-100">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Languages</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {markets.map(m => (
              <tr key={m.id} className="hover:bg-light/60">
                <td className="px-6 py-3 font-mono font-bold text-gray-800">{m.code}</td>
                <td className="px-4 py-3 text-gray-700">{m.name}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {m.languages.map(l => (
                      <span key={l} className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">{l}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(m)} title="Edit" className="p-1.5 text-gray-400 hover:text-indigo-600"><Edit2 size={15} /></button>
                  <button onClick={() => setDeleteTarget(m)} title="Delete" className="p-1.5 text-gray-400 hover:text-rose-600"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmationModal
        variant="danger"
        isOpen={!!deleteTarget}
        title={`Delete market ${deleteTarget?.code}?`}
        message="Existing render-history rows keep their market stamp; only the preset disappears from the print dialog."
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

const AdminDashboard: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'users' | 'suppliers' | 'categories' | 'projects' | 'prompts' | 'markets' | 'imPrint' | 'translationMemory' | 'feedback'>('users');
  const [refreshing, setRefreshing] = useState(false);

  // Core Data
  const [users, setUsers] = useState<User[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [attributes, setAttributes] = useState<CategoryAttribute[]>([]);

  // The L1/L2 parent levels, for the table filters and the category modal's parent picker.
  const [categoryTree, setCategoryTree] = useState<CategoryTree>({ l1: [], l2: [] });

  // Category table filters. At ~130 leaves the list is only navigable filtered, so these
  // drive the table directly rather than being a cosmetic extra.
  const [catSearch, setCatSearch] = useState('');
  const [catL1, setCatL1] = useState('');
  const [catL2, setCatL2] = useState('');
  const [catShowInactive, setCatShowInactive] = useState(false);
  const [aiPrompts, setAIPrompts] = useState<AIPrompt[]>([]);

  // AI Prompt Editing State
  const [editingPrompt, setEditingPrompt] = useState<AIPrompt | null>(null);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  // Prompt Library State — user-saved prompts for use in Claude chat outside the app.
  const [promptLibrary, setPromptLibrary] = useState<PromptLibraryEntry[]>([]);
  const [editingLibEntry, setEditingLibEntry] = useState<{ id?: string; title: string; description: string; promptText: string } | null>(null);
  const [savingLibEntry, setSavingLibEntry] = useState(false);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  // Translation Verbatims State — regulation phrases with official per-language
  // wording; translation substitutes the stored wording instead of translating.
  const [verbatims, setVerbatims] = useState<TranslationVerbatim[]>([]);
  const [editingVerbatim, setEditingVerbatim] = useState<{ id?: string; phrase: string; note: string; translations: Record<string, string> } | null>(null);
  const [savingVerbatim, setSavingVerbatim] = useState(false);
  
  // Forms & UI State
  const [newSupName, setNewSupName] = useState('');
  const [newSupCode, setNewSupCode] = useState('');
  const [newSupEmail, setNewSupEmail] = useState('');
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedSupplierForPMAssignment, setSelectedSupplierForPMAssignment] = useState<string | null>(null);
  const [selectedPMsForSupplier, setSelectedPMsForSupplier] = useState<string[]>([]);
  const [pmAssignmentModalOpen, setPMAssignmentModalOpen] = useState(false);
  const [projectReassignmentModalOpen, setProjectReassignmentModalOpen] = useState(false);
  const [selectedProjectForReassignment, setSelectedProjectForReassignment] = useState<any>(null);
  const [newPMIdForProject, setNewPMIdForProject] = useState<string>('');

  // Category/Attribute Editing State
  const [selectedCategoryDetail, setSelectedCategoryDetail] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'category' | 'attribute' | 'supplier'>('category');
  const [editingItem, setEditingItem] = useState<any>(null);
  const [enumOptionsDraft, setEnumOptionsDraft] = useState<string>('');

  // Delete Modal State
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  // Assign Attribute Modal State
  const [assignAttrModal, setAssignAttrModal] = useState(false);
  const [assignAttrSearch, setAssignAttrSearch] = useState('');
  const [assigningAttrId, setAssigningAttrId] = useState<string | null>(null);
  // "Link an attribute from another category into this one" modal (shared assignment, no duplication).
  const [linkAttrModal, setLinkAttrModal] = useState(false);
  const [linkAttrSearch, setLinkAttrSearch] = useState('');
  const [linkingAttrId, setLinkingAttrId] = useState<string | null>(null);

  // "Import attributes from CSV" modal — bulk-create attributes for the open category.
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<ParsedAttributeRow[]>([]);
  const [importIncluded, setImportIncluded] = useState<boolean[]>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // Where the preview rows came from. Both sources produce ParsedAttributeRow[] and share
  // the preview grid and the importCategoryAttributes write path below.
  const [importSource, setImportSource] = useState<'csv' | 'producttoolkit'>('csv');
  const [ptLoading, setPtLoading] = useState(false);
  const [ptNotice, setPtNotice] = useState<string | null>(null);
  // ProductToolkit categories that match no OriginFlow category by name. Worth surfacing:
  // a definition nobody can reach is invisible otherwise.
  const [ptUnmatched, setPtUnmatched] = useState<string[] | null>(null);
  // 'add' leaves what is already here alone; 'replace' treats the source as the truth and
  // clears this category's own attributes first. See replaceCategoryAttributes.
  const [importMode, setImportMode] = useState<'add' | 'replace'>('add');
  // Replace normally leaves global attributes alone. This opts into deleting the ones this
  // import does not mention too — which removes them from EVERY category, not just this one.
  const [replaceIncludeGlobals, setReplaceIncludeGlobals] = useState(false);
  // Reviewed ProductToolkit sync: the computed plan, which items are ticked, and any
  // reviewer remaps (incoming key -> existing attribute id, '' = force new).
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [syncIncluded, setSyncIncluded] = useState<Set<string>>(new Set());
  const [syncRemap, setSyncRemap] = useState<Record<string, string>>({});
  const [syncBusy, setSyncBusy] = useState(false);

  /**
   * Every group offerable in a picker: OriginFlow's built-ins plus whatever groups the data
   * actually uses. ProductToolkit clusters arrive as groups verbatim, so without this a synced
   * attribute's own group would be missing from its dropdown and silently reset on edit.
   */
  const allGroupOptions = React.useMemo(() => {
    const set = new Set<string>(ATTRIBUTE_GROUPS as readonly string[]);
    for (const a of attributes) if (a.group) set.add(a.group);
    return [...set];
  }, [attributes]);

  // Bulk grid editor for the open category's attributes.
  const [attrView, setAttrView] = useState<'list' | 'grid'>('list');
  const [gridRows, setGridRows] = useState<CategoryAttribute[]>([]);
  const [gridOptionsText, setGridOptionsText] = useState<Record<string, string>>({});
  const [gridDirty, setGridDirty] = useState<Set<string>>(new Set());
  const [gridSaving, setGridSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [u, s, c, tree, a, p, ai, lib, verbs] = await Promise.all([
      getProfiles(),
      getSuppliers(),
      getCategories(),
      getCategoryTree(),
      getCategoryAttributes(),
      getProjects(),
      getAIPrompts(),
      getPromptLibrary(),
      getTranslationVerbatims()
    ]);
    setUsers(u);
    setSuppliers(s);
    setCategories(c);
    setCategoryTree(tree);
    setAttributes(a);
    setProjects(p);
    setAIPrompts(ai);
    setPromptLibrary(lib);
    setVerbatims(verbs);
  };

  useRefetchOnFocus(loadData);

  // Rebuild the grid editor's working copy from the loaded attributes whenever the open
  // category or the underlying data changes — but not while the user has unsaved edits
  // (so a background refetch never clobbers in-progress changes).
  useEffect(() => {
    if (!selectedCategoryDetail) return;
    if (gridDirty.size > 0) return;
    const rows = getAttributesForCategory(attributes, selectedCategoryDetail)
      .slice()
      .sort(compareAttributes);
    setGridRows(rows.map(r => ({ ...r, validationRules: { ...(r.validationRules ?? {}) } })));
    setGridOptionsText(Object.fromEntries(rows.map(r => [r.id, (r.validationRules?.enumOptions ?? []).join(', ')])));
  }, [attributes, selectedCategoryDetail, gridDirty.size]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } catch (err) {
      console.error('Error refreshing data:', err);
    } finally {
      setRefreshing(false);
    }
  };

  // --- USER ACTIONS ---
  const toggleRole = async (userId: string, currentRole: UserRole) => {
    if (currentUser?.id === userId) {
        alert("You cannot change your own role to prevent accidental lockout.");
        return;
    }
    const newRole = currentRole === UserRole.ADMIN ? UserRole.PM : UserRole.ADMIN;
    await updateUserRole(userId, newRole);
    loadData();
  };

  // --- SUPPLIER ACTIONS ---
  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    await createSupplier(newSupName, newSupCode, newSupEmail);
    setNewSupName(''); setNewSupCode(''); setNewSupEmail('');
    loadData();
  };
  
  const handleCopyPortalLink = async (supplier: Supplier) => {
    try {
        const token = await ensureSupplierToken(supplier.id);
        if (token !== supplier.portalToken) {
           setSuppliers(prev => prev.map(s => s.id === supplier.id ? { ...s, portalToken: token } : s));
        }
        const baseUrl = window.location.href.split('#')[0];
        const url = `${baseUrl}#/supplier-dashboard/${token}`;
        navigator.clipboard.writeText(url);
        setCopiedTokenId(supplier.id);
        setTimeout(() => setCopiedTokenId(null), 2000);
    } catch (e: any) {
         console.error("Failed to get token", e);
         const msg = e.message || (typeof e === 'object' ? JSON.stringify(e) : String(e));
         alert(`Error generating token: ${msg}`);
    }
  };

  // --- PM ASSIGNMENT ACTIONS ---
  const openPMAssignmentModal = async (supplierId: string) => {
    setSelectedSupplierForPMAssignment(supplierId);
    const pms = await getSupplierPMs(supplierId);
    setSelectedPMsForSupplier(pms.map(p => p.id));
    setPMAssignmentModalOpen(true);
  };

  const handleSavePMAssignment = async () => {
    if (!selectedSupplierForPMAssignment) return;
    try {
      await assignSupplierToPMs(selectedSupplierForPMAssignment, selectedPMsForSupplier);
      setPMAssignmentModalOpen(false);
      setSelectedSupplierForPMAssignment(null);
      setSelectedPMsForSupplier([]);
      loadData();
      alert('PM assignments updated successfully');
    } catch (e: any) {
      alert(`Error saving PM assignments: ${e.message}`);
    }
  };

  const handleReassignProject = async (projectId: string, newPmId: string) => {
    try {
      await reassignProjectPM(projectId, newPmId);
      loadData();
      setProjectReassignmentModalOpen(false);
      setSelectedProjectForReassignment(null);
      setNewPMIdForProject('');
      alert('Project reassigned successfully');
    } catch (e: any) {
      alert(`Error reassigning project: ${e.message}`);
    }
  };

  const openProjectReassignmentModal = (project: any) => {
    setSelectedProjectForReassignment(project);
    setNewPMIdForProject(project.pmId);
    setProjectReassignmentModalOpen(true);
  };

  const handleDeleteProject = (proj: any) => {
    setDeleteModal({
      isOpen: true,
      title: 'Delete Project',
      message: `Permanently delete "${proj.name}" (${proj.projectId})? This also deletes all linked SKUs, attribute requests, compliance requests, instruction manuals, documents and history. This cannot be undone.`,
      onConfirm: async () => {
        try {
          await deleteProject(proj.id);
          await loadData();
        } catch (e: any) {
          alert(`Failed to delete project: ${e.message}`);
        }
        setDeleteModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // --- CATEGORY & ATTRIBUTE ACTIONS ---
  const openAddModal = (type: 'category' | 'attribute', group?: string) => {
    setModalType(type);
    if (type === 'category') {
      // Prefill the parent from the active L2 filter — adding a category is nearly always
      // done from the family you are already looking at.
      const filteredL2 = categoryTree.l2.find(l2 =>
        l2.name === catL2 &&
        (!catL1 || categoryTree.l1.find(l1 => l1.id === l2.l1Id)?.name === catL1));
      setEditingItem({ name: '', active: true, isFinalized: false, l2Id: filteredL2?.id ?? null });
    } else {
        if (!selectedCategoryDetail) return;
        const isPredefined = !!group && PREDEFINED_ATTRIBUTE_GROUPS.includes(group);
        setEditingItem({ name: '', categoryId: isPredefined ? null : selectedCategoryDetail, dataType: 'text', validationRules: {}, group: group ?? 'Category Specific' });
        setEnumOptionsDraft('');
    }
    setIsModalOpen(true);
  };

  const handleEditItem = (item: any, type: 'category' | 'attribute' | 'supplier') => {
    setModalType(type);
    setEditingItem({ ...item });
    if (type === 'attribute') {
      setEnumOptionsDraft((item.validationRules?.enumOptions ?? []).join('\n'));
    }
    setIsModalOpen(true);
  };

  const handleDeleteCategory = (id: string) => {
    setDeleteModal({
      isOpen: true,
      title: 'Delete Category',
      message: 'Are you sure you want to delete this category? This will permanently delete all associated requirements, features, attributes, and templates.',
      onConfirm: async () => {
        try {
          await deleteCategory(id);
          loadData();
        } catch (e: any) {
          alert(`Failed to delete category: ${e.message}`);
        }
        setDeleteModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteAttribute = (id: string) => {
    const attr = attributes.find(a => a.id === id);
    const sharedWith = (attr?.assignedCategoryIds ?? [])
      .map(catId => categories.find(c => c.id === catId)?.name)
      .filter(Boolean) as string[];

    if (sharedWith.length > 0) {
      setDeleteModal({
        isOpen: true,
        title: 'Remove Attribute',
        message: `This attribute is also used in: ${sharedWith.join(', ')}. It will be removed from this category but kept in the others.`,
        onConfirm: async () => {
          try {
            const [newHomeId, ...remaining] = attr!.assignedCategoryIds!;
            await saveCategoryAttribute({ ...attr!, categoryId: newHomeId, assignedCategoryIds: remaining });
            loadData();
          } catch (e: any) {
            alert(`Failed to remove attribute: ${e.message}`);
          }
          setDeleteModal(prev => ({ ...prev, isOpen: false }));
        }
      });
    } else {
      setDeleteModal({
        isOpen: true,
        title: 'Delete Attribute',
        message: 'Are you sure you want to delete this attribute?',
        onConfirm: async () => {
          try {
            await deleteCategoryAttribute(id);
            loadData();
          } catch (e: any) {
            alert(`Failed to delete attribute: ${e.message}`);
          }
          setDeleteModal(prev => ({ ...prev, isOpen: false }));
        }
      });
    }
  };

  const openAssignModal = () => {
    setAssignAttrSearch('');
    setAssigningAttrId(null);
    setAssignAttrModal(true);
  };

  const handleAssignAttribute = async (attributeId: string) => {
    setAssigningAttrId(attributeId);
    try {
      // Promote the attribute to global: it keeps its group and applies to every category.
      await makeAttributeGlobal(attributeId);
      await loadData();
      setAssignAttrModal(false);
    } catch (e: any) {
      alert(`Failed to assign attribute: ${e.message}`);
    }
    setAssigningAttrId(null);
  };

  const handleUnassignAttribute = async (attributeId: string) => {
    if (!selectedCategoryDetail) return;
    try {
      await unassignAttributeFromCategory(attributeId, selectedCategoryDetail);
      loadData();
    } catch (e: any) {
      alert(`Failed to unlink attribute: ${e.message}`);
    }
  };

  const openLinkModal = () => {
    setLinkAttrSearch('');
    setLinkingAttrId(null);
    setLinkAttrModal(true);
  };

  // Share an attribute owned by another category into the current one (adds this category to
  // its assignedCategoryIds — no duplicate row is created; edits stay in sync across categories).
  const handleLinkAttribute = async (attributeId: string) => {
    if (!selectedCategoryDetail) return;
    setLinkingAttrId(attributeId);
    try {
      await assignAttributeToCategory(attributeId, selectedCategoryDetail);
      await loadData();
      setLinkAttrModal(false);
    } catch (e: any) {
      alert(`Failed to link attribute: ${e.message}`);
    }
    setLinkingAttrId(null);
  };

  // --- CSV ATTRIBUTE IMPORT ---
  const openImportModal = () => {
    setImportRows([]);
    setImportIncluded([]);
    setImportFileName('');
    setImportError(null);
    setImporting(false);
    setImportSource('csv');
    setImportMode('add');
    setReplaceIncludeGlobals(false);
    setSyncPlan(null);
    setSyncIncluded(new Set());
    setSyncRemap({});
    setPtNotice(null);
    setPtUnmatched(null);
    setImportModalOpen(true);
  };

  /**
   * Build (or rebuild, after a remap) the sync plan for the open category: fetch the live
   * definition, ask the database what currently depends on each attribute, and diff.
   * Nothing is written here — this only produces the review.
   */
  const buildSyncPlan = async (remap: Record<string, string> = syncRemap) => {
    const target = categories.find(c => c.id === selectedCategoryDetail);
    if (!target) return;
    setSyncBusy(true);
    setImportError(null);
    setPtNotice(null);
    try {
      const attrs = await getProductToolkitDefinition(target.name);
      if (attrs === null) {
        setSyncPlan(null);
        setPtNotice(`ProductToolkit has no definition loaded for "${target.name}".`);
        return;
      }
      const incoming = mapProductToolkitAttributes(attrs);
      const applies = getAttributesForCategory(attributes, target.id);
      const usage = await getAttributeUsage(applies.map(a => a.id));
      const plan = planAttributeSync(applies, incoming, usage, target.id, remap);
      setSyncPlan(plan);
      // Default: everything that would change, except anything flagged breaking — those are
      // opt-in, so a careless Apply cannot strand data.
      setSyncIncluded(new Set(
        plan.items
          .filter(i => (i.action === 'create' || i.action === 'update')
            && !i.risks.some(r => r.level === 'breaking'))
          .map(i => i.key),
      ));
    } catch (err: any) {
      setSyncPlan(null);
      setImportError(
        err instanceof ProductToolkitUnavailableError ? err.message : `Could not build the sync plan: ${err.message}`,
      );
    } finally {
      setSyncBusy(false);
    }
  };

  const setRemap = (key: string, existingId: string) => {
    const next = { ...syncRemap };
    if (existingId === '__auto__') delete next[key]; else next[key] = existingId;
    setSyncRemap(next);
    void buildSyncPlan(next); // re-plan so risks and counts reflect the correction
  };

  /** Newline for the confirm() text; a literal one inside a template string breaks the file. */
  const NL = String.fromCharCode(10);

  const handleApplySync = async () => {
    if (!syncPlan || !selectedCategoryDetail) return;
    const breaking = syncPlan.items.filter(i => syncIncluded.has(i.key) && i.risks.some(r => r.level === 'breaking'));
    if (breaking.length && !window.confirm(
      `${breaking.length} selected change(s) are flagged as breaking:` + NL + NL +
      breaking.slice(0, 6).map(i => `• ${i.incoming?.name ?? i.existing?.name}`).join(NL) +
      NL + NL + `Apply anyway?`)) return;

    setSyncBusy(true);
    try {
      const res = await applyAttributeSync(syncPlan, selectedCategoryDetail, syncIncluded);
      await loadData();
      setImportModalOpen(false);
      setSyncPlan(null);
      alert(`Sync applied: ${res.updated} updated, ${res.created} created, ${res.skipped} skipped.`);
    } catch (e: any) {
      setImportError(`Sync failed: ${e.message}`);
    } finally {
      setSyncBusy(false);
    }
  };

  const switchImportSource = (source: 'csv' | 'producttoolkit') => {
    setImportSource(source);
    setSyncPlan(null);
    setSyncRemap({});
    setImportRows([]);
    setImportIncluded([]);
    setImportFileName('');
    setImportError(null);
    setPtNotice(null);
  };

  /**
   * Pull the ProductToolkit definition for the open category into the same preview grid the
   * CSV import uses.
   *
   * Matching is by exact category name: ProductToolkit's `l3` is an opaque identifier (it is
   * the deepest level a category reaches, which may be an L1 or L2), so it is compared to the
   * OriginFlow leaf name as a whole string rather than being parsed for depth. Definitions
   * that match nothing are listed rather than dropped silently.
   *
   * Three outcomes are all normal, not failures: unreachable (off the internal network), no
   * definition loaded for this category (most categories have none), and an empty list.
   */
  const handleLoadFromProductToolkit = async () => {
    const target = categories.find(c => c.id === selectedCategoryDetail);
    if (!target) return;
    setPtLoading(true);
    setImportError(null);
    setPtNotice(null);
    try {
      const [summaries, attrs] = await Promise.all([
        // Only for the unmatched report — a failure here must not block the import itself.
        getProductToolkitDefinitions().catch(() => null),
        getProductToolkitDefinition(target.name),
      ]);

      if (summaries) {
        const known = new Set(categories.map(c => c.name));
        setPtUnmatched(summaries.map(d => d.l3).filter(l3 => !known.has(l3)).sort());
      }

      if (attrs === null) {
        setImportRows([]);
        setImportIncluded([]);
        setPtNotice(
          `ProductToolkit has no definition loaded for "${target.name}". Most categories don't ` +
          `have one yet — it appears once someone uploads that category's CSV there.`,
        );
        return;
      }

      const rows = orderImportRows(mapProductToolkitAttributes(attrs));
      setImportRows(rows);
      setImportIncluded(rows.map(() => true));
      setImportFileName(`ProductToolkit · ${target.name}`);
      if (rows.length === 0) {
        setPtNotice(`The ProductToolkit definition for "${target.name}" is empty — no attributes to import.`);
      }
    } catch (err: any) {
      setImportRows([]);
      setImportIncluded([]);
      setImportError(
        err instanceof ProductToolkitUnavailableError
          ? err.message
          : `Could not load the ProductToolkit definition: ${err.message}`,
      );
    } finally {
      setPtLoading(false);
    }
  };

  // Preview rows are sectioned like every other attribute list: Global first, then the rest
  // in ATTRIBUTE_GROUPS order. Sort is stable, so the source file's order survives within a
  // group. Applied where rows ENTER state, so the parallel importIncluded array stays aligned.
  const orderImportRows = (rows: ParsedAttributeRow[]) =>
    [...rows].sort((a, b) =>
      attributeGroupRank(a.group) - attributeGroupRank(b.group) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.name.localeCompare(b.name));

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const rows = orderImportRows(parseAttributeCsv(buf));
      setImportRows(rows);
      setImportIncluded(rows.map(() => true));
      if (rows.length === 0) {
        setImportError('No attribute rows found. Check the file has a header row with "Attribute" and "Akeneo Code" columns.');
      }
    } catch (err: any) {
      setImportError(`Could not read file: ${err.message}`);
      setImportRows([]);
      setImportIncluded([]);
    }
    // Allow re-selecting the same file after a fix.
    e.target.value = '';
  };

  const setImportRowGroup = (index: number, group: string) => {
    setImportRows(prev => prev.map((r, i) => i === index ? { ...r, group } : r));
  };

  // Best-effort preview mirroring importCategoryAttributes:
  //  'new'    → no existing match; a new attribute will be created.
  //  'link'   → exists in another category; it will be shared into this one (no duplicate).
  //  'exists' → already applies here (global / owned / already shared); nothing to do.
  const importRowStatus = (row: ParsedAttributeRow): 'new' | 'link' | 'exists' => {
    const norm = (s?: string) => (s ?? '').trim().toLowerCase();
    // Mirror importCategoryAttributes exactly, or the preview lies about what will happen.
    // A global row (every group but 'Category Specific') resolves to one shared attribute:
    // name within the group first, then the Akeneo code. A category-scoped row uses the code
    // as identity across all groups, falling back to the name within its group.
    const code = norm(row.akeneoId);
    const byName = (a: CategoryAttribute) => a.group === row.group && norm(a.name) === norm(row.name);
    const byCode = (a: CategoryAttribute) => !!code && norm(a.akeneoId) === code;
    const match = resolvesToGlobal(row)
      ? (attributes.find(byName) ?? attributes.find(byCode))
      : attributes.find(a => (code ? byCode(a) : byName(a)));
    if (!match) return 'new';
    const appliesHere =
      match.categoryId === null ||
      match.categoryId === selectedCategoryDetail ||
      (match.assignedCategoryIds ?? []).includes(selectedCategoryDetail!);
    return appliesHere ? 'exists' : 'link';
  };

  const handleConfirmImport = async () => {
    if (!selectedCategoryDetail) return;
    const included = importRows.filter((_, i) => importIncluded[i]);
    if (included.length === 0) return;
    if (importMode === 'replace') {
      const applies = getAttributesForCategory(attributes, selectedCategoryDetail);
      // Anything the incoming rows do not account for, keyed the way the importer matches.
      const inCode = new Set(included.map(r => (r.akeneoId ?? '').trim().toLowerCase()).filter(Boolean));
      const inName = new Set(included.map(r => r.name.trim().toLowerCase()));
      const leftover = applies.filter(a =>
        !(a.akeneoId && inCode.has(a.akeneoId.trim().toLowerCase())) && !inName.has(a.name.trim().toLowerCase()));

      const ownedGone = leftover.filter(a => a.categoryId === selectedCategoryDetail);
      const sharedGone = leftover.filter(a => a.categoryId !== null && a.categoryId !== selectedCategoryDetail);
      const globalGone = leftover.filter(a => a.categoryId === null);
      const otherCategories = new Set(
        attributes.filter(a => a.categoryId && a.categoryId !== selectedCategoryDetail).map(a => a.categoryId),
      ).size;

      const lines = [
        'Replace the attributes of "' + (categories.find(c => c.id === selectedCategoryDetail)?.name ?? '') + '"?',
        '',
        'Kept and updated in place: ' + (applies.length - leftover.length) +
          ' (ids survive, so SKU values and IM references keep working)',
        'Deleted, owned by this category: ' + ownedGone.length,
        'Un-shared from this category: ' + sharedGone.length,
      ];
      if (replaceIncludeGlobals) {
        lines.push(
          'Deleted GLOBAL attributes: ' + globalGone.length,
          '',
          'WARNING: a global attribute applies to every category, so deleting it removes it from ' +
            otherCategories + ' other categor' + (otherCategories === 1 ? 'y' : 'ies') + ' as well.',
        );
        if (globalGone.length) lines.push('They are: ' + globalGone.map(a => a.name).join(', '));
      } else {
        lines.push('Global attributes left alone: ' + globalGone.length);
      }
      lines.push('', 'Values captured against a deleted attribute stop resolving. This cannot be undone.');

      if (!window.confirm(lines.join(NL))) return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const res = importMode === 'replace'
        ? await replaceCategoryAttributes(selectedCategoryDetail, included, { includeGlobals: replaceIncludeGlobals })
        : await importCategoryAttributes(selectedCategoryDetail, included);
      await loadData();
      setImportModalOpen(false);
      const rep = res as ReplaceAttributesResult;
      const removed = importMode === 'replace'
        ? `${rep.updated} updated in place, ${rep.deleted} deleted` +
          (rep.deletedGlobals ? `, ${rep.deletedGlobals} global(s) deleted` : '') +
          `, ${rep.unshared} un-shared, `
        : '';
      alert(`Import complete: ${removed}${res.created} created, ${res.linked} linked${res.skipped ? `, ${res.skipped} already present` : ''}.`);
    } catch (e: any) {
      setImportError(`Import failed: ${e.message}`);
    } finally {
      setImporting(false);
    }
  };

  // --- BULK GRID EDITOR ---
  const markGridDirty = (id: string) => setGridDirty(prev => new Set(prev).add(id));

  const updateGridRow = (id: string, patch: Partial<CategoryAttribute>) => {
    setGridRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    markGridDirty(id);
  };

  const updateGridRules = (id: string, patch: Partial<CategoryAttribute['validationRules']>) => {
    setGridRows(prev => prev.map(r =>
      r.id === id ? { ...r, validationRules: { ...(r.validationRules ?? {}), ...patch } } : r,
    ));
    markGridDirty(id);
  };

  const changeGridGroup = (id: string, group: string) => {
    // Scope no longer follows the group. It used to: a group outside
    // PREDEFINED_ATTRIBUTE_GROUPS was assumed category-scoped, so filling categoryId in here
    // was how a demotion happened. Every ProductToolkit cluster is outside that list, so
    // that rule would silently demote a synced GLOBAL attribute — stripping it from every
    // other category — just because someone touched its group dropdown.
    // Group is now a display heading; scope lives in categoryId and only changes explicitly
    // (Make global / Unlink, or a reviewed sync).
    setGridRows(prev => prev.map(r => (r.id === id ? { ...r, group } : r)));
    markGridDirty(id);
  };

  /**
   * Move an attribute up or down WITHIN its group.
   *
   * Reorders the group's rows, then renumbers that whole group 10, 20, 30... — an untouched
   * group sits at sort_order 0 and reads alphabetically, so the first move is what makes its
   * order explicit. Every row whose number actually changes is marked dirty, so "Save all
   * changes" persists exactly the ones that moved. Gaps of 10 leave room to slot a row in
   * later without renumbering everything again.
   */
  const moveGridRow = (id: string, direction: -1 | 1) => {
    setGridRows(prev => {
      const row = prev.find(r => r.id === id);
      if (!row) return prev;
      const group = row.group ?? 'Category Specific';
      const inGroup = prev.filter(r => (r.group ?? 'Category Specific') === group);
      const idx = inGroup.findIndex(r => r.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= inGroup.length) return prev; // already at the edge

      const reordered = [...inGroup];
      [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];

      const renumbered = new Map(reordered.map((r, i) => [r.id, (i + 1) * 10]));
      for (const r of reordered) {
        if ((r.sortOrder ?? 0) !== renumbered.get(r.id)) markGridDirty(r.id);
      }
      // Rebuild the flat list in the new within-group order, leaving other groups untouched.
      const queue = [...reordered];
      return prev.map(r =>
        (r.group ?? 'Category Specific') === group
          ? (() => { const next = queue.shift()!; return { ...next, sortOrder: renumbered.get(next.id) }; })()
          : r,
      );
    });
  };

  const changeGridOptions = (id: string, text: string) => {
    setGridOptionsText(prev => ({ ...prev, [id]: text }));
    const enumOptions = text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    updateGridRules(id, { enumOptions });
  };

  const addGridRow = () => {
    if (!selectedCategoryDetail) return;
    const id = generateUUID();
    const row: CategoryAttribute = {
      id,
      categoryId: selectedCategoryDetail,
      assignedCategoryIds: [],
      name: '',
      dataType: 'text',
      validationRules: {},
      group: 'Category Specific',
      supplierVisible: true,
      // Append to the end of its group rather than sorting to the top on an empty name.
      sortOrder: Math.max(
        0,
        ...gridRows
          .filter(r => (r.group ?? 'Category Specific') === 'Category Specific')
          .map(r => r.sortOrder ?? 0),
      ) + 10,
    };
    setGridRows(prev => [...prev, row]);
    setGridOptionsText(prev => ({ ...prev, [id]: '' }));
    markGridDirty(id);
  };

  const removeGridRow = (id: string) => {
    const existsInDb = attributes.some(a => a.id === id);
    if (!existsInDb) {
      // Never persisted — just drop it from the working copy.
      setGridRows(prev => prev.filter(r => r.id !== id));
      setGridDirty(prev => { const n = new Set(prev); n.delete(id); return n; });
      return;
    }
    handleDeleteAttribute(id); // reuse the existing confirm + delete + reload flow
  };

  const handleSaveGrid = async () => {
    const changed = gridRows.filter(r => gridDirty.has(r.id) && r.name.trim());
    if (changed.length === 0) { setGridDirty(new Set()); return; }
    setGridSaving(true);
    try {
      for (const r of changed) {
        await saveCategoryAttribute(
          {
            ...r,
            validationRules: r.validationRules && Object.keys(r.validationRules).length ? r.validationRules : undefined,
          },
          // What the grid shows is what gets saved: pass the row's actual scope instead of
          // letting it be re-derived from the group name, which no longer implies scope.
          { forceScope: r.categoryId === null ? 'global' : 'category' },
        );
      }
      setGridDirty(new Set());
      await loadData();
    } catch (e: any) {
      alert(`Error saving changes: ${e.message}`);
    } finally {
      setGridSaving(false);
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        if (modalType === 'category') {
          const item = editingItem as CategoryL3;
          await saveCategory({ ...item, id: item.id || generateUUID() });
        } else if (modalType === 'attribute') {
          const item = editingItem as CategoryAttribute;
          await saveCategoryAttribute({ ...item, id: item.id || generateUUID() });
        } else if (modalType === 'supplier') {
          await updateSupplier(editingItem.id, editingItem);
        }
        setIsModalOpen(false);
        loadData();
    } catch (e: any) {
        alert(`Error saving: ${e.message}`);
    }
  };

  const toggleCategoryFinalized = async (category: CategoryL3) => {
    const newStatus = !category.isFinalized;
    await saveCategory({ 
      ...category, 
      isFinalized: newStatus,
      finalizedAt: newStatus ? new Date().toISOString() : null
    });
    loadData();
  };

  // --- AI PROMPT ACTIONS ---
  const openPromptModal = (prompt: AIPrompt) => {
    setEditingPrompt({ ...prompt });
    setPromptModalOpen(true);
  };

  const handleSavePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPrompt) return;
    setSavingPrompt(true);
    try {
      await updateAIPrompt(
        editingPrompt.id,
        {
          systemPrompt: editingPrompt.systemPrompt,
          model: editingPrompt.model,
          maxTokens: editingPrompt.maxTokens
        },
        currentUser?.id
      );
      setPromptModalOpen(false);
      setEditingPrompt(null);
      await loadData();
    } catch (e: any) {
      alert(`Error saving prompt: ${e.message}`);
    } finally {
      setSavingPrompt(false);
    }
  };

  // --- PROMPT LIBRARY ACTIONS ---
  const handleSaveLibEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLibEntry) return;
    setSavingLibEntry(true);
    try {
      const { id, title, description, promptText } = editingLibEntry;
      if (id) {
        await updatePromptLibraryEntry(id, { title, description, promptText });
      } else {
        await createPromptLibraryEntry({ title, description, promptText }, currentUser?.id);
      }
      setEditingLibEntry(null);
      await loadData();
    } catch (e: any) {
      alert(`Error saving prompt: ${e.message}`);
    } finally {
      setSavingLibEntry(false);
    }
  };

  const handleDeleteLibEntry = (entry: PromptLibraryEntry) => {
    setDeleteModal({
      isOpen: true,
      title: 'Delete Prompt?',
      message: `Delete "${entry.title}" from the prompt library? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await deletePromptLibraryEntry(entry.id);
          await loadData();
        } catch (e: any) {
          alert(`Error deleting prompt: ${e.message}`);
        }
        setDeleteModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleCopyLibPrompt = async (entry: PromptLibraryEntry) => {
    try {
      await navigator.clipboard.writeText(entry.promptText);
      setCopiedPromptId(entry.id);
      setTimeout(() => setCopiedPromptId((cur) => (cur === entry.id ? null : cur)), 2000);
    } catch {
      alert('Could not copy to clipboard.');
    }
  };

  // --- TRANSLATION VERBATIM ACTIONS ---
  const handleSaveVerbatim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVerbatim) return;
    setSavingVerbatim(true);
    try {
      const { id, phrase, note } = editingVerbatim;
      // Persist only non-blank language entries (blank = fall back to keeping the source phrase).
      const translations = Object.fromEntries(
        Object.entries(editingVerbatim.translations).filter(([, v]) => v && v.trim()),
      );
      if (id) {
        await updateTranslationVerbatim(id, { phrase, note, translations });
      } else {
        await createTranslationVerbatim({ phrase, note, translations }, currentUser?.id);
      }
      setEditingVerbatim(null);
      await loadData();
    } catch (e: any) {
      alert(`Error saving verbatim: ${e.message}`);
    } finally {
      setSavingVerbatim(false);
    }
  };

  const handleDeleteVerbatim = (entry: TranslationVerbatim) => {
    setDeleteModal({
      isOpen: true,
      title: 'Delete Verbatim?',
      message: `Delete "${entry.phrase}"? Future translations will no longer protect this phrase.`,
      onConfirm: async () => {
        try {
          await deleteTranslationVerbatim(entry.id);
          await loadData();
        } catch (e: any) {
          alert(`Error deleting verbatim: ${e.message}`);
        }
        setDeleteModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // --- RENDERERS ---

  const DATA_TYPES: AttributeDataType[] = ['text', 'integer', 'decimal', 'boolean', 'enum', 'image'];

  const renderAttributeGrid = () => {
    const dirtyCount = gridRows.filter(r => gridDirty.has(r.id)).length;
    const COLS = 10;
    // Section by the groups actually present, in the order they appear once sorted. A
    // ProductToolkit cluster is a valid group and is not on ATTRIBUTE_GROUPS, so iterating
    // that list would silently omit every synced attribute from the grid.
    const grouped = groupsInOrder(gridRows)
      .map(group => ({
        group,
        // Within a group: explicit sort_order first, name as the tie-break (0 = unordered).
        rows: gridRows
          .filter(r => (r.group ?? 'Category Specific') === group)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)),
      }))
      .filter(g => g.rows.length > 0);

    const renderGridRow = (r: CategoryAttribute, indexInGroup: number, groupSize: number) => {
      const isGlobal = r.categoryId === null;
      const isShared = r.categoryId !== null && r.categoryId !== selectedCategoryDetail;
      const dirty = gridDirty.has(r.id);
      return (
        <tr key={r.id} className={dirty ? 'bg-amber-50/40' : 'hover:bg-light'}>
          <td className="px-1 py-1.5">
            <div className="flex flex-col items-center leading-none">
              <button
                type="button"
                onClick={() => moveGridRow(r.id, -1)}
                disabled={indexInGroup === 0}
                title="Move up within this group"
                className="p-0.5 text-gray-300 hover:text-indigo-600 disabled:opacity-25 disabled:hover:text-gray-300"
              >
                <ChevronUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => moveGridRow(r.id, 1)}
                disabled={indexInGroup === groupSize - 1}
                title="Move down within this group"
                className="p-0.5 text-gray-300 hover:text-indigo-600 disabled:opacity-25 disabled:hover:text-gray-300"
              >
                <ChevronDown size={13} />
              </button>
            </div>
          </td>
          <td className="px-2 py-1.5">
            <input
              type="text"
              value={r.name}
              onChange={e => updateGridRow(r.id, { name: e.target.value })}
              placeholder="Attribute name"
              className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-indigo-400 outline-none"
            />
          </td>
          <td className="px-2 py-1.5">
            <div className="flex items-center gap-1">
              <select
                value={r.group ?? 'Category Specific'}
                onChange={e => changeGridGroup(r.id, e.target.value)}
                className="w-full px-1 py-1 border border-gray-200 rounded text-xs bg-white focus:ring-1 focus:ring-indigo-400 outline-none"
              >
                {allGroupOptions.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <span
                className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase shrink-0 ${isGlobal ? 'text-indigo-500 bg-indigo-50' : isShared ? 'text-violet-500 bg-violet-50' : 'text-slate-500 bg-slate-100'}`}
                title={isGlobal ? 'Global — edits apply to every category' : isShared ? 'Shared from another category — edits apply everywhere it is used' : 'Specific to this category'}
              >
                {isGlobal ? 'Global' : isShared ? 'Shared' : 'Cat'}
              </span>
            </div>
          </td>
          <td className="px-2 py-1.5">
            <input
              type="text"
              value={r.akeneoId ?? ''}
              onChange={e => updateGridRow(r.id, { akeneoId: e.target.value || undefined })}
              placeholder="akeneo_code"
              className="w-full px-2 py-1 border border-gray-200 rounded text-xs font-mono text-gray-600 focus:ring-1 focus:ring-indigo-400 outline-none"
            />
          </td>
          <td className="px-2 py-1.5">
            <select
              value={r.dataType}
              onChange={e => updateGridRow(r.id, { dataType: e.target.value as AttributeDataType })}
              className="w-full px-1 py-1 border border-gray-200 rounded text-xs bg-white capitalize focus:ring-1 focus:ring-indigo-400 outline-none"
            >
              {DATA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </td>
          <td className="px-2 py-1.5">
            <input
              type="text"
              value={gridOptionsText[r.id] ?? ''}
              onChange={e => changeGridOptions(r.id, e.target.value)}
              disabled={r.dataType !== 'enum'}
              placeholder={r.dataType === 'enum' ? 'Option A, Option B, …' : '—'}
              className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-indigo-400 outline-none disabled:bg-gray-50 disabled:text-gray-300"
            />
          </td>
          <td className="px-2 py-1.5">
            <input
              type="text"
              value={r.validationRules?.unit ?? ''}
              onChange={e => updateGridRules(r.id, { unit: e.target.value || undefined })}
              disabled={r.dataType !== 'integer' && r.dataType !== 'decimal'}
              placeholder={r.dataType === 'integer' || r.dataType === 'decimal' ? 'L, cm…' : '—'}
              className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-indigo-400 outline-none disabled:bg-gray-50 disabled:text-gray-300"
            />
          </td>
          <td className="px-2 py-1.5 text-center">
            <input
              type="checkbox"
              checked={!!r.validationRules?.required}
              onChange={e => updateGridRules(r.id, { required: e.target.checked || undefined })}
            />
          </td>
          <td className="px-2 py-1.5 text-center">
            {/* Only an explicit false hides it, so an undefined flag reads as visible. */}
            <input
              type="checkbox"
              checked={r.supplierVisible !== false}
              onChange={e => updateGridRow(r.id, { supplierVisible: e.target.checked })}
              title={r.supplierVisible === false
                ? 'Internal only — hidden from supplier forms'
                : 'Shown to suppliers'}
            />
          </td>
          <td className="px-2 py-1.5 text-center">
            <button
              onClick={() => removeGridRow(r.id)}
              className="p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
              title="Delete attribute"
            >
              <Trash2 size={14} />
            </button>
          </td>
        </tr>
      );
    };

    return (
      <div className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-light border-b border-gray-200">
          <div className="text-xs text-muted">
            {gridRows.length} attribute{gridRows.length === 1 ? '' : 's'} for this category
            {dirtyCount > 0 && <span className="ml-2 text-amber-600 font-medium">· {dirtyCount} unsaved</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={addGridRow}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1.5 rounded border border-indigo-100 transition-colors"
            >
              <Plus size={13} /> Add attribute
            </button>
            <button
              onClick={handleSaveGrid}
              disabled={gridSaving || dirtyCount === 0}
              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-xs font-medium shadow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle size={13} /> {gridSaving ? 'Saving…' : `Save all changes${dirtyCount ? ` (${dirtyCount})` : ''}`}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-gray-500 border-b border-gray-200">
              <tr>
                <th className="px-2 py-2 w-12 text-center" title="Move the attribute within its group">Order</th>
                <th className="px-2 py-2 min-w-[180px]">Name</th>
                <th className="px-2 py-2 min-w-[160px]">Group</th>
                <th className="px-2 py-2 min-w-[150px]">Akeneo ID</th>
                <th className="px-2 py-2 min-w-[110px]">Type</th>
                <th className="px-2 py-2 min-w-[220px]">Options (enum)</th>
                <th className="px-2 py-2 min-w-[80px]">Unit</th>
                <th className="px-2 py-2 text-center">Req</th>
                <th className="px-2 py-2 text-center" title="Shown to external suppliers in the attribute portal, proposal form and RFQ">Supplier</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gridRows.length === 0 ? (
                <tr><td colSpan={COLS} className="px-4 py-8 text-center text-gray-400 italic">No attributes yet. Click <strong>Add attribute</strong>, or import from a CSV or ProductToolkit.</td></tr>
              ) : grouped.map(({ group, rows }) => (
                <React.Fragment key={group}>
                  <tr>
                    <td colSpan={COLS} className="px-3 py-1.5 bg-indigo-50/60 border-y border-indigo-100 text-[11px] font-bold uppercase tracking-wide text-indigo-600">
                      {group} <span className="text-indigo-300 font-normal normal-case">({rows.length})</span>
                    </td>
                  </tr>
                  {rows.map((r, i) => renderGridRow(r, i, rows.length))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400">
          Editing a <span className="text-indigo-500 font-medium">Global</span> or <span className="text-violet-500 font-medium">Shared</span> attribute changes it for every category that uses it. Changing the Group moves an attribute between global and category scope.
        </div>
      </div>
    );
  };

  const renderCategoriesTab = () => {
    if (selectedCategoryDetail) {
        const category = categories.find(c => c.id === selectedCategoryDetail);
        
        return (
            <div>
                <button 
                    onClick={() => setSelectedCategoryDetail(null)} 
                    className="mb-6 text-sm text-muted hover:text-gray-800 flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 w-fit"
                >
                    <ArrowLeft size={16} /> Back to Categories
                </button>

                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-xl font-bold text-primary">{category?.name}</h3>
                        <p className="text-sm text-muted mt-1">Attributes</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-md border border-gray-200 bg-white p-0.5 shadow-sm mr-1">
                            <button
                                onClick={() => setAttrView('list')}
                                className={`px-3 py-1.5 text-sm font-medium rounded ${attrView === 'list' ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                                List
                            </button>
                            <button
                                onClick={() => setAttrView('grid')}
                                className={`px-3 py-1.5 text-sm font-medium rounded ${attrView === 'grid' ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                                Grid
                            </button>
                        </div>
                        <button
                            onClick={openImportModal}
                            className="flex items-center gap-2 px-4 py-2 bg-white text-indigo-700 border border-indigo-200 rounded-md hover:bg-indigo-50 text-sm font-medium shadow-sm"
                        >
                            <Upload size={16} /> Import attributes
                        </button>
                        <button
                            onClick={openLinkModal}
                            className="flex items-center gap-2 px-4 py-2 bg-white text-violet-700 border border-violet-200 rounded-md hover:bg-violet-50 text-sm font-medium shadow-sm"
                        >
                            <LinkIcon size={16} /> Link from another category
                        </button>
                    </div>
                </div>

                {attrView === 'grid' && renderAttributeGrid()}

                {attrView === 'list' && (
                <div className="space-y-4">
                    {groupsInOrder(getAttributesForCategory(attributes, selectedCategoryDetail)).map(group => {
                        const isPredefined = PREDEFINED_ATTRIBUTE_GROUPS.includes(group);
                        const groupAttrs = isPredefined
                            ? attributes.filter(a => a.categoryId === null && (a.group ?? 'Category Specific') === group)
                            : attributes.filter(a =>
                                (a.group ?? 'Category Specific') === group &&
                                (a.categoryId === null || a.categoryId === selectedCategoryDetail || (a.assignedCategoryIds ?? []).includes(selectedCategoryDetail!))
                              );
                        return (
                            <div key={group} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
                                <div className="flex items-center justify-between px-4 py-3 bg-light border-b border-gray-200">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-sm text-gray-800">{group}</span>
                                        {isPredefined && (
                                            <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded uppercase tracking-wide">Standard</span>
                                        )}
                                        <span className="text-xs text-gray-400">({groupAttrs.length})</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => openAddModal('attribute', group)}
                                            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded border border-transparent hover:border-indigo-100 transition-colors"
                                        >
                                            <Plus size={13} /> Add
                                        </button>
                                    </div>
                                </div>
                                {groupAttrs.length > 0 ? (
                                    <div className="divide-y divide-slate-100">
                                        {groupAttrs.map(a => {
                                            const isShared = !isPredefined &&
                                                a.categoryId !== selectedCategoryDetail &&
                                                (a.assignedCategoryIds ?? []).includes(selectedCategoryDetail!);
                                            const originCategory = isShared ? categories.find(c => c.id === a.categoryId) : null;
                                            return (
                                            <div key={a.id} className="flex items-center justify-between px-4 py-3 hover:bg-light transition-colors group">
                                                <div>
                                                    <div className="font-medium text-gray-800 text-sm flex items-center gap-2">
                                                        {a.name}
                                                        {isShared && (
                                                            <span className="text-[10px] font-bold text-violet-500 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded uppercase tracking-wide">Shared</span>
                                                        )}
                                                        {a.supplierVisible === false && (
                                                            <span
                                                                className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded uppercase tracking-wide"
                                                                title="Internal only — never shown in the supplier portal, proposal form or RFQ"
                                                            >Internal</span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-muted mt-0.5 capitalize">
                                                        {a.dataType}{a.validationRules?.unit ? ` · ${a.validationRules.unit}` : ''}{a.validationRules?.min !== undefined || a.validationRules?.max !== undefined ? ` [${a.validationRules?.min ?? ''}–${a.validationRules?.max ?? ''}]` : ''}
                                                        {isShared && originCategory && <span className="ml-1 text-violet-400 normal-case">· from {originCategory.name}</span>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {isShared ? (
                                                        <button
                                                            onClick={() => handleUnassignAttribute(a.id)}
                                                            className="flex items-center gap-1 px-2 py-1 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded border border-transparent hover:border-rose-100 transition-colors"
                                                            title="Remove from this category"
                                                        >
                                                            <X size={13} /> Unlink
                                                        </button>
                                                    ) : (
                                                        <>
                                                            <button onClick={() => handleEditItem(a, 'attribute')} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors">
                                                                <Edit2 size={15} />
                                                            </button>
                                                            <button onClick={() => handleDeleteAttribute(a.id)} className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors">
                                                                <Trash2 size={15} />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="px-4 py-6 text-center text-xs text-gray-400 italic">
                                        No attributes yet. Click <strong>Add</strong> to create one.
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                )}
            </div>
        );
    }

    // Categories table.
    //
    // A card per category stopped working once the tree was seeded (~130 leaves), so this is
    // a dense table: one row per L3, with the L1/L2 columns carrying the hierarchy and the
    // filters above narrowing it. Rows repeat their L1/L2 rather than using rowspan groups —
    // repetition survives filtering and sorting, a spanned cell does not.
    const pmUsers = users.filter(u => u.role === UserRole.PM);
    const l1Options = distinctL1(categories);
    const l2Options = distinctL2(categories, catL1 || undefined);
    const visibleCategories = filterCategories(categories, {
        search: catSearch,
        l1: catL1 || undefined,
        l2: catL2 || undefined,
        includeInactive: catShowInactive,
    });
    const inactiveCount = categories.filter(c => !c.active).length;

    return (
        <div>
            <div className="flex flex-wrap justify-between items-center gap-3 px-6 py-4 bg-light border-b border-gray-200">
                <div>
                    <h3 className="font-bold text-gray-800">Product Categories</h3>
                    <p className="text-xs text-muted mt-0.5">
                        {visibleCategories.length} of {categories.length} shown
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={openAssignModal} className="flex items-center gap-2 px-4 py-2 bg-white text-violet-700 border border-violet-200 rounded-md hover:bg-violet-50 text-sm font-medium shadow-sm">
                        <LinkIcon size={16} /> Assign Existing
                    </button>
                    <button onClick={() => openAddModal('category')} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow">
                        <Plus size={16} /> Add Category
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-gray-200 bg-white">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        value={catSearch}
                        onChange={e => setCatSearch(e.target.value)}
                        placeholder="Search any level…"
                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                </div>
                <select
                    value={catL1}
                    // Changing L1 clears L2: the old L2 almost certainly belongs to another
                    // department, and leaving it set would show an empty table.
                    onChange={e => { setCatL1(e.target.value); setCatL2(''); }}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                    <option value="">All L1</option>
                    {l1Options.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <select
                    value={catL2}
                    onChange={e => setCatL2(e.target.value)}
                    className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                    <option value="">All L2</option>
                    {l2Options.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none px-2">
                    <input
                        type="checkbox"
                        checked={catShowInactive}
                        onChange={e => setCatShowInactive(e.target.checked)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Show inactive{inactiveCount > 0 ? ` (${inactiveCount})` : ''}
                </label>
                {(catSearch || catL1 || catL2) && (
                    <button
                        onClick={() => { setCatSearch(''); setCatL1(''); setCatL2(''); }}
                        className="text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50"
                    >
                        Clear
                    </button>
                )}
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-light border-b border-gray-200 text-xs uppercase tracking-wide text-muted">
                        <tr>
                            <th className="text-left font-semibold px-6 py-2.5">L1</th>
                            <th className="text-left font-semibold px-3 py-2.5">L2</th>
                            <th className="text-left font-semibold px-3 py-2.5">L3 — Category</th>
                            <th className="text-right font-semibold px-3 py-2.5">Attrs</th>
                            <th className="text-left font-semibold px-3 py-2.5">PM</th>
                            <th className="text-left font-semibold px-3 py-2.5">Status</th>
                            <th className="text-right font-semibold px-6 py-2.5">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {visibleCategories.map(c => {
                            const attrCount = getAttributesForCategory(attributes, c.id).length;
                            return (
                                <tr key={c.id} className={`hover:bg-light transition-colors ${c.active ? '' : 'opacity-60'}`}>
                                    <td className="px-6 py-2.5 text-muted whitespace-nowrap">
                                        {c.l1Name ?? <span className="italic text-amber-600">{UNCATEGORISED_LABEL}</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-muted whitespace-nowrap">{c.l2Name ?? '—'}</td>
                                    <td className="px-3 py-2.5">
                                        <span className="font-medium text-primary flex items-center gap-1.5">
                                            {c.name}
                                            {c.isFinalized && (
                                                <span title="Finalized (Requirements Locked)" className="text-indigo-600">
                                                    <CheckCircle size={14} />
                                                </span>
                                            )}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{attrCount || '—'}</td>
                                    <td className="px-3 py-2.5">
                                        <select
                                            value={c.pmId ?? ''}
                                            onChange={async (e) => {
                                                await assignPMToCategory(c.id, e.target.value || null);
                                                loadData();
                                            }}
                                            className="text-xs border border-gray-200 rounded px-2 py-1 text-gray-700 bg-white focus:ring-2 focus:ring-indigo-500 outline-none max-w-[140px]"
                                            title="Assign PM to this category"
                                        >
                                            <option value="">— No PM —</option>
                                            {pmUsers.map(pm => (
                                                <option key={pm.id} value={pm.id}>{pm.name}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${c.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                                            {c.active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-2.5">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => setSelectedCategoryDetail(c.id)}
                                                className="text-xs font-medium text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded flex items-center gap-1"
                                                title="Configure attributes"
                                            >
                                                <SlidersHorizontal size={13} /> Configure
                                            </button>
                                            <button
                                                onClick={() => toggleCategoryFinalized(c)}
                                                className={`text-xs px-2 py-1 rounded border transition-colors whitespace-nowrap ${
                                                    c.isFinalized
                                                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                                                    : 'bg-white text-muted border-gray-200 hover:bg-light hover:text-gray-700'
                                                }`}
                                                title="Finalizing signals that requirements are complete"
                                            >
                                                {c.isFinalized ? 'Finalized' : 'Mark Final'}
                                            </button>
                                            <button
                                                onClick={() => handleEditItem(c, 'category')}
                                                className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                                title="Edit category"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteCategory(c.id)}
                                                className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                                                title="Delete Category"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {visibleCategories.length === 0 && (
                            <tr>
                                <td colSpan={7} className="p-8 text-center text-gray-400">
                                    {categories.length === 0
                                        ? 'No categories found.'
                                        : 'No categories match these filters.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
  };

  return (
    <Layout>
      <ConfirmationModal
        variant="danger"
        isOpen={deleteModal.isOpen}
        title={deleteModal.title}
        message={deleteModal.message}
        onConfirm={deleteModal.onConfirm}
        onCancel={() => setDeleteModal(prev => ({ ...prev, isOpen: false }))}
      />

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-primary flex items-center gap-2 mb-1">
            <ShieldCheck className="text-indigo-600" /> Admin Console
          </h1>
          <p className="text-sm text-muted">System configuration and master data management.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh all admin data"
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-light text-gray-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
        <button onClick={() => setActiveTab('users')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'users' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Users size={18} /> Users & Roles
        </button>
        <button onClick={() => setActiveTab('suppliers')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'suppliers' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Truck size={18} /> Suppliers
        </button>
        <button onClick={() => { setActiveTab('categories'); setSelectedCategoryDetail(null); }} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'categories' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Layers size={18} /> Product Categories
        </button>
        <button onClick={() => setActiveTab('projects')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'projects' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Package size={18} /> Projects
        </button>
        <button onClick={() => setActiveTab('prompts')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'prompts' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Sparkles size={18} /> AI Prompts
        </button>
        <button onClick={() => setActiveTab('markets')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'markets' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Globe size={18} /> Markets
        </button>
        <button onClick={() => setActiveTab('imPrint')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'imPrint' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Type size={18} /> IM Print
        </button>
        <button onClick={() => setActiveTab('translationMemory')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'translationMemory' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Languages size={18} /> Translation Memory
        </button>
        <button onClick={() => setActiveTab('feedback')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'feedback' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <MessageSquarePlus size={18} /> Feedback
        </button>
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-200 min-h-[400px]">

        {/* MARKETS TAB */}
        {activeTab === 'markets' && <MarketsAdminSection />}

        {/* IM PRINT TAB — global print typography for the PDF export. */}
        {activeTab === 'imPrint' && <PrintSettingsAdminSection />}

        {/* TRANSLATION MEMORY TAB — browse, correct and approve the reuse corpus. */}
        {activeTab === 'translationMemory' && <TranslationMemoryAdmin />}

        {/* FEEDBACK TAB — bug reports / feature requests from the floating widget. */}
        {activeTab === 'feedback' && <FeedbackAdminSection />}

        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div>
            <div className="px-6 py-4 bg-light border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800">Registered Users</h3>
              <span className="text-xs bg-gray-200 px-2 py-1 rounded text-gray-600">{users.length} Users</span>
            </div>
            <div className="divide-y divide-slate-100">
              {users.map(user => (
                <div key={user.id} className="p-4 flex items-center justify-between hover:bg-light px-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-xs">
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-medium text-primary">{user.name || 'No Name'}</div>
                      <div className="text-xs text-muted">{user.email}</div>
                    </div>
                  </div>
                  <button onClick={() => toggleRole(user.id, user.role)} className={`text-xs px-3 py-1 rounded-full font-bold transition-colors ${user.role === UserRole.ADMIN ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {user.role}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SUPPLIERS TAB */}
        {activeTab === 'suppliers' && (
          <div>
            <div className="px-6 py-4 bg-light border-b border-gray-200 flex justify-between items-center">
               <h3 className="font-bold text-gray-800">Supplier Database</h3>
            </div>
            <div className="p-6 border-b border-gray-100 bg-light/50">
              <h4 className="text-sm font-bold text-gray-700 mb-3">Add New Supplier</h4>
              <form onSubmit={handleCreateSupplier} className="flex flex-col sm:flex-row gap-3">
                 <input required placeholder="Supplier Name" className="border rounded px-3 py-2 text-sm flex-[2]" value={newSupName} onChange={e => setNewSupName(e.target.value)} />
                 <input required placeholder="Code (e.g. SUP-001)" className="border rounded px-3 py-2 text-sm flex-1" value={newSupCode} onChange={e => setNewSupCode(e.target.value)} />
                 <input placeholder="Contact Email" className="border rounded px-3 py-2 text-sm flex-1" value={newSupEmail} onChange={e => setNewSupEmail(e.target.value)} />
                 <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-purple-700 flex items-center justify-center gap-1">
                   <Plus size={16} /> Add
                 </button>
              </form>
            </div>
            <div className="divide-y divide-slate-100">
              {suppliers.map(sup => (
                <div key={sup.id} className="p-4 hover:bg-light px-6 flex justify-between items-center">
                  <div>
                    <div className="flex justify-between">
                      <div className="font-medium text-primary">{sup.name}</div>
                      <span className="ml-3 text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600 font-mono border border-gray-200">{sup.code}</span>
                    </div>
                    <div className="text-xs text-muted mt-1">{sup.email || 'No email provided'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                     <button 
                       onClick={() => handleEditItem(sup, 'supplier')}
                       className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                       title="Edit Supplier"
                     >
                       <Edit2 size={16} />
                     </button>
                     <button
                       onClick={() => handleCopyPortalLink(sup)}
                       className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors"
                       title="Copy Supplier Portal Link"
                     >
                       {copiedTokenId === sup.id ? <CheckCircle size={14} className="text-emerald-600" /> : <LinkIcon size={14} />}
                       {copiedTokenId === sup.id ? 'Link Copied' : 'Portal Link'}
                     </button>
                     <button
                       onClick={() => openPMAssignmentModal(sup.id)}
                       className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors"
                       title="Manage PM Assignments"
                     >
                       <SlidersHorizontal size={14} />
                       Assign PMs
                     </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CATEGORIES TAB */}
        {activeTab === 'categories' && (
            <div className="p-6">
                {renderCategoriesTab()}
            </div>
        )}

        {/* PROJECTS TAB */}
        {activeTab === 'projects' && (
          <div>
            <div className="px-6 py-4 bg-light border-b border-gray-200">
              <h3 className="font-bold text-gray-800">Project PM Management</h3>
            </div>
            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
              {projects.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">
                  No projects found
                </div>
              ) : (
                projects.map(proj => (
                  <div key={proj.id} className="p-4 hover:bg-light px-6 flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium text-primary">{proj.name}</div>
                      <div className="text-xs text-muted mt-1">
                        Project ID: {proj.projectId} • Supplier: {suppliers.find(s => s.id === proj.supplierId)?.name || 'Unknown'}
                      </div>
                      <div className="text-xs text-muted mt-1">
                        Current PM: <span className="font-medium text-gray-700">
                          {users.find(u => u.id === proj.pmId)?.name || 'Unassigned'}
                        </span>
                        {proj.createdBy && (
                          <>
                            {' '} • Created by: <span className="font-medium text-gray-700">
                              {users.find(u => u.id === proj.createdBy)?.name || 'Unknown'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => openProjectReassignmentModal(proj)}
                        className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors whitespace-nowrap"
                        title="Reassign PM"
                      >
                        <SlidersHorizontal size={14} />
                        Change PM
                      </button>
                      <button
                        onClick={() => handleDeleteProject(proj)}
                        className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors whitespace-nowrap"
                        title="Delete Project"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* AI PROMPTS TAB */}
        {activeTab === 'prompts' && (
          <div>
            <div className="px-6 py-4 bg-light border-b border-gray-200">
              <h3 className="font-bold text-gray-800">AI Prompts</h3>
              <p className="text-xs text-muted mt-1">System prompts sent to Claude for server-side AI features. Edit here to change wording without a code deploy.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {aiPrompts.map(prompt => (
                <div key={prompt.id} className="p-4 hover:bg-light px-6 flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-primary flex items-center gap-2">
                      {prompt.name}
                      <span className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded border border-gray-200">{prompt.key}</span>
                    </div>
                    {prompt.description && (
                      <div className="text-xs text-muted mt-1">{prompt.description}</div>
                    )}
                    <div className="flex gap-3 text-xs text-muted mt-2 items-center flex-wrap">
                      <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-200 font-mono">{prompt.model}</span>
                      <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-200">{prompt.maxTokens} max tokens</span>
                    </div>
                  </div>
                  <button
                    onClick={() => openPromptModal(prompt)}
                    className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors whitespace-nowrap"
                  >
                    <Edit2 size={13} /> Edit Prompt
                  </button>
                </div>
              ))}
              {aiPrompts.length === 0 && (
                <div className="p-8 text-center text-gray-400">No AI prompts found.</div>
              )}
            </div>

            {/* PROMPT LIBRARY — user-saved prompts, never executed by the app. Copy them (or
                open claude.ai prefilled) to use directly in Claude chat outside the app. */}
            <div className="px-6 py-4 bg-light border-y border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2"><BookOpen size={16} className="text-indigo-500" /> Prompt Library</h3>
                <p className="text-xs text-muted mt-1">Your saved prompts for use with Claude chat outside the app — copy one, or open it directly in Claude. The app never runs these.</p>
              </div>
              <button
                onClick={() => setEditingLibEntry({ title: '', description: '', promptText: '' })}
                className="flex items-center gap-1.5 text-xs bg-indigo-600 text-white rounded px-3 py-2 font-medium hover:bg-indigo-700 whitespace-nowrap"
              >
                <Plus size={14} /> Add Prompt
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {promptLibrary.map(entry => (
                <div key={entry.id} className="p-4 hover:bg-light px-6 flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-primary">{entry.title}</div>
                    {entry.description && (
                      <div className="text-xs text-muted mt-1">{entry.description}</div>
                    )}
                    <div className="text-xs text-gray-500 mt-2 font-mono bg-gray-50 border border-gray-100 rounded px-2 py-1.5 line-clamp-2 whitespace-pre-wrap break-words">
                      {entry.promptText}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <button
                      onClick={() => handleCopyLibPrompt(entry)}
                      className={`flex items-center gap-1 text-xs border rounded px-3 py-1.5 transition-colors whitespace-nowrap ${copiedPromptId === entry.id ? 'border-emerald-300 text-emerald-700 bg-emerald-50' : 'border-gray-200 text-gray-600 hover:bg-light hover:text-indigo-600'}`}
                    >
                      {copiedPromptId === entry.id ? <CheckCircle size={13} /> : <Copy size={13} />}
                      {copiedPromptId === entry.id ? 'Copied' : 'Copy'}
                    </button>
                    <a
                      href={`https://claude.ai/new?q=${encodeURIComponent(entry.promptText)}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Open a new Claude chat with this prompt prefilled"
                      className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors whitespace-nowrap"
                    >
                      <ExternalLink size={13} /> Open in Claude
                    </a>
                    <button
                      onClick={() => setEditingLibEntry({ id: entry.id, title: entry.title, description: entry.description ?? '', promptText: entry.promptText })}
                      className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors whitespace-nowrap"
                    >
                      <Edit2 size={13} /> Edit
                    </button>
                    <button
                      onClick={() => handleDeleteLibEntry(entry)}
                      className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors whitespace-nowrap"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {promptLibrary.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">
                  No saved prompts yet. Add one to build your team's library for Claude chat.
                </div>
              )}
            </div>

            {/* TRANSLATION VERBATIMS — exact phrases AI translation must never alter. They are
                frozen into opaque tokens before the text reaches the model, so they survive
                every translation byte-identical. */}
            <div className="px-6 py-4 bg-light border-y border-gray-200 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-gray-800 flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-600" /> Translation Verbatims</h3>
                <p className="text-xs text-muted mt-1">
                  Regulation phrases with official wording per language. When the English phrase appears in a text being translated,
                  the stored wording for the target language is substituted directly — the AI never translates it. Languages without
                  stored wording keep the English phrase unchanged (right for identifiers like “(EU) 2019/2016”). Add more as you find them.
                </p>
              </div>
              <button
                onClick={() => setEditingVerbatim({ phrase: '', note: '', translations: {} })}
                className="flex items-center gap-1.5 text-xs bg-emerald-600 text-white rounded px-3 py-2 font-medium hover:bg-emerald-700 whitespace-nowrap"
              >
                <Plus size={14} /> Add Verbatim
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {verbatims.map(entry => (
                <div key={entry.id} className="p-3 hover:bg-light px-6 flex justify-between items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm text-gray-800 bg-gray-50 border border-gray-100 rounded px-2 py-0.5 break-words">{entry.phrase}</span>
                    <span
                      className={`text-[10px] font-bold ml-2 px-1.5 py-0.5 rounded-full border ${Object.keys(entry.translations).length ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}
                      title={Object.keys(entry.translations).length ? `Official wording stored for: ${Object.keys(entry.translations).map(c => c.toUpperCase()).join(', ')}` : 'No per-language wording stored — the English phrase is kept as-is in every language'}
                    >
                      {Object.keys(entry.translations).length ? `${Object.keys(entry.translations).length} lang` : 'as-is'}
                    </span>
                    {entry.note && <span className="text-xs text-muted ml-2">{entry.note}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setEditingVerbatim({ id: entry.id, phrase: entry.phrase, note: entry.note ?? '', translations: { ...entry.translations } })}
                      className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors whitespace-nowrap"
                    >
                      <Edit2 size={13} /> Edit
                    </button>
                    <button
                      onClick={() => handleDeleteVerbatim(entry)}
                      className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors whitespace-nowrap"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {verbatims.length === 0 && (
                <div className="p-8 text-center text-gray-400 text-sm">
                  No verbatims yet. Add regulation phrases and standard identifiers that translations must never change.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal for Categories/Attributes/Suppliers */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-gray-800 capitalize">
                {editingItem?.id ? 'Edit' : 'Add'} {modalType}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSaveItem} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input 
                  required 
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
                  value={editingItem.name} 
                  onChange={e => setEditingItem({...editingItem, name: e.target.value})} 
                  placeholder={`e.g. ${modalType === 'category' ? 'Tower Fans' : modalType === 'attribute' ? 'Power' : 'Supplier Name'}`}
                />
              </div>

              {/* Parent picker. Deliberately not required: leaving it unset parks the leaf in
                  the Uncategorised bucket, which is how legacy rows that predate the tree are
                  kept usable until someone files them. */}
              {modalType === 'category' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Parent (L1 › L2)
                  </label>
                  <select
                    value={editingItem.l2Id ?? ''}
                    onChange={e => setEditingItem({ ...editingItem, l2Id: e.target.value || null })}
                    className="w-full border border-gray-300 p-2.5 rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="">— Uncategorised —</option>
                    {categoryTree.l1.map(l1 => (
                      <optgroup key={l1.id} label={l1.name}>
                        {categoryTree.l2
                          .filter(l2 => l2.l1Id === l1.id)
                          .map(l2 => (
                            <option key={l2.id} value={l2.id}>{l2.name}</option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted mt-1">
                    Where this category sits in the tree. Leave unset to file it later.
                  </p>
                </div>
              )}

              {modalType === 'attribute' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                      <select
                        className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={editingItem.group ?? 'Category Specific'}
                        onChange={e => setEditingItem({ ...editingItem, group: e.target.value })}
                      >
                        {allGroupOptions.map(g => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Data Type</label>
                      <select
                        className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={editingItem.dataType}
                        onChange={e => { setEditingItem({ ...editingItem, dataType: e.target.value, validationRules: {} }); setEnumOptionsDraft(''); }}
                      >
                        <option value="text">Text (free input)</option>
                        <option value="integer">Integer (whole number)</option>
                        <option value="decimal">Decimal (fractional number)</option>
                        <option value="boolean">Boolean (Yes / No)</option>
                        <option value="enum">Dropdown (fixed options list)</option>
                        <option value="image">Image (single upload)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Placeholder / Hint (optional)</label>
                      <input
                        type="text"
                        className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={editingItem.validationRules?.placeholder || ''}
                        onChange={e => setEditingItem({ ...editingItem, validationRules: { ...editingItem.validationRules, placeholder: e.target.value } })}
                        placeholder="e.g. Enter value in watts"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Akeneo Attribute ID (optional)</label>
                      <input
                        type="text"
                        className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={editingItem.akeneoId || ''}
                        onChange={e => setEditingItem({ ...editingItem, akeneoId: e.target.value || undefined })}
                        placeholder="e.g. power_watt"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="attrRequired"
                        className="w-4 h-4 text-indigo-600 rounded"
                        checked={!!editingItem.validationRules?.required}
                        onChange={e => setEditingItem({ ...editingItem, validationRules: { ...editingItem.validationRules, required: e.target.checked } })}
                      />
                      <label htmlFor="attrRequired" className="text-sm text-gray-700 select-none">Required field</label>
                    </div>

                    {(editingItem.dataType === 'integer' || editingItem.dataType === 'decimal') && (
                      <div className="bg-indigo-50 p-3 rounded-md border border-indigo-200 space-y-3">
                        <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Numeric Rules</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Unit (e.g. W, mm, kg)</label>
                            <input
                              type="text"
                              className="w-full border border-gray-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                              value={editingItem.validationRules?.unit || ''}
                              onChange={e => setEditingItem({ ...editingItem, validationRules: { ...editingItem.validationRules, unit: e.target.value } })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Step</label>
                            <input
                              type="number"
                              className="w-full border border-gray-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                              value={editingItem.validationRules?.step ?? ''}
                              onChange={e => setEditingItem({ ...editingItem, validationRules: { ...editingItem.validationRules, step: e.target.value ? Number(e.target.value) : undefined } })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Min value</label>
                            <input
                              type="number"
                              className="w-full border border-gray-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                              value={editingItem.validationRules?.min ?? ''}
                              onChange={e => setEditingItem({ ...editingItem, validationRules: { ...editingItem.validationRules, min: e.target.value ? Number(e.target.value) : undefined } })}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Max value</label>
                            <input
                              type="number"
                              className="w-full border border-gray-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                              value={editingItem.validationRules?.max ?? ''}
                              onChange={e => setEditingItem({ ...editingItem, validationRules: { ...editingItem.validationRules, max: e.target.value ? Number(e.target.value) : undefined } })}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="attrAllowRange"
                            className="w-4 h-4 text-indigo-600 rounded"
                            checked={!!editingItem.validationRules?.allowRange}
                            onChange={e => setEditingItem({ ...editingItem, validationRules: { ...editingItem.validationRules, allowRange: e.target.checked } })}
                          />
                          <label htmlFor="attrAllowRange" className="text-xs text-gray-700 select-none">Allow range input (min–max)</label>
                        </div>
                      </div>
                    )}

                    {editingItem.dataType === 'enum' && (
                      <div className="bg-indigo-50 p-3 rounded-md border border-indigo-200">
                        <label className="block text-xs font-bold text-indigo-700 uppercase tracking-wide mb-2">Allowed Options</label>
                        <textarea
                          rows={4}
                          className="w-full border border-gray-300 p-2 rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                          placeholder="One option per line, or comma-separated&#10;e.g. Red&#10;Green&#10;Blue"
                          value={enumOptionsDraft}
                          onChange={e => setEnumOptionsDraft(e.target.value)}
                          onBlur={e => {
                            const opts = e.target.value.split(/[\n,]/).map((s: string) => s.trim()).filter(Boolean);
                            setEditingItem({ ...editingItem, validationRules: { ...editingItem.validationRules, enumOptions: opts } });
                          }}
                        />
                        <p className="text-xs text-gray-500 mt-1">Supplier will see a dropdown with only these choices.</p>
                      </div>
                    )}

                    <div className="flex items-start gap-2 border-t border-gray-100 pt-3">
                      <input
                        type="checkbox"
                        id="attrSupplierVisible"
                        className="w-4 h-4 mt-0.5 text-indigo-600 rounded"
                        checked={editingItem.supplierVisible !== false}
                        onChange={e => setEditingItem({ ...editingItem, supplierVisible: e.target.checked })}
                      />
                      <label htmlFor="attrSupplierVisible" className="text-xs text-gray-700 select-none">
                        <span className="font-medium">Ask suppliers for this</span>
                        <span className="block text-gray-500 mt-0.5">
                          Unticked, it stays internal: never shown in the supplier attribute portal, the
                          proposal form or an RFQ. It is still visible to your team everywhere.
                        </span>
                      </label>
                    </div>
                  </>
              )}

              {modalType === 'supplier' && (
                  <>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                          <input 
                            required 
                            className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono" 
                            value={editingItem.code} 
                            onChange={e => setEditingItem({...editingItem, code: e.target.value})} 
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                          <input 
                            required 
                            type="email"
                            className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
                            value={editingItem.email || ''} 
                            onChange={e => setEditingItem({...editingItem, email: e.target.value})} 
                          />
                      </div>
                  </>
              )}
              
              {modalType !== 'attribute' && modalType !== 'supplier' && (
                <div className="flex items-center gap-2 cursor-pointer">
                    <input 
                    type="checkbox" 
                    className="w-4 h-4 text-indigo-600 rounded"
                    checked={editingItem.active}
                    onChange={e => setEditingItem({...editingItem, active: e.target.checked})}
                    id="activeCheck"
                    />
                    <label htmlFor="activeCheck" className="text-sm text-gray-700 select-none">Active</label>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium capitalize"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PM Assignment Modal */}
      {pmAssignmentModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-gray-800">Assign Product Managers</h3>
              <button onClick={() => setPMAssignmentModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Select which Product Managers can manage this supplier:
              </p>

              <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-md p-3 space-y-2">
                {users.filter(u => u.role === UserRole.PM).map(pm => (
                  <div key={pm.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`pm-${pm.id}`}
                      checked={selectedPMsForSupplier.includes(pm.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedPMsForSupplier([...selectedPMsForSupplier, pm.id]);
                        } else {
                          setSelectedPMsForSupplier(selectedPMsForSupplier.filter(id => id !== pm.id));
                        }
                      }}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                    <label htmlFor={`pm-${pm.id}`} className="text-sm text-gray-700 cursor-pointer flex-1">
                      {pm.name} ({pm.email})
                    </label>
                  </div>
                ))}
              </div>

              {selectedPMsForSupplier.length > 0 && (
                <div className="bg-indigo-50 border border-indigo-200 rounded p-3">
                  <p className="text-xs font-medium text-indigo-900 mb-2">Selected PMs:</p>
                  <div className="flex flex-wrap gap-2">
                    {users
                      .filter(u => selectedPMsForSupplier.includes(u.id))
                      .map(pm => (
                        <span key={pm.id} className="bg-indigo-200 text-indigo-900 text-xs px-2 py-1 rounded-full">
                          {pm.name}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  onClick={() => setPMAssignmentModalOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePMAssignment}
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium"
                >
                  Save Assignments
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project PM Reassignment Modal */}
      {projectReassignmentModalOpen && selectedProjectForReassignment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-gray-800">Reassign Project Manager</h3>
              <button onClick={() => setProjectReassignmentModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>

            <div className="space-y-4">
              <div className="bg-indigo-50 border border-indigo-200 rounded p-3">
                <p className="text-sm font-medium text-indigo-900">
                  {selectedProjectForReassignment.name}
                </p>
                <p className="text-xs text-indigo-700 mt-1">
                  Project ID: {selectedProjectForReassignment.projectId}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select New Product Manager
                </label>
                <select
                  value={newPMIdForProject}
                  onChange={(e) => setNewPMIdForProject(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="">-- Choose a PM --</option>
                  {users
                    .filter(u => u.role === UserRole.PM)
                    .map(pm => (
                      <option key={pm.id} value={pm.id}>
                        {pm.name} ({pm.email})
                      </option>
                    ))}
                </select>
              </div>

              {newPMIdForProject && newPMIdForProject !== selectedProjectForReassignment.pmId && (
                <div className="bg-amber-50 border border-amber-200 rounded p-3">
                  <p className="text-xs text-amber-900">
                    Current PM: <span className="font-medium">{users.find(u => u.id === selectedProjectForReassignment.pmId)?.name || 'Unassigned'}</span>
                  </p>
                  <p className="text-xs text-amber-900 mt-1">
                    New PM: <span className="font-medium">{users.find(u => u.id === newPMIdForProject)?.name}</span>
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  onClick={() => setProjectReassignmentModalOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (newPMIdForProject && selectedProjectForReassignment) {
                      handleReassignProject(selectedProjectForReassignment.id, newPMIdForProject);
                    } else {
                      alert('Please select a Product Manager');
                    }
                  }}
                  disabled={!newPMIdForProject}
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reassign PM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Prompt Edit Modal */}
      {promptModalOpen && editingPrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-bold text-lg text-gray-800">{editingPrompt.name}</h3>
              <button onClick={() => setPromptModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            {editingPrompt.description && (
              <p className="text-xs text-muted mb-4">{editingPrompt.description}</p>
            )}

            <form onSubmit={handleSavePrompt} className="space-y-4 overflow-y-auto flex-1 pr-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">System Prompt</label>
                <textarea
                  required
                  rows={14}
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                  value={editingPrompt.systemPrompt}
                  onChange={e => setEditingPrompt({ ...editingPrompt, systemPrompt: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">Keep any {'{{placeholder}}'} tokens exactly as they appear — the server fills them in at request time.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                  <input
                    required
                    type="text"
                    className="w-full border border-gray-300 p-2.5 rounded-md text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={editingPrompt.model}
                    onChange={e => setEditingPrompt({ ...editingPrompt, model: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Tokens</label>
                  <input
                    required
                    type="number"
                    min={1}
                    className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={editingPrompt.maxTokens}
                    onChange={e => setEditingPrompt({ ...editingPrompt, maxTokens: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setPromptModalOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingPrompt}
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium disabled:opacity-50"
                >
                  {savingPrompt ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Prompt Library Add/Edit Modal */}
      {editingLibEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                <BookOpen size={18} className="text-indigo-500" /> {editingLibEntry.id ? 'Edit Prompt' : 'Add Prompt'}
              </h3>
              <button onClick={() => setEditingLibEntry(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-xs text-muted mb-4">Saved to the shared library for use with Claude chat outside the app.</p>

            <form onSubmit={handleSaveLibEntry} className="space-y-4 overflow-y-auto flex-1 pr-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  required
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={editingLibEntry.title}
                  onChange={e => setEditingLibEntry({ ...editingLibEntry, title: e.target.value })}
                  placeholder="e.g. Rewrite safety warnings in plain language"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <input
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={editingLibEntry.description}
                  onChange={e => setEditingLibEntry({ ...editingLibEntry, description: e.target.value })}
                  placeholder="When to use this prompt"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
                <textarea
                  required
                  rows={12}
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                  value={editingLibEntry.promptText}
                  onChange={e => setEditingLibEntry({ ...editingLibEntry, promptText: e.target.value })}
                  placeholder="The full prompt text, ready to paste into Claude…"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingLibEntry(null)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLibEntry}
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium disabled:opacity-50"
                >
                  {savingLibEntry ? 'Saving…' : editingLibEntry.id ? 'Save Changes' : 'Add Prompt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Translation Verbatim Add/Edit Modal */}
      {editingVerbatim && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-600" /> {editingVerbatim.id ? 'Edit Verbatim' : 'Add Verbatim'}
              </h3>
              <button onClick={() => setEditingVerbatim(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-xs text-muted mb-4">
              The English phrase is matched exactly (case-sensitive). In each language's output, the stored official
              wording below is substituted — the AI never translates it. Languages left blank keep the English phrase
              unchanged (right for identifiers like “(EU) 2019/2016”).
            </p>

            <form onSubmit={handleSaveVerbatim} className="space-y-4 overflow-y-auto flex-1 pr-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">English phrase (exact, case-sensitive)</label>
                <input
                  required
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={editingVerbatim.phrase}
                  onChange={e => setEditingVerbatim({ ...editingVerbatim, phrase: e.target.value })}
                  placeholder='e.g. Keep out of reach of children. or (EU) 2019/2016'
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <input
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={editingVerbatim.note}
                  onChange={e => setEditingVerbatim({ ...editingVerbatim, note: e.target.value })}
                  placeholder="Where this comes from / why it must stay verbatim"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Official wording per language</label>
                <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {IM_LANGUAGES.filter(l => l.code !== 'en').map(l => (
                    <div key={l.code} className="flex items-center gap-3 px-3 py-1.5">
                      <span className="text-xs font-mono font-semibold text-gray-500 w-8 shrink-0 uppercase">{l.code}</span>
                      <input
                        className="flex-1 border-0 bg-transparent text-sm py-1 focus:ring-0 outline-none placeholder:text-gray-300"
                        value={editingVerbatim.translations[l.code] ?? ''}
                        onChange={e => setEditingVerbatim({
                          ...editingVerbatim,
                          translations: { ...editingVerbatim.translations, [l.code]: e.target.value },
                        })}
                        placeholder={`${l.name} — blank keeps the English phrase`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingVerbatim(null)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingVerbatim}
                  className="px-4 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-md text-sm font-medium disabled:opacity-50"
                >
                  {savingVerbatim ? 'Saving…' : editingVerbatim.id ? 'Save Changes' : 'Add Verbatim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign Existing Attribute Modal — promote a category attribute to global */}
      {assignAttrModal && (() => {
        // Category-scoped attributes can be promoted to global; already-global ones are excluded.
        const assignable = attributes.filter(a => a.categoryId !== null);
        const filtered = assignable.filter(a =>
          a.name.toLowerCase().includes(assignAttrSearch.toLowerCase()) ||
          (a.group ?? 'Category Specific').toLowerCase().includes(assignAttrSearch.toLowerCase()) ||
          (categories.find(c => c.id === a.categoryId)?.name ?? '').toLowerCase().includes(assignAttrSearch.toLowerCase())
        );
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[80vh]">
              <div className="flex justify-between items-center mb-1">
                <h3 className="font-bold text-lg text-gray-800">Assign Existing Attribute</h3>
                <button onClick={() => setAssignAttrModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
              </div>
              <p className="text-xs text-muted mb-4">
                Pick an attribute to make it <span className="font-semibold text-gray-700">global</span>. It keeps its group and will appear on every category automatically.
              </p>

              <div className="relative mb-3">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search by name, group or category…"
                  value={assignAttrSearch}
                  onChange={e => setAssignAttrSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>

              <div className="overflow-y-auto flex-1 border border-gray-200 rounded-lg divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-400 italic">
                    {assignable.length === 0
                      ? 'No category attributes available to make global.'
                      : 'No attributes match your search.'}
                  </div>
                ) : filtered.map(a => {
                  const originName = categories.find(c => c.id === a.categoryId)?.name ?? 'Unknown';
                  const groupName = a.group ?? 'Category Specific';
                  return (
                    <div key={a.id} className="flex items-center justify-between px-4 py-3 hover:bg-light transition-colors">
                      <div>
                        <div className="font-medium text-sm text-gray-800">{a.name}</div>
                        <div className="text-xs text-muted mt-0.5 capitalize">
                          {a.dataType}{a.validationRules?.unit ? ` · ${a.validationRules.unit}` : ''} · <span className="text-indigo-500 normal-case">{groupName}</span> · from <span className="text-violet-500 normal-case">{originName}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleAssignAttribute(a.id)}
                        disabled={assigningAttrId === a.id}
                        className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-800 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded border border-violet-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <LinkIcon size={12} /> {assigningAttrId === a.id ? 'Assigning…' : 'Make Global'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-100 mt-3">
                <button
                  onClick={() => setAssignAttrModal(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Link an attribute owned by another category into the current one (shared assignment). */}
      {linkAttrModal && (() => {
        const targetName = categories.find(c => c.id === selectedCategoryDetail)?.name ?? 'this category';
        // Candidates: category-scoped attributes that live in a *different* category and aren't
        // already linked here. Globals are excluded (they already apply to every category).
        const linkable = attributes.filter(a =>
          a.categoryId !== null &&
          a.categoryId !== selectedCategoryDetail &&
          !(a.assignedCategoryIds ?? []).includes(selectedCategoryDetail!)
        );
        const q = linkAttrSearch.toLowerCase();
        const filtered = linkable.filter(a =>
          a.name.toLowerCase().includes(q) ||
          (a.group ?? 'Category Specific').toLowerCase().includes(q) ||
          (categories.find(c => c.id === a.categoryId)?.name ?? '').toLowerCase().includes(q)
        );
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[80vh]">
              <div className="flex justify-between items-center mb-1">
                <h3 className="font-bold text-lg text-gray-800">Link Attribute from Another Category</h3>
                <button onClick={() => setLinkAttrModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
              </div>
              <p className="text-xs text-muted mb-4">
                Reuse an attribute defined in another category by linking it into <span className="font-semibold text-gray-700">{targetName}</span>. It stays a single shared definition — no duplicate is created, and edits apply everywhere it's used.
              </p>

              <div className="relative mb-3">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search by name, group or category…"
                  value={linkAttrSearch}
                  onChange={e => setLinkAttrSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>

              <div className="overflow-y-auto flex-1 border border-gray-200 rounded-lg divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-400 italic">
                    {linkable.length === 0
                      ? 'No attributes from other categories available to link.'
                      : 'No attributes match your search.'}
                  </div>
                ) : filtered.map(a => {
                  const originName = categories.find(c => c.id === a.categoryId)?.name ?? 'Unknown';
                  const groupName = a.group ?? 'Category Specific';
                  const alsoSharedCount = (a.assignedCategoryIds ?? []).length;
                  return (
                    <div key={a.id} className="flex items-center justify-between px-4 py-3 hover:bg-light transition-colors">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-gray-800 truncate">{a.name}</div>
                        <div className="text-xs text-muted mt-0.5 capitalize">
                          {a.dataType}{a.validationRules?.unit ? ` · ${a.validationRules.unit}` : ''} · <span className="text-indigo-500 normal-case">{groupName}</span> · from <span className="text-violet-500 normal-case">{originName}</span>
                          {alsoSharedCount > 0 && <span className="normal-case text-gray-400"> · shared into {alsoSharedCount} other{alsoSharedCount === 1 ? '' : 's'}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleLinkAttribute(a.id)}
                        disabled={linkingAttrId === a.id}
                        className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-800 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded border border-violet-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                      >
                        <LinkIcon size={12} /> {linkingAttrId === a.id ? 'Linking…' : 'Link here'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end pt-4 border-t border-gray-100 mt-3">
                <button
                  onClick={() => setLinkAttrModal(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {importModalOpen && (() => {
        const targetName = categories.find(c => c.id === selectedCategoryDetail)?.name ?? 'this category';
        const includedCount = importIncluded.filter(Boolean).length;
        const flaggedCount = importRows.filter((r, i) => importIncluded[i] && r.flags.length > 0).length;
        let newCount = 0, linkCount = 0, existsCount = 0;
        importRows.forEach((r, i) => {
          if (!importIncluded[i]) return;
          const s = importRowStatus(r);
          if (s === 'link') linkCount++;
          else if (s === 'exists') existsCount++;
          else newCount++;
        });
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl p-6 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[88vh]">
              <div className="flex justify-between items-center mb-1">
                <h3 className="font-bold text-lg text-gray-800">Import Attributes</h3>
                <button onClick={() => setImportModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
              </div>
              <p className="text-xs text-muted mb-4">
                Bulk-create attributes for <span className="font-semibold text-gray-700">{targetName}</span>.
                <span className="font-medium text-slate-600"> Category</span> rows are added only to this category;
                <span className="font-medium text-indigo-600"> Global</span> rows are shared across every category.
                Change any row's <strong>Group</strong> below before importing to move it between scopes. Re-importing updates existing rows instead of duplicating them.
              </p>

              <div className="flex items-center gap-4 mb-3 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={importMode === 'add'} onChange={() => setImportMode('add')} />
                  <span className={importMode === 'add' ? 'font-semibold text-gray-800' : 'text-gray-600'}>Add missing only</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />
                  <span className={importMode === 'replace' ? 'font-semibold text-rose-700' : 'text-gray-600'}>Replace this category's attributes</span>
                </label>
              </div>
              {importMode === 'replace' && (
                <div className="mb-4 flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    The source is treated as the truth. Anything still in the import is matched and updated
                    <strong> in place</strong> — its id survives, so SKU values and IM references keep working.
                    Anything the import does not mention is deleted (if this category owns it) or un-shared.
                  </span>
                </div>
              )}
              {importMode === 'replace' && (
                <label className="mb-4 -mt-2 flex items-start gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={replaceIncludeGlobals}
                    onChange={e => setReplaceIncludeGlobals(e.target.checked)}
                  />
                  <span className={replaceIncludeGlobals ? 'text-rose-700' : 'text-gray-600'}>
                    <span className="font-medium">Also delete global attributes not in this import</span>
                    <span className="block text-gray-500 mt-0.5">
                      Leaves this category holding <em>only</em> the imported attributes. A global applies to
                      every category, so this deletes it <strong>everywhere</strong> — for clearing out
                      leftovers, not for a routine import.
                    </span>
                  </span>
                </label>
              )}

              <div className="flex items-center gap-1 mb-4 border-b border-gray-100">
                {([['csv', 'CSV file'], ['producttoolkit', 'ProductToolkit']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => switchImportSource(key)}
                    className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px ${importSource === key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {importSource === 'csv' ? (
                <div className="flex items-center gap-3 mb-4">
                  <label className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow cursor-pointer">
                    <Upload size={16} /> Choose CSV file
                    <input type="file" accept=".csv,text/csv,application/vnd.ms-excel,.xlsx" onChange={handleImportFile} className="hidden" />
                  </label>
                  {importFileName && <span className="text-sm text-gray-600 truncate">{importFileName}</span>}
                </div>
              ) : (
                <div className="mb-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleLoadFromProductToolkit}
                      disabled={ptLoading}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow disabled:opacity-50"
                    >
                      {ptLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      {ptLoading ? 'Loading…' : `Load definition for "${targetName}"`}
                    </button>
                    <button
                      onClick={() => void buildSyncPlan({})}
                      disabled={syncBusy}
                      title="Compare the live definition against what is here, and show what each change would break"
                      className="flex items-center gap-2 px-4 py-2 bg-white text-indigo-700 border border-indigo-200 rounded-md hover:bg-indigo-50 text-sm font-medium disabled:opacity-50"
                    >
                      {syncBusy ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                      {syncBusy ? 'Checking…' : 'Review sync'}
                    </button>
                    {importFileName && <span className="text-sm text-gray-600 truncate">{importFileName}</span>}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">
                    Reads the product team's curated definition for this category, matched by exact name.
                    It is served only on the internal network, so this needs the VPN. The definition is what the
                    team decided the category should have — it is not a live read of Akeneo, so review the rows before importing.
                  </p>
                  {ptUnmatched !== null && ptUnmatched.length > 0 && (
                    <details className="mt-2 text-[11px] text-gray-500">
                      <summary className="cursor-pointer hover:text-gray-700">
                        {ptUnmatched.length} ProductToolkit {ptUnmatched.length === 1 ? 'category matches' : 'categories match'} no OriginFlow category
                      </summary>
                      <div className="mt-1 pl-3 text-gray-400 max-h-24 overflow-auto">{ptUnmatched.join(' · ')}</div>
                    </details>
                  )}
                </div>
              )}

              {ptNotice && (
                <div className="mb-3 flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{ptNotice}</span>
                </div>
              )}

              {importError && (
                <div className="mb-3 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{importError}</span>
                </div>
              )}

              {syncPlan && (() => {
                const planRows = syncPlan.items.filter(i => i.action !== 'unchanged');
                const sev = (i: typeof planRows[number]) =>
                  i.risks.some(r => r.level === 'breaking') ? 'breaking'
                  : i.risks.some(r => r.level === 'warning') ? 'warning' : 'ok';
                return (
                  <>
                    <div className="text-xs text-gray-600 mb-2 flex flex-wrap gap-x-3 gap-y-1">
                      <span><span className="font-semibold">{syncPlan.counts.update}</span> to update</span>
                      <span className="text-emerald-600 font-medium">{syncPlan.counts.create} new</span>
                      <span className="text-gray-400">{syncPlan.counts.unchanged} unchanged</span>
                      {syncPlan.counts.absent > 0 && (
                        <span className="text-amber-600 font-medium">{syncPlan.counts.absent} no longer in the definition</span>
                      )}
                      {syncPlan.breakingCount > 0 && (
                        <span className="text-rose-600 font-bold">{syncPlan.breakingCount} would break data</span>
                      )}
                    </div>
                    {syncPlan.breakingCount > 0 && (
                      <div className="mb-3 flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>
                          Changes flagged <strong>breaking</strong> are unticked by default &mdash; each would strand data that
                          already points at the attribute. If an attribute was renamed upstream, use <strong>Match to</strong> to
                          point it at the existing attribute instead of creating a second one.
                        </span>
                      </div>
                    )}
                    <div className="overflow-auto flex-1 border border-gray-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-light sticky top-0">
                          <tr className="text-left text-gray-500">
                            <th className="px-2 py-2 w-8"></th>
                            <th className="px-2 py-2">Attribute</th>
                            <th className="px-2 py-2">Action</th>
                            <th className="px-2 py-2">Changes &amp; risk</th>
                            <th className="px-2 py-2">Used by</th>
                            <th className="px-2 py-2 min-w-[190px]">Match to</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {planRows.map(i => {
                            const level = sev(i);
                            const rowName = i.incoming?.name ?? i.existing?.name ?? '—';
                            const applicable = i.action === 'create' || i.action === 'update';
                            return (
                              <tr key={i.key} className={level === 'breaking' ? 'bg-rose-50/40' : 'hover:bg-light'}>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="checkbox"
                                    disabled={!applicable}
                                    checked={syncIncluded.has(i.key)}
                                    onChange={() => setSyncIncluded(prev => {
                                      const n = new Set(prev);
                                      if (n.has(i.key)) n.delete(i.key); else n.add(i.key);
                                      return n;
                                    })}
                                  />
                                </td>
                                <td className="px-2 py-1.5 font-medium text-gray-800">
                                  {rowName}
                                  {i.matchedBy === 'name' && (
                                    <span
                                      className="ml-1 text-[9px] font-bold uppercase text-amber-600 bg-amber-50 px-1 py-0.5 rounded"
                                      title="Matched only by name, across a group change. Confirm this is the same attribute."
                                    >weak match</span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5">
                                  <span className={
                                    i.action === 'create' ? 'text-emerald-600 font-medium'
                                    : i.action === 'absent' ? 'text-amber-600 font-medium' : 'text-gray-600'}>
                                    {i.action === 'absent' ? 'not in definition' : i.action}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-gray-500 max-w-[300px]">
                                  {i.changes.map(c => (
                                    <div key={c.field} className="truncate">
                                      <span className="text-gray-400">{c.field}:</span> {c.from} &rarr; <strong className="text-gray-700">{c.to}</strong>
                                    </div>
                                  ))}
                                  {i.risks.map((r, n) => (
                                    <div
                                      key={n}
                                      className={`mt-0.5 ${r.level === 'breaking' ? 'text-rose-600' : r.level === 'warning' ? 'text-amber-600' : 'text-gray-400'}`}
                                    >{r.message}</div>
                                  ))}
                                  {i.changes.length === 0 && i.risks.length === 0 && '—'}
                                </td>
                                <td className="px-2 py-1.5 tabular-nums text-gray-500">
                                  {usageTotal(i.usage) || '—'}
                                </td>
                                <td className="px-2 py-1.5">
                                  {i.incoming ? (
                                    <select
                                      value={syncRemap[i.key] ?? '__auto__'}
                                      onChange={e => setRemap(i.key, e.target.value)}
                                      className="border border-gray-200 rounded px-1 py-0.5 text-xs bg-white w-full max-w-[180px]"
                                    >
                                      <option value="__auto__">Auto{i.existing ? ` (${i.matchedBy})` : ' (new)'}</option>
                                      <option value="">Force new attribute</option>
                                      {getAttributesForCategory(attributes, selectedCategoryDetail!).map(a => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                      ))}
                                    </select>
                                  ) : <span className="text-gray-300">&mdash;</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}

              {!syncPlan && importRows.length > 0 && (
                <>
                  <div className="text-xs text-gray-600 mb-2">
                    <span className="font-semibold">{includedCount}</span> selected of {importRows.length} ·{' '}
                    <span className="text-emerald-600 font-medium">{newCount} new</span> ·{' '}
                    <span className="text-violet-600 font-medium">{linkCount} link</span> ·{' '}
                    <span className="text-gray-500 font-medium">{existsCount} already here</span>
                    {flaggedCount > 0 && <> · <span className="text-rose-600 font-medium">{flaggedCount} flagged</span></>}
                  </div>
                  <div className="overflow-auto flex-1 border border-gray-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-light sticky top-0">
                        <tr className="text-left text-gray-500">
                          <th className="px-2 py-2 w-8"></th>
                          <th className="px-2 py-2">Attribute</th>
                          <th className="px-2 py-2">Group</th>
                          <th className="px-2 py-2">Type</th>
                          <th className="px-2 py-2">Options / Unit</th>
                          <th className="px-2 py-2">Akeneo</th>
                          <th className="px-2 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {importRows.map((r, i) => {
                          // Scope comes from the row (PT states it); the group name no longer
                          // implies it, so inferring here would mislabel every synced global.
                          const isGlobal = resolvesToGlobal(r);
                          const status = importRowStatus(r);
                          return (
                            <tr key={i} className={`hover:bg-light ${!importIncluded[i] ? 'opacity-40' : ''}`}>
                              <td className="px-2 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={importIncluded[i]}
                                  onChange={() => setImportIncluded(prev => prev.map((v, j) => j === i ? !v : v))}
                                />
                              </td>
                              <td className="px-2 py-1.5 font-medium text-gray-800">
                                {r.name}
                                {r.required && (
                                  <span className="ml-1 text-rose-500" title="Marked mandatory by the source — imported as a required attribute">*</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-1">
                                  <select
                                    value={r.group}
                                    onChange={e => setImportRowGroup(i, e.target.value)}
                                    className="border border-gray-200 rounded px-1 py-0.5 text-xs text-indigo-700 bg-white max-w-[150px] focus:ring-1 focus:ring-indigo-400 outline-none"
                                  >
                                    {allGroupOptions.map(g => (
                                      <option key={g} value={g}>{g}</option>
                                    ))}
                                  </select>
                                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase ${isGlobal ? 'text-indigo-500 bg-indigo-50' : 'text-slate-500 bg-slate-100'}`}>
                                    {isGlobal ? 'Global' : 'Category'}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-1.5 capitalize">{r.dataType}</td>
                              <td className="px-2 py-1.5 text-gray-500 max-w-[220px] truncate">
                                {r.dataType === 'enum'
                                  ? (r.enumOptions?.length ? `${r.enumOptions.length}: ${r.enumOptions.join(', ')}` : '—')
                                  : (r.unit ? `unit: ${r.unit}` : '—')}
                              </td>
                              <td className="px-2 py-1.5 text-gray-400 font-mono text-[10px]">{r.akeneoId ?? '—'}</td>
                              <td className="px-2 py-1.5">
                                {status === 'link'
                                  ? <span className="text-violet-600 font-medium" title="Already exists in another category — will be shared into this one">Link</span>
                                  : status === 'exists'
                                    ? <span className="text-gray-400 font-medium" title="Already applies to this category — nothing to do">Already here</span>
                                    : <span className="text-emerald-600 font-medium">New</span>}
                                {r.flags.length > 0 && (
                                  <span className="ml-1 inline-flex items-center gap-0.5 text-rose-500" title={r.flags.join('\n')}>
                                    <AlertTriangle size={11} />
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {flaggedCount > 0 && (
                    <p className="text-[11px] text-gray-400 mt-2">
                      ⚠ = needs review (hover the icon). Flagged rows are still importable — you can fix them afterward in the attribute editor.
                    </p>
                  )}
                </>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 mt-3">
                <button
                  onClick={() => setImportModalOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                {syncPlan ? (
                  <button
                    onClick={handleApplySync}
                    disabled={syncBusy || syncIncluded.size === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncBusy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    {syncBusy ? 'Applying…' : `Apply ${syncIncluded.size} change${syncIncluded.size === 1 ? '' : 's'}`}
                  </button>
                ) : (
                <button
                  onClick={handleConfirmImport}
                  disabled={importing || includedCount === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload size={16} /> {importing ? 'Importing…' : `Import ${includedCount} attribute${includedCount === 1 ? '' : 's'}`}
                </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </Layout>
  );
};

export default AdminDashboard;