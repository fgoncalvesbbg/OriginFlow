
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
    getSupplierByToken, getProjectsBySupplierToken, getComplianceRequestsBySupplierId, 
    getSupplierNotifications, markNotificationRead, getMissingDocumentsForSupplier, 
    getRFQsForSupplier, createSupplierProposal, getProductionUpdates, saveProductionUpdate 
} from '../services/apiService';
import { Supplier, Project, ComplianceRequest, Notification, ProjectDocument, RFQEntry, ProductionUpdate, ProductionDelayReason } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { Box, ShieldCheck, ExternalLink, Calendar, LayoutDashboard, Clock, Bell, X, AlertCircle, FileText, ShoppingBag, Upload, CheckCircle, Factory } from 'lucide-react';

const SupplierDashboard: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [complianceReqs, setComplianceReqs] = useState<ComplianceRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [missingDocs, setMissingDocs] = useState<(ProjectDocument & { projectName: string, projectIdCode: string })[]>([]);
  const [openRfqs, setOpenRfqs] = useState<RFQEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);

  // Manufacturing Widget Data
  const [projectsNeedingUpdate, setProjectsNeedingUpdate] = useState<{project: Project, daysUntilEtd: number}[]>([]);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [updatingProject, setUpdatingProject] = useState<Project | null>(null);
  const [updateForm, setUpdateForm] = useState({
      newDate: '',
      delayReason: '' as ProductionDelayReason | '',
      notes: ''
  });

  // Proposal Upload State
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalDesc, setProposalDesc] = useState('');
  const [proposalFile, setProposalFile] = useState<string | null>(null);
  const [uploadingProposal, setUploadingProposal] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid portal link.');
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        const sup = await getSupplierByToken(token);
        if (!sup) {
          setError('Supplier not found. Please check your link.');
        } else {
          setSupplier(sup);
          const [pList, cList, nList, mDocs, rfqList] = await Promise.all([
            getProjectsBySupplierToken(token),
            getComplianceRequestsBySupplierId(sup.id),
            getSupplierNotifications(sup.id),
            getMissingDocumentsForSupplier(sup.id),
            getRFQsForSupplier(sup.id)
          ]);
          setProjects(pList);
          setComplianceReqs(cList);
          setNotifications(nList);
          setMissingDocs(mDocs);
          setOpenRfqs(rfqList);

          // Calculate Manufacturing Checks
          const needsUpdate: {project: Project, daysUntilEtd: number}[] = [];
          
          for (const p of pList) {
              if (p.milestones?.etd && p.status === 'in_progress') {
                  const etd = new Date(p.milestones.etd);
                  const today = new Date();
                  const diffTime = etd.getTime() - today.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  
                  // Check triggers: 6 weeks (42 days), 4 weeks (28 days), 2 weeks (14 days)
                  if ((diffDays <= 45 && diffDays >= 39) || (diffDays <= 30 && diffDays >= 25) || (diffDays <= 16 && diffDays >= 12)) {
                      const updates = await getProductionUpdates(p.id);
                      const recentUpdate = updates.length > 0 && (new Date().getTime() - new Date(updates[0].createdAt).getTime()) < (7 * 24 * 60 * 60 * 1000);
                      
                      if (!recentUpdate) {
                          needsUpdate.push({ project: p, daysUntilEtd: diffDays });
                      }
                  }
              }
          }
          setProjectsNeedingUpdate(needsUpdate);
        }
      } catch (err) {
          console.error(err);
        setError('Failed to load dashboard data.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

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

  const handleProposalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onloadend = () => {
              setProposalFile(reader.result as string);
          };
          reader.readAsDataURL(file);
      }
  };

  const handleSubmitProposal = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!supplier || !proposalFile) return;
      setUploadingProposal(true);
      try {
          await createSupplierProposal(supplier.id, proposalTitle, proposalDesc, proposalFile);
          alert("Proposal uploaded successfully!");
          setProposalTitle('');
          setProposalDesc('');
          setProposalFile(null);
      } catch (e) {
          alert("Failed to upload proposal.");
      } finally {
          setUploadingProposal(false);
      }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-500">Loading Dashboard...</div>;
  if (error) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-red-500 font-medium">{error}</div>;
  if (!supplier) return null;

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm">
              <LayoutDashboard size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">{supplier.name}</h1>
              <p className="text-xs text-slate-500">OriginFlow Supplier Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
             <div className="relative">
               <button 
                 onClick={() => setShowNotifications(!showNotifications)}
                 className="p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors relative"
               >
                 <Bell size={20} />
                 {unreadCount > 0 && (
                   <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full shadow-sm animate-pulse">
                     {unreadCount}
                   </span>
                 )}
               </button>
               
               {showNotifications && (
                 <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-top-2 z-50">
                   <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                     <h3 className="text-sm font-bold text-slate-700">Notifications</h3>
                     <button onClick={() => setShowNotifications(false)}><X size={16} className="text-slate-400" /></button>
                   </div>
                   <div className="max-h-[300px] overflow-y-auto">
                     {notifications.length === 0 ? (
                       <div className="p-8 text-center text-slate-400 text-sm">No notifications</div>
                     ) : (
                       notifications.map(notif => (
                         <div 
                           key={notif.id} 
                           className={`p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${notif.isRead ? 'opacity-60' : 'bg-blue-50/30'}`}
                         >
                           <div className="flex justify-between items-start gap-2">
                             <p className="text-sm text-slate-800 leading-snug">{notif.message}</p>
                             {!notif.isRead && (
                               <button 
                                 onClick={() => handleMarkRead(notif.id)} 
                                 className="text-blue-600 hover:text-blue-800" 
                                 title="Mark as read"
                               >
                                 <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                               </button>
                             )}
                           </div>
                           <div className="flex justify-between items-center mt-2">
                             <span className="text-[10px] text-slate-400">{new Date(notif.createdAt).toLocaleDateString()}</span>
                             {notif.link && (
                               <Link 
                                 to={notif.link} 
                                 onClick={() => handleMarkRead(notif.id)}
                                 className="text-xs font-medium text-blue-600 hover:underline"
                               >
                                 View Details
                               </Link>
                             )}
                           </div>
                         </div>
                       ))
                     )}
                   </div>
                 </div>
               )}
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-10">
        
        {/* 0. Manufacturing Checks */}
        {projectsNeedingUpdate.length > 0 && (
            <section className="animate-in slide-in-from-top-2 fade-in duration-300">
                <div className="flex items-center gap-2 mb-4">
                    <Factory className="text-blue-600" />
                    <h3 className="text-xl font-bold text-slate-800">Production Schedule Confirmation</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {projectsNeedingUpdate.map(({ project, daysUntilEtd }) => (
                        <div key={project.id} className="bg-white border-l-4 border-blue-500 rounded-r-xl shadow-md p-6 flex flex-col justify-between">
                            <div>
                                <h4 className="font-bold text-lg text-slate-900 mb-1">{project.name}</h4>
                                <p className="text-sm text-slate-500 mb-4">PO: {project.projectId}</p>
                                <div className="flex items-center gap-2 mb-4 bg-blue-50 p-3 rounded border border-blue-100">
                                    <Calendar className="text-blue-600" size={18} />
                                    <div>
                                        <span className="text-xs font-bold text-blue-600 uppercase block">Agreed ETD</span>
                                        <span className="font-bold text-slate-800">{new Date(project.milestones!.etd!).toLocaleDateString()}</span>
                                    </div>
                                    <span className="ml-auto text-xs bg-blue-200 text-blue-800 px-2 py-1 rounded-full font-bold">{daysUntilEtd} days away</span>
                                </div>
                            </div>
                            <div className="flex gap-3 mt-2">
                                <button 
                                    onClick={() => handleConfirmEtd(project, project.milestones!.etd!)}
                                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded-lg shadow-sm transition-colors text-sm"
                                >
                                    Confirm On Time
                                </button>
                                <button 
                                    onClick={() => { setUpdatingProject(project); setIsUpdateModalOpen(true); }}
                                    className="flex-1 bg-white border border-red-200 text-red-600 hover:bg-red-50 font-bold py-2 rounded-lg transition-colors text-sm"
                                >
                                    Report Delay
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        )}

        {/* 1. ACTIVE PROJECTS */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Box className="text-slate-400" />
            <h3 className="text-xl font-bold text-slate-800">Assigned Projects</h3>
          </div>
          
          {projects.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400">
               No projects assigned currently.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {projects.map(project => (
                <div key={project.id} className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all hover:-translate-y-1 overflow-hidden flex flex-col">
                   <div className="p-5 flex-1">
                     <div className="flex justify-between items-start mb-3">
                       <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded">{project.projectId}</span>
                       <StatusBadge status={project.status} type="project" />
                     </div>
                     <h4 className="font-bold text-lg text-slate-900 mb-2 line-clamp-2">{project.name}</h4>
                     <div className="flex items-center gap-2 text-sm text-slate-500">
                        <span className="flex items-center gap-1"><Clock size={14} /> Step {project.currentStep}</span>
                     </div>
                   </div>
                   <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-between items-center">
                      <Link 
                        to={`/supplier/${project.supplierLinkToken}`}
                        className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:text-blue-800 hover:underline w-full justify-center"
                      >
                        Access Project Portal <ExternalLink size={14} />
                      </Link>
                   </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 2. MISSING DOCUMENTS */}
        <section>
            <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="text-orange-500" />
                <h3 className="text-xl font-bold text-slate-800">Action Required: Missing Documents</h3>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {missingDocs.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 flex flex-col items-center">
                        <CheckCircle size={32} className="text-green-500 mb-2" />
                        <p>All caught up! No pending document requests.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {missingDocs.map(doc => {
                            const isOverdue = doc.deadline && new Date(doc.deadline) < new Date();
                            const project = projects.find(p => p.id === doc.projectId);
                            return (
                                <div key={doc.id} className="p-4 flex flex-col sm:items-center justify-between hover:bg-slate-50 gap-4 sm:flex-row">
                                    <div>
                                        <h4 className="font-bold text-slate-900 flex items-center gap-2">
                                            {doc.title}
                                            {doc.status === 'rejected' && <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold">Rejected</span>}
                                        </h4>
                                        <p className="text-sm text-slate-500 mt-1">Project: {doc.projectName} ({doc.projectIdCode})</p>
                                        {doc.deadline && (
                                            <div className={`text-xs font-medium mt-1 flex items-center gap-1 ${isOverdue ? 'text-red-600' : 'text-orange-600'}`}>
                                                <Clock size={12} /> Due: {new Date(doc.deadline).toLocaleDateString()} {isOverdue && '(Overdue)'}
                                            </div>
                                        )}
                                    </div>
                                    {project?.supplierLinkToken && (
                                        <Link 
                                            to={`/supplier/${project.supplierLinkToken}`}
                                            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-bold hover:bg-blue-100 transition-colors whitespace-nowrap"
                                        >
                                            <Upload size={14} /> Upload Now
                                        </Link>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>

        {/* 3. OPEN RFQ REQUESTS */}
        <section>
            <div className="flex items-center gap-2 mb-4">
                <ShoppingBag className="text-purple-500" />
                <h3 className="text-xl font-bold text-slate-800">Open RFQ Invitations</h3>
            </div>
            
            {openRfqs.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">
                    No open RFQs at this time.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {openRfqs.map(entry => (
                        <div key={entry.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center hover:shadow-md transition-all">
                            <div>
                                <div className="text-xs font-mono bg-purple-50 text-purple-700 px-2 py-0.5 rounded w-fit mb-2">{entry.rfqIdentifier}</div>
                                <h4 className="font-bold text-slate-900 text-lg">{entry.rfqTitle}</h4>
                                <div className="text-sm text-slate-500 mt-1">Status: <span className="capitalize font-medium text-slate-700">{entry.status}</span></div>
                            </div>
                            <Link 
                                to={`/sourcing/supplier/${entry.token}`}
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg font-bold text-sm hover:bg-purple-700 transition-colors shadow-sm"
                            >
                                View RFQ
                            </Link>
                        </div>
                    ))}
                </div>
            )}
        </section>

        {/* 4. UNSOLICITED PROPOSALS */}
        <section>
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-8 text-white shadow-lg">
                <div className="flex items-start gap-4 mb-6">
                    <div className="p-3 bg-white/10 rounded-lg">
                        <FileText size={24} className="text-blue-300" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold">Send Unsolicited Proposal</h3>
                        <p className="text-slate-300 text-sm mt-1 max-w-xl">
                            Have a new product idea or updated catalog? Upload it here for our sourcing team to review.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmitProposal} className="bg-white/5 p-6 rounded-lg border border-white/10 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Proposal Title</label>
                            <input 
                                required
                                className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="e.g. 2025 Summer Collection"
                                value={proposalTitle}
                                onChange={(e) => setProposalTitle(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Description</label>
                            <input 
                                className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="Brief details..."
                                value={proposalDesc}
                                onChange={(e) => setProposalDesc(e.target.value)}
                            />
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <div className="flex-1">
                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">File (PDF/PPT)</label>
                            <input 
                                type="file" 
                                required
                                className="w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
                                onChange={handleProposalFileChange}
                            />
                        </div>
                        <button 
                            type="submit"
                            disabled={uploadingProposal}
                            className="px-6 py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700 disabled:opacity-50 self-end"
                        >
                            {uploadingProposal ? 'Uploading...' : 'Send Proposal'}
                        </button>
                    </div>
                </form>
            </div>
        </section>

        {/* DELAY REPORT MODAL */}
        {isUpdateModalOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-lg text-red-600">Report Production Delay</h3>
                        <button onClick={() => setIsUpdateModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                    </div>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">New Estimated ETD</label>
                            <input 
                                type="date" 
                                className="w-full border rounded p-2"
                                value={updateForm.newDate}
                                onChange={e => setUpdateForm({...updateForm, newDate: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
                            <select 
                                className="w-full border rounded p-2"
                                value={updateForm.delayReason}
                                onChange={e => setUpdateForm({...updateForm, delayReason: e.target.value as ProductionDelayReason})}
                            >
                                <option value="">Select Reason...</option>
                                {Object.values(ProductionDelayReason).map(r => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Details / Comments</label>
                            <textarea 
                                className="w-full border rounded p-2 text-sm"
                                rows={3}
                                value={updateForm.notes}
                                onChange={e => setUpdateForm({...updateForm, notes: e.target.value})}
                            />
                        </div>
                        <div className="flex justify-end pt-2">
                            <button 
                                onClick={handleReportDelay}
                                disabled={!updateForm.newDate || !updateForm.delayReason}
                                className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 shadow-sm"
                            >
                                Submit Delay Report
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

      </main>
      
      <footer className="bg-white border-t border-slate-200 mt-12 py-8">
         <div className="max-w-6xl mx-auto px-6 text-center text-sm text-slate-400">
           &copy; 2025 OriginFlow PLM. Secure Supplier Dashboard.
         </div>
      </footer>
    </div>
  );
};

export default SupplierDashboard;
