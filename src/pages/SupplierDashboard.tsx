
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getSupplierByToken, getProjectsBySupplierToken, getComplianceRequestsBySupplierId,
  getSupplierNotifications, markNotificationRead, getMissingDocumentsForSupplier,
  getRFQsForSupplier, getProductionUpdates, saveProductionUpdate,
  logAccessCodeAttempt, submitRFQEntry, getSupplierProposals
} from '../services/apiService';
import { Supplier, Project, ComplianceRequest, Notification, ProjectDocument, RFQEntry, ProductionDelayReason, SupplierProposal } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import SubmitProposalModal from '../components/sourcing/SubmitProposalModal';
import { ShieldCheck, LayoutDashboard, Bell, X, AlertCircle, FileText, ShoppingBag, Factory, Key, Upload, Plus, Download, RefreshCw } from 'lucide-react';

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

  // Session Management (60 min timeout)
  const SESSION_TIMEOUT = 60 * 60 * 1000;
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  // Dashboard State Management
  const [dashboardError, setDashboardError] = useState('');
  const [refreshingRfqs, setRefreshingRfqs] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('info');
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);

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
      <div className="min-h-screen bg-light flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
          <div className="flex items-center justify-center w-12 h-12 bg-primary-light rounded-lg mb-6 mx-auto">
            <Key size={24} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2 text-center">{supplier.name} Portal</h1>
          <p className="text-muted text-center mb-6">Enter your access code to continue</p>

          <form onSubmit={handleVerifyAccessCode} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-dark mb-2">
                Access Code (6 digits)
              </label>
              <input
                type="text"
                value={enteredAccessCode}
                onChange={(e) => setEnteredAccessCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-center text-2xl tracking-widest font-mono"
              />
              {accessCodeError && (
                <p className="text-red-600 text-sm mt-2">{accessCodeError}</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-primary text-white py-2 rounded-lg hover:bg-primary-dark transition font-medium"
            >
              Verify Access Code
            </button>
          </form>

          <p className="text-muted text-sm text-center mt-6">
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
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center">
              <LayoutDashboard size={20} className="text-primary" />
            </div>
            <div>
              <h1 className="font-bold text-lg">{supplier.name}</h1>
              <p className="text-sm text-muted">Supplier Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleRefreshDashboard}
              disabled={refreshingDashboard}
              title="Refresh dashboard data"
              className="p-2 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
            >
              <RefreshCw size={20} className={`text-muted ${refreshingDashboard ? 'animate-spin' : ''}`} />
            </button>

            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <Bell size={20} className="text-muted" />
                {unreadCount > 0 && (
                  <span className="absolute top-0 right-0 w-5 h-5 bg-red-600 text-white text-xs rounded-full flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg z-50">
                  <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="font-bold">Notifications</h3>
                    <button onClick={() => setShowNotifications(false)}>
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

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
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

        {/* Projects Section */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <ShoppingBag size={20} className="text-primary" />
            Projects
          </h2>
          {projects.length === 0 ? (
            <p className="text-muted">No projects assigned</p>
          ) : (
            <div className="grid gap-4">
              {projects.map(p => (
                <div key={p.id} className="bg-white rounded-lg shadow p-4 border-l-4 border-primary">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-bold text-lg">{p.name}</h3>
                      <p className="text-sm text-muted">ID: {p.projectId}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <StatusBadge status={p.status} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Manufacturing Checks */}
        {projectsNeedingUpdate.length > 0 && (
          <div className="mb-8 bg-yellow-50 border-l-4 border-yellow-400 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-yellow-900">
              <Factory size={20} />
              Production Status Updates Needed
            </h2>
            <div className="space-y-4">
              {projectsNeedingUpdate.map(({ project, daysUntilEtd }) => (
                <div key={project.id} className="bg-white rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold">{project.name}</h3>
                      <p className="text-sm text-muted">
                        ETD: {new Date(project.milestones?.etd || '').toLocaleDateString()} ({daysUntilEtd} days)
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleConfirmEtd(project, project.milestones?.etd || '')}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm transition"
                      >
                        Confirm On Time
                      </button>
                      <button
                        onClick={() => {
                          setUpdatingProject(project);
                          setIsUpdateModalOpen(true);
                        }}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm transition"
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
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <ShieldCheck size={20} className="text-primary" />
            Compliance Requests ({complianceReqs.length})
          </h2>
          {complianceReqs.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-muted">
              <p>No compliance requests at this time</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {complianceReqs.map(c => (
                <div
                  key={c.id}
                  onClick={() => navigate(`/compliance/supplier/${c.token}`)}
                  className="bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-md hover:border-primary border-l-4 border-primary transition-all"
                >
                  <h3 className="font-bold">{c.requestId}</h3>
                  <p className="text-sm text-muted mt-1">{c.projectName}</p>
                  {c.accessCode && (
                    <p className="text-sm font-mono bg-gray-50 rounded px-2 py-1 mt-2 inline-block">
                      Code: <span className="text-blue-600 font-bold">{c.accessCode}</span>
                    </p>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-gray-500">Click to open</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Missing Documents */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <FileText size={20} className="text-primary" />
            Documents Needed ({missingDocs.length})
          </h2>
          {missingDocs.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-muted">
              <p>No documents required at this time</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {missingDocs.map(d => (
                <div key={d.id} className="bg-white rounded-lg shadow p-4 border-l-4 border-yellow-400">
                  <h3 className="font-bold">{d.title}</h3>
                  <p className="text-sm text-muted">{d.projectName}</p>
                  {d.deadline && (
                    <p className="text-sm text-red-600 mt-2">
                      Due: {new Date(d.deadline).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RFQs */}
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <ShoppingBag size={20} className="text-primary" />
            Open RFQs ({openRfqs.length})
            {refreshingRfqs && (
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin ml-2" />
            )}
          </h2>
          {openRfqs.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-muted">
              <p>No RFQs available at this time</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {openRfqs.map(rfq => (
                <div key={rfq.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold">{rfq.rfqTitle}</h3>
                      <p className="text-sm text-muted">{rfq.rfqIdentifier}</p>
                    </div>
                    {rfq.status === 'pending' ? (
                      <button
                        onClick={() => {
                          setSelectedRfqForQuote(rfq);
                          setIsQuoteModalOpen(true);
                        }}
                        className="ml-4 px-3 py-1 bg-primary text-white rounded text-sm hover:bg-primary-dark transition whitespace-nowrap"
                      >
                        Submit Quote
                      </button>
                    ) : rfq.status === 'submitted' ? (
                      <span className="ml-4 px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium whitespace-nowrap">
                        Quote Submitted
                      </span>
                    ) : (
                      <span className="ml-4 px-3 py-1 bg-gray-100 text-gray-800 text-xs rounded font-medium whitespace-nowrap">
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FileText size={20} className="text-primary" />
              My Proposals ({proposals.length})
            </h2>
            <button
              onClick={() => setIsProposalModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
            >
              <Plus size={16} /> Submit New Proposal
            </button>
          </div>
          {proposals.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-muted">
              <p>You haven't submitted any proposals yet. Share your new products with us!</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {proposals.map(prop => (
                <div key={prop.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold">{prop.title}</h3>
                      <p className="text-sm text-muted mt-1">{prop.description}</p>
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

      </div>

      {/* Update Modal */}
      {isUpdateModalOpen && updatingProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">Report Delay</h2>
            <form onSubmit={(e) => { e.preventDefault(); handleReportDelay(); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">New ETD</label>
                <input
                  type="date"
                  value={updateForm.newDate}
                  onChange={(e) => setUpdateForm({ ...updateForm, newDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Reason for Delay</label>
                <select
                  value={updateForm.delayReason}
                  onChange={(e) => setUpdateForm({ ...updateForm, delayReason: e.target.value as ProductionDelayReason })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
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
                <label className="block text-sm font-medium mb-2">Additional Notes</label>
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
                  className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
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
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold">{selectedRfqForQuote.rfqTitle}</h2>
                <p className="text-sm text-muted mt-1">{selectedRfqForQuote.rfqIdentifier}</p>
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
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmitQuote} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
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
