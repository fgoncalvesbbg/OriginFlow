
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
import { ShieldCheck, LayoutDashboard, Bell, X, AlertCircle, FileText, ShoppingBag, Factory, Key, Upload, Plus, Download, RefreshCw, Copy, Check, CheckCircle } from 'lucide-react';

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

  // Contact PM State
  const [isContactPmOpen, setIsContactPmOpen] = useState(false);
  const [contactPmProject, setContactPmProject] = useState<Project | null>(null);
  const [contactForm, setContactForm] = useState({
    subject: '',
    message: ''
  });

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
        if (isContactPmOpen) {
          setIsContactPmOpen(false);
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
  }, [isContactPmOpen, isQuoteModalOpen, isUpdateModalOpen, isProposalModalOpen, showNotifications]);

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

  // Contact PM handlers
  const handleOpenContactPm = (project: Project) => {
    setContactPmProject(project);
    setContactForm({ subject: '', message: '' });
    setIsContactPmOpen(true);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!contactForm.message.trim()) {
      setToastMessage('Please enter a message');
      setToastType('error');
      return;
    }

    try {
      // In a real implementation, this would call an API to create a notification
      // For now, just show success
      setToastMessage(`Message sent to Project Manager about ${contactPmProject?.name}`);
      setToastType('success');
      setIsContactPmOpen(false);
      setContactForm({ subject: '', message: '' });
    } catch (err: any) {
      setToastMessage('Failed to send message');
      setToastType('error');
    }
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

  const unreadCount = notifications.filter(n => !n.isRead).length;

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
                    {notifications.length === 0 ? (
                      <p className="p-4 text-muted text-sm">No notifications</p>
                    ) : (
                      notifications.map(n => (
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

        {/* Dashboard Summary Stats */}
        <div className="mb-8 grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
          {/* Active Projects */}
          <div className="bg-white rounded-lg shadow p-3 sm:p-4 border-l-4 border-blue-400 hover:shadow-md transition">
            <p className="text-xs sm:text-sm text-muted font-medium uppercase tracking-wide">Active Projects</p>
            <p className="text-2xl sm:text-3xl font-bold text-primary mt-2">{summaryStats.activeProjects}</p>
          </div>

          {/* Pending Actions */}
          <div className={`bg-white rounded-lg shadow p-3 sm:p-4 border-l-4 transition hover:shadow-md ${summaryStats.pendingActions > 0 ? 'border-amber-400' : 'border-gray-400'}`}>
            <p className="text-xs sm:text-sm text-muted font-medium uppercase tracking-wide">Pending Actions</p>
            <p className={`text-2xl sm:text-3xl font-bold mt-2 ${summaryStats.pendingActions > 0 ? 'text-amber-600' : 'text-gray-600'}`}>
              {summaryStats.pendingActions}
            </p>
          </div>

          {/* Upcoming Deadlines */}
          <div className={`bg-white rounded-lg shadow p-3 sm:p-4 border-l-4 transition hover:shadow-md ${summaryStats.upcomingDeadlines > 0 ? 'border-orange-400' : 'border-gray-400'}`}>
            <p className="text-xs sm:text-sm text-muted font-medium uppercase tracking-wide">Deadlines (7d)</p>
            <p className={`text-2xl sm:text-3xl font-bold mt-2 ${summaryStats.upcomingDeadlines > 0 ? 'text-orange-600' : 'text-gray-600'}`}>
              {summaryStats.upcomingDeadlines}
            </p>
          </div>

          {/* Overdue Items */}
          {summaryStats.overdueCount > 0 && (
            <div className="bg-white rounded-lg shadow p-3 sm:p-4 border-l-4 border-red-400 hover:shadow-md transition md:col-span-1">
              <p className="text-xs sm:text-sm text-muted font-medium uppercase tracking-wide">Overdue</p>
              <p className="text-2xl sm:text-3xl font-bold text-red-600 mt-2 animate-pulse">{summaryStats.overdueCount}</p>
            </div>
          )}

          {/* Unread Notifications */}
          {summaryStats.unreadNotifications > 0 && (
            <div className="bg-white rounded-lg shadow p-3 sm:p-4 border-l-4 border-indigo-400 hover:shadow-md transition md:col-span-1">
              <p className="text-xs sm:text-sm text-muted font-medium uppercase tracking-wide">Unread</p>
              <p className="text-2xl sm:text-3xl font-bold text-indigo-600 mt-2">{summaryStats.unreadNotifications}</p>
            </div>
          )}
        </div>

        {/* Dashboard Insights / Visualizations */}
        <div className="mb-8 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Project Status Distribution */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h3 className="text-sm sm:text-base font-bold mb-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-indigo-600 rounded-full" />
              Project Status
            </h3>
            {dashboardInsights.projectDistribution.total === 0 ? (
              <p className="text-xs sm:text-sm text-muted text-center py-4">No projects to visualize</p>
            ) : (
              <div className="space-y-3">
                {dashboardInsights.projectDistribution.inProgress > 0 && (
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs font-medium text-gray-600">In Progress</span>
                      <span className="text-xs font-bold text-gray-700">
                        {dashboardInsights.projectDistribution.inProgress}/{dashboardInsights.projectDistribution.total}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{ width: `${(dashboardInsights.projectDistribution.inProgress / dashboardInsights.projectDistribution.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {dashboardInsights.projectDistribution.archived > 0 && (
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs font-medium text-gray-600">Archived</span>
                      <span className="text-xs font-bold text-gray-700">
                        {dashboardInsights.projectDistribution.archived}/{dashboardInsights.projectDistribution.total}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-gray-600 h-2 rounded-full"
                        style={{ width: `${(dashboardInsights.projectDistribution.archived / dashboardInsights.projectDistribution.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {dashboardInsights.projectDistribution.cancelled > 0 && (
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-xs font-medium text-gray-600">Cancelled</span>
                      <span className="text-xs font-bold text-gray-700">
                        {dashboardInsights.projectDistribution.cancelled}/{dashboardInsights.projectDistribution.total}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-red-600 h-2 rounded-full"
                        style={{ width: `${(dashboardInsights.projectDistribution.cancelled / dashboardInsights.projectDistribution.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Document Upload Progress */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6 flex flex-col items-center justify-center">
            <h3 className="text-sm sm:text-base font-bold mb-4 w-full">Document Progress</h3>
            {missingDocs.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-2xl sm:text-3xl font-bold text-green-600">✓</p>
                <p className="text-xs sm:text-sm text-muted mt-2">All documents uploaded</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <svg className="w-20 h-20" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="8"
                    strokeDasharray={`${(dashboardInsights.docProgress / 100) * 283} 283`}
                    strokeLinecap="round"
                    transform="rotate(-90 50 50)"
                    className="transition-all duration-500"
                  />
                  <text x="50" y="55" textAnchor="middle" fontSize="20" fontWeight="bold" className="fill-gray-800">
                    {Math.round(dashboardInsights.docProgress)}%
                  </text>
                </svg>
                <p className="text-xs sm:text-sm text-muted">
                  {filteredDocuments.length} of {missingDocs.length} pending
                </p>
              </div>
            )}
          </div>

          {/* Compliance Timeline */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h3 className="text-sm sm:text-base font-bold mb-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-indigo-600 rounded-full" />
              Deadlines (Next 5)
            </h3>
            {dashboardInsights.complianceTimeline.length === 0 ? (
              <p className="text-xs sm:text-sm text-muted text-center py-4">No upcoming deadlines</p>
            ) : (
              <div className="space-y-2">
                {dashboardInsights.complianceTimeline.map((compliance) => {
                  const daysLeft = getDaysUntil(compliance.deadline);
                  const isOverdue = daysLeft! < 0;
                  const isUrgent = daysLeft! <= 3 && daysLeft! >= 0;

                  return (
                    <div key={compliance.id} className="flex items-center gap-2 text-xs">
                      <span
                        className={`px-2 py-1 rounded font-mono font-bold whitespace-nowrap ${
                          isOverdue
                            ? 'bg-red-100 text-red-700'
                            : isUrgent
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {isOverdue ? 'OVERDUE' : daysLeft! === 0 ? 'TODAY' : `${daysLeft}d`}
                      </span>
                      <span className="flex-1 text-gray-600 truncate">{compliance.requestId}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Search and Filter Bar */}
        <section aria-label="Search and filters">
          <div className="mb-8 bg-white rounded-lg shadow p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              {/* Search Input */}
              <div className="flex-1 relative">
                <label htmlFor="dashboard-search" className="sr-only">
                  Search dashboard
                </label>
                <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none">
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  id="dashboard-search"
                  type="text"
                  placeholder="Search projects, compliance, documents..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search dashboard"
                  aria-describedby="search-results"
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

            {/* Results Counter */}
            {debouncedSearchTerm && (
              <div id="search-results" className="mt-3 text-xs sm:text-sm text-muted" role="status" aria-live="polite">
                Found: {filteredProjects.length} projects, {filteredCompliance.length} compliance, {filteredDocuments.length} documents, {filteredRfqs.length} RFQs, {filteredProposals.length} proposals
              </div>
            )}
          </div>
        </section>

        {/* Projects Section */}
        <div className="mb-8">
          <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2">
            <ShoppingBag size={20} className="text-primary flex-shrink-0" />
            <span>Projects {filteredProjects.length !== projects.length && `(${filteredProjects.length}/${projects.length})`}</span>
          </h2>
          {filteredProjects.length === 0 ? (
            <p className="text-muted text-sm">{debouncedSearchTerm ? 'No projects match your search' : 'No projects assigned'}</p>
          ) : (
            <div className="grid gap-3 sm:gap-4">
              {filteredProjects.map(p => {
                const pendingDocs = filteredDocuments.filter(d => d.projectIdCode === p.projectId);
                const pendingCompliance = filteredCompliance.filter(c => c.projectId === p.id && c.status === ComplianceRequestStatus.PENDING_SUPPLIER);
                const nextAction = pendingDocs.length > 0
                  ? `Upload ${pendingDocs.length} document${pendingDocs.length > 1 ? 's' : ''}`
                  : pendingCompliance.length > 0
                  ? `Complete ${pendingCompliance.length} compliance request${pendingCompliance.length > 1 ? 's' : ''}`
                  : 'No pending actions';

                return (
                  <div key={p.id} className="bg-white rounded-lg shadow p-3 sm:p-4 border-l-4 border-primary hover:shadow-md transition">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-base sm:text-lg break-words">{p.name}</h3>
                        <p className="text-xs sm:text-sm text-muted">ID: {p.projectId}</p>

                        {/* Key Milestones */}
                        {p.milestones && (
                          <div className="mt-2 text-xs sm:text-sm space-y-1 text-gray-600">
                            {p.milestones.poDate && <p>🗓️ PO: {new Date(p.milestones.poDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                            {p.milestones.massProduction && <p>🏭 Mass Prod: {new Date(p.milestones.massProduction).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                            {p.milestones.etd && (
                              <p className={getDaysUntil(p.milestones.etd)! < 0 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                                📦 ETD: {new Date(p.milestones.etd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ({getDaysUntil(p.milestones.etd)} days)
                              </p>
                            )}
                          </div>
                        )}

                        {/* Next Action */}
                        <div className={`mt-2 px-3 py-1 rounded-lg text-xs sm:text-sm font-medium ${
                          nextAction === 'No pending actions'
                            ? 'bg-green-50 text-green-700 border border-green-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          🎯 {nextAction}
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                          <StatusBadge status={p.status} />
                        </div>
                      </div>

                      {/* Contact PM Button */}
                      <button
                        onClick={() => handleOpenContactPm(p)}
                        aria-label={`Contact Project Manager about ${p.name}`}
                        className="px-3 sm:px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 text-xs sm:text-sm font-medium transition whitespace-nowrap w-full sm:w-auto"
                      >
                        💬 <span className="hidden sm:inline">Contact PM</span>
                        <span className="sm:hidden">Message</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Manufacturing Checks */}
        {projectsNeedingUpdate.length > 0 && (
          <div className="mb-8 bg-yellow-50 border-l-4 border-yellow-400 rounded-lg p-3 sm:p-6">
            <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2 text-yellow-900">
              <Factory size={20} className="flex-shrink-0" />
              <span>Production Status Updates Needed</span>
            </h2>
            <div className="space-y-3 sm:space-y-4">
              {projectsNeedingUpdate.map(({ project, daysUntilEtd }) => (
                <div key={project.id} className="bg-white rounded-lg p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-0">
                    <div className="min-w-0">
                      <h3 className="font-bold text-sm sm:text-base break-words">{project.name}</h3>
                      <p className="text-xs sm:text-sm text-muted">
                        ETD: {new Date(project.milestones?.etd || '').toLocaleDateString()} ({daysUntilEtd} days)
                      </p>
                    </div>
                    <div className="flex flex-col xs:flex-row gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => handleConfirmEtd(project, project.milestones?.etd || '')}
                        className="px-3 sm:px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs sm:text-sm transition"
                      >
                        Confirm On Time
                      </button>
                      <button
                        onClick={() => {
                          setUpdatingProject(project);
                          setIsUpdateModalOpen(true);
                        }}
                        className="px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-xs sm:text-sm transition"
                      >
                        Report Delay
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Compliance Section */}
        <div className="mb-8">
          <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2">
            <ShieldCheck size={20} className="text-primary flex-shrink-0" />
            <span>Compliance Requests {filteredCompliance.length !== complianceReqs.length && `(${filteredCompliance.length}/${complianceReqs.length})`}</span>
          </h2>
          {filteredCompliance.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 sm:p-8 text-center text-muted">
              <p className="text-sm sm:text-base">{debouncedSearchTerm ? 'No compliance requests match your search' : 'No compliance requests at this time'}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:gap-4">
              {filteredCompliance.map(c => {
                const submitted = isRequestSubmitted(c);
                const statusBadge = getStatusBadge(c.status);
                return (
                  <div
                    key={c.id}
                    onClick={() => !submitted && navigate(`/compliance/supplier/${c.token}`)}
                    className={`bg-white rounded-lg shadow p-3 sm:p-6 transition-all border-l-4 ${
                      submitted
                        ? 'border-gray-400 opacity-85'
                        : 'border-primary cursor-pointer hover:shadow-md'
                    }`}
                  >
                    {/* Request ID and Status Badge */}
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 mb-3">
                      <h3 className="font-bold text-base sm:text-lg break-words">{c.requestId}</h3>
                      <span className={`whitespace-nowrap text-xs font-semibold px-3 py-1 rounded-full border ${statusBadge.color} ${statusBadge.bgColor}`}>
                        {statusBadge.label}
                      </span>
                    </div>

                    {/* Project Name */}
                    <p className="text-sm text-muted mb-3">{c.projectName}</p>

                    {/* Access Code or Submission Info */}
                    {!submitted && c.accessCode && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyAccessCode(c.accessCode);
                        }}
                        className="w-full bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 rounded-lg px-4 py-3 border-2 border-blue-300 transition-all duration-200 cursor-pointer group mb-3"
                        title="Click to copy access code"
                      >
                        <p className="text-xs text-blue-600 font-semibold mb-2 uppercase tracking-wider text-left">
                          Access Code (Click to Copy)
                        </p>
                        <div className="flex items-center justify-between">
                          <code className="text-xl font-bold text-blue-700 tracking-widest font-mono">
                            {c.accessCode}
                          </code>
                          <div className="transition-all duration-200">
                            {copiedCode === c.accessCode ? (
                              <div className="flex flex-col items-center gap-1">
                                <Check className="w-5 h-5 text-green-600 animate-pulse" />
                                <span className="text-xs text-green-600 font-medium">Copied!</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-1 opacity-60 group-hover:opacity-100">
                                <Copy className="w-5 h-5 text-blue-600" />
                                <span className="text-xs text-blue-600 font-medium">Copy</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    )}

                    {/* Submission Info (for submitted requests) */}
                    {submitted && (
                      <div className="bg-gray-50 rounded-lg px-4 py-3 border-2 border-gray-300 mb-3">
                        <p className="text-xs text-gray-600 font-semibold mb-1 uppercase tracking-wider">
                          Status: {statusBadge.label}
                        </p>
                        {c.submittedAt && (
                          <p className="text-sm text-gray-700 font-medium">
                            Submitted: {new Date(c.submittedAt).toLocaleDateString()}
                          </p>
                        )}
                        {c.respondentName && (
                          <p className="text-xs text-gray-600 mt-1">
                            By: {c.respondentName}
                            {c.respondentPosition && ` (${c.respondentPosition})`}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Action Button */}
                    <div className="flex items-center justify-between pt-2">
                      {!submitted ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/compliance/supplier/${c.token}`);
                          }}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          Click to open →
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                          <CheckCircle size={14} />
                          Already submitted
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Missing Documents */}
        <div className="mb-8">
          <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2">
            <FileText size={20} className="text-primary flex-shrink-0" />
            <span>Documents Needed {filteredDocuments.length !== missingDocs.length && `(${filteredDocuments.length}/${missingDocs.length})`}</span>
          </h2>
          {filteredDocuments.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 sm:p-8 text-center text-muted">
              <p className="text-sm sm:text-base">{debouncedSearchTerm ? 'No documents match your search' : 'No documents required at this time'}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:gap-4">
              {filteredDocuments.map(d => {
                const isUploading = uploadingDocs[d.id];
                const hasFile = selectedFiles[d.id];
                const progress = uploadProgress[d.id] || 0;
                const error = uploadErrors[d.id];

                return (
                  <div key={d.id} className="bg-white rounded-lg shadow p-3 sm:p-4 border-l-4 border-yellow-400 hover:shadow-md transition">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-sm sm:text-base break-words">{d.title}</h3>
                        <p className="text-xs sm:text-sm text-muted">{d.projectName}</p>
                        {d.deadline && (
                          <p className={`mt-1 text-xs sm:text-sm ${getDaysUntil(d.deadline)! < 0 ? 'text-red-600 font-medium' : 'text-orange-600'}`}>
                            📅 Due: {new Date(d.deadline).toLocaleDateString()} ({getDaysUntil(d.deadline)} days)
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Upload UI */}
                    <div className="mt-3 space-y-2">
                      {!hasFile ? (
                        <>
                          <label className="flex items-center justify-center px-3 py-2 border-2 border-dashed border-yellow-300 rounded-lg bg-yellow-50 hover:bg-yellow-100 cursor-pointer transition text-xs sm:text-sm font-medium text-yellow-700">
                            <input
                              type="file"
                              onChange={(e) => handleDocumentSelect(d.id, e.target.files)}
                              className="hidden"
                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                              disabled={isUploading}
                            />
                            📎 Select File (Max 5MB)
                          </label>
                          {error && <p className="text-red-600 text-xs">{error}</p>}
                        </>
                      ) : (
                        <>
                          <div className="bg-blue-50 p-2 rounded-lg text-xs sm:text-sm">
                            <p className="font-medium text-blue-700 break-words">✓ {selectedFiles[d.id]?.name}</p>
                            <p className="text-blue-600">
                              {((selectedFiles[d.id]?.size || 0) / 1024).toFixed(0)} KB
                            </p>
                          </div>

                          {/* Progress Bar */}
                          {isUploading && (
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-green-600 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button
                              onClick={() => handleDocumentUpload(d.id)}
                              disabled={isUploading}
                              className="flex-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs sm:text-sm font-medium transition disabled:opacity-50 flex items-center justify-center gap-1"
                            >
                              {isUploading ? (
                                <>
                                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                  {progress}%
                                </>
                              ) : (
                                <>📤 Upload</>
                              )}
                            </button>
                            {!isUploading && (
                              <button
                                onClick={() => {
                                  setSelectedFiles({ ...selectedFiles, [d.id]: null });
                                  setUploadErrors({ ...uploadErrors, [d.id]: '' });
                                }}
                                className="px-2 py-1.5 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 text-xs font-medium transition"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RFQs */}
        <div className="mb-8">
          <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2">
            <ShoppingBag size={20} className="text-primary flex-shrink-0" />
            <span>Open RFQs {filteredRfqs.length !== openRfqs.length && `(${filteredRfqs.length}/${openRfqs.length})`}</span>
            {refreshingRfqs && (
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin ml-2" />
            )}
          </h2>
          {filteredRfqs.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 sm:p-8 text-center text-muted">
              <p className="text-sm sm:text-base">{debouncedSearchTerm ? 'No RFQs match your search' : 'No RFQs available at this time'}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:gap-4">
              {filteredRfqs.map(rfq => (
                <div key={rfq.id} className="bg-white rounded-lg shadow p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm sm:text-base break-words">{rfq.rfqTitle}</h3>
                      <p className="text-xs sm:text-sm text-muted">{rfq.rfqIdentifier}</p>
                    </div>
                    {rfq.status === 'pending' ? (
                      <button
                        onClick={() => {
                          setSelectedRfqForQuote(rfq);
                          setIsQuoteModalOpen(true);
                        }}
                        className="px-3 py-1 bg-primary text-white rounded text-xs sm:text-sm hover:bg-primary-dark transition whitespace-nowrap w-full sm:w-auto"
                      >
                        Submit Quote
                      </button>
                    ) : rfq.status === 'submitted' ? (
                      <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium whitespace-nowrap w-full sm:w-auto text-center sm:text-left">
                        Quote Submitted
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-gray-100 text-gray-800 text-xs rounded font-medium whitespace-nowrap w-full sm:w-auto text-center sm:text-left">
                        {rfq.status}
                      </span>
                    )}
                  </div>
                  {rfq.status === 'submitted' && rfq.unitPrice && (
                    <div className="mt-3 pt-3 border-t border-gray-200 text-sm">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-muted text-xs">Unit Price</p>
                          <p className="font-bold">{rfq.currency || 'USD'} {rfq.unitPrice}</p>
                        </div>
                        {rfq.leadTimeWeeks && (
                          <div>
                            <p className="text-muted text-xs">Lead Time</p>
                            <p className="font-bold">{rfq.leadTimeWeeks} weeks</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* My Proposals */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <FileText size={20} className="text-primary flex-shrink-0" />
              <span>My Proposals {filteredProposals.length !== proposals.length && `(${filteredProposals.length}/${proposals.length})`}</span>
            </h2>
            <button
              onClick={() => setIsProposalModalOpen(true)}
              className="flex items-center justify-center sm:justify-start gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-xs sm:text-sm font-medium w-full sm:w-auto"
            >
              <Plus size={16} /> <span>Submit New Proposal</span>
            </button>
          </div>
          {filteredProposals.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 sm:p-8 text-center text-muted">
              <p className="text-sm sm:text-base">{debouncedSearchTerm ? 'No proposals match your search' : "You haven't submitted any proposals yet. Share your new products with us!"}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:gap-4">
              {filteredProposals.map(prop => (
                <div key={prop.id} className="bg-white rounded-lg shadow p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-sm sm:text-base break-words">{prop.title}</h3>
                      <p className="text-xs sm:text-sm text-muted mt-1">{prop.description}</p>
                      {prop.categoryId && (
                        <p className="text-xs text-gray-500 mt-2">Category: Electronics</p>
                      )}
                    </div>
                    <span className={`ml-4 px-3 py-1 text-xs rounded font-medium whitespace-nowrap ${
                      prop.status === 'new' ? 'bg-blue-100 text-blue-800' :
                      prop.status === 'reviewed' ? 'bg-yellow-100 text-yellow-800' :
                      prop.status === 'accepted' ? 'bg-green-100 text-green-800' :
                      prop.status === 'converted_to_rfq' ? 'bg-indigo-100 text-indigo-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {prop.status === 'converted_to_rfq' ? 'Converted to RFQ' : prop.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>Submitted: {new Date(prop.createdAt).toLocaleDateString()}</span>
                    {prop.attachments && prop.attachments.length > 0 && (
                      <>
                        <span>•</span>
                        <span>{prop.attachments.length} file(s)</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </main>

      {/* Contact PM Modal */}
      {isContactPmOpen && contactPmProject && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsContactPmOpen(false);
          }}
        >
          <dialog
            open
            className="bg-white rounded-lg max-w-md w-full p-4 sm:p-6 max-h-screen overflow-y-auto"
            aria-labelledby="contact-modal-title"
          >
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="min-w-0">
                <h2 id="contact-modal-title" className="text-lg sm:text-xl font-bold break-words">
                  Contact Project Manager
                </h2>
                <p className="text-xs sm:text-sm text-muted mt-1">{contactPmProject.name}</p>
              </div>
              <button
                onClick={() => setIsContactPmOpen(false)}
                aria-label="Close dialog"
                className="text-gray-400 hover:text-gray-600 flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded p-1"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSendMessage} className="space-y-4">
              <div>
                <label htmlFor="subject-input" className="block text-xs sm:text-sm font-medium text-dark mb-2">
                  Subject (Optional)
                </label>
                <input
                  id="subject-input"
                  type="text"
                  maxLength={100}
                  value={contactForm.subject}
                  onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                  placeholder="e.g., Progress update request"
                  aria-describedby="subject-count"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
                <p id="subject-count" className="text-xs text-gray-500 mt-1">
                  {contactForm.subject.length}/100
                </p>
              </div>

              <div>
                <label htmlFor="message-input" className="block text-xs sm:text-sm font-medium text-dark mb-2">
                  Message <span className="text-red-600" aria-label="required">*</span>
                </label>
                <textarea
                  id="message-input"
                  required
                  maxLength={500}
                  rows={4}
                  value={contactForm.message}
                  onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                  placeholder="Type your message here..."
                  aria-describedby="message-count"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm resize-none"
                />
                <p id="message-count" className="text-xs text-gray-500 mt-1">
                  {contactForm.message.length}/500
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsContactPmOpen(false)}
                  className="flex-1 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs sm:text-sm font-medium transition disabled:opacity-50"
                >
                  Send Message
                </button>
              </div>
            </form>
          </dialog>
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
