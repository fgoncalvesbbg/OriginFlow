
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import Layout from '../../components/Layout';
import { 
  getComplianceRequestById, getComplianceRequirements, 
  getProductFeatures, getCategories, submitComplianceResponse, deleteComplianceRequest,
  addDocument, uploadFile, getProjectDocs, COMPLIANCE_SECTIONS, getSupplierById,
  getProjectById
} from '../../services/apiService';
import { useAuth } from '../../context/AuthContext';
import { 
  ComplianceRequest, ComplianceRequirement, ProductFeature, 
  CategoryL3, ComplianceResponseStatus, ComplianceRequestStatus, ComplianceResponseItem, UserRole,
  DocStatus, ResponsibleParty, Supplier, Project
} from '../../types';
import { Copy, CheckCheck, ShieldCheck, Save, Calendar, AlertTriangle, Trash2, FileDown, Folder, Lock, Eye, EyeOff, User, X, Verified, Mail, Loader2, Check, Clock, Building, FileCheck } from 'lucide-react';

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
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded text-sm">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded text-sm font-medium">Delete</button>
        </div>
      </div>
    </div>
  );
};

const ComplianceRequestDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [req, setReq] = useState<ComplianceRequest | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [features, setFeatures] = useState<ProductFeature[]>([]);
  const [category, setCategory] = useState<CategoryL3 | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [showAccessCode, setShowAccessCode] = useState(true);

  // Editable Form State
  const [answers, setAnswers] = useState<Record<string, ComplianceResponseStatus>>({});
  const [comments, setComments] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    if (!id) return;
    const [r, allReqs, allFeats, allCats] = await Promise.all([
      getComplianceRequestById(id),
      getComplianceRequirements(),
      getProductFeatures(),
      getCategories()
    ]);

    if (r) {
      setReq(r);
      setCategory(allCats.find(c => c.id === r.categoryId) || null);
      setFeatures(allFeats);
      
      if (r.supplierId) {
          getSupplierById(r.supplierId).then(setSupplier);
      }

      if (r.projectId) {
          getProjectById(r.projectId).then(setProject);
      }
      
      const applicableReqs = allReqs.filter(requirement => {
        if (requirement.categoryId !== r.categoryId) return false;
        if (requirement.appliesByDefault && (!requirement.conditionFeatureIds || requirement.conditionFeatureIds.length === 0)) return true;
        const hasTriggerFeature = requirement.conditionFeatureIds?.some(fid => 
            r.features.find(f => f.featureId === fid)?.value
        );
        return hasTriggerFeature;
      });
      setRequirements(applicableReqs);

      const initialAnswers: Record<string, ComplianceResponseStatus> = {};
      const initialComments: Record<string, string> = {};
      r.responses.forEach(resp => {
        initialAnswers[resp.requirementId] = resp.status;
        if (resp.comment) initialComments[resp.requirementId] = resp.comment;
      });
      setAnswers(initialAnswers);
      setComments(initialComments);
    }
    setLoading(false);
  };

  const handleCopyLink = () => {
    if (!req) return;
    const url = `${window.location.origin}/#/compliance/supplier/${req.token}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendEmail = () => {
    if (!req || !supplier) {
      alert("Missing request or supplier information.");
      return;
    }
    
    const portalUrl = `${window.location.origin}/#/compliance/supplier/${req.token}`;
    const subject = encodeURIComponent(`ACTION REQUIRED: Compliance TCF Request - ${req.projectName} (${req.requestId})`);
    
    const bodyText = `Hello ${supplier.name},

A Technical Compliance File (TCF) self-declaration is required for our project: ${req.projectName}.

Please access our secure compliance portal at the link below to complete the requirement checklist:

Link: ${portalUrl}
Security Access Code: ${req.accessCode}

How to complete:
1. Open the portal link above.
2. Enter the 6-digit security access code.
3. Review each requirement and select 'Comply' or 'Cannot Comply'.
4. Submit the form.

Best regards,
${user?.name || 'Project Manager'}
LaunchFlow PLM Platform`;

    const mailtoUrl = `mailto:${supplier.email || ''}?subject=${subject}&body=${encodeURIComponent(bodyText)}`;
    
    window.location.href = mailtoUrl;
    setEmailSent(true);
    setTimeout(() => setEmailSent(false), 5000);
  };

  const handleSave = async () => {
    if (!req || !user) return;
    setSaving(true);

    const responseItems: ComplianceResponseItem[] = requirements.map(r => ({
      requirementId: r.id,
      status: answers[r.id] || ComplianceResponseStatus.NOT_APPLICABLE,
      comment: comments[r.id]
    }));

    const hasRejection = responseItems.some(item => item.status === ComplianceResponseStatus.CANNOT_COMPLY);
    const allAnswered = requirements.every(r => answers[r.id]);

    let newStatus = ComplianceRequestStatus.SUBMITTED;
    
    if (allAnswered) {
      if (hasRejection) {
        newStatus = ComplianceRequestStatus.REJECTED;
      } else {
        newStatus = ComplianceRequestStatus.APPROVED;
      }
    }

    await submitComplianceResponse(req.id, responseItems, newStatus, user.name);
    await loadData(); 
    setSaving(false);
  };
  
  const handleDeleteRequest = async () => {
    if (!req) return;
    try {
      await deleteComplianceRequest(req.id);
      navigate('/compliance');
    } catch (e: any) {
      alert(`Failed to delete: ${e.message}`);
    }
  };

  const handleExportPDF = async () => {
    if (!req || !user) return;
    setExporting(true);
    try {
      const doc = new jsPDF();
      doc.setFillColor(248, 250, 252); 
      doc.rect(0, 0, 210, 40, 'F');
      
      doc.setFontSize(20);
      doc.setTextColor(15, 23, 42); 
      doc.text("Compliance TCF Report", 14, 25);
      
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139); 
      doc.text(`Generated: ${new Date().toLocaleString()}`, 150, 25);
      
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(11);
      
      let y = 55;
      doc.setFont("helvetica", "bold");
      doc.text(`Request ID:`, 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(req.requestId, 45, y);
      
      doc.setFont("helvetica", "bold");
      doc.text(`Status:`, 120, y);
      doc.setFont("helvetica", "normal");
      doc.text(req.status.toUpperCase(), 145, y);
      
      y += 8;
      doc.setFont("helvetica", "bold");
      doc.text(`Project:`, 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(req.projectName, 45, y);
      
      y += 8;
      doc.setFont("helvetica", "bold");
      doc.text(`Category:`, 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(category?.name || '-', 45, y);

      y += 8;
      doc.setFont("helvetica", "bold");
      doc.text(`Supplier:`, 14, y);
      doc.setFont("helvetica", "normal");
      doc.text(`${supplier?.name || 'Unknown'}`, 45, y);

      y += 15;
      doc.line(14, y, 196, y);
      y += 10;
      
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("Requirements Checklist", 14, y);
      y += 12;

      const groupedReqs = requirements.reduce((acc, r) => {
          const sec = r.section || 'General Requirements';
          if (!acc[sec]) acc[sec] = [];
          acc[sec].push(r);
          return acc;
      }, {} as Record<string, ComplianceRequirement[]>);
      
      const sortedSections = Object.keys(groupedReqs).sort((a, b) => {
        const indexA = COMPLIANCE_SECTIONS.indexOf(a);
        const indexB = COMPLIANCE_SECTIONS.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
      });

      sortedSections.forEach((section) => {
          const reqs = groupedReqs[section];
          if (y > 270) { doc.addPage(); y = 20; }
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text(section, 14, y);
          y += 6;

          reqs.forEach((r, i) => {
            if (y > 260) { doc.addPage(); y = 20; }
            
            const status = answers[r.id] || 'Pending';
            const comment = comments[r.id] || '';
            
            doc.setFillColor(241, 245, 249); 
            doc.rect(14, y - 5, 182, 8, 'F');
            doc.setFontSize(11);
            doc.setFont("helvetica", "bold");
            doc.text(`${r.title}`, 16, y);
            
            let statusColor = [100, 116, 139]; 
            if (status === ComplianceResponseStatus.COMPLY) statusColor = [22, 163, 74]; 
            if (status === ComplianceResponseStatus.CANNOT_COMPLY) statusColor = [220, 38, 38]; 
            
            doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
            doc.text(status === ComplianceResponseStatus.COMPLY ? 'ACCEPTED' : status === ComplianceResponseStatus.CANNOT_COMPLY ? 'REJECTED' : 'PENDING', 160, y);
            doc.setTextColor(0, 0, 0);

            y += 8;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(71, 85, 105); 
            const splitDesc = doc.splitTextToSize(r.description, 175);
            doc.text(splitDesc, 16, y);
            y += (splitDesc.length * 5) + 4;
            
            if (comment) {
              doc.setFont("helvetica", "italic");
              doc.setTextColor(220, 38, 38); 
              const splitComment = doc.splitTextToSize(`Note: ${comment}`, 175);
              doc.text(splitComment, 16, y);
              doc.setTextColor(0, 0, 0);
              y += (splitComment.length * 5) + 2;
            }
            y += 6;
          });
          y += 4; 
      });

      const fileName = `${req.requestId}_Report.pdf`;
      doc.save(fileName);

      if (req.projectId) {
          const pdfBlob = doc.output('blob');
          const file = new File([pdfBlob], fileName, { type: "application/pdf" });
          const existingDocs = await getProjectDocs(req.projectId);
          const docTitle = `TCF Report - ${req.requestId}`;
          let targetDoc = existingDocs.find(d => d.title === docTitle);
          if (!targetDoc) {
              targetDoc = await addDocument({
                  projectId: req.projectId,
                  stepNumber: 1,
                  title: docTitle,
                  description: "Auto-generated compliance report PDF.",
                  responsibleParty: ResponsibleParty.INTERNAL,
                  isVisibleToSupplier: true,
                  isRequired: false,
                  status: DocStatus.APPROVED
              });
          }
          await uploadFile(targetDoc.id, file, false); 
          alert("PDF exported and saved to Project Documents.");
      } else {
          alert("PDF exported.");
      }

    } catch (e: any) {
      console.error(e);
      alert("Export failed: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { timeZone: 'UTC' });
  };
  
  if (loading || !req) return <Layout><div>Loading...</div></Layout>;

  const isOverdue = req.deadline && new Date(req.deadline) < new Date() && req.status === ComplianceRequestStatus.PENDING_SUPPLIER;

  const groupedReqs = requirements.reduce((acc, r) => {
      const sec = r.section || 'General Requirements';
      if (!acc[sec]) acc[sec] = [];
      acc[sec].push(r);
      return acc;
  }, {} as Record<string, ComplianceRequirement[]>);

  const sortedSections = Object.keys(groupedReqs).sort((a, b) => {
    const indexA = COMPLIANCE_SECTIONS.indexOf(a);
    const indexB = COMPLIANCE_SECTIONS.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

  return (
    <Layout>
      <ConfirmationModal 
         isOpen={isDeleteModalOpen}
         title="Delete Request"
         message="Are you sure you want to delete this TCF Request? This cannot be undone."
         onCancel={() => setIsDeleteModalOpen(false)}
         onConfirm={handleDeleteRequest}
      />

      <div className="flex flex-col md:flex-row justify-between items-start mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{req.projectName}</h1>
          <div className="text-sm text-slate-500 mt-1 flex flex-wrap gap-4 items-center">
            <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">{req.requestId}</span>
            <span>Category: <strong>{category?.name}</strong></span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                req.status === 'approved' ? 'bg-green-100 text-green-800' :
                req.status === 'rejected' ? 'bg-red-100 text-red-800' :
                'bg-blue-100 text-blue-800'
            }`}>
                {req.status.replace('_', ' ')}
            </span>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2 items-center">
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-3 py-2 rounded-md flex items-center gap-2 text-sm mr-2">
             <Lock size={14} /> 
             <span className="font-bold">Access Code:</span> 
             <span className="font-mono font-bold tracking-widest">{showAccessCode ? req.accessCode || '----' : '••••••'}</span>
             <button onClick={() => setShowAccessCode(!showAccessCode)} className="ml-1 text-yellow-600">
                {showAccessCode ? <EyeOff size={14} /> : <Eye size={14} />}
             </button>
          </div>

          <button 
            onClick={handleSendEmail}
            className={`flex items-center gap-2 px-4 py-2 rounded shadow-sm text-sm font-medium transition-all ${
              emailSent ? 'bg-green-600 text-white' : 'bg-white border border-blue-200 text-blue-600 hover:bg-blue-50'
            }`}
          >
            {emailSent ? <Check size={14} /> : <Mail size={14} />}
            {emailSent ? 'Link Shared!' : 'Email Supplier'}
          </button>

          <button 
            onClick={handleExportPDF}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded shadow-sm text-sm hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            {exporting ? 'Generating...' : <><FileDown size={14} /> Export PDF</>}
          </button>

          <button onClick={handleCopyLink} className="flex items-center gap-2 px-4 py-2 bg-white border rounded shadow-sm text-sm hover:bg-slate-50">
            {copied ? 'Copied!' : <><Copy size={14} /> Copy Portal Link</>}
          </button>
          
          {user?.role === UserRole.ADMIN && (
             <button onClick={() => setIsDeleteModalOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 text-red-600 rounded shadow-sm text-sm hover:bg-red-50">
               <Trash2 size={14} /> Delete
             </button>
          )}
        </div>
      </div>

      <div className="space-y-6 mb-8">
         {sortedSections.map(section => (
            <div key={section} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                <div className="bg-slate-100 px-6 py-3 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                       <Folder size={16} className="text-slate-400"/>
                       <span className="font-semibold text-slate-700 uppercase tracking-wide text-sm">{section}</span>
                    </div>
                </div>
                <div className="divide-y divide-slate-100">
                    {groupedReqs[section].map((r, idx) => {
                        const currentAnswer = answers[r.id];
                        const isRejected = currentAnswer === ComplianceResponseStatus.CANNOT_COMPLY;

                        return (
                        <div key={r.id} className={`p-6 transition-colors ${isRejected ? 'bg-red-50/30' : 'hover:bg-slate-50'}`}>
                            <div className="flex flex-col md:flex-row gap-6">
                            <div className="flex-1">
                                <h4 className="font-bold text-slate-900">{r.title}</h4>
                                <p className="text-sm text-slate-600 mb-4">{r.description}</p>
                                
                                {/* Standardized Rules Bar for PM Review */}
                                <div className="bg-slate-50/80 p-2.5 rounded-lg border border-slate-200 flex flex-wrap gap-x-6 gap-y-2 items-center">
                                    <div className="flex items-center gap-1.5 min-w-[120px]">
                                        <Clock size={12} className="text-slate-400" />
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter leading-none">Timing</span>
                                            <span className="text-[10px] font-bold text-slate-700">{r.timingType === 'POST_ETD' ? `ETD + ${r.timingWeeks}w` : 'At ETD'}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 min-w-[140px]">
                                        <Building size={12} className="text-slate-400" />
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter leading-none">Origin</span>
                                            <span className="text-[10px] font-bold text-slate-700">{r.testReportOrigin === 'supplier_inhouse' ? 'In-House OK' : '3rd Party Lab Only'}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 min-w-[140px]">
                                        <FileCheck size={12} className="text-slate-400" />
                                        <div className="flex flex-col">
                                            <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter leading-none">Declaration</span>
                                            <span className="text-[10px] font-bold text-slate-700">{r.selfDeclarationAccepted ? 'Accepted' : 'Report Mandatory'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="w-full md:w-96 shrink-0">
                                <div className="flex items-center gap-4 mb-3">
                                    <label className={`flex items-center gap-2 cursor-pointer p-2 rounded border ${currentAnswer === ComplianceResponseStatus.COMPLY ? 'bg-green-50 border-green-200 text-green-700' : 'border-slate-200'}`}>
                                        <input 
                                            type="radio" 
                                            className="text-green-600"
                                            checked={currentAnswer === ComplianceResponseStatus.COMPLY}
                                            onChange={() => setAnswers({...answers, [r.id]: ComplianceResponseStatus.COMPLY})}
                                        />
                                        <span className="text-sm font-medium">Accept</span>
                                    </label>

                                    <label className={`flex items-center gap-2 cursor-pointer p-2 rounded border ${currentAnswer === ComplianceResponseStatus.CANNOT_COMPLY ? 'bg-red-50 border-red-200 text-red-700' : 'border-slate-200'}`}>
                                        <input 
                                            type="radio" 
                                            className="text-red-600"
                                            checked={currentAnswer === ComplianceResponseStatus.CANNOT_COMPLY}
                                            onChange={() => setAnswers({...answers, [r.id]: ComplianceResponseStatus.CANNOT_COMPLY})}
                                        />
                                        <span className="text-sm font-medium">Reject</span>
                                    </label>
                                </div>
                                <textarea 
                                    className="w-full text-sm border rounded p-2 outline-none"
                                    rows={2}
                                    placeholder="Add comment..."
                                    value={comments[r.id] || ''}
                                    onChange={(e) => setComments({...comments, [r.id]: e.target.value})}
                                />
                            </div>
                            </div>
                        </div>
                        );
                    })}
                </div>
            </div>
         ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 shadow-lg flex justify-end gap-3 z-30 md:pl-64">
         <button onClick={() => navigate('/compliance')} className="px-6 py-2 text-slate-600 hover:bg-slate-100 rounded font-medium">Cancel</button>
         <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded font-bold shadow-sm disabled:opacity-50 flex items-center gap-2">
            <Save size={18} /> {saving ? 'Saving...' : 'Save & Update Status'}
         </button>
      </div>
    </Layout>
  );
};

export default ComplianceRequestDetail;
