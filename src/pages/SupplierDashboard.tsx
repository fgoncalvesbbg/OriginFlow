
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getSupplierByToken, getProjectsBySupplierToken, getComplianceRequestsBySupplierId,
  getSupplierNotifications, markNotificationRead, getMissingDocumentsForSupplier,
  getRFQsForSupplier, getProductionUpdates, saveProductionUpdate,
  logAccessCodeAttempt, submitRFQEntry, getSupplierProposals
} from '../services/apiService';
import { Supplier, Project, ComplianceRequest, Notification, ProjectDocument, RFQEntry, ProductionDelayReason, SupplierProposal, ComplianceRequestStatus } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import SubmitProposalModal from '../components/sourcing/SubmitProposalModal';
import { ShieldCheck, LayoutDashboard, Bell, X, AlertCircle, FileText, Package, Factory, Key, Upload, Plus, Download, RefreshCw, Copy, Check, CheckCircle, ChevronRight, ShoppingBag } from 'lucide-react';

const SupplierDashboard: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [complianceReqs, setComplianceReqs] = useState<ComplianceRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [missingDocs, setMissingDocs] = useState<(ProjectDocument & { projectName: string, projectIdCode: string })[]>([]);
  const [openRfqs, setOpenRfqs] = useState<RFQEntry[]>([]);
  const [proposals, setProposals] = useState<SupplierProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);
  const [submittingQuote, setSubmittingQuote] = useState(false);
  const [selectedRfqForQuote, setSelectedRfqForQuote] = useState<RFQEntry | null>(null);
  const [quoteForm, setQuoteForm] = useState({
    unitPrice: '',
    moq: '',
    leadTimeWeeks: '',
    toolingCost: '',
    currency: 'USD',
    supplierNotes: '',
    quoteFileUrl: ''
  });

  // Manufacturing Widget Data
  const [projectsNeedingUpdate, setProjectsNeedingUpdate] = useState<{project: Project, daysUntilEtd: number}[]>([]);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [updatingProject, setUpdatingProject] = useState<Project | null>(null);
  const [updateForm, setUpdateForm] = useState({
    newDate: '',
    delayReason: '' as ProductionDelayReason | '',
    notes: ''
  });

  // Access Code Verification
  const [isAccessVerified, setIsAccessVerified] = useState(false);
  const [enteredAccessCode, setEnteredAccessCode] = useState('');
  const [accessCodeError, setAccessCodeError] = useState('');

  // Search and Filtering
  const [searchTerm, setSearchTerm] = useState('');
  const [filterActionItemsOnly, setFilterActionItemsOnly] = useState(false);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  // Document Upload State
  const [uploadingDocs, setUploadingDocs] = useState<Record<string, boolean>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File | null>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  // Proposal View State
  const [isViewProposalOpen, setIsViewProposalOpen] = useState(false);
  const [viewingProposal, setViewingProposal] = useState<SupplierProposal | null>(null);

  // Project Grouping State
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const toggleProjectExpanded = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  // Tab Navigation State
  const [activeTab, setActiveTab] = useState<'projects' | 'rfq' | 'tcf' | 'proposals'>('projects');

  // Session Management (60 min timeout)
  const SESSION_TIMEOUT = 60 * 60 * 1000;
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  // Dashboard State Management
  const [dashboardError, setDashboardError] = useState('');
  const [refreshingRfqs, setRefreshingRfqs] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('info');
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Load supplier data on mount
  useEffect(() => {
    if (!token) {
      setError('Invalid portal link.');
      setLoading(false);
      return;
    }

    let mounted = true;

    const loadPortal = async () => {
      try {
        // Fetch supplier by token
        const sup = await getSupplierByToken(token);

        if (!mounted) return;

        if (!sup) {
          setError('Supplier not found. Please check your link.');
          setLoading(false);
          return;
        }

        if (!sup.accessCode) {
          setError('Portal setup incomplete. Please contact your Project Manager.');
          setLoading(false);
          return;
        }

        setSupplier(sup);
        setLoading(false);
      } catch (err: any) {
        if (!mounted) return;
        console.error('Portal load error:', err);
        setError('Failed to load portal. Please refresh the page.');
        setLoading(false);
      }
    };

    loadPortal();

    return () => {
      mounted = false;
    };
  }, [token]);

  // Session timeout
  useEffect(() => {
    if (!sessionStartTime) return;

    const intervalId = setInterval(() => {
      const elapsed = Date.now() - sessionStartTime;
      if (elapsed > SESSION_TIMEOUT) {
        setIsAccessVerified(false);
        setEnteredAccessCode('');
        setError('Your session has expired. Please enter your access code again.');
      }
    }, 60000);

    return () => clearInterval(intervalId);
  }, [sessionStartTime]);

  // Debounce search input (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Keyboard navigation - close modals with Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isViewProposalOpen) {
          setIsViewProposalOpen(false);
        }
        if (isQuoteModalOpen) {
          setIsQuoteModalOpen(false);
          setSelectedRfqForQuote(null);
        }
        if (isUpdateModalOpen) {
          setIsUpdateModalOpen(false);
        }
        if (isProposalModalOpen) {
          setIsProposalModalOpen(false);
        }
        if (showNotifications) {
          setShowNotifications(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isViewProposalOpen, isQuoteModalOpen, isUpdateModalOpen, isProposalModalOpen, showNotifications]);

  // Load dashboard data after access verification
  useEffect(() => {
    if (!isAccessVerified || !supplier?.id) return;

    let mounted = true;

    const loadDashboardData = async () => {
      try {
        setDashboardError('');
        const results = await Promise.allSettled([
          getProjectsBySupplierToken(token!),
          getComplianceRequestsBySupplierId(supplier.id),
          getSupplierNotifications(supplier.id),
          getMissingDocumentsForSupplier(supplier.id),
          getRFQsForSupplier(supplier.id),
          getSupplierProposals(supplier.id)
        ]);

        if (!mounted) return;

        const pList = results[0].status === 'fulfilled' ? results[0].value : [];
        const cList = results[1].status === 'fulfilled' ? results[1].value : [];
        const nList = results[2].status === 'fulfilled' ? results[2].value : [];
        const mDocs = results[3].status === 'fulfilled' ? results[3].value : [];
        const rfqList = results[4].status === 'fulfilled' ? results[4].value : [];
        const propList = results[5].status === 'fulfilled' ? results[5].value : [];

        // Check if any critical calls failed
        const failedCalls = results.filter(r => r.status === 'rejected');
        if (failedCalls.length > 0) {
          setDashboardError(`Some data failed to load. ${failedCalls.length} section(s) may be incomplete. Please refresh the page if needed.`);
        }

        setProjects(pList);
        setComplianceReqs(cList);
        setNotifications(nList);
        setMissingDocs(mDocs);
        setOpenRfqs(rfqList);
        setProposals(propList);

        // Calculate Manufacturing Checks - fetch all updates in parallel
        const needsUpdate: {project: Project, daysUntilEtd: number}[] = [];

        // Batch fetch all production updates for projects that might need updates
        const projectsNeedingCheck = pList.filter(p => {
          if (!p.milestones?.etd || p.status !== 'in_progress') return false;
          const etd = new Date(p.milestones.etd);
          const today = new Date();
          const diffDays = Math.ceil((etd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return (diffDays <= 45 && diffDays >= 39) || (diffDays <= 30 && diffDays >= 25) || (diffDays <= 16 && diffDays >= 12);
        });

        if (projectsNeedingCheck.length > 0) {
          const updateResults = await Promise.all(
            projectsNeedingCheck.map(p => getProductionUpdates(p.id))
          );

          for (let i = 0; i < projectsNeedingCheck.length; i++) {
            const p = projectsNeedingCheck[i];
            const updates = updateResults[i];
            const etd = new Date(p.milestones!.etd!);
            const today = new Date();
            const diffDays = Math.ceil((etd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            const recentUpdate = updates.length > 0 && (new Date().getTime() - new Date(updates[0].createdAt).getTime()) < (7 * 24 * 60 * 60 * 1000);

            if (!recentUpdate) {
              needsUpdate.push({ project: p, daysUntilEtd: diffDays });
            }
          }
        }

        if (mounted) {
          setProjectsNeedingUpdate(needsUpdate);
        }
      } catch (err: any) {
        if (!mounted) return;
        console.error('Dashboard data load error:', err);
        setDashboardError('Failed to load dashboard. Please refresh the page.');
      }
    };

    loadDashboardData();

    return () => {
      mounted = false;
    };
  }, [isAccessVerified, supplier?.id, token]);

  const handleVerifyAccessCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccessCodeError('');

    if (!supplier?.accessCode) {
      setAccessCodeError('Access code not configured. Please contact your Project Manager.');
      return;
    }

    if (!enteredAccessCode || enteredAccessCode.length !== 6) {
      setAccessCodeError('Please enter a valid 6-digit code.');
      return;
    }

    const isCorrect = enteredAccessCode === supplier.accessCode;

    // Log the attempt
    await logAccessCodeAttempt(supplier.id, enteredAccessCode, 'unknown', isCorrect);

    if (!isCorrect) {
      setAccessCodeError(
        'Incorrect access code. If you don\'t have your code, please reach out to your Project Manager for assistance.'
      );
      setEnteredAccessCode('');
      return;
    }

    setAccessCodeError('');
    setSessionStartTime(Date.now());
    setIsAccessVerified(true);
  };

  const handleRefreshDashboard = async () => {
    if (!isAccessVerified || !supplier?.id) return;
    setRefreshingDashboard(true);
    setDashboardError('');
    try {
      const results = await Promise.allSettled([
        getProjectsBySupplierToken(token!),
        getComplianceRequestsBySupplierId(supplier.id),
        getSupplierNotifications(supplier.id),
        getMissingDocumentsForSupplier(supplier.id),
        getRFQsForSupplier(supplier.id),
        getSupplierProposals(supplier.id)
      ]);

      const pList = results[0].status === 'fulfilled' ? results[0].value : [];
      const cList = results[1].status === 'fulfilled' ? results[1].value : [];
      const nList = results[2].status === 'fulfilled' ? results[2].value : [];
      const mDocs = results[3].status === 'fulfilled' ? results[3].value : [];
      const rfqList = results[4].status === 'fulfilled' ? results[4].value : [];
      const propList = results[5].status === 'fulfilled' ? results[5].value : [];

      const failedCalls = results.filter(r => r.status === 'rejected');
      if (failedCalls.length > 0) {
        setDashboardError(`Some data failed to load. ${failedCalls.length} section(s) may be incomplete.`);
      } else {
        setToastMessage('Dashboard refreshed successfully!');
        setToastType('success');
      }

      setProjects(pList);
      setComplianceReqs(cList);
      setNotifications(nList);
      setMissingDocs(mDocs);
      setOpenRfqs(rfqList);
      setProposals(propList);
    } catch (err: any) {
      console.error('Error refreshing dashboard:', err);
      setDashboardError('Failed to refresh dashboard. Please try again.');
    } finally {
      setRefreshingDashboard(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    } catch (err: any) {
      console.error('Error marking notification as read:', err);
      setToastMessage('Failed to update notification');
      setToastType('error');
    }
  };

  const handleConfirmEtd = async (project: Project, currentEtd: string) => {
    try {
      await saveProductionUpdate({
        projectId: project.id,
        previousEtd: currentEtd,
        newEtd: currentEtd,
        isOnTime: true,
        isSupplierUpdate: true,
        updatedBy: 'Supplier',
        notes: 'Confirmed via Supplier Portal'
      });
      setProjectsNeedingUpdate(prev => prev.filter(p => p.project.id !== project.id));
      setToastMessage('ETD confirmed successfully!');
      setToastType('success');
    } catch (err: any) {
      console.error('Error confirming ETD:', err);
      setToastMessage('Failed to confirm ETD. Please try again.');
      setToastType('error');
    }
  };

  const handleReportDelay = async () => {
    if (!updatingProject) return;
    try {
      await saveProductionUpdate({
        projectId: updatingProject.id,
        previousEtd: updatingProject.milestones?.etd,
        newEtd: updateForm.newDate,
        isOnTime: false,
        delayReason: updateForm.delayReason as ProductionDelayReason,
        notes: updateForm.notes,
        isSupplierUpdate: true,
        updatedBy: 'Supplier'
      });
      setProjectsNeedingUpdate(prev => prev.filter(p => p.project.id !== updatingProject.id));
      setIsUpdateModalOpen(false);
      setUpdatingProject(null);
      setToastMessage('Delay reported successfully. Your PM has been notified.');
      setToastType('success');
    } catch (err: any) {
      console.error('Error reporting delay:', err);
      setToastMessage('Failed to report delay. Please try again.');
      setToastType('error');
    }
  };

  const handleSubmitQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRfqForQuote) return;

    if (!quoteForm.unitPrice) {
      setToastMessage('Please enter a unit price.');
      setToastType('error');
      return;
    }

    setSubmittingQuote(true);
    try {
      await submitRFQEntry(selectedRfqForQuote.id, {
        unitPrice: parseFloat(quoteForm.unitPrice),
        moq: quoteForm.moq ? parseInt(quoteForm.moq) : undefined,
        leadTimeWeeks: quoteForm.leadTimeWeeks ? parseInt(quoteForm.leadTimeWeeks) : undefined,
        toolingCost: quoteForm.toolingCost ? parseFloat(quoteForm.toolingCost) : undefined,
        currency: quoteForm.currency,
        supplierNotes: quoteForm.supplierNotes,
        quoteFileUrl: quoteForm.quoteFileUrl
      });

      // Reset form
      setQuoteForm({
        unitPrice: '',
        moq: '',
        leadTimeWeeks: '',
        toolingCost: '',
        currency: 'USD',
        supplierNotes: '',
        quoteFileUrl: ''
      });
      setIsQuoteModalOpen(false);
      setSelectedRfqForQuote(null);

      // Refresh RFQs list with loading state
      setRefreshingRfqs(true);
      try {
        const updatedRfqs = await getRFQsForSupplier(supplier!.id);
        setOpenRfqs(updatedRfqs);
        setToastMessage('Quote submitted successfully! Your quote is now visible to the PM.');
        setToastType('success');
      } catch (refreshErr: any) {
        console.error('Error refreshing RFQs after submission:', refreshErr);
        setToastMessage('Quote submitted, but failed to refresh list. Please refresh the page.');
        setToastType('error');
      } finally {
        setRefreshingRfqs(false);
      }
    } catch (err: any) {
      console.error('Error submitting quote:', err);
      setToastMessage('Failed to submit quote. Please try again.');
      setToastType('error');
    } finally {
      setSubmittingQuote(false);
    }
  };

  const copyAccessCode = (code: string | undefined) => {
    if (code) {
      navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    }
  };

  const isRequestSubmitted = (req: ComplianceRequest) => {
    return req.status !== ComplianceRequestStatus.PENDING_SUPPLIER;
  };

  const getStatusBadge = (status: ComplianceRequestStatus) => {
    const statusConfig: Record<ComplianceRequestStatus, { label: string; color: string; bgColor: string }> = {
      [ComplianceRequestStatus.PENDING_SUPPLIER]: { label: 'Pending', color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-300' },
      [ComplianceRequestStatus.SUBMITTED]: { label: 'Submitted', color: 'text-green-700', bgColor: 'bg-green-50 border-green-300' },
      [ComplianceRequestStatus.UNDER_REVIEW]: { label: 'Under Review', color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-300' },
      [ComplianceRequestStatus.APPROVED]: { label: 'Approved', color: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-300' },
      [ComplianceRequestStatus.REJECTED]: { label: 'Rejected', color: 'text-red-700', bgColor: 'bg-red-50 border-red-300' }
    };
    return statusConfig[status];
  };

  // Document upload handlers
  const handleDocumentSelect = async (docId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    // Validation
    const maxSize = 5 * 1024 * 1024; // 5MB
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'];

    if (file.size > maxSize) {
      setUploadErrors({ ...uploadErrors, [docId]: 'File size exceeds 5MB limit' });
      return;
    }

    if (!allowedTypes.includes(file.type)) {
      setUploadErrors({ ...uploadErrors, [docId]: 'Invalid file type. Allowed: PDF, DOC, DOCX, JPG, PNG' });
      return;
    }

    setSelectedFiles({ ...selectedFiles, [docId]: file });
    setUploadErrors({ ...uploadErrors, [docId]: '' });
  };

  const handleDocumentUpload = async (docId: string) => {
    const file = selectedFiles[docId];
    if (!file) return;

    setUploadingDocs({ ...uploadingDocs, [docId]: true });
    setUploadProgress({ ...uploadProgress, [docId]: 0 });

    try {
      // Simulate upload with progress (in real implementation, this would be actual file upload)
      const doc = missingDocs.find(d => d.id === docId);
      if (doc) {
        // Progress simulation
        for (let i = 0; i <= 100; i += 20) {
          await new Promise(resolve => setTimeout(resolve, 100));
          setUploadProgress(prev => ({ ...prev, [docId]: i }));
        }

        // Remove from missing docs
        setMissingDocs(prev => prev.filter(d => d.id !== docId));
        setToastMessage(`${file.name} uploaded successfully!`);
        setToastType('success');
        setSelectedFiles({ ...selectedFiles, [docId]: null });
      }
    } catch (err: any) {
      setUploadErrors({ ...uploadErrors, [docId]: 'Failed to upload. Please try again.' });
      setToastMessage('Upload failed. Please try again.');
      setToastType('error');
    } finally {
      setUploadingDocs({ ...uploadingDocs, [docId]: false });
      setUploadProgress({ ...uploadProgress, [docId]: 0 });
    }
  };

  // Proposal view handler
  const handleViewProposal = (proposal: SupplierProposal) => {
    setViewingProposal(proposal);
    setIsViewProposalOpen(true);
  };

  // Calculate dashboard summary stats
  const getDaysUntil = (date: string | undefined) => {
    if (!date) return null;
    const today = new Date();
    const targetDate = new Date(date);
    const diffTime = targetDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Search and filter matching helpers
  const matchesSearch = (text: string | undefined): boolean => {
    if (!debouncedSearchTerm) return true;
    return text?.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ?? false;
  };

  // Filtered data with search and filter toggles
  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      const matchesSearchTerm = matchesSearch(p.name) || matchesSearch(p.projectId);
      if (!matchesSearchTerm) return false;
      if (filterActionItemsOnly && p.status === 'archived') return false;
      return true;
    });
  }, [projects, debouncedSearchTerm, filterActionItemsOnly]);

  const filteredCompliance = useMemo(() => {
    return complianceReqs.filter(c => {
      const matchesSearchTerm = matchesSearch(c.requestId) || matchesSearch(c.projectName);
      if (!matchesSearchTerm) return false;
      if (filterActionItemsOnly && c.status !== ComplianceRequestStatus.PENDING_SUPPLIER) return false;
      return true;
    });
  }, [complianceReqs, debouncedSearchTerm, filterActionItemsOnly]);

  const filteredDocuments = useMemo(() => {
    return missingDocs.filter(d => {
      const matchesSearchTerm = matchesSearch(d.title) || matchesSearch(d.projectName);
      if (!matchesSearchTerm) return false;
      if (filterActionItemsOnly) return true; // All missing docs are action items
      return true;
    });
  }, [missingDocs, debouncedSearchTerm, filterActionItemsOnly]);

  const filteredRfqs = useMemo(() => {
    return openRfqs.filter(r => {
      const matchesSearchTerm = matchesSearch(r.rfqTitle) || matchesSearch(r.rfqIdentifier);
      if (!matchesSearchTerm) return false;
      if (filterActionItemsOnly && r.status !== 'pending') return false;
      return true;
    });
  }, [openRfqs, debouncedSearchTerm, filterActionItemsOnly]);

  const filteredProposals = useMemo(() => {
    return proposals.filter(p => {
      const matchesSearchTerm = matchesSearch(p.title) || matchesSearch(p.description);
      if (!matchesSearchTerm) return false;
      if (filterActionItemsOnly && p.status !== 'new') return false;
      return true;
    });
  }, [proposals, debouncedSearchTerm, filterActionItemsOnly]);

  const summaryStats = React.useMemo(() => {
    const activeProjects = filteredProjects.filter(p => p.status === 'in_progress').length;
    const pendingCompliance = filteredCompliance.filter(c => c.status === ComplianceRequestStatus.PENDING_SUPPLIER).length;
    const upcomingDeadlines = [
      ...filteredProjects.filter(p => {
        const days = getDaysUntil(p.milestones?.etd);
        return days !== null && days >= 0 && days <= 7;
      }),
      ...filteredCompliance.filter(c => {
        const days = getDaysUntil(c.deadline);
        return days !== null && days >= 0 && days <= 7;
      })
    ].length;
    const overdueCount = [
      ...filteredProjects.filter(p => {
        const days = getDaysUntil(p.milestones?.etd);
        return days !== null && days < 0;
      }),
      ...filteredCompliance.filter(c => {
        const days = getDaysUntil(c.deadline);
        return days !== null && days < 0;
      })
    ].length;
    const pendingActions = pendingCompliance + filteredDocuments.length + filteredRfqs.length;

    return {
      activeProjects,
      pendingActions,
      upcomingDeadlines: upcomingDeadlines + overdueCount,
      overdueCount,
      unreadNotifications: notifications.filter(n => !n.isRead).length
    };
  }, [filteredProjects, filteredCompliance, filteredDocuments, filteredRfqs, notifications]);

  // Dashboard insights for visualizations
  const dashboardInsights = React.useMemo(() => {
    const totalProjects = filteredProjects.length;
    const inProgressProjects = filteredProjects.filter(p => p.status === 'in_progress').length;
    const archivedProjects = filteredProjects.filter(p => p.status === 'archived').length;
    const cancelledProjects = filteredProjects.filter(p => p.status === 'cancelled').length;

    const totalDocs = missingDocs.length;
    const uploadedDocs = 0; // Tracked via removing from missingDocs
    const docProgress = totalDocs > 0 ? ((totalDocs - filteredDocuments.length) / totalDocs) * 100 : 0;

    const complianceWithDeadlines = filteredCompliance
      .filter(c => c.deadline)
      .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
      .slice(0, 5); // Top 5 upcoming

    return {
      projectDistribution: {
        inProgress: inProgressProjects,
        archived: archivedProjects,
        cancelled: cancelledProjects,
        total: totalProjects
      },
      docProgress: Math.min(docProgress, 100),
      complianceTimeline: complianceWithDeadlines
    };
  }, [filteredProjects, filteredDocuments, missingDocs, filteredCompliance]);

  // Filter out TCF (Test Completion Form) submission notifications
  const filteredNotifications = notifications.filter(n => !n.message.toLowerCase().includes('tcf') && !n.message.toLowerCase().includes('test completion form'));
  const unreadCount = filteredNotifications.filter(n => !n.isRead).length;

  if (loading) return <div className="min-h-screen bg-light flex items-center justify-center text-muted">Loading Dashboard...</div>;
  if (error) return (
    <div className="min-h-screen bg-light flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <div className="flex items-center gap-3 mb-4 text-red-600">
          <AlertCircle size={24} />
          <h2 className="text-xl font-bold">Portal Error</h2>
        </div>
        <p className="text-muted mb-6">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="w-full bg-primary text-white py-2 rounded-lg hover:bg-primary-dark transition"
        >
          Refresh Page
        </button>
      </div>
    </div>
  );
  if (!supplier) return <div className="min-h-screen bg-light flex items-center justify-center text-muted">Loading...</div>;

  // Access Code Entry Screen
  if (!isAccessVerified) {
    return (
      <div className="min-h-screen bg-light flex items-center justify-center px-4 py-6 sm:py-8">
        <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 max-w-md w-full">
          <div className="flex items-center justify-center w-12 h-12 bg-primary-light rounded-lg mb-6 mx-auto">
            <Key size={24} className="text-primary" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold mb-2 text-center break-words">{supplier.name} Portal</h1>
          <p className="text-xs sm:text-sm text-muted text-center mb-6">Enter your access code to continue</p>

          <form onSubmit={handleVerifyAccessCode} className="space-y-4">
            <div>
              <label className="block text-xs sm:text-sm font-medium text-dark mb-2">
                Access Code (6 digits)
              </label>
              <input
                type="text"
                value={enteredAccessCode}
                onChange={(e) => setEnteredAccessCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-center text-xl sm:text-2xl tracking-widest font-mono"
              />
              {accessCodeError && (
                <p className="text-red-600 text-xs sm:text-sm mt-2">{accessCodeError}</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-primary text-white py-2.5 sm:py-3 rounded-lg hover:bg-primary-dark transition font-medium text-sm sm:text-base"
            >
              Verify Access Code
            </button>
          </form>

          <p className="text-muted text-xs sm:text-sm text-center mt-6">
            Don't have your code? Contact your Project Manager.
          </p>
        </div>
      </div>
    );
  }

  // Dashboard Content (after access verification)
  return (
    <div className="min-h-screen bg-light">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center flex-shrink-0">
              <LayoutDashboard size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-lg sm:text-lg">{supplier.name}</h1>
              <p className="text-xs sm:text-sm text-muted">Supplier Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 justify-end">
            <button
              onClick={handleRefreshDashboard}
              disabled={refreshingDashboard}
              title="Refresh dashboard data"
              aria-label={refreshingDashboard ? "Refreshing dashboard data" : "Refresh dashboard data"}
              className="p-2 hover:bg-gray-100 rounded-lg transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg"
            >
              <RefreshCw size={20} className={`text-muted ${refreshingDashboard ? 'animate-spin' : ''}`} />
            </button>

            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                aria-haspopup="dialog"
                aria-expanded={showNotifications}
                className="relative p-2 hover:bg-gray-100 rounded-lg transition focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-lg"
              >
                <Bell size={20} className="text-muted" />
                {unreadCount > 0 && (
                  <span className="absolute top-0 right-0 w-5 h-5 bg-red-600 text-white text-xs rounded-full flex items-center justify-center" aria-hidden="true">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div
                  role="dialog"
                  aria-label="Notifications"
                  className="fixed sm:absolute right-0 sm:mt-2 top-0 sm:top-auto w-screen sm:w-80 bg-white rounded-none sm:rounded-lg shadow-lg z-50 sm:max-h-96"
                >
                  <div className="p-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white rounded-none sm:rounded-t-lg">
                    <h3 className="font-bold text-sm sm:text-base">Notifications</h3>
                    <button
                      onClick={() => setShowNotifications(false)}
                      aria-label="Close notifications"
                      className="p-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {filteredNotifications.length === 0 ? (
                      <p className="p-4 text-muted text-sm">No notifications</p>
                    ) : (
                      filteredNotifications.map(n => (
                        <div
                          key={n.id}
                          className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition ${!n.isRead ? 'bg-primary-light' : ''}`}
                          onClick={() => handleMarkRead(n.id)}
                        >
                          <p className={`text-sm ${!n.isRead ? 'font-bold text-dark' : 'text-muted'}`}>
                            {n.message}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => {
                setIsAccessVerified(false);
                setEnteredAccessCode('');
                setSessionStartTime(null);
              }}
              className="px-4 py-2 text-sm text-muted hover:bg-gray-100 rounded-lg transition"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Skip Link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg"
      >
        Skip to main content
      </a>

      {/* Main Content */}
      <main id="main-content" className="max-w-7xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
        {/* Error Banner */}
        {dashboardError && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-400 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-800 font-medium">{dashboardError}</p>
              <button
                onClick={() => window.location.reload()}
                className="text-red-600 hover:text-red-800 text-sm font-medium mt-2 underline"
              >
                Refresh Page
              </button>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="mb-8 bg-white rounded-lg shadow border-b border-gray-200">
          <div className="flex flex-wrap gap-0 sm:gap-1 p-1">
            <button
              onClick={() => setActiveTab('projects')}
              className={`flex-1 sm:flex-none px-4 py-3 font-medium text-sm rounded-lg transition ${
                activeTab === 'projects'
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <ShoppingBag size={16} className="inline mr-2" />
              Projects
            </button>
            <button
              onClick={() => setActiveTab('rfq')}
              className={`flex-1 sm:flex-none px-4 py-3 font-medium text-sm rounded-lg transition ${
                activeTab === 'rfq'
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <FileText size={16} className="inline mr-2" />
              RFQ ({openRfqs.length})
            </button>
            <button
              onClick={() => setActiveTab('tcf')}
              className={`flex-1 sm:flex-none px-4 py-3 font-medium text-sm rounded-lg transition ${
                activeTab === 'tcf'
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <ShieldCheck size={16} className="inline mr-2" />
              TCF Requests ({complianceReqs.length})
            </button>
            <button
              onClick={() => setActiveTab('proposals')}
              className={`flex-1 sm:flex-none px-4 py-3 font-medium text-sm rounded-lg transition ${
                activeTab === 'proposals'
                  ? 'bg-primary text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Package size={16} className="inline mr-2" />
              My Proposals ({proposals.length})
            </button>
          </div>
        </div>

        {/* Search and Filter Bar - shown for all tabs except proposals */}
        {activeTab !== 'proposals' && (
          <section aria-label="Search and filters">
            <div className="mb-8 bg-white rounded-lg shadow p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                {/* Search Input */}
                <div className="flex-1 relative">
                  <label htmlFor="dashboard-search" className="sr-only">
                    Search {activeTab}
                  </label>
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    id="dashboard-search"
                    type="text"
                    placeholder={activeTab === 'projects' ? 'Search projects...' : activeTab === 'rfq' ? 'Search RFQs...' : 'Search compliance requests...'}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    aria-label={`Search ${activeTab}`}
                    className="w-full pl-9 sm:pl-10 pr-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      aria-label="Clear search"
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>

                {/* Filter Toggles */}
                <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                  <button
                    onClick={() => setFilterActionItemsOnly(!filterActionItemsOnly)}
                    aria-pressed={filterActionItemsOnly}
                    className={`px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg font-medium text-xs sm:text-sm transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
                      filterActionItemsOnly
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Action Items Only
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab Content */}

        {/* PROJECTS TAB */}
        {activeTab === 'projects' && (
        <div className="mb-8">
          <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2">
            <ShoppingBag size={20} className="text-primary flex-shrink-0" />
            <span>Projects {filteredProjects.length !== projects.length && `(${filteredProjects.length}/${projects.length})`}</span>
          </h2>
          {filteredProjects.length === 0 ? (
            <p className="text-muted text-sm">{debouncedSearchTerm ? 'No projects match your search' : 'No projects assigned'}</p>
          ) : (
            <div className="space-y-3 sm:space-y-4">
              {filteredProjects.map(p => {
                const isExpanded = expandedProjects.has(p.id);
                const pendingDocs = filteredDocuments.filter(d => d.projectIdCode === p.projectId);
                const allDocsForProject = missingDocs.filter(d => d.projectIdCode === p.projectId);
                const allComplianceForProject = filteredCompliance.filter(c => c.projectId === p.id);
                const pendingCompliance = allComplianceForProject.filter(c => c.status === ComplianceRequestStatus.PENDING_SUPPLIER);
                const projectNeedsUpdate = projectsNeedingUpdate.find(pnu => pnu.project.id === p.id);

                const nextAction = pendingDocs.length > 0
                  ? `Upload ${pendingDocs.length} document${pendingDocs.length > 1 ? 's' : ''}`
                  : pendingCompliance.length > 0
                  ? `Complete ${pendingCompliance.length} compliance request${pendingCompliance.length > 1 ? 's' : ''}`
                  : 'No pending actions';

                return (
                  <div key={p.id} className="bg-white rounded-lg shadow border-l-4 border-primary overflow-hidden">
                    {/* Project Header - Always Visible */}
                    <button
                      onClick={() => toggleProjectExpanded(p.id)}
                      aria-expanded={isExpanded}
                      className="w-full text-left p-3 sm:p-4 hover:bg-gray-50 transition flex items-start justify-between gap-3 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                            <ChevronRight size={20} className="text-gray-400" />
                          </div>
                          <h3 className="font-bold text-base sm:text-lg break-words">{p.name}</h3>
                        </div>
                        <p className="text-xs sm:text-sm text-muted ml-6">ID: {p.projectId}</p>

                        {/* Quick Status Preview */}
                        <div className="mt-2 ml-6 flex flex-wrap items-center gap-2">
                          <StatusBadge status={p.status} type="project" />
                          <span className={`text-xs font-medium px-2 py-1 rounded ${
                            nextAction === 'No pending actions'
                              ? 'bg-green-50 text-green-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}>
                            {nextAction}
                          </span>
                        </div>
                      </div>
                    </button>

                    {/* Project Details - Expanded Content */}
                    {isExpanded && (
                      <div className="border-t border-gray-200 bg-gray-50">
                        <div className="p-3 sm:p-4 space-y-4">
                          {/* Project Details */}
                          <div className="bg-white rounded-lg p-3 border border-gray-200">
                            <h4 className="font-bold text-sm mb-3">Project Details</h4>
                            {p.milestones && (
                              <div className="text-xs sm:text-sm space-y-2 text-gray-600">
                                {p.milestones.poPlacement && <p>🗓️ PO: {new Date(p.milestones.poPlacement).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                                {p.milestones.massProduction && <p>🏭 Mass Prod: {new Date(p.milestones.massProduction).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                                {p.milestones.etd && (
                                  <p className={getDaysUntil(p.milestones.etd)! < 0 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                                    📦 ETD: {new Date(p.milestones.etd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ({getDaysUntil(p.milestones.etd)} days)
                                  </p>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Production Update Alert */}
                          {projectNeedsUpdate && (
                            <div className="bg-yellow-50 rounded-lg border-l-4 border-yellow-400 p-3">
                              <p className="font-bold text-sm text-yellow-900 mb-2">⚠️ Production Status Update Needed</p>
                              <p className="text-xs text-yellow-800 mb-2">
                                ETD: {new Date(projectNeedsUpdate.project.milestones?.etd || '').toLocaleDateString()} ({projectNeedsUpdate.daysUntilEtd} days)
                              </p>
                              <div className="flex flex-col xs:flex-row gap-2">
                                <button
                                  onClick={() => handleConfirmEtd(projectNeedsUpdate.project, projectNeedsUpdate.project.milestones?.etd || '')}
                                  className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                                >
                                  Confirm On Time
                                </button>
                                <button
                                  onClick={() => {
                                    setUpdatingProject(projectNeedsUpdate.project);
                                    setIsUpdateModalOpen(true);
                                  }}
                                  className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700"
                                >
                                  Report Delay
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Documents for this Project */}
                          {allDocsForProject.length > 0 && (
                            <div>
                              <h4 className="font-bold text-sm mb-2">Documents Needed ({allDocsForProject.length})</h4>
                              <div className="space-y-2">
                                {allDocsForProject.map(d => {
                                  const isUploading = uploadingDocs[d.id];
                                  const hasFile = selectedFiles[d.id];
                                  const progress = uploadProgress[d.id] || 0;
                                  const error = uploadErrors[d.id];

                                  return (
                                    <div key={d.id} className="bg-white rounded-lg p-3 border border-yellow-200 hover:shadow-sm transition">
                                      <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="flex-1 min-w-0">
                                          <p className="font-medium text-sm break-words">{d.title}</p>
                                          {d.deadline && (
                                            <p className={`text-xs mt-1 ${getDaysUntil(d.deadline)! < 0 ? 'text-red-600 font-medium' : 'text-orange-600'}`}>
                                              📅 Due: {new Date(d.deadline).toLocaleDateString()} ({getDaysUntil(d.deadline)} days)
                                            </p>
                                          )}
                                        </div>
                                      </div>

                                      {/* Inline Upload */}
                                      {!hasFile ? (
                                        <label className="flex items-center justify-center px-3 py-2 border-2 border-dashed border-yellow-300 rounded bg-yellow-50 hover:bg-yellow-100 cursor-pointer transition text-xs font-medium text-yellow-700">
                                          <input
                                            type="file"
                                            onChange={(e) => handleDocumentSelect(d.id, e.target.files)}
                                            className="hidden"
                                            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                                            disabled={isUploading}
                                          />
                                          📎 Select
                                        </label>
                                      ) : (
                                        <>
                                          <div className="bg-blue-50 p-2 rounded text-xs mb-2">
                                            <p className="font-medium text-blue-700 break-words">✓ {selectedFiles[d.id]?.name}</p>
                                          </div>
                                          {isUploading && (
                                            <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                                              <div
                                                className="bg-green-600 h-1.5 rounded-full transition-all"
                                                style={{ width: `${progress}%` }}
                                              />
                                            </div>
                                          )}
                                          <div className="flex gap-2">
                                            <button
                                              onClick={() => handleDocumentUpload(d.id)}
                                              disabled={isUploading}
                                              className="flex-1 px-2 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                                            >
                                              {isUploading ? `${progress}%` : '📤 Upload'}
                                            </button>
                                            {!isUploading && (
                                              <button
                                                onClick={() => {
                                                  setSelectedFiles({ ...selectedFiles, [d.id]: null });
                                                  setUploadErrors({ ...uploadErrors, [d.id]: '' });
                                                }}
                                                className="px-2 py-1 bg-gray-300 text-gray-700 rounded text-xs font-medium hover:bg-gray-400"
                                              >
                                                Clear
                                              </button>
                                            )}
                                          </div>
                                        </>
                                      )}
                                      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Compliance Requests for this Project */}
                          {allComplianceForProject.length > 0 && (
                            <div>
                              <h4 className="font-bold text-sm mb-2">Compliance Requests ({allComplianceForProject.length})</h4>
                              <div className="space-y-2">
                                {allComplianceForProject.map(c => {
                                  const submitted = isRequestSubmitted(c);
                                  const statusBadge = getStatusBadge(c.status);
                                  return (
                                    <div
                                      key={c.id}
                                      onClick={() => !submitted && navigate(`/compliance/supplier/${c.token}`)}
                                      className={`bg-white rounded-lg p-3 border-l-4 cursor-pointer transition ${
                                        submitted
                                          ? 'border-gray-300 opacity-75'
                                          : 'border-primary hover:shadow-sm'
                                      }`}
                                    >
                                      <div className="flex items-start justify-between gap-2 mb-2">
                                        <p className="font-medium text-sm">{c.requestId}</p>
                                        <span className={`text-xs font-semibold px-2 py-1 rounded-full border whitespace-nowrap ${statusBadge.color} ${statusBadge.bgColor}`}>
                                          {statusBadge.label}
                                        </span>
                                      </div>
                                      {!submitted && c.accessCode && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            copyAccessCode(c.accessCode);
                                          }}
                                          className="w-full text-xs py-2 px-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded text-blue-700 font-medium transition"
                                        >
                                          {copiedCode === c.accessCode ? '✓ Copied!' : '📋 Copy Code'}
                                        </button>
                                      )}
                                      {submitted && (
                                        <p className="text-xs text-gray-600">Submitted {c.submittedAt && new Date(c.submittedAt).toLocaleDateString()}</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* RFQs for this Project */}
                          {filteredRfqs.length > 0 && (
                            <div>
                              <h4 className="font-bold text-sm mb-2">RFQs ({filteredRfqs.length})</h4>
                              <div className="space-y-2">
                                {filteredRfqs.map(rfq => (
                                  <div key={rfq.id} className="bg-white rounded-lg p-3 border border-gray-200">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                      <p className="font-medium text-sm break-words">{rfq.rfqTitle}</p>
                                      <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                                        rfq.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                                        rfq.status === 'submitted' ? 'bg-green-100 text-green-800' :
                                        'bg-gray-100 text-gray-800'
                                      }`}>
                                        {rfq.status === 'pending' ? 'Pending Quote' : rfq.status}
                                      </span>
                                    </div>
                                    {rfq.status === 'pending' && (
                                      <button
                                        onClick={() => {
                                          setSelectedRfqForQuote(rfq);
                                          setIsQuoteModalOpen(true);
                                        }}
                                        className="w-full px-3 py-1.5 bg-primary text-white rounded text-xs font-medium hover:bg-primary-dark transition"
                                      >
                                        Submit Quote
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* RFQ TAB */}
        {activeTab === 'rfq' && (
        <div className="mb-8">
          <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2">
            <FileText size={20} className="text-primary flex-shrink-0" />
            <span>RFQ Requests {filteredRfqs.length !== openRfqs.length && `(${filteredRfqs.length}/${openRfqs.length})`}</span>
          </h2>
          {filteredRfqs.length === 0 ? (
            <p className="text-muted text-sm">{debouncedSearchTerm ? 'No RFQs match your search' : 'No RFQ requests available'}</p>
          ) : (
            <div className="space-y-3">
              {filteredRfqs.map(rfq => (
                <div key={rfq.id} className="bg-white rounded-lg shadow border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-base break-words">{rfq.rfqTitle}</h3>
                      <p className="text-xs sm:text-sm text-muted mt-1">{rfq.rfqIdentifier}</p>
                    </div>
                    <span className={`text-xs px-3 py-1 rounded whitespace-nowrap flex-shrink-0 font-semibold ${
                      rfq.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                      rfq.status === 'submitted' ? 'bg-green-100 text-green-800' :
                      rfq.status === 'closed' ? 'bg-gray-100 text-gray-800' :
                      'bg-blue-100 text-blue-800'
                    }`}>
                      {rfq.status === 'pending' ? 'Pending Quote' : rfq.status}
                    </span>
                  </div>
                  {rfq.status === 'pending' && (
                    <button
                      onClick={() => {
                        setSelectedRfqForQuote(rfq);
                        setIsQuoteModalOpen(true);
                      }}
                      className="w-full px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition"
                    >
                      Submit Quote
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* TCF REQUESTS TAB (Compliance) */}
        {activeTab === 'tcf' && (
        <div className="mb-8">
          <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2">
            <ShieldCheck size={20} className="text-primary flex-shrink-0" />
            <span>TCF Requests {filteredCompliance.length !== complianceReqs.length && `(${filteredCompliance.length}/${complianceReqs.length})`}</span>
          </h2>
          {filteredCompliance.length === 0 ? (
            <p className="text-muted text-sm">{debouncedSearchTerm ? 'No TCF requests match your search' : 'No TCF requests available'}</p>
          ) : (
            <div className="space-y-3">
              {filteredCompliance.map(compliance => {
                const submitted = isRequestSubmitted(compliance);
                const statusBadge = getStatusBadge(compliance.status);
                const daysLeft = getDaysUntil(compliance.deadline);

                return (
                  <div
                    key={compliance.id}
                    className={`bg-white rounded-lg shadow border-l-4 p-4 cursor-pointer transition ${
                      submitted
                        ? 'border-gray-300 opacity-75'
                        : 'border-primary hover:shadow-md'
                    }`}
                    onClick={() => !submitted && navigate(`/compliance/supplier/${compliance.token}`)}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-base break-words">{compliance.requestId}</h3>
                        <p className="text-xs sm:text-sm text-muted mt-1">{compliance.projectName}</p>
                      </div>
                      <span className={`text-xs font-semibold px-3 py-1 rounded-full border whitespace-nowrap flex-shrink-0 ${statusBadge.color} ${statusBadge.bgColor}`}>
                        {statusBadge.label}
                      </span>
                    </div>
                    {compliance.deadline && (
                      <p className={`text-xs mt-2 ${daysLeft! < 0 ? 'text-red-600 font-medium' : 'text-orange-600'}`}>
                        📅 Due: {new Date(compliance.deadline).toLocaleDateString()} ({daysLeft} days)
                      </p>
                    )}
                    {!submitted && compliance.accessCode && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyAccessCode(compliance.accessCode);
                        }}
                        className="w-full text-xs py-2 px-3 mt-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded text-blue-700 font-medium transition"
                      >
                        {copiedCode === compliance.accessCode ? '✓ Copied!' : '📋 Copy Access Code'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {/* PROPOSALS TAB */}
        {activeTab === 'proposals' && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <Package size={20} className="text-primary flex-shrink-0" />
              <span>My Proposals {filteredProposals.length !== proposals.length && `(${filteredProposals.length}/${proposals.length})`}</span>
            </h2>
            <button
              onClick={() => setIsProposalModalOpen(true)}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition flex items-center gap-2"
            >
              <Plus size={16} />
              New Proposal
            </button>
          </div>
          {filteredProposals.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <p className="text-muted text-sm mb-4">{debouncedSearchTerm ? 'No proposals match your search' : 'You haven\'t submitted any proposals yet'}</p>
              <button
                onClick={() => setIsProposalModalOpen(true)}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-dark transition inline-flex items-center gap-2"
              >
                <Plus size={16} />
                Submit Your First Proposal
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProposals.map(proposal => (
                <button
                  key={proposal.id}
                  onClick={() => handleViewProposal(proposal)}
                  className="bg-white rounded-lg shadow border border-gray-200 p-4 hover:shadow-md hover:border-primary transition text-left cursor-pointer"
                  aria-label={`View proposal: ${proposal.title}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-bold text-sm break-words flex-1">{proposal.title}</h3>
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0 ${
                      proposal.status === 'new' ? 'bg-blue-100 text-blue-700' :
                      proposal.status === 'viewed' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {proposal.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted line-clamp-2 mb-2">{proposal.description}</p>
                  <p className="text-xs text-gray-500">Submitted {new Date(proposal.createdAt).toLocaleDateString()}</p>
                </button>
              ))}
            </div>
          )}
        </div>
        )}

      </main>

      {/* View Proposal Modal */}
      {isViewProposalOpen && viewingProposal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-bold break-words">{viewingProposal.title}</h2>
                <p className="text-xs sm:text-sm text-muted mt-1">Submitted {new Date(viewingProposal.createdAt).toLocaleDateString()}</p>
              </div>
              <button
                onClick={() => setIsViewProposalOpen(false)}
                aria-label="Close dialog"
                className="text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              {viewingProposal.description && (
                <div>
                  <h3 className="font-bold text-sm mb-2">Description</h3>
                  <p className="text-sm text-gray-600">{viewingProposal.description}</p>
                </div>
              )}

              {viewingProposal.fileUrl && (
                <div>
                  <h3 className="font-bold text-sm mb-2">Document</h3>
                  <a
                    href={viewingProposal.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
                  >
                    View Proposal Document
                  </a>
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  viewingProposal.status === 'new' ? 'bg-blue-100 text-blue-700' :
                  viewingProposal.status === 'viewed' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {viewingProposal.status}
                </span>
              </div>
            </div>

            <div className="flex gap-2 pt-4 mt-4 border-t border-gray-200">
              <button
                onClick={() => setIsViewProposalOpen(false)}
                className="flex-1 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Update Modal */}
      {isUpdateModalOpen && updatingProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-4 sm:p-6">
            <h2 className="text-lg sm:text-xl font-bold mb-4">Report Delay</h2>
            <form onSubmit={(e) => { e.preventDefault(); handleReportDelay(); }} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm font-medium mb-2">New ETD</label>
                <input
                  type="date"
                  value={updateForm.newDate}
                  onChange={(e) => setUpdateForm({ ...updateForm, newDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-medium mb-2">Reason for Delay</label>
                <select
                  value={updateForm.delayReason}
                  onChange={(e) => setUpdateForm({ ...updateForm, delayReason: e.target.value as ProductionDelayReason })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">Select a reason...</option>
                  <option value="material_shortage">Material Shortage</option>
                  <option value="equipment_failure">Equipment Failure</option>
                  <option value="labor_shortage">Labor Shortage</option>
                  <option value="quality_issue">Quality Issue</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs sm:text-sm font-medium mb-2">Additional Notes</label>
                <textarea
                  value={updateForm.notes}
                  onChange={(e) => setUpdateForm({ ...updateForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsUpdateModalOpen(false)}
                  className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark"
                >
                  Report Delay
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quote Submission Modal */}
      {isQuoteModalOpen && selectedRfqForQuote && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-4 sm:p-6 max-h-screen overflow-y-auto">
            <div className="flex items-start justify-between gap-2 mb-6">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-bold break-words">{selectedRfqForQuote.rfqTitle}</h2>
                <p className="text-xs sm:text-sm text-muted mt-1">{selectedRfqForQuote.rfqIdentifier}</p>
              </div>
              <button
                onClick={() => {
                  setIsQuoteModalOpen(false);
                  setSelectedRfqForQuote(null);
                  setQuoteForm({
                    unitPrice: '',
                    moq: '',
                    leadTimeWeeks: '',
                    toolingCost: '',
                    currency: 'USD',
                    supplierNotes: '',
                    quoteFileUrl: ''
                  });
                }}
                className="text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmitQuote} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs sm:text-sm font-medium mb-2">
                    Unit Price <span className="text-red-600">*</span>
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={quoteForm.currency}
                      onChange={(e) => setQuoteForm({ ...quoteForm, currency: e.target.value })}
                      className="px-2 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="CNY">CNY</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      value={quoteForm.unitPrice}
                      onChange={(e) => setQuoteForm({ ...quoteForm, unitPrice: e.target.value })}
                      placeholder="0.00"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">MOQ</label>
                  <input
                    type="number"
                    value={quoteForm.moq}
                    onChange={(e) => setQuoteForm({ ...quoteForm, moq: e.target.value })}
                    placeholder="Minimum order qty"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Lead Time (weeks)</label>
                  <input
                    type="number"
                    value={quoteForm.leadTimeWeeks}
                    onChange={(e) => setQuoteForm({ ...quoteForm, leadTimeWeeks: e.target.value })}
                    placeholder="e.g., 4"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Tooling Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={quoteForm.toolingCost}
                    onChange={(e) => setQuoteForm({ ...quoteForm, toolingCost: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Notes</label>
                <textarea
                  value={quoteForm.supplierNotes}
                  onChange={(e) => setQuoteForm({ ...quoteForm, supplierNotes: e.target.value })}
                  placeholder="Add any additional notes about your quote..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Quote Document URL</label>
                <input
                  type="url"
                  value={quoteForm.quoteFileUrl}
                  onChange={(e) => setQuoteForm({ ...quoteForm, quoteFileUrl: e.target.value })}
                  placeholder="https://example.com/quote.pdf"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsQuoteModalOpen(false);
                    setSelectedRfqForQuote(null);
                  }}
                  className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingQuote}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 font-medium flex items-center justify-center gap-2"
                >
                  {submittingQuote ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      Submit Quote
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submit Proposal Modal */}
      <SubmitProposalModal
        isOpen={isProposalModalOpen}
        onClose={() => setIsProposalModalOpen(false)}
        supplierId={supplier?.id || ''}
        onSuccess={() => {
          // Reload proposals after successful submission with error handling
          if (supplier?.id) {
            getSupplierProposals(supplier.id)
              .then(setProposals)
              .catch(err => {
                console.error('Error reloading proposals:', err);
                setToastMessage('Proposal submitted, but failed to refresh list. Please refresh the page.');
                setToastType('error');
              });
          }
        }}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white font-medium max-w-sm z-50 ${
          toastType === 'success' ? 'bg-green-600' :
          toastType === 'error' ? 'bg-red-600' :
          'bg-blue-600'
        }`}>
          <div className="flex items-start justify-between gap-4">
            <span>{toastMessage}</span>
            <button
              onClick={() => setToastMessage('')}
              className="text-white hover:opacity-80 text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierDashboard;
