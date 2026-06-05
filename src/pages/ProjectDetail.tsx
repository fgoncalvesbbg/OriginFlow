
/**
 * ProjectDetail — the primary project workspace page: documents, steps/milestones, suppliers,
 * compliance, SKUs, attribute requests, and production updates for a single project.
 */
import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { useRefetchOnFocus } from '../hooks';
import {
  getProjectById,
  getProjectSteps,
  getProjectDocs,
  getSupplierById,
  getSuppliers,
  getProfiles,
  updateProject,
  saveProjectMilestones,
  updateStepStatus,
  updateDocStatus,
  uploadFile,
  uploadAdHocFile,
  updateDocumentMetadata,
  addDocument,
  removeDocument,
  deleteDocumentVersion,
  getComplianceRequests,
  getCategories,
  getProjectIM,
  getProjectIMStaleReasons,
  getProductionUpdates,
  saveProductionUpdate,
  createAttributeRequest,
  getAttributeRequestsByProject,
  deleteAttributeRequest,
  updateAttributeRequestData,
  getCategoryAttributes,
  getProjectSkus,
  createProjectSku,
  updateProjectSku,
  deleteProjectSku,
  getEffectiveSkuValue,
  MAX_SKUS_PER_PROJECT
} from '../services';
import { getAttributesForCategory } from '../utils';
import {
  Project, ProjectStep, ProjectDocument, Supplier, StepStatus, DocStatus, ResponsibleParty,
  ComplianceRequest, CategoryL3, User, ProjectOverallStatus, ProjectIM, ProductionUpdate, ProductionDelayReason,
  ProjectAttributeRequest, ProjectSku, SkuAttributeValue
} from '../types';
import { StatusBadge } from '../components/StatusBadge';
import {
  CheckCircle2, Circle, FileText, Copy, Check, Eye, Upload, Plus, Pencil,
  Trash2, Calendar, X, ShieldCheck, ChevronRight, ListTodo, History, ChevronDown, ChevronUp, ExternalLink, Lock, Unlock, AlertTriangle, File, GanttChartSquare, Paperclip, BookOpen, Factory, ArrowRight, Clock, AlertCircle, User as UserIcon, RefreshCw, ClipboardList, Send, Link as LinkIcon, Download, Layers, Boxes
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { ProjectAICopilot } from '../components/ProjectAICopilot';
import AttributeInput from '../components/common/AttributeInput';
import { ConfirmationModal } from '../components/common/ConfirmationModal';

// --- Internal Components ---

const NotificationToast: React.FC<{ message: string, type: 'success' | 'error' | null, onClose: () => void }> = ({ message, type, onClose }) => {
  useEffect(() => {
    if (!type) return;
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [message, type, onClose]);

  if (!type) return null;

  return (
    <div className={`fixed top-4 right-4 z-[70] px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-medium animate-in slide-in-from-right-5 ${
      type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
    }`}>
      {type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      {message}
    </div>
  );
};

const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [steps, setSteps] = useState<ProjectStep[]>([]);
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  
  // Compliance State
  const [complianceRequests, setComplianceRequests] = useState<ComplianceRequest[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  
  // IM State
  const [projectIM, setProjectIM] = useState<ProjectIM | null>(null);
  const [projectLeaflet, setProjectLeaflet] = useState<ProjectIM | null>(null);
  // Drill-down reasons a published manual is out of date (empty = up to date).
  const [imStaleReasons, setImStaleReasons] = useState<import('../services').StaleReason[]>([]);
  const [leafletStaleReasons, setLeafletStaleReasons] = useState<import('../services').StaleReason[]>([]);

  // Manufacturing State
  const [productionUpdates, setProductionUpdates] = useState<ProductionUpdate[]>([]);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [etdForm, setEtdForm] = useState({
      isOnTime: true,
      newDate: '',
      delayReason: '' as ProductionDelayReason | '',
      notes: ''
  });
  
  // Attribute Requests
  const [attrRequests, setAttrRequests] = useState<ProjectAttributeRequest[]>([]);
  const [categoryAttributeDefs, setCategoryAttributeDefs] = useState<import('../types').CategoryAttribute[]>([]);
  const [attrReqModal, setAttrReqModal] = useState(false);
  const [attrReqStep, setAttrReqStep] = useState<2 | 3>(2);
  const [attrReqCategoryId, setAttrReqCategoryId] = useState('');
  const [attrReqSkuNumber, setAttrReqSkuNumber] = useState('');
  const [attrReqSkuTitle, setAttrReqSkuTitle] = useState('');
  const [attrReqSelectedSkuId, setAttrReqSelectedSkuId] = useState('');
  const [attrReqSourceStep2, setAttrReqSourceStep2] = useState<ProjectAttributeRequest | null>(null);
  const [attrReqNote, setAttrReqNote] = useState('');
  const [attrReqSending, setAttrReqSending] = useState(false);
  const [attrReqSendingAll, setAttrReqSendingAll] = useState(false);
  // Sending a defined SKU (from the Attributes tab) to the supplier for review.
  const [sendingSkuId, setSendingSkuId] = useState<string | null>(null);
  const [sendingAllSkus, setSendingAllSkus] = useState(false);
  const [attrLinkModal, setAttrLinkModal] = useState<{ open: boolean; url: string }>({ open: false, url: '' });
  const [attrLinkCopied, setAttrLinkCopied] = useState(false);
  const [expandedAttrRequestId, setExpandedAttrRequestId] = useState<string | null>(null);
  const [attrReqRefreshing, setAttrReqRefreshing] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<'checklist' | 'attributes' | 'compliance' | 'timeline' | 'im' | 'manufacturing'>('checklist');

  // Attributes tab: track which historical snapshots are expanded
  const [expandedAttrHistoryId, setExpandedAttrHistoryId] = useState<string | null>(null);
  // Attributes tab: inline editing of a snapshot's values (keyed by request id)
  const [editingAttrReqId, setEditingAttrReqId] = useState<string | null>(null);
  const [editingAttrValues, setEditingAttrValues] = useState<Record<string, string>>({});
  const [editingAttrModes, setEditingAttrModes] = useState<Record<string, 'fixed' | 'range' | 'text'>>({});
  const [savingAttr, setSavingAttr] = useState(false);

  // Project-defined SKUs (canonical list, max 10) managed in the Attributes tab
  const [projectSkus, setProjectSkus] = useState<ProjectSku[]>([]);
  const [editingSkuId, setEditingSkuId] = useState<string | null>(null);
  const [skuDraftNumber, setSkuDraftNumber] = useState('');
  const [skuDraftTitle, setSkuDraftTitle] = useState('');
  const [addingSku, setAddingSku] = useState(false);
  const [savingSku, setSavingSku] = useState(false);

  // Review Modal State
  const [reviewingDoc, setReviewingDoc] = useState<ProjectDocument | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  // Edit/Add Document Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDocData, setEditingDocData] = useState<Partial<ProjectDocument>>({});
  const [isNewDoc, setIsNewDoc] = useState(false);
  
  // Expanded Docs for History
  const [expandedDocIds, setExpandedDocIds] = useState<Record<string, boolean>>({});
  
  // Edit Project Modal State
  const [isEditProjectOpen, setIsEditProjectOpen] = useState(false);
  const [allSuppliers, setAllSuppliers] = useState<Supplier[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [projectEditForm, setProjectEditForm] = useState({
    name: '',
    projectId: '',
    supplierId: '',
    pmId: '',
    status: ProjectOverallStatus.IN_PROGRESS
  });

  // Timeline Edit State
  const [isEditingTimeline, setIsEditingTimeline] = useState(false);
  const [timelineForm, setTimelineForm] = useState({
    poPlacement: '',
    massProduction: '',
    etd: '',
    eta: ''
  });

  // File Upload Ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  const [uploadType, setUploadType] = useState<'standard' | 'adhoc'>('standard');
  const [adHocStepNumber, setAdHocStepNumber] = useState<number>(1);

  // UI State for custom modals/toasts
  const [notification, setNotification] = useState<{ msg: string, type: 'success' | 'error' | null }>({ msg: '', type: null });
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean, title: string, message: string, action: () => void }>({
    isOpen: false, title: '', message: '', action: () => {}
  });
  const [refreshing, setRefreshing] = useState(false);

  const showNotification = (msg: string, type: 'success' | 'error') => {
    setNotification({ msg, type });
  };

  const handleRefreshData = async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      await loadProjectData();
      showNotification('Project data refreshed successfully!', 'success');
    } catch (err) {
      console.error('Error refreshing project data:', err);
      showNotification('Failed to refresh project data', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    const fallback = setTimeout(() => setLoading(false), 15_000);
    loadProjectData().finally(() => clearTimeout(fallback));
    return () => clearTimeout(fallback);
  }, [id]);

  // Why each published manual is out of date vs its source blocks/template (if at all).
  useEffect(() => {
    let active = true;
    if (id && projectIM?.status === 'generated') {
      getProjectIMStaleReasons(id, 'im').then(r => { if (active) setImStaleReasons(r); }).catch(() => {});
    } else setImStaleReasons([]);
    return () => { active = false; };
  }, [id, projectIM?.status, projectIM?.updatedAt]);

  useEffect(() => {
    let active = true;
    if (id && projectLeaflet?.status === 'generated') {
      getProjectIMStaleReasons(id, 'warning_leaflet').then(r => { if (active) setLeafletStaleReasons(r); }).catch(() => {});
    } else setLeafletStaleReasons([]);
    return () => { active = false; };
  }, [id, projectLeaflet?.status, projectLeaflet?.updatedAt]);

  const staleSummary = (reasons: import('../services').StaleReason[]) => {
    const blocks = reasons.filter(r => r.type === 'block').map(r => r.label);
    const others = reasons.filter(r => r.type !== 'block').map(r => r.label);
    return [blocks.length ? `Block${blocks.length > 1 ? 's' : ''}: ${blocks.join(', ')}` : '', ...others].filter(Boolean).join(' · ');
  };

  const loadProjectData = async () => {
    if (!id) return;
    try {
      const p = await getProjectById(id);
      if (p) {
        setProject(p);
        const [sData, stepsData, docsData, compReqs, cats, imData, leafletData, prodUpdates] = await Promise.all([
          getSupplierById(p.supplierId).catch(err => {
            console.error('Error loading supplier:', err);
            return null;
          }),
          getProjectSteps(p.id),
          getProjectDocs(p.id),
          getComplianceRequests().catch(err => {
            console.error('Error loading compliance requests:', err);
            return [];
          }),
          getCategories().catch(err => {
            console.error('Error loading categories:', err);
            return [];
          }),
          getProjectIM(p.id),
          getProjectIM(p.id, 'warning_leaflet'),
          getProductionUpdates(p.id)
        ]);
        setSupplier(sData || null);
        setSteps(stepsData);
        setDocs(docsData);
        // Filter compliance requests to only this project
        setComplianceRequests(compReqs.filter(r => r.projectId === p.id));
        setCategories(cats);
        setProjectIM(imData || null);
        setProjectLeaflet(leafletData || null);
        setProductionUpdates(prodUpdates);

        // Load attribute requests, attribute definitions, and defined SKUs
        try {
          const [attrReqs, attrDefs, skus] = await Promise.all([
            getAttributeRequestsByProject(p.id),
            getCategoryAttributes(),
            getProjectSkus(p.id),
          ]);
          setAttrRequests(attrReqs);
          setCategoryAttributeDefs(attrDefs);
          setProjectSkus(skus);
        } catch (e) { console.error('Error loading attribute requests:', e); }

        // Init timeline form
        setTimelineForm({
          poPlacement: p.milestones?.poPlacement || '',
          massProduction: p.milestones?.massProduction || '',
          etd: p.milestones?.etd || '',
          eta: p.milestones?.eta || ''
        });
      }
    } catch (err: any) {
      console.error('Error loading project data:', err);
    } finally {
      setLoading(false);
    }
  };

  useRefetchOnFocus(loadProjectData);

  const handleCopyLink = () => {
    if (!project) return;
    const url = `${window.location.origin}/#/supplier/${project.supplierLinkToken}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStepStatusChange = async (stepId: string, newStatus: StepStatus) => {
    await updateStepStatus(stepId, newStatus);
    setSteps(steps.map(s => s.id === stepId ? { ...s, status: newStatus } : s));
  };

  const handleDocReview = async (status: DocStatus) => {
    if (!reviewingDoc) return;
    try {
      const updated = await updateDocStatus(reviewingDoc.id, status, status === DocStatus.REJECTED ? rejectComment : undefined);
      setDocs(docs.map(d => d.id === updated.id ? updated : d));
      setReviewingDoc(null);
      setRejectComment('');
      showNotification(`Document marked as ${status.replace('_', ' ')}`, 'success');
    } catch (e: any) {
      showNotification(`Failed: ${e.message}`, 'error');
    }
  };
  
  const toggleDocHistory = (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setExpandedDocIds(prev => ({ ...prev, [docId]: !prev[docId] }));
  };

  // --- Manufacturing Update ---
  const handleAddUpdate = async () => {
      if (!project) return;
      
      const currentEtd = timelineForm.etd || '';
      
      // If setting initial ETD, treat as new update
      if (!currentEtd && !etdForm.newDate) {
          alert("Please specify the ETD date.");
          return;
      }

      if (!etdForm.isOnTime && !etdForm.newDate) {
          alert("Please specify a new date if delayed.");
          return;
      }

      const finalNewEtd = etdForm.isOnTime ? (currentEtd || etdForm.newDate) : etdForm.newDate;
      if (!finalNewEtd) {
          alert("Please select a valid date.");
          return;
      }

      try {
          const update = await saveProductionUpdate({
              projectId: project.id,
              previousEtd: currentEtd || undefined,
              newEtd: finalNewEtd,
              isOnTime: etdForm.isOnTime,
              delayReason: !etdForm.isOnTime ? (etdForm.delayReason as ProductionDelayReason) : undefined,
              notes: etdForm.notes,
              updatedBy: user?.name || 'PM',
              isSupplierUpdate: false
          });
          
          setProductionUpdates(prev => [update, ...prev]);
          
          // Refresh main project data to get new ETD in local state
          await loadProjectData();
          
          setIsUpdateModalOpen(false);
          setEtdForm({ isOnTime: true, newDate: '', delayReason: '', notes: '' });
          showNotification("Production status updated", 'success');
      } catch (e: any) {
          showNotification(e.message, 'error');
      }
  };

  // --- Project Edit ---
  
  const handleOpenEditProject = async () => {
    if (!project) return;
    if (allSuppliers.length === 0) {
      const [sups, usrs] = await Promise.all([getSuppliers(), getProfiles()]);
      setAllSuppliers(sups);
      setAllUsers(usrs);
    }

    setProjectEditForm({
      name: project.name,
      projectId: project.projectId,
      supplierId: project.supplierId,
      pmId: project.pmId,
      status: project.status
    });
    
    setIsEditProjectOpen(true);
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    
    try {
      await updateProject(project.id, projectEditForm);
      setIsEditProjectOpen(false);
      loadProjectData(); 
      showNotification('Project details updated', 'success');
    } catch (e: any) {
      showNotification(e.message, 'error');
    }
  };

  // --- Attribute Requests ---

  const handleOpenAttrReqModal = (step: 2 | 3, step2Req?: ProjectAttributeRequest) => {
    setAttrReqStep(step);
    setAttrReqNote('');
    setAttrReqSourceStep2(step2Req || null);
    if (step === 3 && step2Req) {
      setAttrReqSelectedSkuId('');
      setAttrReqSkuNumber(step2Req.skuNumber);
      setAttrReqSkuTitle(step2Req.skuTitle);
      setAttrReqCategoryId(step2Req.categoryId || project?.categoryId || complianceRequests[0]?.categoryId || '');
    } else {
      setAttrReqSelectedSkuId('');
      setAttrReqSkuNumber('');
      setAttrReqSkuTitle('');
      setAttrReqCategoryId(project?.categoryId || complianceRequests[0]?.categoryId || '');
    }
    setAttrReqModal(true);
  };

  const handleSendAttrRequest = async () => {
    if (!project) return;
    if (!attrReqSkuNumber.trim()) { showNotification('SKU number is required.', 'error'); return; }
    setAttrReqSending(true);
    try {
      const cat = categories.find(c => c.id === attrReqCategoryId);
      // Step 3 prefills from the source Step 2 submission; Step 2 prefills from the
      // selected defined SKU's attribute values (if any) so the supplier sees the PM's spec.
      const selectedSku = projectSkus.find(s => s.id === attrReqSelectedSkuId);
      const skuPrefill = selectedSku?.attributeValues?.filter(v => v.value) ?? [];
      const prefill = attrReqStep === 3
        ? (attrReqSourceStep2?.submittedData?.length ? attrReqSourceStep2.submittedData : undefined)
        : (skuPrefill.length ? skuPrefill : undefined);
      const req = await createAttributeRequest(
        project.id, project.name, project.projectId,
        attrReqCategoryId || null, cat?.name || '',
        attrReqStep,
        attrReqSkuNumber.trim(), attrReqSkuTitle.trim(),
        attrReqNote.trim() || undefined,
        prefill
      );
      const url = `${window.location.origin}/#/attribute-request/${req.token}`;
      setAttrRequests(prev => [req, ...prev]);
      setAttrReqModal(false);
      setAttrLinkCopied(false);
      setAttrLinkModal({ open: true, url });
    } catch (e: any) {
      showNotification('Failed to create request: ' + e.message, 'error');
    } finally {
      setAttrReqSending(false);
    }
  };

  const handleSendAllProductionRequests = async () => {
    if (!project) return;
    const step2Reqs = attrRequests.filter(r => r.step === 2);
    const existingStep3Skus = new Set(attrRequests.filter(r => r.step === 3).map(r => r.skuNumber));
    const toCreate = step2Reqs.filter(r => !existingStep3Skus.has(r.skuNumber));
    if (!toCreate.length) { showNotification('All SKUs already have production requests.', 'error'); return; }
    setAttrReqSendingAll(true);
    try {
      const newReqs = await Promise.all(toCreate.map(s2 =>
        createAttributeRequest(
          project.id, project.name, project.projectId,
          s2.categoryId, s2.categoryName,
          3,
          s2.skuNumber, s2.skuTitle,
          undefined,
          s2.status === 'submitted' && s2.submittedData?.length ? s2.submittedData : undefined
        )
      ));
      setAttrRequests(prev => [...newReqs, ...prev]);
      showNotification(`${newReqs.length} production request(s) created.`, 'success');
    } catch (e: any) {
      showNotification('Failed to create production requests: ' + e.message, 'error');
    } finally {
      setAttrReqSendingAll(false);
    }
  };

  // Send a single project-defined SKU to the supplier for attribute review (Step 2).
  // Creates a Step-2 request prefilled with the SKU's entered attribute values.
  const handleSendSkuForReview = async (sku: ProjectSku) => {
    if (!project) return;
    setSendingSkuId(sku.id);
    try {
      const categoryId = project.categoryId || complianceRequests[0]?.categoryId || null;
      const cat = categories.find(c => c.id === categoryId);
      const prefill = sku.attributeValues?.filter(v => v.value) ?? [];
      const req = await createAttributeRequest(
        project.id, project.name, project.projectId,
        categoryId, cat?.name || '',
        2,
        sku.skuNumber, sku.skuTitle,
        undefined,
        prefill.length ? prefill : undefined
      );
      const url = `${window.location.origin}/#/attribute-request/${req.token}`;
      setAttrRequests(prev => [req, ...prev]);
      setAttrLinkCopied(false);
      setAttrLinkModal({ open: true, url });
    } catch (e: any) {
      showNotification('Failed to send SKU for review: ' + e.message, 'error');
    } finally {
      setSendingSkuId(null);
    }
  };

  // Send every defined SKU that hasn't been sent for Step-2 review yet.
  const handleSendAllSkusForReview = async () => {
    if (!project) return;
    const alreadySent = new Set(attrRequests.filter(r => r.step === 2).map(r => r.skuNumber));
    const toSend = projectSkus.filter(s => !alreadySent.has(s.skuNumber));
    if (!toSend.length) { showNotification('All defined SKUs have already been sent.', 'error'); return; }
    setSendingAllSkus(true);
    try {
      const categoryId = project.categoryId || complianceRequests[0]?.categoryId || null;
      const cat = categories.find(c => c.id === categoryId);
      const newReqs = await Promise.all(toSend.map(sku => {
        const prefill = sku.attributeValues?.filter(v => v.value) ?? [];
        return createAttributeRequest(
          project.id, project.name, project.projectId,
          categoryId, cat?.name || '',
          2,
          sku.skuNumber, sku.skuTitle,
          undefined,
          prefill.length ? prefill : undefined
        );
      }));
      setAttrRequests(prev => [...newReqs, ...prev]);
      showNotification(`${newReqs.length} SKU(s) sent for supplier review.`, 'success');
    } catch (e: any) {
      showNotification('Failed to send SKUs: ' + e.message, 'error');
    } finally {
      setSendingAllSkus(false);
    }
  };

  const handleCopyAttrLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setAttrLinkCopied(true);
    setTimeout(() => setAttrLinkCopied(false), 2000);
  };

  const handleDeleteAttrRequest = async (req: ProjectAttributeRequest) => {
    if (!window.confirm(`Delete request for SKU "${req.skuNumber || '—'}"? This cannot be undone.`)) return;
    try {
      await deleteAttributeRequest(req.id);
      setAttrRequests(prev => prev.filter(r => r.id !== req.id));
      if (expandedAttrRequestId === req.id) setExpandedAttrRequestId(null);
    } catch (e: any) {
      showNotification('Failed to delete: ' + e.message, 'error');
    }
  };

  const handleRefreshAttrRequests = async () => {
    if (!project) return;
    setAttrReqRefreshing(true);
    try {
      const reqs = await getAttributeRequestsByProject(project.id);
      setAttrRequests(reqs);
    } catch (e) { console.error('Error refreshing attribute requests:', e); }
    finally { setAttrReqRefreshing(false); }
  };

  const handleExportAttrData = (req: ProjectAttributeRequest) => {
    if (!req.submittedData?.length) return;
    const akeneoMap = new Map(categoryAttributeDefs.map(a => [a.id, a.akeneoId ?? '']));
    const rows = req.submittedData.map(d => ({
      Attribute: d.name,
      'Akeneo ID': akeneoMap.get(d.attributeId) ?? '',
      Value: d.value,
      Type: d.type || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attributes');
    const filename = `${project?.name || 'project'}_${req.categoryName || 'attributes'}_${new Date(req.submittedAt!).toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const handleStartEditAttr = (req: ProjectAttributeRequest) => {
    setEditingAttrReqId(req.id);
    setEditingAttrValues(Object.fromEntries((req.submittedData || []).map(d => [d.attributeId, d.value])));
    // Seed the input mode per attribute from its definition: numeric range-capable
    // values that already look like a range open in "range" mode, other numerics in
    // "fixed", everything else in "text".
    const modes: Record<string, 'fixed' | 'range' | 'text'> = {};
    for (const d of req.submittedData || []) {
      const def = categoryAttributeDefs.find(a => a.id === d.attributeId);
      const isNumeric = def?.dataType === 'integer' || def?.dataType === 'decimal';
      if (isNumeric) {
        modes[d.attributeId] = def?.validationRules?.allowRange && /^.+-.+$/.test(d.value) ? 'range' : 'fixed';
      } else {
        modes[d.attributeId] = 'text';
      }
    }
    setEditingAttrModes(modes);
  };

  const handleCancelEditAttr = () => {
    setEditingAttrReqId(null);
    setEditingAttrValues({});
    setEditingAttrModes({});
  };

  const handleSaveAttr = async (req: ProjectAttributeRequest) => {
    if (!req.submittedData) return;
    setSavingAttr(true);
    try {
      const updatedData = req.submittedData.map(d => ({ ...d, value: editingAttrValues[d.attributeId] ?? d.value }));
      const updated = await updateAttributeRequestData(req.id, updatedData);
      setAttrRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
      setEditingAttrReqId(null);
      setEditingAttrValues({});
      showNotification('Attributes updated', 'success');
    } catch (e: any) {
      showNotification('Failed to update: ' + e.message, 'error');
    } finally {
      setSavingAttr(false);
    }
  };

  // --- Project-defined SKUs ---

  // Attributes that apply to this project's category (empty when no category set).
  const projectCatAttrs = project?.categoryId
    ? getAttributesForCategory(categoryAttributeDefs, project.categoryId)
    : [];

  // Latest supplier submission (any step) for a SKU number, newest first.
  const getLatestSkuSubmission = (skuNumber: string): ProjectAttributeRequest | undefined =>
    attrRequests
      .filter(r => r.skuNumber === skuNumber && r.status === 'submitted' && r.submittedData && r.submittedData.length > 0)
      .sort((a, b) => new Date(b.submittedAt!).getTime() - new Date(a.submittedAt!).getTime())[0];

  // Effective value for a SKU attribute (latest supplier submission wins, else the SKU's own
  // value) is provided by the shared service helper — call as
  // getEffectiveSkuValue(sku, attrRequests, attributeId).

  const seedAttrEditorFromValues = (stored: SkuAttributeValue[]) => {
    const map = new Map(stored.map(v => [v.attributeId, v.value]));
    const values: Record<string, string> = {};
    const modes: Record<string, 'fixed' | 'range' | 'text'> = {};
    for (const a of projectCatAttrs) {
      const v = map.get(a.id) ?? '';
      values[a.id] = v;
      const numeric = a.dataType === 'integer' || a.dataType === 'decimal';
      modes[a.id] = numeric
        ? (a.validationRules?.allowRange && /^.+-.+$/.test(v) ? 'range' : 'fixed')
        : 'text';
    }
    setEditingAttrValues(values);
    setEditingAttrModes(modes);
  };

  const handleStartEditSku = (sku: ProjectSku) => {
    setEditingAttrReqId(null); // don't let the request editor and SKU editor clash
    setEditingSkuId(sku.id);
    setSkuDraftNumber(sku.skuNumber);
    setSkuDraftTitle(sku.skuTitle);
    // Overlay the latest supplier submission on the SKU's own values so the editor
    // shows what was submitted rather than empty fields.
    const seed: SkuAttributeValue[] = projectCatAttrs.map(a => ({
      attributeId: a.id,
      name: a.name,
      value: getEffectiveSkuValue(sku, attrRequests, a.id),
      type: a.dataType,
    }));
    seedAttrEditorFromValues(seed);
  };

  const handleCancelEditSku = () => {
    setEditingSkuId(null);
    setSkuDraftNumber('');
    setSkuDraftTitle('');
    setEditingAttrValues({});
    setEditingAttrModes({});
  };

  const handleAddSku = async () => {
    if (!project) return;
    if (projectSkus.length >= MAX_SKUS_PER_PROJECT) {
      showNotification(`Maximum of ${MAX_SKUS_PER_PROJECT} SKUs reached.`, 'error');
      return;
    }
    if (!skuDraftNumber.trim()) { showNotification('SKU number is required.', 'error'); return; }
    if (projectSkus.some(s => s.skuNumber.trim().toLowerCase() === skuDraftNumber.trim().toLowerCase())) {
      showNotification('A SKU with that number already exists.', 'error');
      return;
    }
    setSavingSku(true);
    try {
      const created = await createProjectSku(project.id, skuDraftNumber.trim(), skuDraftTitle.trim(), [], projectSkus.length);
      setProjectSkus(prev => [...prev, created]);
      setAddingSku(false);
      setSkuDraftNumber('');
      setSkuDraftTitle('');
      handleStartEditSku(created); // jump straight into entering attribute values
      showNotification('SKU added', 'success');
    } catch (e: any) {
      showNotification(e.message, 'error');
    } finally {
      setSavingSku(false);
    }
  };

  const handleSaveSku = async (sku: ProjectSku) => {
    if (!skuDraftNumber.trim()) { showNotification('SKU number is required.', 'error'); return; }
    setSavingSku(true);
    try {
      const attributeValues: SkuAttributeValue[] = projectCatAttrs.map(a => ({
        attributeId: a.id,
        name: a.name,
        value: editingAttrValues[a.id] ?? '',
        type: a.dataType,
      }));
      const updated = await updateProjectSku(sku.id, {
        skuNumber: skuDraftNumber.trim(),
        skuTitle: skuDraftTitle.trim(),
        attributeValues,
      });
      setProjectSkus(prev => prev.map(s => s.id === updated.id ? updated : s));
      handleCancelEditSku();
      showNotification('SKU saved', 'success');
    } catch (e: any) {
      showNotification('Failed to save SKU: ' + e.message, 'error');
    } finally {
      setSavingSku(false);
    }
  };

  const handleDeleteSku = (sku: ProjectSku) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete SKU',
      message: `Delete SKU "${sku.skuNumber || '—'}" and its attribute values? This cannot be undone.`,
      action: async () => {
        try {
          await deleteProjectSku(sku.id);
          setProjectSkus(prev => prev.filter(s => s.id !== sku.id));
          if (editingSkuId === sku.id) handleCancelEditSku();
          showNotification('SKU deleted', 'success');
        } catch (e: any) {
          showNotification(e.message, 'error');
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // --- Timeline Edit ---

  const handleSaveTimeline = async () => {
    if (!project) return;
    try {
      // Updated to use dedicated save function that interacts with project_documents
      await saveProjectMilestones(project.id, timelineForm);
      await loadProjectData();
      setIsEditingTimeline(false);
      showNotification('Timeline milestones updated', 'success');
    } catch (e: any) {
      showNotification(e.message, 'error');
    }
  };

  // --- Document CRUD ---

  const handleEditDoc = (e: React.MouseEvent, doc: ProjectDocument) => {
    e.stopPropagation();
    setEditingDocData(doc);
    setIsNewDoc(false);
    setIsEditModalOpen(true);
  };

  const handleAddDoc = (stepNumber: number) => {
    setEditingDocData({
      stepNumber,
      projectId: project?.id,
      title: '',
      description: '',
      responsibleParty: ResponsibleParty.SUPPLIER,
      isVisibleToSupplier: true,
      isRequired: true,
      status: DocStatus.NOT_STARTED
    });
    setIsNewDoc(true);
    setIsEditModalOpen(true);
  };

  const handleSaveDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDocData.title || !project) return;

    try {
      if (isNewDoc) {
        const newDoc = await addDocument(editingDocData as Omit<ProjectDocument, 'id'>);
        setDocs([...docs, newDoc]);
      } else {
        if (!editingDocData.id) return;
        const updated = await updateDocumentMetadata(editingDocData.id, editingDocData);
        setDocs(docs.map(d => d.id === updated.id ? updated : d));
      }
      setIsEditModalOpen(false);
      showNotification('Document requirement saved', 'success');
    } catch (e: any) {
      showNotification(e.message, 'error');
    }
  };

  const handleDeleteDoc = (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    setConfirmModal({
      isOpen: true,
      title: 'Delete Document',
      message: 'Are you sure you want to delete this document? This cannot be undone.',
      action: async () => {
        try {
          await removeDocument(docId);
          setDocs(docs.filter(d => d.id !== docId));
          showNotification('Document deleted', 'success');
        } catch (e: any) {
          showNotification(e.message, 'error');
        }
        setConfirmModal(prev => ({...prev, isOpen: false}));
      }
    });
  };
  
  const handleDeleteVersion = (versionId: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Version',
      message: 'Are you sure you want to delete this file version?',
      action: async () => {
        try {
          await deleteDocumentVersion(versionId);
          loadProjectData();
          showNotification('Version deleted', 'success');
        } catch (e: any) {
          showNotification(e.message, 'error');
        }
        setConfirmModal(prev => ({...prev, isOpen: false}));
      }
    });
  };
  
  const handleToggleFinal = (e: React.MouseEvent, doc: ProjectDocument) => {
    e.stopPropagation();
    const isFinal = doc.status === DocStatus.APPROVED;
    const newStatus = isFinal ? DocStatus.UNDER_REVIEW : DocStatus.APPROVED;
    
    setConfirmModal({
      isOpen: true,
      title: isFinal ? 'Unlock Document?' : 'Mark as Final?',
      message: isFinal 
         ? 'This will unlock the document, allowing new uploads and edits.' 
         : 'This will mark the document as approved/final and block further changes.',
      action: async () => {
        try {
          const updated = await updateDocStatus(doc.id, newStatus);
          setDocs(docs.map(d => d.id === updated.id ? updated : d));
          showNotification(isFinal ? 'Document Unlocked' : 'Document Finalized', 'success');
        } catch (e: any) {
          showNotification(e.message, 'error');
        }
        setConfirmModal(prev => ({...prev, isOpen: false}));
      }
    });
  };

  // --- File Upload ---

  const triggerUpload = (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    setUploadingDocId(docId);
    setUploadType('standard');
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; 
      fileInputRef.current.click();
    }
  };

  const triggerAdHocUpload = (e: React.MouseEvent, stepNumber: number) => {
    e.stopPropagation();
    setAdHocStepNumber(stepNumber);
    setUploadType('adhoc');
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
        fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      if (uploadType === 'standard' && uploadingDocId) {
        try {
            const updatedDoc = await uploadFile(uploadingDocId, file, false);
            setDocs(docs.map(d => d.id === uploadingDocId ? updatedDoc : d));
            setExpandedDocIds(prev => ({ ...prev, [uploadingDocId]: true }));
            showNotification('File uploaded successfully', 'success');
        } catch (err: any) {
            console.error("Upload failed", err);
            showNotification(`Upload failed: ${err.message || "Unknown error"}`, 'error');
        } finally {
            setUploadingDocId(null);
        }
      } else if (uploadType === 'adhoc' && project) {
         try {
            const newDoc = await uploadAdHocFile(project.id, adHocStepNumber, file, false);
            setDocs([...docs, newDoc]);
            showNotification('Additional file uploaded', 'success');
         } catch (err: any) {
            console.error("Ad-hoc Upload failed", err);
            showNotification(`Upload failed: ${err.message || "Unknown error"}`, 'error');
         }
      }
    }
  };

  const getCategoryName = (catId: string) => categories.find(c => c.id === catId)?.name || 'Unknown';

  // Calculate Alerts for Manufacturing Tab
  const getEtdAlert = () => {
      if (!timelineForm.etd) return null;
      const etd = new Date(timelineForm.etd);
      const today = new Date();
      const diffTime = etd.getTime() - today.getTime();
      const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // 6 Week Check (38-45 days)
      if (days >= 38 && days <= 45) return { type: 'info', title: '6-Week Production Check', msg: 'Verify raw material status and production start.' };
      
      // 4 Week Check (24-31 days)
      if (days >= 24 && days <= 31) return { type: 'warning', title: '4-Week QA Booking', msg: 'Book Quality Inspection (QA) now.' };
      
      // 2 Week Check (10-17 days)
      if (days >= 10 && days <= 17) return { type: 'error', title: '2-Week Logistics Confirm', msg: 'Confirm shipping vessel and logistics bookings.' };
      
      return null;
  };

  if (loading) return <Layout><div className="p-10 text-center">Loading...</div></Layout>;
  if (!project) return <Layout><div className="p-10 text-center">Project not found</div></Layout>;

  return (
    <Layout>
      <NotificationToast message={notification.msg} type={notification.type} onClose={() => setNotification({msg:'', type:null})} />
      <ConfirmationModal 
        isOpen={confirmModal.isOpen} 
        title={confirmModal.title} 
        message={confirmModal.message} 
        onConfirm={confirmModal.action} 
        onCancel={() => setConfirmModal(prev => ({...prev, isOpen: false}))} 
      />
      
      <ProjectAICopilot project={project} supplier={supplier} steps={steps} docs={docs} />

      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        onChange={handleFileChange} 
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-muted font-mono">{project.projectId}</span>
            <StatusBadge status={project.status} type="project" />
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-primary">{project.name}</h1>
            <button onClick={handleOpenEditProject} className="text-gray-400 hover:text-indigo-600"><Pencil size={18}/></button>
          </div>
          <div className="text-muted text-sm mt-1 flex items-center gap-4">
             <span className="flex items-center gap-1"><Factory size={14} /> {supplier?.name || 'No Supplier'}</span>
             {project.pmId && <span className="flex items-center gap-1"><UserIcon size={14} /> PM: {user?.name}</span>}
          </div>
        </div>
        <div className="flex gap-2">
           <button
             onClick={handleRefreshData}
             disabled={refreshing}
             title="Refresh all project data"
             className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-light disabled:opacity-50 disabled:cursor-not-allowed"
           >
             <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
           </button>
           <button onClick={handleCopyLink} className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-light">
              {copied ? <Check size={16} /> : <Copy size={16} />} Supplier Link
           </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
        <button onClick={() => setActiveTab('checklist')} className={`px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-2 ${activeTab === 'checklist' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <ListTodo size={16} /> Checklist
        </button>
        <button onClick={() => setActiveTab('attributes')} className={`px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-2 ${activeTab === 'attributes' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Layers size={16} /> Attributes
        </button>
        <button onClick={() => setActiveTab('compliance')} className={`px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-2 ${activeTab === 'compliance' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <ShieldCheck size={16} /> Compliance
        </button>
        <button onClick={() => setActiveTab('im')} className={`px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-2 ${activeTab === 'im' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <BookOpen size={16} /> Instruction Manual
        </button>
        <button onClick={() => setActiveTab('timeline')} className={`px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-2 ${activeTab === 'timeline' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Calendar size={16} /> Timeline
        </button>
        <button onClick={() => setActiveTab('manufacturing')} className={`px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-2 ${activeTab === 'manufacturing' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Factory size={16} /> Manufacturing
        </button>
      </div>

      {/* CHECKLIST CONTENT */}
      {activeTab === 'checklist' && (
        <div className="space-y-8">
          {steps.map(step => {
            const stepDocs = docs.filter(d => d.stepNumber === step.stepNumber);
            const adHocDocs = stepDocs.filter(d => d.description === 'ad-hoc');
            const standardDocs = stepDocs.filter(d => d.description !== 'ad-hoc');
            const allStepDocs = [...standardDocs, ...adHocDocs];

            return (
              <div key={step.id} className="bg-white rounded-xl border border-gray-200 shadow overflow-hidden">
                <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step.status === StepStatus.COMPLETED ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                      {step.stepNumber}
                    </div>
                    <h3 className="font-bold text-gray-800">{step.name}</h3>
                  </div>
                  <select 
                    value={step.status}
                    onChange={(e) => handleStepStatusChange(step.id, e.target.value as StepStatus)}
                    className="text-sm border-gray-300 rounded-md shadow focus:border-indigo-500 focus:ring-indigo-500 bg-white px-2 py-1"
                  >
                    {Object.values(StepStatus).map(s => (
                      <option key={s} value={s}>{s.replace('_', ' ').toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                <div className="divide-y divide-slate-100">
                  {/* Reusable: a sent request row (status, link, data, delete). */}
                  {/* Step 2 — Product Attribute Data: one row per DEFINED SKU (from the Attributes tab). */}
                  {step.stepNumber === 2 && (() => {
                    const step2Reqs = attrRequests.filter(r => r.step === 2);
                    // Latest Step-2 request per SKU number (prefer submitted, else newest).
                    const latestReqBySku = new Map<string, ProjectAttributeRequest>();
                    for (const r of step2Reqs) {
                      const cur = latestReqBySku.get(r.skuNumber);
                      if (!cur) { latestReqBySku.set(r.skuNumber, r); continue; }
                      const prefer = (r.status === 'submitted' && cur.status !== 'submitted')
                        || (!(cur.status === 'submitted' && r.status !== 'submitted') && new Date(r.createdAt) > new Date(cur.createdAt));
                      if (prefer) latestReqBySku.set(r.skuNumber, r);
                    }
                    const definedNumbers = new Set(projectSkus.map(s => s.skuNumber));
                    // Requests for SKU numbers no longer defined (legacy / removed) — keep them visible.
                    const orphanReqs = Array.from(latestReqBySku.values()).filter(r => !definedNumbers.has(r.skuNumber));
                    const unsentCount = projectSkus.filter(s => !latestReqBySku.has(s.skuNumber)).length;

                    const renderReqExtras = (req: ProjectAttributeRequest) => {
                      const isSubmitted = req.status === 'submitted';
                      const isExpanded = expandedAttrRequestId === req.id;
                      return (
                        <>
                          {isSubmitted && (
                            <button onClick={() => setExpandedAttrRequestId(isExpanded ? null : req.id)} className="text-xs text-emerald-700 font-medium hover:underline flex items-center gap-1">
                              {isExpanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>} Data
                            </button>
                          )}
                          <a href={`${window.location.origin}/#/attribute-request/${req.token}`} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline flex items-center gap-0.5" title="Open portal link">
                            <LinkIcon size={11}/> Link
                          </a>
                          <button onClick={() => handleDeleteAttrRequest(req)} className="p-1 text-gray-300 hover:text-rose-500 rounded" title="Delete request">
                            <Trash2 size={12}/>
                          </button>
                        </>
                      );
                    };

                    const renderExpandedData = (req: ProjectAttributeRequest) => (
                      expandedAttrRequestId === req.id && req.submittedData && req.submittedData.length > 0 ? (
                        <div className="px-4 pb-4">
                          <div className="flex justify-end mb-2">
                            <button onClick={() => handleExportAttrData(req)} className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg font-medium">
                              <Download size={12} /> Export to Excel
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {req.submittedData.map(d => (
                              <div key={d.attributeId} className="bg-white rounded border border-indigo-100 px-3 py-2">
                                <div className="text-xs text-gray-500">{d.name}</div>
                                <div className="text-sm font-medium text-gray-800">{d.value || '—'}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null
                    );

                    return (
                      <div className="bg-indigo-50/30 border-b border-indigo-100">
                        {/* Section header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-indigo-100/60">
                          <div className="flex items-center gap-2">
                            <ClipboardList size={15} className="text-indigo-500" />
                            <span className="text-sm font-semibold text-gray-700">Product Attribute Data</span>
                            {projectSkus.length > 0 && (
                              <span className="text-[10px] bg-indigo-100 text-indigo-600 font-bold px-1.5 py-0.5 rounded">{projectSkus.length} SKU{projectSkus.length > 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={handleRefreshAttrRequests} disabled={attrReqRefreshing} title="Refresh" className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-100 rounded-lg disabled:opacity-50">
                              <RefreshCw size={12} className={attrReqRefreshing ? 'animate-spin' : ''} />
                            </button>
                            {unsentCount > 0 && (
                              <button onClick={handleSendAllSkusForReview} disabled={sendingAllSkus} className="flex items-center gap-1.5 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50">
                                {sendingAllSkus ? <><RefreshCw size={12} className="animate-spin"/> Sending...</> : <><Send size={12}/> Send all ready ({unsentCount})</>}
                              </button>
                            )}
                            <button onClick={() => setActiveTab('attributes')} className="flex items-center gap-1.5 text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-light font-medium" title="Define SKUs and their attribute values">
                              <Boxes size={12} /> Manage SKUs
                            </button>
                          </div>
                        </div>

                        {/* Empty state — SKUs are defined on the Attributes tab */}
                        {projectSkus.length === 0 && orphanReqs.length === 0 && (
                          <div className="px-4 py-5 text-xs text-gray-400 text-center">
                            No SKUs defined yet. Define SKUs in the{' '}
                            <button onClick={() => setActiveTab('attributes')} className="text-indigo-600 font-medium hover:underline">Attributes tab</button>
                            {' '}— they'll appear here ready to send for supplier review.
                          </div>
                        )}

                        {/* One row per defined SKU */}
                        {projectSkus.map(sku => {
                          const req = latestReqBySku.get(sku.skuNumber);
                          const isSubmitted = req?.status === 'submitted';
                          const valuesSet = sku.attributeValues.filter(v => v.value).length;
                          return (
                            <div key={sku.id} className="border-t border-indigo-100/60 first:border-t-0">
                              <div className="flex items-center justify-between px-4 py-3 gap-3">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isSubmitted ? 'bg-emerald-400' : req ? 'bg-amber-400' : 'bg-gray-300'}`} />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-semibold text-gray-800">{sku.skuNumber || '—'}</span>
                                      {sku.skuTitle && <span className="text-xs text-gray-500 truncate">{sku.skuTitle}</span>}
                                      {isSubmitted
                                        ? <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded flex-shrink-0">SUBMITTED</span>
                                        : req
                                          ? <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex-shrink-0">PENDING</span>
                                          : <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded flex-shrink-0">READY TO SEND</span>
                                      }
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                      {req
                                        ? (isSubmitted ? `Submitted ${new Date(req.submittedAt!).toLocaleDateString()}` : `Sent ${new Date(req.createdAt).toLocaleDateString()}`)
                                        : `${valuesSet} attribute value${valuesSet !== 1 ? 's' : ''} set`}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {req
                                    ? renderReqExtras(req)
                                    : (
                                      <button onClick={() => handleSendSkuForReview(sku)} disabled={sendingSkuId === sku.id} className="flex items-center gap-1 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50">
                                        {sendingSkuId === sku.id ? <RefreshCw size={11} className="animate-spin"/> : <Send size={11}/>} Send for review
                                      </button>
                                    )}
                                </div>
                              </div>
                              {req && renderExpandedData(req)}
                            </div>
                          );
                        })}

                        {/* Legacy requests whose SKU is no longer defined */}
                        {orphanReqs.map(req => {
                          const isSubmitted = req.status === 'submitted';
                          return (
                            <div key={req.id} className="border-t border-indigo-100/60">
                              <div className="flex items-center justify-between px-4 py-3 gap-3">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isSubmitted ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-semibold text-gray-800">{req.skuNumber || '—'}</span>
                                      {req.skuTitle && <span className="text-xs text-gray-500 truncate">{req.skuTitle}</span>}
                                      {isSubmitted
                                        ? <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded flex-shrink-0">SUBMITTED</span>
                                        : <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex-shrink-0">PENDING</span>}
                                      <span className="text-[10px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded flex-shrink-0" title="This SKU is not in the project's defined SKUs">NOT IN DEFINED SKUS</span>
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                      {isSubmitted ? `Submitted ${new Date(req.submittedAt!).toLocaleDateString()}` : `Sent ${new Date(req.createdAt).toLocaleDateString()}`}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">{renderReqExtras(req)}</div>
                              </div>
                              {renderExpandedData(req)}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Step 3 — Final Attribute Verification: derived from Step-2 requests. */}
                  {step.stepNumber === 3 && (() => {
                    const stepReqs = attrRequests.filter(r => r.step === 3);
                    const step2Reqs = attrRequests.filter(r => r.step === 2);
                    const existingStep3Skus = new Set(attrRequests.filter(r => r.step === 3).map(r => r.skuNumber));
                    const unsentStep3Count = step2Reqs.filter(r => !existingStep3Skus.has(r.skuNumber)).length;

                    return (
                      <div className="bg-indigo-50/30 border-b border-indigo-100">
                        {/* Section header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-indigo-100/60">
                          <div className="flex items-center gap-2">
                            <ClipboardList size={15} className="text-indigo-500" />
                            <span className="text-sm font-semibold text-gray-700">Final Attribute Verification</span>
                            {stepReqs.length > 0 && (
                              <span className="text-[10px] bg-indigo-100 text-indigo-600 font-bold px-1.5 py-0.5 rounded">{stepReqs.length} SKU{stepReqs.length > 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={handleRefreshAttrRequests} disabled={attrReqRefreshing} title="Refresh" className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-100 rounded-lg disabled:opacity-50">
                              <RefreshCw size={12} className={attrReqRefreshing ? 'animate-spin' : ''} />
                            </button>
                            {unsentStep3Count > 0 && (
                              <button onClick={handleSendAllProductionRequests} disabled={attrReqSendingAll} className="flex items-center gap-1.5 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50">
                                {attrReqSendingAll ? <><RefreshCw size={12} className="animate-spin"/> Sending...</> : <><Send size={12}/> Send All ({unsentStep3Count})</>}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Empty state */}
                        {stepReqs.length === 0 && (
                          <div className="px-4 py-4 text-xs text-gray-400 text-center">
                            No production requests yet. Send SKUs for review in Step 2 first, then use "Send All".
                          </div>
                        )}

                        {/* One row per sent Step-3 request */}
                        {stepReqs.map(req => {
                          const isSubmitted = req.status === 'submitted';
                          const isExpanded = expandedAttrRequestId === req.id;
                          return (
                            <div key={req.id} className="border-t border-indigo-100/60 first:border-t-0">
                              <div className="flex items-center justify-between px-4 py-3 gap-3">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isSubmitted ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-semibold text-gray-800">{req.skuNumber || '—'}</span>
                                      {req.skuTitle && <span className="text-xs text-gray-500 truncate">{req.skuTitle}</span>}
                                      {isSubmitted
                                        ? <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded flex-shrink-0">SUBMITTED</span>
                                        : <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex-shrink-0">PENDING</span>
                                      }
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                      {isSubmitted ? `Submitted ${new Date(req.submittedAt!).toLocaleDateString()}` : `Sent ${new Date(req.createdAt).toLocaleDateString()}`}
                                      {req.categoryName && ` · ${req.categoryName}`}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {isSubmitted && (
                                    <button onClick={() => setExpandedAttrRequestId(isExpanded ? null : req.id)} className="text-xs text-emerald-700 font-medium hover:underline flex items-center gap-1">
                                      {isExpanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>} Data
                                    </button>
                                  )}
                                  <a href={`${window.location.origin}/#/attribute-request/${req.token}`} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline flex items-center gap-0.5" title="Open portal link">
                                    <LinkIcon size={11}/> Link
                                  </a>
                                  <button
                                    onClick={() => {
                                      const s2 = attrRequests.find(r => r.step === 2 && r.skuNumber === req.skuNumber);
                                      handleOpenAttrReqModal(3, s2);
                                    }}
                                    className="text-xs text-gray-500 hover:text-indigo-600 flex items-center gap-0.5"
                                    title="Resend"
                                  >
                                    <RefreshCw size={11}/> Resend
                                  </button>
                                  <button onClick={() => handleDeleteAttrRequest(req)} className="p-1 text-gray-300 hover:text-rose-500 rounded" title="Delete request">
                                    <Trash2 size={12}/>
                                  </button>
                                </div>
                              </div>
                              {/* Expanded submitted data */}
                              {isExpanded && req.submittedData && req.submittedData.length > 0 && (
                                <div className="px-4 pb-4">
                                  <div className="flex justify-end mb-2">
                                    <button onClick={() => handleExportAttrData(req)} className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg font-medium">
                                      <Download size={12} /> Export to Excel
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    {req.submittedData.map(d => (
                                      <div key={d.attributeId} className="bg-white rounded border border-indigo-100 px-3 py-2">
                                        <div className="text-xs text-gray-500">{d.name}</div>
                                        <div className="text-sm font-medium text-gray-800">{d.value || '—'}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Step 2 SKUs not yet sent for production verification */}
                        {step2Reqs.filter(r => !existingStep3Skus.has(r.skuNumber)).map(r => (
                          <div key={r.id} className="border-t border-indigo-100/60 flex items-center justify-between px-4 py-3 gap-3">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="w-2 h-2 rounded-full flex-shrink-0 bg-gray-300" />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-gray-400">{r.skuNumber || '—'}</span>
                                  {r.skuTitle && <span className="text-xs text-gray-400">{r.skuTitle}</span>}
                                  <span className="text-[10px] font-bold bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded flex-shrink-0">NOT SENT</span>
                                </div>
                              </div>
                            </div>
                            <button onClick={() => handleOpenAttrReqModal(3, r)} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                              <Send size={11}/> Send
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {allStepDocs.map(doc => {
                    const isRejected = doc.status === DocStatus.REJECTED;
                    const hasFile = !!doc.fileUrl;
                    const isAdHoc = doc.description === 'ad-hoc';

                    return (
                      <div key={doc.id} className="p-4 hover:bg-light transition-colors group">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4 flex-1">
                            <div className={`p-2 rounded-xl ${hasFile ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                              <FileText size={20} />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-medium text-primary">{doc.title}</h4>
                                <StatusBadge status={doc.status} type="doc" />
                                {isAdHoc && <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded border">Extra</span>}
                              </div>
                              <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
                                <span>{doc.responsibleParty === 'supplier' ? 'Supplier' : 'Internal'}</span>
                                {doc.deadline && <span className="text-amber-600 flex items-center gap-1">Due: {doc.deadline}</span>}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Actions */}
                            {hasFile && (
                              <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                                <Eye size={16} />
                              </a>
                            )}
                            
                            <button onClick={(e) => triggerUpload(e, doc.id)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" title="Upload File">
                              <Upload size={16} />
                            </button>

                            {doc.status === DocStatus.WAITING_UPLOAD || doc.status === DocStatus.UPLOADED ? (
                                <button onClick={() => setReviewingDoc(doc)} className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded" title="Review">
                                  <CheckCircle2 size={16} />
                                </button>
                            ) : null}

                            <div className="relative">
                               <button onClick={(e) => toggleDocHistory(e, doc.id)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded">
                                  <History size={16} />
                               </button>
                            </div>

                            <button onClick={(e) => handleEditDoc(e, doc)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                               <Pencil size={16} />
                            </button>
                            
                            <button onClick={(e) => handleDeleteDoc(e, doc.id)} className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded">
                               <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        
                        {expandedDocIds[doc.id] && doc.versions && doc.versions.length > 0 && (
                           <div className="mt-3 pl-12 pr-4">
                              <p className="text-xs font-bold text-muted uppercase mb-2">Version History</p>
                              <div className="space-y-2">
                                 {doc.versions.map((v, idx) => (
                                    <div key={v.id} className="flex justify-between items-center text-xs bg-light p-2 rounded border border-gray-100">
                                       <div className="flex items-center gap-2">
                                          <span className="font-mono bg-gray-200 px-1.5 rounded">v{v.versionNumber}</span>
                                          <a href={v.fileUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline truncate max-w-[200px]">
                                             View File
                                          </a>
                                          <span className="text-gray-400">{new Date(v.uploadedAt).toLocaleString()}</span>
                                       </div>
                                       {/* Only show delete if it's not the only version or logic allows */}
                                       <button onClick={() => handleDeleteVersion(v.id)} className="text-red-400 hover:text-rose-600"><X size={12}/></button>
                                    </div>
                                 ))}
                              </div>
                           </div>
                        )}
                      </div>
                    );
                  })}
                  
                  <div className="p-4 bg-light/50 flex justify-between items-center">
                     <button onClick={() => handleAddDoc(step.stepNumber)} className="text-sm text-indigo-600 font-medium hover:underline flex items-center gap-1">
                        <Plus size={14} /> Add Requirement
                     </button>
                     <button onClick={(e) => triggerAdHocUpload(e, step.stepNumber)} className="text-sm text-muted hover:text-gray-700 flex items-center gap-1">
                        <Paperclip size={14} /> Upload Extra File
                     </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ATTRIBUTES TAB */}
      {activeTab === 'attributes' && (() => {
        const stepLabel = (s: 2 | 3) => (s === 3 ? 'Final Verification' : 'Product Data');

        // Group every request by SKU. Each SKU can have multiple requests over time
        // (Step 2 product data, Step 3 final verification, resends) — each submitted
        // request is one historical snapshot of that SKU's attributes.
        const bySku = new Map<string, ProjectAttributeRequest[]>();
        for (const r of attrRequests) {
          const key = r.skuNumber || '—';
          if (!bySku.has(key)) bySku.set(key, []);
          bySku.get(key)!.push(r);
        }

        const skuGroups = Array.from(bySku.entries()).map(([sku, reqs]) => {
          // Snapshots = submitted requests with data, newest first
          const snapshots = reqs
            .filter(r => r.status === 'submitted' && r.submittedData && r.submittedData.length > 0)
            .sort((a, b) => new Date(b.submittedAt!).getTime() - new Date(a.submittedAt!).getTime());
          const pending = reqs.filter(r => r.status !== 'submitted');
          const title = reqs.find(r => r.skuTitle)?.skuTitle || '';
          return { sku, title, snapshots, pending };
        }).sort((a, b) => a.sku.localeCompare(b.sku));

        // Render the right editor for an attribute, honoring its defined data type
        // (enum → dropdown, boolean → Yes/No, numeric → number/range, image → upload).
        // Falls back to a plain text input when no definition is found for the attribute.
        const renderAttrEditor = (d: { attributeId: string; name: string; value: string; type?: string }) => {
          const def = categoryAttributeDefs.find(a => a.id === d.attributeId);
          const setVal = (v: string) => setEditingAttrValues(prev => ({ ...prev, [d.attributeId]: v }));
          if (def) {
            return (
              <AttributeInput
                attribute={def}
                value={editingAttrValues[d.attributeId] ?? ''}
                onChange={setVal}
                mode={editingAttrModes[d.attributeId] || 'text'}
                onModeChange={mode => {
                  setEditingAttrModes(prev => ({ ...prev, [d.attributeId]: mode }));
                  setVal('');
                }}
              />
            );
          }
          return (
            <input
              value={editingAttrValues[d.attributeId] ?? ''}
              onChange={(e) => setVal(e.target.value)}
              className="mt-0.5 w-full text-sm border border-gray-300 rounded px-2 py-1 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
            />
          );
        };

        return (
          <div>
            {/* ===== Defined SKUs manager ===== */}
            <div className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Defined SKUs</h3>
                  <p className="text-sm text-muted mt-0.5">Up to {MAX_SKUS_PER_PROJECT} SKUs for this project, each with its attribute values. These SKUs are used across the project.</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-gray-400">{projectSkus.length}/{MAX_SKUS_PER_PROJECT}</span>
                  <button
                    onClick={() => { setAddingSku(true); setSkuDraftNumber(''); setSkuDraftTitle(''); setEditingSkuId(null); }}
                    disabled={projectSkus.length >= MAX_SKUS_PER_PROJECT || addingSku}
                    className="flex items-center gap-1.5 text-sm bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 font-medium disabled:opacity-50"
                  >
                    <Plus size={16} /> Add SKU
                  </button>
                </div>
              </div>

              {/* Add SKU inline form */}
              {addingSku && (
                <div className="bg-white rounded-xl border border-indigo-200 shadow p-4 mb-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">SKU Number *</label>
                      <input value={skuDraftNumber} onChange={e => setSkuDraftNumber(e.target.value)} placeholder="e.g. SKU-001" className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">SKU Title</label>
                      <input value={skuDraftTitle} onChange={e => setSkuDraftTitle(e.target.value)} placeholder="e.g. Wireless Charger 10W" className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setAddingSku(false); setSkuDraftNumber(''); setSkuDraftTitle(''); }} className="text-sm text-gray-500 hover:bg-gray-100 px-3 py-1.5 rounded-lg font-medium">Cancel</button>
                    <button onClick={handleAddSku} disabled={savingSku} className="flex items-center gap-1 text-sm bg-indigo-600 text-white px-4 py-1.5 rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50">
                      {savingSku ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />} Add
                    </button>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {projectSkus.length === 0 && !addingSku && (
                <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-muted">
                  No SKUs defined yet. Click "Add SKU" to define the SKUs used across this project.
                </div>
              )}

              {/* SKU cards */}
              <div className="space-y-4">
                {projectSkus.map(sku => {
                  const isEditing = editingSkuId === sku.id;
                  const submission = getLatestSkuSubmission(sku.skuNumber);
                  const valuesSet = projectCatAttrs.length > 0
                    ? projectCatAttrs.filter(a => getEffectiveSkuValue(sku, attrRequests, a.id)).length
                    : sku.attributeValues.filter(v => v.value).length;
                  return (
                    <div key={sku.id} className="bg-white rounded-xl border border-gray-200 shadow overflow-hidden">
                      <div className="bg-light px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600"><Boxes size={20} /></div>
                          {isEditing ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <input value={skuDraftNumber} onChange={e => setSkuDraftNumber(e.target.value)} placeholder="SKU number" className="text-sm font-semibold border border-gray-300 rounded px-2 py-1 w-32 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" />
                              <input value={skuDraftTitle} onChange={e => setSkuDraftTitle(e.target.value)} placeholder="Title" className="text-sm border border-gray-300 rounded px-2 py-1 w-48 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" />
                            </div>
                          ) : (
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-bold text-gray-800">{sku.skuNumber}</h4>
                                {sku.skuTitle && <span className="text-sm text-gray-500 truncate">{sku.skuTitle}</span>}
                                {submission && (
                                  <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded flex-shrink-0" title={`Latest supplier submission ${new Date(submission.submittedAt!).toLocaleDateString()}`}>
                                    SUPPLIER DATA
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted mt-0.5">
                                {valuesSet} attribute value{valuesSet !== 1 ? 's' : ''} set
                                {submission && <span className="text-emerald-600"> · showing latest submission ({new Date(submission.submittedAt!).toLocaleDateString()})</span>}
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {isEditing ? (
                            <>
                              <button onClick={() => handleSaveSku(sku)} disabled={savingSku} className="flex items-center gap-1 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50">
                                {savingSku ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Save
                              </button>
                              <button onClick={handleCancelEditSku} disabled={savingSku} className="flex items-center gap-1 text-xs text-gray-500 hover:bg-gray-100 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"><X size={12} /> Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => handleStartEditSku(sku)} className="flex items-center gap-1 text-xs text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg font-medium"><Pencil size={12} /> Edit</button>
                              <button onClick={() => handleDeleteSku(sku)} className="p-1.5 text-gray-300 hover:text-rose-500 rounded" title="Delete SKU"><Trash2 size={14} /></button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="p-6">
                        {!project?.categoryId ? (
                          <div className="text-sm text-gray-400 flex items-center gap-2"><AlertCircle size={14} /> Assign a category to this project to enter attribute values.</div>
                        ) : projectCatAttrs.length === 0 ? (
                          <div className="text-sm text-gray-400">No attributes are defined for this project's category.</div>
                        ) : isEditing ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {projectCatAttrs.map(a => (
                              <div key={a.id} className="bg-light rounded border border-gray-100 px-3 py-2">
                                <div className="text-xs text-gray-500 mb-0.5">{a.name}{a.validationRules?.unit ? ` (${a.validationRules.unit})` : ''}</div>
                                {renderAttrEditor({ attributeId: a.id, name: a.name, value: editingAttrValues[a.id] ?? '', type: a.dataType })}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {projectCatAttrs.map(a => {
                              const ownVal = sku.attributeValues.find(x => x.attributeId === a.id)?.value || '';
                              const submittedVal = submission?.submittedData?.find(d => d.attributeId === a.id)?.value || '';
                              const v = submittedVal || ownVal;
                              const fromSupplier = !!submittedVal && submittedVal !== ownVal;
                              return (
                                <div key={a.id} className="bg-light rounded border border-gray-100 px-3 py-2">
                                  <div className="text-xs text-gray-500 flex items-center gap-1">
                                    {a.name}
                                    {fromSupplier && <span className="text-[9px] font-bold text-emerald-600" title="From latest supplier submission">★</span>}
                                  </div>
                                  <div className="text-sm font-medium text-gray-800 break-words">{v || '—'}</div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ===== Supplier submission history ===== */}
            <div className="flex justify-between items-center mb-6 mt-10 pt-8 border-t border-gray-200">
              <div>
                <h3 className="text-lg font-bold text-gray-800">Supplier Submission History</h3>
                <p className="text-sm text-muted mt-0.5">Attribute data submitted by suppliers via attribute requests, grouped by SKU.</p>
              </div>
              <button
                onClick={handleRefreshAttrRequests}
                disabled={attrReqRefreshing}
                className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-light disabled:opacity-50"
              >
                <RefreshCw size={16} className={attrReqRefreshing ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            {skuGroups.length === 0 ? (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-muted">
                No attribute data yet. Send attribute requests from the Checklist tab (Step 2 / Step 3) to collect SKU attributes.
              </div>
            ) : (
              <div className="space-y-6">
                {skuGroups.map(({ sku, title, snapshots, pending }) => {
                  const latest = snapshots[0];
                  const history = snapshots.slice(1);
                  return (
                    <div key={sku} className="bg-white rounded-xl border border-gray-200 shadow overflow-hidden">
                      {/* SKU header */}
                      <div className="bg-light px-6 py-4 border-b border-gray-200 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600"><Boxes size={20} /></div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-bold text-gray-800">{sku}</h4>
                              {title && <span className="text-sm text-gray-500 truncate">{title}</span>}
                            </div>
                            <p className="text-xs text-muted mt-0.5">
                              {snapshots.length > 0
                                ? `${snapshots.length} submission${snapshots.length > 1 ? 's' : ''} on record`
                                : 'Awaiting submission'}
                            </p>
                          </div>
                        </div>
                        {latest && (
                          <button
                            onClick={() => handleExportAttrData(latest)}
                            className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg font-medium flex-shrink-0"
                          >
                            <Download size={12} /> Export Latest
                          </button>
                        )}
                      </div>

                      <div className="p-6">
                        {/* Latest attributes */}
                        {latest ? (
                          <>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Latest Attributes</span>
                                <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{stepLabel(latest.step)}</span>
                                <span className="text-[11px] text-gray-400">Submitted {new Date(latest.submittedAt!).toLocaleDateString()}</span>
                              </div>
                              {editingAttrReqId === latest.id ? (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <button
                                    onClick={() => handleSaveAttr(latest)}
                                    disabled={savingAttr}
                                    className="flex items-center gap-1 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                                  >
                                    {savingAttr ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Save
                                  </button>
                                  <button
                                    onClick={handleCancelEditAttr}
                                    disabled={savingAttr}
                                    className="flex items-center gap-1 text-xs text-gray-500 hover:bg-gray-100 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                                  >
                                    <X size={12} /> Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleStartEditAttr(latest)}
                                  className="flex items-center gap-1 text-xs text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg font-medium flex-shrink-0"
                                >
                                  <Pencil size={12} /> Edit
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {latest.submittedData!.map(d => (
                                <div key={d.attributeId} className="bg-light rounded border border-gray-100 px-3 py-2">
                                  <div className="text-xs text-gray-500 mb-0.5">{d.name}</div>
                                  {editingAttrReqId === latest.id ? (
                                    renderAttrEditor(d)
                                  ) : (
                                    <div className="text-sm font-medium text-gray-800 break-words">{d.value || '—'}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="text-sm text-gray-400 flex items-center gap-2">
                            <Clock size={14} /> No submitted attributes yet for this SKU.
                            {pending.length > 0 && ` ${pending.length} request${pending.length > 1 ? 's' : ''} pending.`}
                          </div>
                        )}

                        {/* History */}
                        {history.length > 0 && (
                          <div className="mt-6 pt-5 border-t border-gray-100">
                            <div className="flex items-center gap-2 mb-3">
                              <History size={14} className="text-gray-400" />
                              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">History ({history.length})</span>
                            </div>
                            <div className="space-y-2">
                              {history.map((snap, idx) => {
                                const isOpen = expandedAttrHistoryId === snap.id;
                                // The snapshot chronologically just before this one (older) to highlight changes.
                                const prevSnap = snapshots[snapshots.indexOf(snap) + 1];
                                const prevValues = new Map((prevSnap?.submittedData || []).map(d => [d.attributeId, d.value]));
                                return (
                                  <div key={snap.id} className="border border-gray-100 rounded-lg overflow-hidden">
                                    <button
                                      onClick={() => setExpandedAttrHistoryId(isOpen ? null : snap.id)}
                                      className="w-full flex items-center justify-between px-3 py-2.5 bg-light/50 hover:bg-light text-left"
                                    >
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {isOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                                        <span className="text-sm font-medium text-gray-700">{stepLabel(snap.step)}</span>
                                        <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">v{history.length - idx}</span>
                                        <span className="text-xs text-gray-400">Submitted {new Date(snap.submittedAt!).toLocaleString()}</span>
                                      </div>
                                      <span
                                        onClick={(e) => { e.stopPropagation(); handleExportAttrData(snap); }}
                                        className="text-gray-400 hover:text-emerald-600 p-1"
                                        title="Export this snapshot"
                                      >
                                        <Download size={13} />
                                      </span>
                                    </button>
                                    {isOpen && snap.submittedData && (
                                      <div className="px-3 py-3">
                                        <div className="flex justify-end mb-2">
                                          {editingAttrReqId === snap.id ? (
                                            <div className="flex items-center gap-1.5">
                                              <button
                                                onClick={() => handleSaveAttr(snap)}
                                                disabled={savingAttr}
                                                className="flex items-center gap-1 text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
                                              >
                                                {savingAttr ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Save
                                              </button>
                                              <button
                                                onClick={handleCancelEditAttr}
                                                disabled={savingAttr}
                                                className="flex items-center gap-1 text-xs text-gray-500 hover:bg-gray-100 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                                              >
                                                <X size={12} /> Cancel
                                              </button>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => handleStartEditAttr(snap)}
                                              className="flex items-center gap-1 text-xs text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg font-medium"
                                            >
                                              <Pencil size={12} /> Edit
                                            </button>
                                          )}
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                          {snap.submittedData.map(d => {
                                            const editing = editingAttrReqId === snap.id;
                                            const changed = !editing && prevSnap && prevValues.get(d.attributeId) !== d.value;
                                            return (
                                              <div key={d.attributeId} className={`rounded border px-3 py-2 ${changed ? 'border-amber-200 bg-amber-50' : 'border-gray-100 bg-white'}`}>
                                                <div className="text-xs text-gray-500 flex items-center gap-1 mb-0.5">
                                                  {d.name}
                                                  {changed && <span className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1 rounded">CHANGED</span>}
                                                </div>
                                                {editing ? (
                                                  renderAttrEditor(d)
                                                ) : (
                                                  <div className="text-sm font-medium text-gray-800 break-words">{d.value || '—'}</div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
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
      })()}

      {/* COMPLIANCE TAB */}
      {activeTab === 'compliance' && (
        <div>
           <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-gray-800">Compliance Requests</h3>
              <Link to={`/compliance/create?projectId=${project.id}`} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 shadow">
                 <Plus size={16} /> New Request
              </Link>
           </div>
           
           {complianceRequests.length === 0 ? (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center text-muted">
                 No compliance requests found for this project.
              </div>
           ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow">
                 <table className="w-full text-left text-sm">
                    <thead className="bg-light border-b border-gray-200 text-gray-600">
                       <tr>
                          <th className="px-6 py-3 font-semibold">ID</th>
                          <th className="px-6 py-3 font-semibold">Category</th>
                          <th className="px-6 py-3 font-semibold">Status</th>
                          <th className="px-6 py-3 font-semibold">Deadline</th>
                          <th className="px-6 py-3 font-semibold">Action</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                       {complianceRequests.map(req => (
                          <tr key={req.id} className="hover:bg-light">
                             <td className="px-6 py-4 font-mono text-gray-600">{req.requestId}</td>
                             <td className="px-6 py-4">{getCategoryName(req.categoryId)}</td>
                             <td className="px-6 py-4"><StatusBadge status={req.status} type="doc" /></td>
                             <td className="px-6 py-4 text-muted">{req.deadline ? new Date(req.deadline).toLocaleDateString() : '-'}</td>
                             <td className="px-6 py-4">
                                <Link to={`/compliance/request/${req.id}`} className="text-indigo-600 hover:text-blue-800 font-medium">View Details</Link>
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
              </div>
           )}
        </div>
      )}

      {/* TIMELINE TAB */}
      {activeTab === 'timeline' && (
         <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-xl shadow border border-gray-200 p-8">
               <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                     <GanttChartSquare className="text-indigo-600"/> Project Milestones
                  </h3>
                  {!isEditingTimeline && (
                     <button onClick={() => setIsEditingTimeline(true)} className="text-sm text-indigo-600 hover:underline font-medium">Edit Dates</button>
                  )}
               </div>
               
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                     <label className="block text-sm font-medium text-muted mb-1">PO Placement</label>
                     <input type="date" disabled={!isEditingTimeline} className="w-full border border-gray-300 rounded-md p-2 disabled:bg-light disabled:text-muted" value={timelineForm.poPlacement} onChange={e => setTimelineForm({...timelineForm, poPlacement: e.target.value})} />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-muted mb-1">Mass Production Start</label>
                     <input type="date" disabled={!isEditingTimeline} className="w-full border border-gray-300 rounded-md p-2 disabled:bg-light disabled:text-muted" value={timelineForm.massProduction} onChange={e => setTimelineForm({...timelineForm, massProduction: e.target.value})} />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-muted mb-1">ETD (Estimated Time of Departure)</label>
                     <input type="date" disabled={!isEditingTimeline} className="w-full border border-gray-300 rounded-md p-2 disabled:bg-light disabled:text-muted" value={timelineForm.etd} onChange={e => setTimelineForm({...timelineForm, etd: e.target.value})} />
                  </div>
                  <div>
                     <label className="block text-sm font-medium text-muted mb-1">ETA (Estimated Time of Arrival)</label>
                     <input type="date" disabled={!isEditingTimeline} className="w-full border border-gray-300 rounded-md p-2 disabled:bg-light disabled:text-muted" value={timelineForm.eta} onChange={e => setTimelineForm({...timelineForm, eta: e.target.value})} />
                  </div>
               </div>

               {isEditingTimeline && (
                  <div className="mt-8 flex justify-end gap-3 border-t border-gray-100 pt-4">
                     <button onClick={() => { setIsEditingTimeline(false); loadProjectData(); }} className="px-4 py-2 text-gray-600 hover:bg-light rounded text-sm">Cancel</button>
                     <button onClick={handleSaveTimeline} className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-sm font-bold shadow">Save Changes</button>
                  </div>
               )}
            </div>
         </div>
      )}

      {/* IM TAB */}
      {activeTab === 'im' && (
         <div className="max-w-4xl mx-auto">
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-8 text-white shadow-lg flex justify-between items-center">
               <div>
                  <h3 className="text-2xl font-bold mb-2 flex items-center gap-2"><BookOpen className="text-indigo-400"/> Instruction Manual</h3>
                  <p className="text-gray-300 text-sm max-w-lg">Generate a compliant instruction manual based on the category template and project data.</p>
               </div>
               <Link to={`/project/${project.id}/im-generator`} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2">
                  {projectIM ? 'Edit Manual' : 'Start Generator'} <ArrowRight size={18} />
               </Link>
            </div>

            {projectIM && (
               <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow">
                     <h4 className="text-xs font-bold text-muted uppercase mb-2">Status</h4>
                     <div className="flex items-center gap-2">
                        {projectIM.status === 'generated' ? <CheckCircle2 className="text-emerald-600" size={20} /> : <Circle className="text-orange-500" size={20} />}
                        <span className="font-bold text-gray-800 capitalize">{projectIM.status}</span>
                     </div>
                     {imStaleReasons.length > 0 && (
                        <div className="mt-2">
                           <div className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-orange-100 text-orange-700 border-orange-200" title={`${staleSummary(imStaleReasons)} changed since last publish. Re-publish from the generator to update.`}>
                              <RefreshCw size={11} /> Needs re-publish
                           </div>
                           <div className="text-[11px] text-orange-600/80 mt-1">↳ {staleSummary(imStaleReasons)}</div>
                        </div>
                     )}
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow">
                     <h4 className="text-xs font-bold text-muted uppercase mb-2">Last Updated</h4>
                     <span className="font-mono text-gray-700">{new Date(projectIM.updatedAt).toLocaleString()}</span>
                  </div>
               </div>
            )}

            {/* Warning Leaflet */}
            <div className="mt-8 bg-gradient-to-br from-amber-900 to-amber-950 rounded-xl p-8 text-white shadow-lg flex justify-between items-center">
               <div>
                  <h3 className="text-2xl font-bold mb-2 flex items-center gap-2"><AlertTriangle className="text-amber-300"/> Warning Leaflet</h3>
                  <p className="text-amber-100/80 text-sm max-w-lg">Generate the safety warning leaflet based on the category's leaflet template and project data.</p>
               </div>
               <Link to={`/project/${project.id}/im-generator/warning_leaflet`} className="bg-amber-500 hover:bg-amber-400 text-amber-950 px-6 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2">
                  {projectLeaflet ? 'Edit Leaflet' : 'Start Generator'} <ArrowRight size={18} />
               </Link>
            </div>

            {projectLeaflet && (
               <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow">
                     <h4 className="text-xs font-bold text-muted uppercase mb-2">Status</h4>
                     <div className="flex items-center gap-2">
                        {projectLeaflet.status === 'generated' ? <CheckCircle2 className="text-emerald-600" size={20} /> : <Circle className="text-orange-500" size={20} />}
                        <span className="font-bold text-gray-800 capitalize">{projectLeaflet.status}</span>
                     </div>
                     {leafletStaleReasons.length > 0 && (
                        <div className="mt-2">
                           <div className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border bg-orange-100 text-orange-700 border-orange-200" title={`${staleSummary(leafletStaleReasons)} changed since last publish. Re-publish from the generator to update.`}>
                              <RefreshCw size={11} /> Needs re-publish
                           </div>
                           <div className="text-[11px] text-orange-600/80 mt-1">↳ {staleSummary(leafletStaleReasons)}</div>
                        </div>
                     )}
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow">
                     <h4 className="text-xs font-bold text-muted uppercase mb-2">Last Updated</h4>
                     <span className="font-mono text-gray-700">{new Date(projectLeaflet.updatedAt).toLocaleString()}</span>
                  </div>
               </div>
            )}
         </div>
      )}

      {/* MANUFACTURING TAB */}
      {activeTab === 'manufacturing' && (
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Status & Actions */}
            <div className="space-y-6">
                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow">
                    <h3 className="text-lg font-bold text-gray-800 mb-4">Production Status</h3>
                    
                    {/* Automated Alerts */}
                    {getEtdAlert() && (
                        <div className={`mb-6 p-4 rounded-xl border flex gap-3 ${getEtdAlert()?.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : getEtdAlert()?.type === 'warning' ? 'bg-amber-50 border-amber-200 text-orange-800' : 'bg-indigo-50 border-indigo-200 text-blue-800'}`}>
                            <AlertCircle className="shrink-0 mt-0.5" size={18} />
                            <div>
                                <h4 className="font-bold text-sm">{getEtdAlert()?.title}</h4>
                                <p className="text-xs mt-1 opacity-90">{getEtdAlert()?.msg}</p>
                            </div>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div>
                            <div className="text-xs font-bold text-muted uppercase mb-1">Current ETD</div>
                            <div className="text-xl font-mono font-bold text-primary">{timelineForm.etd ? new Date(timelineForm.etd).toLocaleDateString() : 'Not Set'}</div>
                        </div>
                        <button 
                            onClick={() => setIsUpdateModalOpen(true)}
                            className="w-full py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 shadow text-sm"
                        >
                            Update Status / Report Delay
                        </button>
                    </div>
                </div>
            </div>

            {/* Right Column: Update History */}
            <div className="lg:col-span-2">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><History size={18}/> Update History</h3>
                <div className="space-y-4">
                    {productionUpdates.length === 0 ? (
                        <div className="text-center py-12 bg-light rounded-xl border border-dashed border-gray-200 text-gray-400">No updates recorded yet.</div>
                    ) : (
                        productionUpdates.map(update => (
                            <div key={update.id} className={`bg-white p-4 rounded-xl border shadow relative pl-4 ${update.isOnTime ? 'border-gray-200' : 'border-rose-200'}`}>
                                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${update.isOnTime ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${update.isOnTime ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                            {update.isOnTime ? 'On Track' : 'Delayed'}
                                        </span>
                                        {!update.isOnTime && <span className="ml-2 text-xs font-bold text-rose-600">{update.delayReason}</span>}
                                    </div>
                                    <span className="text-xs text-gray-400">{new Date(update.createdAt).toLocaleString()}</span>
                                </div>
                                <div className="flex gap-6 text-sm mb-2">
                                    <div>
                                        <span className="text-muted text-xs block">New ETD</span>
                                        <span className="font-mono font-bold">{new Date(update.newEtd).toLocaleDateString()}</span>
                                    </div>
                                    {update.previousEtd && (
                                        <div>
                                            <span className="text-muted text-xs block">Previous</span>
                                            <span className="font-mono text-gray-400 line-through">{new Date(update.previousEtd).toLocaleDateString()}</span>
                                        </div>
                                    )}
                                </div>
                                {update.notes && <p className="text-sm text-gray-600 bg-light p-2 rounded border border-gray-100 mt-2">{update.notes}</p>}
                                <div className="mt-2 text-xs text-gray-400 flex items-center gap-1">
                                    <UserIcon size={10} /> Updated by: {update.updatedBy || (update.isSupplierUpdate ? 'Supplier' : 'PM')}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
         </div>
      )}

      {/* MODALS */}
      
      {/* Review Modal */}
      {reviewingDoc && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="font-bold text-lg mb-2">Review Document</h3>
            <p className="text-sm text-gray-600 mb-4">Action for: <strong>{reviewingDoc.title}</strong></p>
            
            {reviewingDoc.fileUrl && (
               <div className="bg-light p-3 rounded border border-gray-200 mb-4 flex items-center justify-between">
                  <span className="text-xs font-mono text-muted truncate max-w-[200px]">{reviewingDoc.fileUrl}</span>
                  <a href={reviewingDoc.fileUrl} target="_blank" rel="noreferrer" className="text-indigo-600 text-xs hover:underline font-bold">View File</a>
               </div>
            )}

            <textarea 
              className="w-full border border-gray-300 rounded p-3 text-sm mb-4 focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="Add comment (required for rejection)..."
              rows={3}
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
            />
            
            <div className="flex justify-end gap-2">
              <button onClick={() => setReviewingDoc(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm font-medium">Cancel</button>
              <button 
                onClick={() => handleDocReview(DocStatus.REJECTED)}
                disabled={!rejectComment.trim()}
                className="px-4 py-2 bg-rose-100 text-rose-700 hover:bg-red-200 rounded text-sm font-medium disabled:opacity-50"
              >
                Reject
              </button>
              <button onClick={() => handleDocReview(DocStatus.APPROVED)} className="px-4 py-2 bg-emerald-600 text-white hover:bg-green-700 rounded text-sm font-medium shadow">Approve</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Add Doc Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="font-bold text-lg mb-4">{isNewDoc ? 'Add Requirement' : 'Edit Document'}</h3>
            <form onSubmit={handleSaveDoc} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input required className="w-full border border-gray-300 rounded p-2 text-sm" value={editingDocData.title || ''} onChange={e => setEditingDocData({...editingDocData, title: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea className="w-full border border-gray-300 rounded p-2 text-sm" rows={2} value={editingDocData.description || ''} onChange={e => setEditingDocData({...editingDocData, description: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Responsible</label>
                    <select className="w-full border border-gray-300 rounded p-2 text-sm" value={editingDocData.responsibleParty} onChange={e => setEditingDocData({...editingDocData, responsibleParty: e.target.value as ResponsibleParty})}>
                       <option value={ResponsibleParty.SUPPLIER}>Supplier</option>
                       <option value={ResponsibleParty.INTERNAL}>Internal</option>
                    </select>
                 </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
                    <input type="date" className="w-full border border-gray-300 rounded p-2 text-sm" value={editingDocData.deadline || ''} onChange={e => setEditingDocData({...editingDocData, deadline: e.target.value})} />
                 </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                 <input type="checkbox" id="visCheck" checked={editingDocData.isVisibleToSupplier} onChange={e => setEditingDocData({...editingDocData, isVisibleToSupplier: e.target.checked})} className="rounded text-indigo-600" />
                 <label htmlFor="visCheck" className="text-sm text-gray-700">Visible to Supplier</label>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-4">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm font-medium">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-sm font-medium">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {isEditProjectOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="font-bold text-lg mb-4">Edit Project Details</h3>
            <form onSubmit={handleUpdateProject} className="space-y-4">
               <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
                  <input required className="w-full border rounded p-2 text-sm" value={projectEditForm.name} onChange={e => setProjectEditForm({...projectEditForm, name: e.target.value})} />
               </div>
               <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Project ID</label>
                  <input required className="w-full border rounded p-2 text-sm" value={projectEditForm.projectId} onChange={e => setProjectEditForm({...projectEditForm, projectId: e.target.value})} />
               </div>
               <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                  <select className="w-full border rounded p-2 text-sm" value={projectEditForm.supplierId} onChange={e => setProjectEditForm({...projectEditForm, supplierId: e.target.value})}>
                     {allSuppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
               </div>
               <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Project Manager</label>
                  <select className="w-full border rounded p-2 text-sm" value={projectEditForm.pmId} onChange={e => setProjectEditForm({...projectEditForm, pmId: e.target.value})}>
                     {allUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
               </div>
               <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select className="w-full border rounded p-2 text-sm" value={projectEditForm.status} onChange={e => setProjectEditForm({...projectEditForm, status: e.target.value as ProjectOverallStatus})}>
                     {Object.values(ProjectOverallStatus).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
               </div>
               <div className="flex justify-end gap-3 pt-4">
                  <button type="button" onClick={() => setIsEditProjectOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm font-medium">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-sm font-medium">Update Project</button>
               </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Status Modal */}
      {isUpdateModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
                  <h3 className="font-bold text-lg mb-4">Update Production Status</h3>
                  <div className="space-y-4">
                      <div>
                          <span className="block text-sm font-medium text-gray-700 mb-2">Status</span>
                          <div className="flex gap-4">
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input type="radio" name="status" checked={etdForm.isOnTime} onChange={() => setEtdForm({...etdForm, isOnTime: true})} className="text-indigo-600" />
                                  <span className="text-sm">On Time</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                  <input type="radio" name="status" checked={!etdForm.isOnTime} onChange={() => setEtdForm({...etdForm, isOnTime: false})} className="text-rose-600" />
                                  <span className="text-sm">Delayed</span>
                              </label>
                          </div>
                      </div>
                      
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">New ETD</label>
                          <input type="date" className="w-full border rounded p-2 text-sm" value={etdForm.newDate} onChange={(e) => setEtdForm({...etdForm, newDate: e.target.value})} />
                      </div>

                      {!etdForm.isOnTime && (
                          <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">Reason for Delay</label>
                              <select className="w-full border rounded p-2 text-sm" value={etdForm.delayReason} onChange={(e) => setEtdForm({...etdForm, delayReason: e.target.value as ProductionDelayReason})}>
                                  <option value="">Select Reason...</option>
                                  {Object.values(ProductionDelayReason).map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                          </div>
                      )}

                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                          <textarea className="w-full border rounded p-2 text-sm" rows={3} value={etdForm.notes} onChange={(e) => setEtdForm({...etdForm, notes: e.target.value})} placeholder="Additional details..." />
                      </div>

                      <div className="flex justify-end gap-3 pt-2">
                          <button onClick={() => setIsUpdateModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm font-medium">Cancel</button>
                          <button onClick={handleAddUpdate} className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-sm font-medium">Submit Update</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Send Attribute Request Modal */}
      {attrReqModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <ClipboardList size={18} className="text-indigo-600"/>
                {attrReqStep === 2 ? 'Send Attribute Data Request' : 'Send Production Validation Request'}
              </h3>
              <button onClick={() => setAttrReqModal(false)}><X size={18} className="text-gray-400"/></button>
            </div>
            {attrReqStep === 3 && attrReqSourceStep2?.status === 'submitted' && (
              <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                Pre-filled with Step 2 data — supplier will validate and resubmit for production.
              </div>
            )}

            {/* SKU selection */}
            {attrReqStep === 3 ? (
              // Step 3 SKU is locked — it comes from the source Step 2 request.
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SKU Number</label>
                  <input
                    type="text"
                    className="w-full border rounded-lg p-2 text-sm outline-none bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed"
                    value={attrReqSkuNumber}
                    disabled
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SKU Title</label>
                  <input
                    type="text"
                    className="w-full border rounded-lg p-2 text-sm outline-none bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed"
                    value={attrReqSkuTitle}
                    disabled
                  />
                </div>
              </div>
            ) : (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  SKU <span className="text-rose-500">*</span>
                </label>
                {projectSkus.length === 0 ? (
                  <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    No SKUs defined yet. Add SKUs in the Attributes tab first.
                  </div>
                ) : (
                  <select
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none bg-white focus:ring-2 focus:ring-indigo-500"
                    value={attrReqSelectedSkuId}
                    onChange={e => {
                      const s = projectSkus.find(x => x.id === e.target.value);
                      setAttrReqSelectedSkuId(e.target.value);
                      setAttrReqSkuNumber(s?.skuNumber ?? '');
                      setAttrReqSkuTitle(s?.skuTitle ?? '');
                    }}
                  >
                    <option value="">— Select a SKU —</option>
                    {projectSkus.map(s => (
                      <option key={s.id} value={s.id}>{s.skuNumber}{s.skuTitle ? ` — ${s.skuTitle}` : ''}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Category
                {attrReqStep === 3
                  ? <span className="ml-2 text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase">Locked</span>
                  : attrReqCategoryId && <span className="ml-2 text-[10px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded uppercase">From Project</span>}
              </label>
              <select
                className={`w-full border rounded-lg p-2 text-sm outline-none ${attrReqStep === 3 ? 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed' : 'border-gray-300 bg-white focus:ring-2 focus:ring-indigo-500'}`}
                value={attrReqCategoryId}
                onChange={e => setAttrReqCategoryId(e.target.value)}
                disabled={attrReqStep === 3}
              >
                <option value="">— No category (predefined attributes only) —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Message to Supplier (optional)</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                rows={2}
                placeholder="e.g. Please fill in the technical specifications for this SKU..."
                value={attrReqNote}
                onChange={e => setAttrReqNote(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setAttrReqModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
              <button
                onClick={handleSendAttrRequest}
                disabled={attrReqSending || (attrReqStep === 2 && !attrReqSelectedSkuId)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {attrReqSending ? <><span className="animate-spin">⏳</span> Creating...</> : <><Send size={14}/> Create Request</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attribute Request Link Modal */}
      {attrLinkModal.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600"/> Request Created!</h3>
              <button onClick={() => setAttrLinkModal({ open: false, url: '' })}><X size={18} className="text-gray-400"/></button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Share this link with the supplier. They will see the attribute form and submit their data directly.</p>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
              <span className="text-xs text-gray-700 font-mono truncate flex-1 select-all">{attrLinkModal.url}</span>
              <button
                onClick={() => handleCopyAttrLink(attrLinkModal.url)}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded font-medium transition-colors ${attrLinkCopied ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'}`}
              >
                {attrLinkCopied ? <><Check size={12}/> Copied!</> : <><Copy size={12}/> Copy</>}
              </button>
            </div>
            <a
              href={attrLinkModal.url}
              target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              <ExternalLink size={14}/> Open Supplier Form
            </a>
            <button onClick={() => setAttrLinkModal({ open: false, url: '' })} className="mt-3 w-full py-2 text-sm text-gray-400 hover:text-gray-600">Close</button>
          </div>
        </div>
      )}

    </Layout>
  );
};

export default ProjectDetail;
