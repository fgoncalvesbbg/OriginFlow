
import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
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
  getProductionUpdates,
  saveProductionUpdate
} from '../services/apiService';
import { 
  Project, ProjectStep, ProjectDocument, Supplier, StepStatus, DocStatus, ResponsibleParty, 
  ComplianceRequest, CategoryL3, User, ProjectOverallStatus, ProjectIM, ProductionUpdate, ProductionDelayReason 
} from '../types';
import { StatusBadge } from '../components/StatusBadge';
import {
  CheckCircle2, Circle, FileText, Copy, Check, Eye, Upload, Plus, Pencil,
  Trash2, Calendar, X, ShieldCheck, ChevronRight, ListTodo, History, ChevronDown, ChevronUp, ExternalLink, Lock, Unlock, AlertTriangle, File, GanttChartSquare, Paperclip, BookOpen, Factory, ArrowRight, Clock, AlertCircle, User as UserIcon, RefreshCw
} from 'lucide-react';
import { ProjectAICopilot } from '../components/ProjectAICopilot';

// --- Internal Components ---

const ConfirmationModal: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-primary mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-sm font-medium">Confirm</button>
        </div>
      </div>
    </div>
  );
};

const NotificationToast: React.FC<{ message: string, type: 'success' | 'error' | null, onClose: () => void }> = ({ message, type, onClose }) => {
  if (!type) return null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [message, onClose]);

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

  // Manufacturing State
  const [productionUpdates, setProductionUpdates] = useState<ProductionUpdate[]>([]);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [etdForm, setEtdForm] = useState({
      isOnTime: true,
      newDate: '',
      delayReason: '' as ProductionDelayReason | '',
      notes: ''
  });
  
  // Tabs
  const [activeTab, setActiveTab] = useState<'checklist' | 'compliance' | 'timeline' | 'im' | 'manufacturing'>('checklist');
  
  // Review Modal State
  const [reviewingDoc, setReviewingDoc] = useState<ProjectDocument | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  // Edit/Add Document Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDocData, setEditingDocData] = useState<Partial<ProjectDocument>>({});
  const [isNewDoc, setIsNewDoc] = useState(false);
  
  // Expanded Docs for History
  const [expandedDocIds, setExpandedDocIds] = useState<Set<string>>(new Set());
  
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
    loadProjectData();
  }, [id]);

  const loadProjectData = async () => {
    if (!id) return;
    try {
      const p = await getProjectById(id);
      if (p) {
        setProject(p);
        const [sData, stepsData, docsData, compReqs, cats, imData, prodUpdates] = await Promise.all([
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
          getProductionUpdates(p.id)
        ]);
        setSupplier(sData || null);
        setSteps(stepsData);
        setDocs(docsData);
        // Filter compliance requests to only this project
        setComplianceRequests(compReqs.filter(r => r.projectId === p.id));
        setCategories(cats);
        setProjectIM(imData || null);
        setProductionUpdates(prodUpdates);
      }
    } catch (err: any) {
      console.error('Error loading project data:', err);
    }

    // Init timeline form
    setTimelineForm({
      poPlacement: p.milestones?.poPlacement || '',
      massProduction: p.milestones?.massProduction || '',
      etd: p.milestones?.etd || '',
      eta: p.milestones?.eta || ''
    });
    setLoading(false);
  };

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
    const newSet = new Set(expandedDocIds);
    if (newSet.has(docId)) {
      newSet.delete(docId);
    } else {
      newSet.add(docId);
    }
    setExpandedDocIds(newSet);
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
            const newSet = new Set(expandedDocIds);
            newSet.add(uploadingDocId);
            setExpandedDocIds(newSet);
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
                        
                        {expandedDocIds.has(doc.id) && doc.versions && doc.versions.length > 0 && (
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
                  </div>
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow">
                     <h4 className="text-xs font-bold text-muted uppercase mb-2">Last Updated</h4>
                     <span className="font-mono text-gray-700">{new Date(projectIM.updatedAt).toLocaleString()}</span>
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

    </Layout>
  );
};

export default ProjectDetail;
