
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getSupplierByToken, getProjectsBySupplierToken, getComplianceRequestsBySupplierId,
  getSupplierNotifications, markNotificationRead, getMissingDocumentsForSupplier,
  getRFQsForSupplier, createSupplierProposal, getProductionUpdates, saveProductionUpdate,
  logAccessCodeAttempt, getSupplierProposals
} from '../services/apiService';
import { Supplier, Project, ComplianceRequest, Notification, ProjectDocument, RFQEntry, ProductionDelayReason, SupplierProposal } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { ShieldCheck, LayoutDashboard, Bell, X, AlertCircle, FileText, ShoppingBag, Factory, Key, Upload, Check } from 'lucide-react';

const SupplierDashboard: React.FC = () => {
  const { token } = useParams<{ token: string }>();
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
  const [submittingProposal, setSubmittingProposal] = useState(false);
  const [proposalForm, setProposalForm] = useState({
    title: '',
    description: '',
    fileUrl: ''
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
        const [pList, cList, nList, mDocs, rfqList, propList] = await Promise.all([
          getProjectsBySupplierToken(token!),
          getComplianceRequestsBySupplierId(supplier.id),
          getSupplierNotifications(supplier.id),
          getMissingDocumentsForSupplier(supplier.id),
          getRFQsForSupplier(supplier.id),
          getSupplierProposals(supplier.id)
        ]);

        if (!mounted) return;

        setProjects(pList);
        setComplianceReqs(cList);
        setNotifications(nList);
        setMissingDocs(mDocs);
        setOpenRfqs(rfqList);
        setProposals(propList);

        // Calculate Manufacturing Checks
        const needsUpdate: {project: Project, daysUntilEtd: number}[] = [];

        for (const p of pList) {
          if (p.milestones?.etd && p.status === 'in_progress') {
            const etd = new Date(p.milestones.etd);
            const today = new Date();
            const diffTime = etd.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if ((diffDays <= 45 && diffDays >= 39) || (diffDays <= 30 && diffDays >= 25) || (diffDays <= 16 && diffDays >= 12)) {
              const updates = await getProductionUpdates(p.id);
              const recentUpdate = updates.length > 0 && (new Date().getTime() - new Date(updates[0].createdAt).getTime()) < (7 * 24 * 60 * 60 * 1000);

              if (!recentUpdate) {
                needsUpdate.push({ project: p, daysUntilEtd: diffDays });
              }
            }
          }
        }

        if (mounted) {
          setProjectsNeedingUpdate(needsUpdate);
        }
      } catch (err: any) {
        if (!mounted) return;
        console.error('Dashboard data load error:', err);
        // Non-critical error - don't block the UI
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

  const handleMarkRead = async (id: string) => {
    await markNotificationRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
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
      alert("ETD Confirmed!");
    } catch (e) {
      alert("Error confirming ETD.");
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
      alert("Delay reported successfully.");
    } catch (e) {
      alert("Error reporting delay.");
    }
  };

  const handleSubmitProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplier) return;

    if (!proposalForm.title.trim() || !proposalForm.description.trim()) {
      alert('Please fill in all required fields.');
      return;
    }

    setSubmittingProposal(true);
    try {
      await createSupplierProposal(
        supplier.id,
        proposalForm.title,
        proposalForm.description,
        proposalForm.fileUrl
      );

      // Reset form and refresh proposals
      setProposalForm({ title: '', description: '', fileUrl: '' });
      setIsProposalModalOpen(false);

      // Refresh proposals list
      const updatedProposals = await getSupplierProposals(supplier.id);
      setProposals(updatedProposals);

      alert('Proposal submitted successfully!');
    } catch (e) {
      alert('Error submitting proposal. Please try again.');
    } finally {
      setSubmittingProposal(false);
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
                <div key={c.id} className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold">{c.requestId}</h3>
                  <p className="text-sm text-muted mt-1">{c.projectName}</p>
                  <div className="mt-2">
                    <StatusBadge status={c.status} />
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
          </h2>
          {openRfqs.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-muted">
              <p>No RFQs available at this time</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {openRfqs.map(rfq => (
                <div key={rfq.id} className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-bold">{rfq.rfqTitle}</h3>
                  <p className="text-sm text-muted">{rfq.rfqIdentifier}</p>
                  <div className="mt-2 flex gap-2">
                    {rfq.status === 'open' && (
                      <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                        Open for Quotes
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Proposals Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Upload size={20} className="text-primary" />
              My Proposals ({proposals.length})
            </h2>
            <button
              onClick={() => setIsProposalModalOpen(true)}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition text-sm font-medium flex items-center gap-2"
            >
              <Upload size={16} />
              Submit Proposal
            </button>
          </div>
          {proposals.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <Upload size={40} className="text-gray-300 mx-auto mb-4" />
              <p className="text-muted mb-4">No proposals submitted yet</p>
              <button
                onClick={() => setIsProposalModalOpen(true)}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition text-sm font-medium"
              >
                Submit Your First Proposal
              </button>
            </div>
          ) : (
            <div className="grid gap-4">
              {proposals.map(p => (
                <div key={p.id} className="bg-white rounded-lg shadow p-4 border-l-4 border-green-400">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-bold">{p.title}</h3>
                      <p className="text-sm text-muted mt-1">{p.description}</p>
                      <div className="mt-3 flex items-center gap-2">
                        {p.status === 'new' ? (
                          <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded flex items-center gap-1">
                            <FileText size={12} />
                            Pending Review
                          </span>
                        ) : p.status === 'approved' ? (
                          <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded flex items-center gap-1">
                            <Check size={12} />
                            Approved
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs rounded">
                            {p.status}
                          </span>
                        )}
                        <span className="text-xs text-muted">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
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

      {/* Proposal Modal */}
      {isProposalModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Upload size={20} className="text-primary" />
                Submit a Proposal
              </h2>
              <button
                onClick={() => setIsProposalModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handleSubmitProposal} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Proposal Title <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={proposalForm.title}
                  onChange={(e) => setProposalForm({ ...proposalForm, title: e.target.value })}
                  placeholder="e.g., New Product Offering"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Description <span className="text-red-600">*</span>
                </label>
                <textarea
                  value={proposalForm.description}
                  onChange={(e) => setProposalForm({ ...proposalForm, description: e.target.value })}
                  placeholder="Describe your proposal, including key features and benefits..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary"
                  rows={4}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Document/File URL <span className="text-gray-500 text-xs">(optional)</span>
                </label>
                <input
                  type="url"
                  value={proposalForm.fileUrl}
                  onChange={(e) => setProposalForm({ ...proposalForm, fileUrl: e.target.value })}
                  placeholder="https://example.com/document.pdf"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary"
                />
              </div>

              <p className="text-xs text-muted">
                Submit your proposals, quotes, or business development ideas. Our team will review and respond within 2-3 business days.
              </p>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsProposalModalOpen(false)}
                  className="flex-1 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingProposal}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 font-medium flex items-center justify-center gap-2"
                >
                  {submittingProposal ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      Submit Proposal
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierDashboard;
