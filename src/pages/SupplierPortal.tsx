
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getProjectByToken, getProjectSteps, getProjectDocs, uploadFile, uploadAdHocFile } from '../services/apiService';
import { Project, ProjectStep, ProjectDocument, DocStatus, ResponsibleParty } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { UploadCloud, FileText, CheckCircle, AlertCircle, Clock, Lock, Paperclip, Upload } from 'lucide-react';

const SupplierPortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [steps, setSteps] = useState<ProjectStep[]>([]);
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Upload State
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<'standard' | 'adhoc'>('standard');
  const [adHocStepNumber, setAdHocStepNumber] = useState(1);

  useEffect(() => {
    if (!token) {
      setError("Invalid link.");
      setLoading(false);
      return;
    }

    let mounted = true;
    const controller = new AbortController();

    const load = async () => {
      try {
        const p = await getProjectByToken(token);

        if (!mounted || controller.signal.aborted) return;

        if (!p) {
          setError("Project not found or link expired.");
          setLoading(false);
          return;
        }

        const [stepsData, docsData] = await Promise.all([
          getProjectSteps(p.id),
          getProjectDocs(p.id)
        ]);

        if (!mounted || controller.signal.aborted) return;

        // Filter only visible docs
        const visibleDocs = docsData.filter(d => d.isVisibleToSupplier);

        setProject(p);
        setSteps(stepsData);
        setDocs(visibleDocs);
        setLoading(false);
      } catch (err: any) {
        if (!mounted || controller.signal.aborted) return;
        if (err.name === 'AbortError') {
          console.debug('Portal load cancelled');
          return;
        }
        console.error('Portal load error:', err);
        setError("Failed to load portal. Please refresh the page.");
        setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [token]);

  const triggerUpload = (docId: string) => {
    setUploadingId(docId);
    setUploadType('standard');
    if (fileInputRef.current) {
        fileInputRef.current.value = '';
        fileInputRef.current.click();
    }
  };

  const triggerAdHocUpload = (stepNumber: number) => {
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
        if (uploadType === 'standard' && uploadingId) {
            try {
                const updatedDoc = await uploadFile(uploadingId, file, true);
                setDocs(docs.map(d => d.id === uploadingId ? updatedDoc : d));
            } catch (e) {
                alert("Upload failed. Please try again.");
            } finally {
                setUploadingId(null);
            }
        } else if (uploadType === 'adhoc' && project) {
            try {
                const newDoc = await uploadAdHocFile(project.id, adHocStepNumber, file, true);
                setDocs([...docs, newDoc]);
            } catch (e) {
                alert("Upload failed. Please try again.");
            }
        }
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-light text-muted">Loading Portal...</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center bg-light text-red-500 font-medium">{error}</div>;
  if (!project) return null;

  return (
    <div className="min-h-screen bg-light font-sans">
      {/* Hidden Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        onChange={handleFileChange} 
      />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold text-primary">{project.name}</h1>
            <p className="text-xs text-muted">Project ID: {project.projectId}</p>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-xs font-medium text-muted uppercase tracking-wide">Requested by</div>
            <div className="font-semibold text-gray-800">OriginFlow Partner</div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        
        <div className="mb-8 bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="text-indigo-600 shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="text-sm font-bold text-blue-900">Action Required</h3>
            <p className="text-sm text-blue-800 mt-1">
              Please upload the documents requested below. Pay attention to the deadlines. 
              Documents marked "Rejected" require correction and re-upload.
            </p>
          </div>
        </div>

        <div className="space-y-8">
          {steps.map(step => {
            const rawStepDocs = docs.filter(d => d.stepNumber === step.stepNumber);
            if (rawStepDocs.length === 0) return null;

            const othersPlaceholder = rawStepDocs.find(d => d.title === 'Others' && d.description !== 'ad-hoc');
            const adHocDocs = rawStepDocs.filter(d => d.description === 'ad-hoc');
            const standardDocs = rawStepDocs.filter(d => d.title !== 'Others' && d.description !== 'ad-hoc');

            // Display standard -> ad-hoc -> placeholder (rendered separately)
            const mainDocs = [...standardDocs, ...adHocDocs];

            return (
              <div key={step.id} className="bg-white rounded-xl border border-gray-200 shadow overflow-hidden">
                <div className="bg-light px-6 py-3 border-b border-gray-200">
                  <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
                    Step {step.stepNumber}: {step.name}
                  </h2>
                </div>

                <div className="divide-y divide-slate-100">
                  {mainDocs.map(doc => {
                    const isMyResponsibility = doc.responsibleParty === ResponsibleParty.SUPPLIER || doc.description === 'ad-hoc';
                    const isRejected = doc.status === DocStatus.REJECTED;
                    const isApproved = doc.status === DocStatus.APPROVED;
                    const isAdHoc = doc.description === 'ad-hoc';

                    return (
                      <div key={doc.id} className={`p-6 flex flex-col md:flex-row gap-6 ${isApproved ? 'bg-emerald-50/30' : ''}`}>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-2">
                             <StatusBadge status={doc.status} type="doc" />
                             {doc.deadline && (
                               <span className={`text-xs font-medium flex items-center gap-1 ${isApproved ? 'text-gray-400' : 'text-amber-600'}`}>
                                 <Clock size={14} /> Due: {doc.deadline}
                               </span>
                             )}
                          </div>
                          <div className="flex items-center gap-2 mb-1">
                             <h3 className={`font-semibold text-lg ${isApproved ? 'text-emerald-900' : 'text-primary'}`}>{doc.title}</h3>
                             {isApproved && <Lock size={14} className="text-emerald-600" />}
                             {isAdHoc && <span className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded border">Extra File</span>}
                          </div>
                          <p className="text-sm text-muted mb-3">{doc.description !== 'ad-hoc' ? doc.description || "Please provide the requested document." : "Additional file."}</p>
                          
                          {isRejected && doc.supplierComment && (
                            <div className="bg-rose-50 border border-rose-100 p-3 rounded text-sm text-rose-800 mt-3">
                              <strong>Correction Needed:</strong> {doc.supplierComment}
                            </div>
                          )}
                        </div>

                        <div className="w-full md:w-72 shrink-0 flex flex-col justify-center bg-light rounded-xl border border-gray-100 p-4">
                          {isMyResponsibility ? (
                            <>
                              {isApproved ? (
                                <div className="text-center py-4 text-emerald-700 bg-emerald-50 rounded border border-emerald-100">
                                   <CheckCircle className="mx-auto mb-2" size={32} />
                                   <p className="text-sm font-bold">Document Approved</p>
                                   <p className="text-xs opacity-80 mt-1">No further changes allowed.</p>
                                   {doc.fileUrl && (
                                     <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-emerald-700 underline">Download</a>
                                   )}
                                </div>
                              ) : doc.fileUrl && !isRejected ? (
                                <div className="text-center">
                                   <CheckCircle className="mx-auto text-emerald-500 mb-2" size={32} />
                                   <p className="text-sm font-medium text-primary">File Uploaded</p>
                                   <p className="text-xs text-muted mt-1 mb-3">
                                     Uploaded on {new Date(doc.uploadedAt!).toLocaleDateString()}
                                   </p>
                                   {!isAdHoc && (
                                     <label className="block w-full text-center py-2 px-4 border border-gray-300 rounded bg-white hover:bg-light text-sm cursor-pointer transition-colors">
                                        Replace File
                                        <input 
                                          type="file" 
                                          className="hidden" 
                                          onChange={(e) => e.target.files?.[0] && triggerUpload(doc.id)} 
                                        />
                                     </label>
                                   )}
                                   {isAdHoc && (
                                      <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="block w-full text-center py-2 px-4 border border-gray-300 rounded bg-white hover:bg-light text-sm transition-colors">
                                        View File
                                      </a>
                                   )}
                                </div>
                              ) : (
                                <div className="text-center">
                                  <button onClick={() => triggerUpload(doc.id)} className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${isRejected ? 'border-red-300 bg-rose-50 hover:bg-rose-100' : 'border-gray-300 bg-white hover:bg-indigo-50 hover:border-indigo-300'}`}>
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                        {uploadingId === doc.id ? (
                                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                                        ) : (
                                          <>
                                            <UploadCloud className={`w-8 h-8 mb-2 ${isRejected ? 'text-red-400' : 'text-gray-400'}`} />
                                            <p className="text-sm text-muted font-medium">Click to upload</p>
                                            <p className="text-xs text-gray-400">PDF, JPG, PNG</p>
                                          </>
                                        )}
                                    </div>
                                  </button>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-center py-4 text-gray-400">
                              <FileText className="mx-auto mb-2 opacity-50" size={32} />
                              <p className="text-sm">Internal Document</p>
                              <p className="text-xs opacity-70">(View Only)</p>
                              {doc.fileUrl && (
                                <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-indigo-600 hover:underline">Download</a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* OTHERS PLACEHOLDER */}
                  {othersPlaceholder && (
                     <div className="p-6 bg-indigo-50/30 border-t border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-3">
                           <div className="p-2 bg-indigo-100 rounded text-indigo-600">
                             <Paperclip size={20} />
                           </div>
                           <div>
                              <h4 className="text-sm font-bold text-gray-800">Others / Additional Files</h4>
                              <p className="text-xs text-muted">Need to send more files? Upload them here.</p>
                           </div>
                        </div>
                        <button 
                          onClick={() => triggerAdHocUpload(step.stepNumber)}
                          className="flex items-center gap-2 bg-white border border-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-sm font-medium shadow hover:bg-indigo-50 hover:border-indigo-300 transition-all"
                        >
                          <Upload size={16} /> Upload Extra File
                        </button>
                     </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
      
      <footer className="bg-white border-t border-gray-200 mt-12 py-8">
         <div className="max-w-5xl mx-auto px-6 text-center text-sm text-gray-400">
           &copy; 2025 OriginFlow PLM. Secure Document Portal.
         </div>
      </footer>
    </div>
  );
};

export default SupplierPortal;
