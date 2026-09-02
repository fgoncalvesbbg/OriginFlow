
/** Compliance library: manage categories, requirements, attributes (with AI-assisted authoring). */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import {
  getCategories, getComplianceRequirements,
  saveRequirement, deleteRequirement, addStandardRequirements,
  getCategoryAttributes,
  getComplianceSections, addComplianceSection, deleteComplianceSection,
  getRegulations, collectBlocks,
  COMPLIANCE_SECTIONS
} from '../../services';
import { CategoryL3, ComplianceRequirement, CategoryAttribute, FeatureConditionFields, Regulation } from '../../types';
import { getAttributesForCategory } from '../../utils';
import { distinctL1, distinctL2, filterCategories } from '../../utils/category-tree.utils';
// Added comment above fix: Adding missing X icon to lucide-react imports
import { Plus, Edit2, Trash2, ArrowLeft, CheckCircle, RefreshCw, Folder, FolderOpen, Clock, Building, FileCheck, X, GitBranch, Lock, Globe, Search, Scale, Ban } from 'lucide-react';

// Sentinel "category" id for the global requirements view — requirements stored with
// categoryId = null apply to every category.
const GLOBAL_VIEW = '__global__';

/** Human-readable "applies if" description for a requirement's attribute condition, or null when unconditioned. */
const describeRequirementCondition = (cond: FeatureConditionFields | null | undefined, attrs: CategoryAttribute[]): string | null => {
  if (!cond) return null;
  const condAttrId = cond.requires_feature ?? cond.requires_feature_absent ?? null;
  if (!condAttrId) return null;
  const condAttr = attrs.find(a => a.id === condAttrId);
  const name = condAttr?.name ?? 'attribute';
  if (cond.requires_feature_absent) return `${name}: absent`;
  if (cond.requires_feature_label) return `${name} ∈ ${cond.requires_feature_label}`;
  if (cond.requires_feature_num_min && cond.requires_feature_num_max) return `${name}: ${cond.requires_feature_num_min}–${cond.requires_feature_num_max}`;
  if (cond.requires_feature_num_min) return `${name} ≥ ${cond.requires_feature_num_min}`;
  if (cond.requires_feature_num_max) return `${name} ≤ ${cond.requires_feature_num_max}`;
  return `${name}: has value`;
};

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const ConfirmationModal: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isAlert?: boolean;
}> = ({ isOpen, title, message, onConfirm, onCancel, isAlert }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-primary mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          {!isAlert && (
            <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
          )}
          <button onClick={onConfirm} className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-sm font-medium">
            {isAlert ? 'OK' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ComplianceLibrary: React.FC = () => {
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [attributes, setAttributes] = useState<CategoryAttribute[]>([]);
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [customSections, setCustomSections] = useState<string[]>([]);
  const [newSectionInput, setNewSectionInput] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedCategoryForReqs, setSelectedCategoryForReqs] = useState<string | null>(null);

  // Category-table filters for the requirements picker.
  const [reqSearch, setReqSearch] = useState('');
  const [reqL1, setReqL1] = useState('');
  const [reqL2, setReqL2] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(COMPLIANCE_SECTIONS));
  
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [newSectionName, setNewSectionName] = useState('');

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isAlert?: boolean;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [c, r, a, s, regs] = await Promise.all([
        getCategories(), getComplianceRequirements(), getCategoryAttributes(), getComplianceSections(),
        getRegulations()
      ]);
      setCategories(c);
      setRequirements(r);
      setAttributes(a);
      setCustomSections(s);
      setRegulations(regs);
    } catch (error) {
      console.error("Failed to load library data", error);
    } finally {
      setLoading(false);
    }
  };

  const showAlert = (title: string, message: string) => {
    setModalState({
      isOpen: true,
      title,
      message,
      isAlert: true,
      onConfirm: () => setModalState(prev => ({ ...prev, isOpen: false }))
    });
  };

  const showConfirm = (title: string, message: string, onConfirmAction: () => Promise<void> | void) => {
    setModalState({
      isOpen: true,
      title,
      message,
      isAlert: false,
      onConfirm: async () => {
        await onConfirmAction();
        setModalState(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Regulations by id, so a row can name the law behind it without an N+1 lookup.
  const regulationById = useMemo(
    () => new Map(regulations.map(r => [r.id, r])),
    [regulations],
  );

  /** Regulations whose expiry is currently stopping work (migration 140). */
  const blockedRegulationIds = useMemo(
    () => new Set(collectBlocks(regulations, regulations).map(b => b.regulationId)),
    [regulations],
  );

  /**
   * Linking a requirement to a regulation carries its TCF description across, but ONLY
   * into an empty description. Overwriting text somebody wrote would be the kind of silent
   * edit that makes people stop trusting the picker — and the description is what the
   * supplier actually reads.
   */
  const applyRegulationLink = (item: any, regulationId: string | null) => {
    const reg = regulationId ? regulationById.get(regulationId) : null;
    setEditingItem({
      ...item,
      regulationId,
      // A clause belongs to one document, so changing the regulation must drop it —
      // otherwise the requirement quietly cites a clause of a different standard.
      clauseId: null,
      referenceCode: reg ? reg.referenceCode : item.referenceCode,
      description: !item.description?.trim() && reg?.tcfDescription ? reg.tcfDescription : item.description,
      title: !item.title?.trim() && reg ? reg.referenceCode : item.title,
    });
  };

  /**
   * Narrowing a requirement to one clause (migration 141). Its TCF description, when the
   * clause has one, is more specific than the regulation's and fills an empty description
   * the same way the regulation's does — never overwriting text somebody wrote.
   */
  const applyClauseLink = (item: any, clauseId: string | null) => {
    const reg = item.regulationId ? regulationById.get(item.regulationId) : null;
    const clause = clauseId ? reg?.clauses?.find(c => c.id === clauseId) : null;
    setEditingItem({
      ...item,
      clauseId,
      description: !item.description?.trim() && clause?.tcfDescription
        ? clause.tcfDescription
        : item.description,
    });
  };

  const handleSaveRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        const item = editingItem as ComplianceRequirement;
        // Global view (or an item explicitly marked global) saves with categoryId = null.
        const isGlobal = selectedCategoryForReqs === GLOBAL_VIEW || item.categoryId === null;
        const catId = isGlobal ? null : (item.categoryId || selectedCategoryForReqs);

        if (!isGlobal && !catId) throw new Error("Category ID is missing.");

        // Drop an "enabled but unset" condition (no attribute chosen) back to null.
        let condition = item.condition ?? null;
        if (condition && !condition.requires_feature && !condition.requires_feature_absent) condition = null;

        await saveRequirement({
            ...item,
            categoryId: catId,
            condition,
            id: item.id || generateUUID()
        });
        await persistSectionIfNew(item.section);
        setIsModalOpen(false);
        loadData();
    } catch (err: any) {
        console.error(err);
        showAlert('Error', `Error saving: ${err.message}`);
    }
  };

  const handleDeleteRequirement = (id: string) => {
    showConfirm('Delete Requirement', 'Are you sure you want to delete this requirement?', async () => {
      try {
        await deleteRequirement(id);
        loadData();
      } catch (e: any) {
        console.error(e);
        showAlert('Error', `Failed to delete: ${e.message}`);
      }
    });
  };

  const openAddModal = (sectionName?: string) => {
    const isGlobal = selectedCategoryForReqs === GLOBAL_VIEW;
    const catId = isGlobal ? null : (selectedCategoryForReqs || categories[0]?.id);
    if (!isGlobal && !catId) { showAlert("Notice", "No category selected"); return; }
    setEditingItem({
      categoryId: catId,
      section: sectionName || '',
      title: '', 
      description: '', 
      regulationId: null,
      isMandatory: true,
      appliesByDefault: true,
      condition: null,
      timingType: 'ETD',
      timingWeeks: 0,
      testReportOrigin: 'third_party_mandatory',
      selfDeclarationAccepted: false
    });
    setNewSectionName(sectionName || '');
    setIsModalOpen(true);
  };

  const handleEditRequirement = (req: ComplianceRequirement) => {
    setEditingItem({ 
        ...req,
        timingType: req.timingType || 'ETD',
        timingWeeks: req.timingWeeks || 0,
        testReportOrigin: req.testReportOrigin || 'third_party_mandatory',
        selfDeclarationAccepted: req.selfDeclarationAccepted || false
    });
    setNewSectionName(req.section || '');
    setIsModalOpen(true);
  };

  const handlePreloadDefaults = () => {
      if (!selectedCategoryForReqs) return;
      
      showConfirm('Preload Standards', "This will add standard TCF requirements to this category. Continue?", async () => {
          setLoading(true);
          try {
              await addStandardRequirements(selectedCategoryForReqs);
              await loadData();
          } catch (e: any) {
              console.error(e);
              showAlert('Error', "Failed to preload.");
          } finally {
              setLoading(false);
          }
      });
  }

  const toggleSection = (section: string) => {
      const next = new Set(expandedSections);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      setExpandedSections(next);
  };

  // Built-in sections + user-defined ones + any already referenced by a requirement.
  // Order: built-ins first, then custom (creation order), then legacy free-text values.
  const usedSections = requirements.map(r => r.section).filter(Boolean) as string[];
  const availableSections = Array.from(new Set([...COMPLIANCE_SECTIONS, ...customSections, ...usedSections]));

  // Persist a section the moment a requirement adopts it, so it shows for every category.
  const persistSectionIfNew = async (name?: string) => {
    const clean = (name || '').trim();
    if (!clean || COMPLIANCE_SECTIONS.includes(clean) || customSections.includes(clean)) return;
    await addComplianceSection(clean);
  };

  const handleAddSection = async () => {
    const clean = newSectionInput.trim();
    if (!clean) return;
    if (COMPLIANCE_SECTIONS.includes(clean) || customSections.includes(clean)) { setNewSectionInput(''); return; }
    try {
      await addComplianceSection(clean);
      setNewSectionInput('');
      await loadData();
    } catch (e: any) {
      showAlert('Error', `Failed to add section: ${e.message}`);
    }
  };

  const handleDeleteSection = (name: string) => {
    showConfirm('Delete Section Group', `Remove the "${name}" section group? Requirements already using it keep their label.`, async () => {
      try {
        await deleteComplianceSection(name);
        await loadData();
      } catch (e: any) {
        showAlert('Error', `Failed to delete section: ${e.message}`);
      }
    });
  };

  const renderRequirementsView = () => {
    if (!selectedCategoryForReqs) {
      // A card grid does not survive ~130 categories, so this is a table: one row per L3
      // with its L1/L2, filtered from above. Global Requirements stays pinned as a banner
      // rather than becoming a row — it is not a category and must not sort among them.
      const globalCount = requirements.filter(r => r.categoryId == null).length;
      const l1Options = distinctL1(categories);
      const l2Options = distinctL2(categories, reqL1 || undefined);
      const visible = filterCategories(categories, {
        search: reqSearch,
        l1: reqL1 || undefined,
        l2: reqL2 || undefined,
        includeInactive: false,
      });

      return (
        <div>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Select a Category to Manage Requirements</h3>

            <div
                onClick={() => setSelectedCategoryForReqs(GLOBAL_VIEW)}
                className="mb-4 p-4 rounded-xl border shadow-sm cursor-pointer hover:shadow-md transition-all group flex items-center justify-between bg-amber-50 border-amber-200 hover:border-amber-400"
            >
                <div className="flex items-center gap-3">
                    <Globe size={18} className="text-amber-700" />
                    <div>
                        <h3 className="font-bold text-amber-900 group-hover:text-amber-700 transition-colors">Global Requirements</h3>
                        <p className="text-amber-700/80 text-xs mt-0.5">
                            {globalCount} Requirement{globalCount !== 1 ? 's' : ''} · applied to every category
                        </p>
                    </div>
                </div>
                <span className="text-xs font-medium text-amber-700 flex items-center gap-1">
                    Manage Global <ArrowLeft className="rotate-180" size={12} />
                </span>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200 bg-light">
                    <div className="relative flex-1 min-w-[180px]">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            value={reqSearch}
                            onChange={e => setReqSearch(e.target.value)}
                            placeholder="Search any level…"
                            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                    <select
                        value={reqL1}
                        onChange={e => { setReqL1(e.target.value); setReqL2(''); }}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                        <option value="">All L1</option>
                        {l1Options.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <select
                        value={reqL2}
                        onChange={e => setReqL2(e.target.value)}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                        <option value="">All L2</option>
                        {l2Options.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span className="text-xs text-muted ml-auto">{visible.length} categories</span>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-light border-b border-gray-200 text-xs uppercase tracking-wide text-muted">
                            <tr>
                                <th className="text-left font-semibold px-4 py-2.5">L1</th>
                                <th className="text-left font-semibold px-3 py-2.5">L2</th>
                                <th className="text-left font-semibold px-3 py-2.5">L3 — Category</th>
                                <th className="text-right font-semibold px-3 py-2.5">Requirements</th>
                                <th className="text-left font-semibold px-3 py-2.5">Status</th>
                                <th className="px-4 py-2.5"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {visible.map(cat => {
                                const count = requirements.filter(r => r.categoryId === cat.id).length;
                                return (
                                <tr
                                    key={cat.id}
                                    onClick={() => setSelectedCategoryForReqs(cat.id)}
                                    className={`cursor-pointer transition-colors group ${cat.isFinalized ? 'bg-indigo-50/50 hover:bg-indigo-50' : 'hover:bg-light'}`}
                                >
                                    <td className="px-4 py-2.5 text-muted whitespace-nowrap">{cat.l1Name ?? '—'}</td>
                                    <td className="px-3 py-2.5 text-muted whitespace-nowrap">{cat.l2Name ?? '—'}</td>
                                    <td className="px-3 py-2.5 font-medium text-primary group-hover:text-indigo-600">{cat.name}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{count || '—'}</td>
                                    <td className="px-3 py-2.5">
                                        {cat.isFinalized && (
                                            <span className="text-[10px] font-bold bg-indigo-600 text-white px-1.5 py-0.5 rounded">FINALIZED</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <ArrowLeft className="rotate-180 inline text-gray-300 group-hover:text-indigo-600" size={14} />
                                    </td>
                                </tr>
                                );
                            })}
                            {visible.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={6} className="text-center py-12 text-gray-400">
                                        {categories.length === 0 ? 'No categories found.' : 'No categories match these filters.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
      );
    }

    const isGlobalView = selectedCategoryForReqs === GLOBAL_VIEW;
    const category = isGlobalView ? null : categories.find(c => c.id === selectedCategoryForReqs);
    const globalReqs = requirements.filter(r => r.categoryId == null);
    // In a category view, global requirements appear (locked) alongside the category's own.
    const catReqs = isGlobalView
        ? globalReqs
        : [...globalReqs, ...requirements.filter(r => r.categoryId === selectedCategoryForReqs)];

    const groupedReqs = catReqs.reduce((acc, req) => {
        const sec = req.section || 'General Requirements';
        if (!acc[sec]) acc[sec] = [];
        acc[sec].push(req);
        return acc;
    }, {} as Record<string, ComplianceRequirement[]>);

    // Show every known section group (so newly added/predefined ones are visible even
    // when empty), then any legacy section a requirement uses that isn't in the list.
    const sortedSections = Array.from(new Set([...availableSections, ...Object.keys(groupedReqs)]));

    return (
      <div>
        <button 
          onClick={() => setSelectedCategoryForReqs(null)} 
          className="mb-6 text-sm text-muted hover:text-gray-800 flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 w-fit"
        >
          <ArrowLeft size={16} /> Back to Categories
        </button>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h3 className="text-2xl font-bold text-primary flex items-center gap-3">
              {isGlobalView ? <><Globe size={22} className="text-amber-500" /> Global Requirements</> : category?.name}
              {category?.isFinalized && (
                <span title="Finalized Category">
                  <CheckCircle className="text-indigo-600" size={20} />
                </span>
              )}
            </h3>
            <p className="text-muted text-sm">
              {isGlobalView
                ? 'These requirements apply to every category and appear locked in each one.'
                : 'Managing requirements for this category.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isGlobalView && (
              <>
                <button
                  onClick={handlePreloadDefaults}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-light text-sm font-medium shadow"
                  title="Add standard template requirements"
                >
                  <RefreshCw size={16} /> Preload Standard
                </button>
              </>
            )}
            <button
              onClick={() => openAddModal()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow"
            >
              <Plus size={16} /> Add {isGlobalView ? 'Global ' : ''}Requirement
            </button>
          </div>
        </div>

        {/* Section group management — added groups show for every category */}
        <div className="bg-light border border-gray-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Section Groups</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {availableSections.map(s => {
              const isCustom = !COMPLIANCE_SECTIONS.includes(s);
              return (
                <span key={s} className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${isCustom ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                  {s}
                  {isCustom && (
                    <button type="button" onClick={() => handleDeleteSection(s)} className="text-indigo-400 hover:text-rose-600" title="Delete section group">
                      <X size={12} />
                    </button>
                  )}
                </span>
              );
            })}
            <span className="inline-flex items-center gap-1">
              <input
                type="text"
                placeholder="New section group…"
                value={newSectionInput}
                onChange={e => setNewSectionInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSection(); } }}
                className="border border-gray-300 rounded-md px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <button type="button" onClick={handleAddSection} disabled={!newSectionInput.trim()}
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-40 font-medium">
                <Plus size={12} /> Add
              </button>
            </span>
          </div>
        </div>

        <div className="space-y-6">
          {(
            sortedSections.map((section) => {
                const isExpanded = expandedSections.has(section);
                const items = groupedReqs[section] ?? [];
                return (
                    <div key={section} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow">
                        <div 
                            className="bg-light px-5 py-3 border-b border-gray-200 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => toggleSection(section)}
                        >
                            <div className="flex items-center gap-2">
                                {isExpanded ? <FolderOpen size={18} className="text-indigo-500" /> : <Folder size={18} className="text-gray-400" />}
                                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">{section}</h4>
                                <span className="text-xs text-gray-400 ml-1">({items.length})</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); openAddModal(section); }}
                                className="text-xs flex items-center gap-1 bg-white border border-gray-300 px-2 py-1 rounded text-indigo-600 hover:text-blue-800 hover:bg-indigo-50 font-medium"
                            >
                                <Plus size={14} /> Add to Section
                            </button>
                        </div>
                        
                        {isExpanded && (
                            <div className="divide-y divide-slate-100">
                                {items.length === 0 && (
                                    <div className="px-5 py-4 text-xs text-gray-400">No requirements in this section yet.</div>
                                )}
                                {items.map(r => {
                                const isLocked = !isGlobalView && r.categoryId == null;
                                return (
                                <div key={r.id} className="bg-white p-5 hover:bg-light transition-colors group">
                                    <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-1">
                                        <h4 className="font-bold text-primary text-sm">{r.title}</h4>
                                        {r.isMandatory && <span className="bg-rose-100 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">Mandatory</span>}
                                        {r.categoryId == null && <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"><Globe size={10} /> Global</span>}
                                        {isLocked && <span className="inline-flex items-center gap-1 text-gray-400 text-[10px] font-bold px-1.5 py-0.5 uppercase tracking-wide"><Lock size={10} /> Locked</span>}
                                        </div>
                                        {/* The law behind the ask (migration 139). Internal only —
                                            the supplier portal renders none of this. */}
                                        {(() => {
                                            const reg = r.regulationId ? regulationById.get(r.regulationId) : null;
                                            if (!reg) return null;
                                            const edition = [reg.version, reg.editionYear ? String(reg.editionYear) : ''].filter(Boolean).join(' · ');
                                            return (
                                                <div className="flex flex-wrap items-center gap-2 mb-2 text-[10px]">
                                                    <Link
                                                        to={`/regulations/${reg.id}`}
                                                        className="inline-flex items-center gap-1 font-mono font-bold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded hover:bg-sky-100"
                                                        title={reg.title}
                                                    >
                                                        <Scale size={10} /> {reg.referenceCode}
                                                        {(() => {
                                                            const clause = r.clauseId
                                                                ? reg.clauses?.find(c => c.id === r.clauseId)
                                                                : null;
                                                            return clause
                                                                ? <span className="text-sky-500">§{clause.number}</span>
                                                                : null;
                                                        })()}
                                                    </Link>
                                                    {edition && <span className="text-gray-400">{edition}</span>}
                                                    {reg.lastAmendedAt && <span className="text-gray-400">last change {reg.lastAmendedAt}</span>}
                                                    {reg.versionState === 'newer_available' && (
                                                        <span className="font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                                            Newer version available
                                                        </span>
                                                    )}
                                                    {reg.versionState === 'repealed' && reg.status !== 'expired' && (
                                                        <span className="font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                                            Repealed on EUR-Lex
                                                        </span>
                                                    )}
                                                    {/* Expiry is OUR decision and it stops work, so it outranks the
                                                        EUR-Lex verdict in the row rather than sitting beside it. */}
                                                    {reg.status === 'expired' && (
                                                        <span className={`font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
                                                            blockedRegulationIds.has(reg.id)
                                                                ? 'bg-rose-600 text-white'
                                                                : 'text-amber-800 bg-amber-50 border border-amber-200'
                                                        }`}>
                                                            <Ban size={9} />
                                                            {blockedRegulationIds.has(reg.id)
                                                                ? 'Expired — blocking new requests'
                                                                : 'Expired, replaced'}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                        <p className="text-gray-600 text-xs leading-relaxed mb-3">{r.description}</p>
                                        
                                        <div className="bg-light p-2.5 rounded-xl border border-gray-100 flex flex-wrap gap-x-6 gap-y-2 items-center">
                                            <div className="flex items-center gap-1.5 min-w-[120px]">
                                                <Clock size={12} className="text-gray-400" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Timing</span>
                                                    <span className="text-[10px] font-bold text-gray-700">{r.timingType === 'POST_ETD' ? `ETD + ${r.timingWeeks}w` : 'At ETD'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 min-w-[140px]">
                                                <Building size={12} className="text-gray-400" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Origin</span>
                                                    <span className="text-[10px] font-bold text-gray-700">{r.testReportOrigin === 'supplier_inhouse' ? 'In-House Accepted' : '3rd Party Lab Only'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 min-w-[140px]">
                                                <FileCheck size={12} className="text-gray-400" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Declaration</span>
                                                    <span className="text-[10px] font-bold text-gray-700">{r.selfDeclarationAccepted ? 'Accepted' : 'Report Mandatory'}</span>
                                                </div>
                                            </div>

                                            {(() => {
                                                const desc = describeRequirementCondition(r.condition, attributes);
                                                if (!desc) return null;
                                                return (
                                                    <div className="flex items-center gap-1.5 min-w-[160px]">
                                                        <GitBranch size={12} className="text-indigo-500" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Applies If</span>
                                                            <span className="text-[10px] font-bold text-indigo-700">{desc}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                        </div>
                                    </div>
                                    
                                    {isLocked ? (
                                        <div className="flex items-center gap-1 text-[10px] text-gray-400 whitespace-nowrap" title="Managed in Global Requirements">
                                            <Lock size={12} /> Edit in Global
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                            onClick={() => handleEditRequirement(r)}
                                            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                                            >
                                            <Edit2 size={14} />
                                            </button>
                                            <button
                                            onClick={() => handleDeleteRequirement(r.id)}
                                            className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors"
                                            >
                                            <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )}
                                    </div>
                                </div>
                                );
                                })}
                            </div>
                        )}
                    </div>
                );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <ConfirmationModal
        isOpen={modalState.isOpen}
        title={modalState.title}
        message={modalState.message}
        onConfirm={modalState.onConfirm}
        onCancel={() => setModalState(prev => ({ ...prev, isOpen: false }))}
        isAlert={modalState.isAlert}
      />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-primary">Compliance Library</h1>
        <p className="text-muted">Manage regulatory requirements for your product categories.</p>
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-200 p-6 min-h-[400px]">
        {loading ? <div>Loading...</div> : renderRequirementsView()}
      </div>


      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
               <h3 className="font-bold text-lg text-gray-800 capitalize">
                 {editingItem.id ? 'Edit' : 'Add'} Requirement
               </h3>
               <span className={`text-xs px-2 py-1 rounded font-medium ${(editingItem.categoryId == null) ? 'bg-amber-100 text-amber-800 inline-flex items-center gap-1' : 'bg-indigo-100 text-blue-800'}`}>
                   {editingItem.categoryId == null
                     ? <><Globe size={12} /> Global · All Categories</>
                     : (categories.find(c => c.id === editingItem.categoryId)?.name || 'No Category')}
               </span>
            </div>
            
            <div className="overflow-y-auto p-6 flex-1">
            <form id="reqForm" onSubmit={handleSaveRequirement} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section Group</label>
                <div className="flex gap-2">
                    <select 
                        className="flex-1 border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={editingItem.section || ''}
                        onChange={e => {
                            setEditingItem({...editingItem, section: e.target.value});
                            setNewSectionName(e.target.value);
                        }}
                    >
                        <option value="">-- Select or Type New --</option>
                        {availableSections.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <input 
                        type="text" 
                        placeholder="Or Type New Section Name"
                        className="flex-1 border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={newSectionName}
                        onChange={e => {
                            setNewSectionName(e.target.value);
                            setEditingItem({...editingItem, section: e.target.value});
                        }}
                    />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Requirement Title</label>
                <input 
                  placeholder="e.g. Power Cord Safety" 
                  required 
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
                  value={editingItem.title} 
                  onChange={e => setEditingItem({...editingItem, title: e.target.value})} 
                />
              </div>
              
              {/* The regulation behind this requirement (migration 139). Optional on purpose:
                  BOM, exploded views and packaging artwork are real asks with no law behind
                  them, and forcing a pseudo-regulation for those would pollute the library. */}
              <div className="bg-sky-50/50 border border-sky-200 p-4 rounded-xl space-y-2">
                <label className="block text-sm font-medium text-sky-900 mb-1 flex items-center gap-1.5">
                  <Scale size={14} /> Regulation
                </label>
                <select
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={editingItem.regulationId || ''}
                  onChange={e => applyRegulationLink(editingItem, e.target.value || null)}
                >
                  <option value="">— No regulation (document request only) —</option>
                  {regulations.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.referenceCode} — {r.title.length > 70 ? `${r.title.slice(0, 70)}…` : r.title}
                      {r.status === 'superseded' ? ' (superseded)' : ''}
                    </option>
                  ))}
                </select>
                {(() => {
                  const reg = editingItem.regulationId ? regulationById.get(editingItem.regulationId) : null;
                  const clauses = reg?.clauses ?? [];
                  if (reg && clauses.length > 0) {
                    return (
                      <div>
                        <label className="block text-[11px] font-semibold text-sky-900 mb-1 mt-2">
                          Narrow to a clause (optional)
                        </label>
                        <select
                          className="w-full border border-gray-300 p-2 rounded-md text-xs bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                          value={editingItem.clauseId || ''}
                          onChange={e => applyClauseLink(editingItem, e.target.value || null)}
                        >
                          <option value="">— The whole regulation —</option>
                          {clauses.map(c => (
                            <option key={c.id} value={c.id}>
                              {[c.number, c.qualifier].filter(Boolean).join(' ')}
                              {c.title ? ` — ${c.title}` : ''}
                              {c.amendedIn ? ` (changed in ${c.amendedIn})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }
                  return null;
                })()}
                {(() => {
                  const reg = editingItem.regulationId ? regulationById.get(editingItem.regulationId) : null;
                  if (!reg) {
                    return (
                      <p className="text-[11px] text-gray-500">
                        Link this to the regulation that demands it and the whole library — summary,
                        version, and what the manual must contain — hangs off one row. Leave it unset
                        for a document you simply need, like a BOM or packaging artwork.
                      </p>
                    );
                  }
                  const edition = [reg.version, reg.editionYear ? String(reg.editionYear) : ''].filter(Boolean).join(' · ');
                  return (
                    <div className="text-[11px] text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {edition && <span className="font-semibold">{edition}</span>}
                      {reg.lastAmendedAt && <span>last change {reg.lastAmendedAt}</span>}
                      {reg.versionState === 'newer_available' && (
                        <span className="text-amber-700 font-semibold">A newer version exists</span>
                      )}
                      {reg.versionState === 'repealed' && (
                        <span className="text-rose-700 font-semibold">Repealed</span>
                      )}
                      <Link to={`/regulations/${reg.id}`} className="text-indigo-600 hover:underline ml-auto">
                        Open regulation →
                      </Link>
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reference Code (Optional)</label>
                    <input 
                        placeholder="e.g. EN-60335-1" 
                        className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-50 disabled:text-gray-400" 
                        value={editingItem.referenceCode || ''} 
                        disabled={!!editingItem.regulationId}
                        title={editingItem.regulationId
                          ? 'Taken from the linked regulation, so the two can never disagree.'
                          : undefined}
                        onChange={e => setEditingItem({...editingItem, referenceCode: e.target.value})} 
                    />
                </div>
                <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input 
                        type="checkbox" 
                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                        checked={editingItem.isMandatory}
                        onChange={e => setEditingItem({...editingItem, isMandatory: e.target.checked})}
                    />
                    <span className="text-sm font-medium text-gray-700">Mandatory Requirement</span>
                    </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Long Description</label>
                <textarea 
                  placeholder="Full details of the requirement..." 
                  rows={3}
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" 
                  value={editingItem.description} 
                  onChange={e => setEditingItem({...editingItem, description: e.target.value})} 
                />
              </div>

              <div className="bg-light border border-gray-200 p-4 rounded-xl shadow space-y-4">
                  <h4 className="font-bold text-sm text-gray-800 border-b pb-2 border-gray-200">Submission Rules</h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                      <div>
                          <label className="block text-[10px] font-bold text-muted uppercase mb-1">Timing</label>
                          <select 
                             className="w-full border rounded text-sm p-2 bg-white"
                             value={editingItem.timingType}
                             onChange={(e) => setEditingItem({...editingItem, timingType: e.target.value})}
                          >
                              <option value="ETD">Mandatory at ETD</option>
                              <option value="POST_ETD">Deferred (Post-ETD)</option>
                          </select>
                          {editingItem.timingType === 'POST_ETD' && (
                              <div className="mt-2 flex items-center gap-2">
                                  <span className="text-xs text-gray-600">Due</span>
                                  <input 
                                    type="number" 
                                    min="1"
                                    className="w-16 border rounded p-1 text-center text-sm"
                                    value={editingItem.timingWeeks || ''}
                                    onChange={(e) => setEditingItem({...editingItem, timingWeeks: parseInt(e.target.value) || 0})}
                                  />
                                  <span className="text-xs text-gray-600">weeks after ETD</span>
                              </div>
                          )}
                      </div>

                      <div>
                          <label className="block text-[10px] font-bold text-muted uppercase mb-1">Report Origin</label>
                          <select 
                             className="w-full border rounded text-sm p-2 bg-white"
                             value={editingItem.testReportOrigin}
                             onChange={(e) => setEditingItem({...editingItem, testReportOrigin: e.target.value})}
                          >
                              <option value="third_party_mandatory">3rd Party Lab (Mandatory)</option>
                              <option value="supplier_inhouse">Supplier In-House Test</option>
                          </select>
                      </div>
                  </div>

                  <div className="pt-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input 
                            type="checkbox" 
                            className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                            checked={editingItem.selfDeclarationAccepted}
                            onChange={e => setEditingItem({...editingItem, selfDeclarationAccepted: e.target.checked})}
                        />
                        <span className="text-sm font-medium text-gray-700">Supplier Self-Declaration Accepted</span>
                      </label>
                  </div>
              </div>

              {/* Conditional applicability — mirrors IM block conditions */}
              {(() => {
                const editCatId = editingItem.categoryId || selectedCategoryForReqs;
                const condAttrs = editCatId ? getAttributesForCategory(attributes, editCatId) : [];
                const cond: FeatureConditionFields | null = editingItem.condition ?? null;
                const condEnabled = cond != null;
                const condMode: 'present' | 'absent' = cond?.requires_feature_absent ? 'absent' : 'present';
                const condAttrId = cond?.requires_feature ?? cond?.requires_feature_absent ?? '';
                const condAttr = condAttrs.find(a => a.id === condAttrId);
                const enumSelected = cond?.requires_feature_label ? cond.requires_feature_label.split(',').map(s => s.trim()).filter(Boolean) : [];
                const setCond = (next: FeatureConditionFields | null) => setEditingItem({ ...editingItem, condition: next });

                return (
                  <div className="bg-light border border-gray-200 p-4 rounded-xl shadow space-y-4">
                    <div className="flex items-center justify-between border-b pb-2 border-gray-200">
                      <h4 className="font-bold text-sm text-gray-800 flex items-center gap-2"><GitBranch size={14} className="text-indigo-600" /> Conditional Applicability</h4>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                          checked={condEnabled}
                          onChange={e => setCond(e.target.checked ? {} : null)} />
                        <span className="text-xs font-medium text-gray-700">Only if attribute condition met</span>
                      </label>
                    </div>

                    {!condEnabled && (
                      <p className="text-xs text-gray-500">This requirement always applies. Enable the toggle to gate it by a product attribute.</p>
                    )}

                    {condEnabled && (
                      <>
                        {condAttrs.length === 0 && (
                          <p className="text-xs text-rose-500">No attributes defined for this category. Add attributes in Admin to use conditions.</p>
                        )}
                        {/* Present / Absent toggle */}
                        <div className="flex gap-2">
                          {(['present', 'absent'] as const).map(m => (
                            <button type="button" key={m}
                              onClick={() => setCond(m === 'absent' ? { requires_feature_absent: condAttrId || undefined } : { requires_feature: condAttrId || undefined })}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${condMode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                              {m === 'present' ? 'Attribute has a value' : 'Attribute has no value (absent)'}
                            </button>
                          ))}
                        </div>

                        {/* Attribute selector */}
                        <div>
                          <label className="block text-[10px] font-bold text-muted uppercase mb-1">Attribute</label>
                          <select className="w-full border rounded-lg p-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            value={condAttrId}
                            onChange={e => setCond(condMode === 'absent' ? { requires_feature_absent: e.target.value } : { requires_feature: e.target.value })}>
                            <option value="">— select attribute —</option>
                            {condAttrs.map(a => <option key={a.id} value={a.id}>{a.name} ({a.dataType})</option>)}
                          </select>
                        </div>

                        {/* Value input — only for 'present' mode */}
                        {condMode === 'present' && condAttr && (
                          <div>
                            <label className="block text-[10px] font-bold text-muted uppercase mb-2">
                              {condAttr.dataType === 'enum' ? 'Match any of' : (condAttr.dataType === 'integer' || condAttr.dataType === 'decimal') ? 'Value range' : 'Expected value'}
                            </label>
                            {condAttr.dataType === 'enum' && (
                              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                                {(condAttr.validationRules?.enumOptions ?? []).map(opt => (
                                  <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input type="checkbox" checked={enumSelected.includes(opt)}
                                      onChange={e => {
                                        const next = e.target.checked ? [...enumSelected, opt] : enumSelected.filter(v => v !== opt);
                                        setCond({ requires_feature: condAttrId, requires_feature_label: next.length ? next.join(', ') : undefined });
                                      }}
                                      className="rounded text-indigo-600" />
                                    {opt}
                                  </label>
                                ))}
                              </div>
                            )}
                            {(condAttr.dataType === 'integer' || condAttr.dataType === 'decimal') && (
                              <div className="flex items-center gap-2">
                                <input type="number" placeholder="Min" value={cond?.requires_feature_num_min ?? ''}
                                  onChange={e => setCond({ ...cond, requires_feature: condAttrId, requires_feature_num_min: e.target.value || undefined })}
                                  className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                                <span className="text-gray-400">–</span>
                                <input type="number" placeholder="Max" value={cond?.requires_feature_num_max ?? ''}
                                  onChange={e => setCond({ ...cond, requires_feature: condAttrId, requires_feature_num_max: e.target.value || undefined })}
                                  className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                                {condAttr.validationRules?.unit && <span className="text-xs text-gray-500">{condAttr.validationRules.unit}</span>}
                              </div>
                            )}
                            {condAttr.dataType === 'boolean' && (
                              <div className="flex gap-4">
                                {['true', 'false'].map(v => (
                                  <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input type="radio" name="reqCondBool" value={v}
                                      checked={(cond?.requires_feature_label === 'No' ? 'false' : 'true') === v}
                                      onChange={() => setCond({ requires_feature: condAttrId, requires_feature_label: v === 'true' ? 'Yes' : 'No' })}
                                      className="text-indigo-600" />
                                    {v === 'true' ? 'Yes' : 'No'}
                                  </label>
                                ))}
                              </div>
                            )}
                            {condAttr.dataType === 'text' && (
                              <input type="text" placeholder="Exact value to match…" value={cond?.requires_feature_label ?? ''}
                                onChange={e => setCond({ requires_feature: condAttrId, requires_feature_label: e.target.value || undefined })}
                                className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}

            </form>
            </div>
              
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 bg-white p-4 rounded-b-xl flex-shrink-0">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-5 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  form="reqForm"
                  className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium shadow"
                >
                  Save Requirement
                </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default ComplianceLibrary;
