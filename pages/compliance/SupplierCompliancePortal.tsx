
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { 
  verifySupplierAccess, submitComplianceResponseSecure,
  getComplianceRequirements, getProductFeatures, getCategories,
  COMPLIANCE_SECTIONS
} from '../../services/apiService';
import { 
  ComplianceRequest, ComplianceRequirement, ProductFeature, 
  CategoryL3, ComplianceResponseItem, ComplianceResponseStatus, ComplianceRequestStatus
} from '../../types';
import { AlertTriangle, CheckCircle, ShieldCheck, Calendar, Box, Lock, ArrowRight, Loader2, Folder, Building, FileCheck, Clock, PenTool, Info, RefreshCw } from 'lucide-react';

const SupplierCompliancePortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // Data State
  const [req, setReq] = useState<ComplianceRequest | null>(null);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [category, setCategory] = useState<CategoryL3 | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  // Form State
  const [answers, setAnswers] = useState<Record<string, ComplianceResponseStatus>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [respondentName, setRespondentName] = useState('');
  const [respondentPosition, setRespondentPosition] = useState('');

  const handleLogin = async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      
      if (!token || accessCodeInput.length < 4) return;
      
      setLoginError('');
      setLoading(true);
      
      try {
          const requestData = await verifySupplierAccess(token, accessCodeInput.trim());
          setReq(requestData);
          if (['submitted', 'approved', 'rejected'].includes(requestData.status)) {
              setSubmitted(true);
          }
          if (requestData.respondentName) setRespondentName(requestData.respondentName);
          if (requestData.respondentPosition) setRespondentPosition(requestData.respondentPosition);

          await loadPortalDependencies(requestData);
          setIsAuthenticated(true);
          setLoading(false);
      } catch (err: any) {
          console.error("[Portal] Login failed:", err);
          const isAbort = err.name === 'AbortError' || err.message?.includes('aborted');
          const isNotFound = err.message?.includes('Invalid credentials') || err.message?.includes('PGRST116');

          if (isAbort) {
              setLoginError("Connection interrupted. Please try clicking the button again.");
          } else if (isNotFound) {
              setLoginError("Invalid Access Code. Please check your invitation email.");
          } else {
              setLoginError(err.message || "An unexpected error occurred.");
          }
          setLoading(false);
      }
  };

  const loadPortalDependencies = async (requestData: ComplianceRequest) => {
      try {
          const [allReqs, allCats] = await Promise.all([
            getComplianceRequirements(),
            getCategories()
          ]);

          const cat = allCats.find(c => c.id === requestData.categoryId);
          setCategory(cat || null);
          
          const applicableReqs = allReqs.filter(requirement => {
            if (requirement.categoryId !== requestData.categoryId) return false;

            if (requirement.appliesByDefault && (!requirement.conditionFeatureIds || requirement.conditionFeatureIds.length === 0)) {
                return true;
            }
            
            const featureList = requestData.features || [];
            return (requirement.conditionFeatureIds || []).some(fid => {
                const matchedFeature = featureList.find(f => f.featureId === fid);
                return matchedFeature?.value === true;
            });
          });
          
          setRequirements(applicableReqs);

          const initialAnswers: Record<string, ComplianceResponseStatus> = {};
          const initialComments: Record<string, string> = {};
          (requestData.responses || []).forEach(resp => {
            initialAnswers[resp.requirementId] = resp.status;
            if (resp.comment) initialComments[resp.requirementId] = resp.comment;
          });
          setAnswers(initialAnswers);
          setComments(initialComments);
          
      } catch (e: any) {
          console.error("[Portal] Dependency load error:", e.message);
          throw new Error("Credentials verified, but failed to load requirement library. " + e.message);
      }
  };

  const handleSubmit = async () => {
      if (!req || !token) return;
      if (!respondentName.trim() || !respondentPosition.trim()) {
          alert("Please complete the Final Declaration (Name and Position) before submitting.");
          return;
      }

      const allAnswered = requirements.every(r => answers[r.id]);
      if (!allAnswered) {
          alert("Please provide a response (Confirm or Cannot Confirm) for every requirement.");
          return;
      }

      if (!confirm("Confirm submission? You cannot edit your responses once submitted.")) return;

      setLoading(true);
      try {
          const responseItems: ComplianceResponseItem[] = requirements.map(r => ({
              requirementId: r.id,
              status: answers[r.id],
              comment: comments[r.id]
          }));

          await submitComplianceResponseSecure(
              token, 
              accessCodeInput.trim(), 
              responseItems, 
              ComplianceRequestStatus.SUBMITTED,
              respondentName,
              respondentPosition
          );
          setSubmitted(true);
          window.scrollTo(0, 0);
      } catch (e: any) {
          console.error("[Portal] Submission Error:", e);
          alert("Failed to submit: " + e.message);
      } finally {
          setLoading(false);
      }
  };

  if (!isAuthenticated) {
      return (
          <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
              <div className="bg-white max-w-md w-full rounded-2xl shadow-xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-300">
                  <div className="bg-blue-600 p-6 text-center">
                      <ShieldCheck className="w-12 h-12 text-white mx-auto mb-3 opacity-90" />
                      <h2 className="text-xl font-bold text-white">Compliance Portal</h2>
                      <p className="text-blue-100 text-sm">Technical Compliance File Gateway</p>
                  </div>
                  <div className="p-8">
                      <form onSubmit={handleLogin}>
                          <div className="mb-6">
                              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Security Access Code</label>
                              <div className="relative">
                                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                  <input 
                                    type="text" 
                                    autoFocus
                                    className="w-full pl-10 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all text-center font-mono text-lg tracking-widest"
                                    placeholder="000000"
                                    maxLength={6}
                                    value={accessCodeInput}
                                    onChange={(e) => setAccessCodeInput(e.target.value.replace(/[^0-9]/g, ''))}
                                  />
                              </div>
                              <p className="text-[10px] text-slate-400 mt-2 text-center">Enter the 6-digit code from your TCF Invitation.</p>
                          </div>
                          {loginError && (
                              <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-lg text-xs flex items-start gap-2">
                                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                  <span>{loginError}</span>
                              </div>
                          )}
                          <button type="submit" disabled={loading || accessCodeInput.length < 4} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                              {loading ? <Loader2 className="animate-spin" size={18} /> : <span>Access Portal <ArrowRight size={16} /></span>}
                          </button>
                      </form>
                  </div>
              </div>
          </div>
      );
  }

  if (loading && !submitted) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-400">
      <Loader2 className="animate-spin text-blue-600 mb-4" size={32} />
      <p className="font-medium text-sm">Preparing checklist...</p>
    </div>
  );

  if (!req) return null;

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
    <div className="min-h-screen bg-slate-50 font-sans pb-20 text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg text-blue-700"><ShieldCheck size={24} /></div>
            <div>
                <h1 className="text-lg font-bold text-slate-900 leading-tight">TCF Compliance Declaration</h1>
                <p className="text-[10px] text-slate-500 font-mono">{req.requestId}</p>
            </div>
          </div>
          <div className="text-right">
             <div className="text-[10px] text-slate-400 uppercase tracking-wide font-bold">Project</div>
             <div className="text-sm font-bold text-slate-800">{req.projectName}</div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {submitted && (
            <div className="mb-8 bg-green-50 border border-green-200 rounded-xl p-10 text-center animate-in fade-in slide-in-from-top-4">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full text-green-600 mb-4"><CheckCircle size={32} /></div>
                <h2 className="text-2xl font-bold text-green-900 mb-2">Form Successfully Submitted</h2>
                <p className="text-green-800 max-w-md mx-auto">Your technical compliance response has been recorded. Our team will review the declaration.</p>
            </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1"><Folder size={12}/> Product Category</div>
                <div className="font-medium text-slate-900">{category?.name || 'Standard'}</div>
            </div>
            <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1"><Calendar size={12}/> Global Deadline</div>
                <div className="font-medium">{req.deadline ? new Date(req.deadline).toLocaleDateString() : 'None'}</div>
            </div>
        </div>

        {!submitted && (
            <div className="space-y-8">
                {sortedSections.map(section => (
                    <div key={section} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center gap-2">
                            <Folder size={16} className="text-slate-400"/>
                            <h3 className="font-bold text-slate-800 text-xs uppercase tracking-widest">{section}</h3>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {groupedReqs[section].map(r => {
                                const answer = answers[r.id];
                                return (
                                    <div key={r.id} className="p-6 hover:bg-slate-50/30 transition-colors">
                                        <div className="flex flex-col md:flex-row gap-6">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h4 className="font-bold text-slate-900 text-sm">{r.title}</h4>
                                                    {r.isMandatory && <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase">Mandatory</span>}
                                                </div>
                                                <p className="text-xs text-slate-600 mb-4 leading-relaxed">{r.description}</p>
                                                
                                                {/* Unified Rules Summary Block */}
                                                <div className="bg-slate-100/60 p-3 rounded-lg border border-slate-200 flex flex-wrap gap-x-8 gap-y-3 items-center">
                                                    <div className="flex items-center gap-2 min-w-[130px]">
                                                        <Clock size={14} className="text-slate-400" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight leading-none mb-0.5">Timing</span>
                                                            <span className="text-xs font-bold text-slate-700">{r.timingType === 'POST_ETD' ? `Deferred (${r.timingWeeks}w post-ETD)` : 'Mandatory at ETD'}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 min-w-[150px]">
                                                        <Building size={14} className="text-slate-400" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight leading-none mb-0.5">Report Origin</span>
                                                            <span className="text-xs font-bold text-slate-700">{r.testReportOrigin === 'supplier_inhouse' ? 'Supplier In-House OK' : '3rd Party Lab (Mandatory)'}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 min-w-[150px]">
                                                        <FileCheck size={14} className="text-slate-400" />
                                                        <div className="flex flex-col">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tight leading-none mb-0.5">Declaration Status</span>
                                                            <span className="text-xs font-bold text-slate-700">{r.selfDeclarationAccepted ? 'Accepted' : 'Lab Report Required'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="w-full md:w-72 shrink-0 space-y-3 pt-2">
                                                <div className="flex gap-2">
                                                    <button onClick={() => setAnswers({...answers, [r.id]: ComplianceResponseStatus.COMPLY})} className={`flex-1 py-2 text-xs font-bold rounded border transition-all ${answer === ComplianceResponseStatus.COMPLY ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-300 hover:border-green-400'}`}>Confirm</button>
                                                    <button onClick={() => setAnswers({...answers, [r.id]: ComplianceResponseStatus.CANNOT_COMPLY})} className={`flex-1 py-2 text-xs font-bold rounded border transition-all ${answer === ComplianceResponseStatus.CANNOT_COMPLY ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-300 hover:border-green-400'}`}>Cannot Confirm</button>
                                                </div>
                                                <textarea className="w-full text-xs border border-slate-200 rounded p-2 focus:ring-1 focus:ring-blue-500 outline-none" placeholder="Notes (Optional)..." rows={2} value={comments[r.id] || ''} onChange={(e) => setComments({...comments, [r.id]: e.target.value})} />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 mt-8">
                    <div className="flex items-center gap-2 mb-6 pb-2 border-b border-slate-100"><PenTool className="text-blue-600" size={20} /><h3 className="font-bold text-slate-800">Final Declaration</h3></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name <span className="text-red-500">*</span></label>
                            <input type="text" className="w-full border border-slate-300 rounded p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Name of representative" value={respondentName} onChange={(e) => setRespondentName(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Position <span className="text-red-500">*</span></label>
                            <input type="text" className="w-full border border-slate-300 rounded p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. Quality Manager" value={respondentPosition} onChange={(e) => setRespondentPosition(e.target.value)} />
                        </div>
                    </div>
                </div>

                <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 -mx-6 px-6 mt-12 shadow-[0_-10px_20px_-5px_rgba(0,0,0,0.05)] flex justify-between items-center z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-600 transition-all duration-700" style={{ width: `${requirements.length ? (requirements.filter(r => answers[r.id]).length / requirements.length) * 100 : 100}%` }} />
                      </div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{requirements.filter(r => answers[r.id]).length} / {requirements.length} Items Done</span>
                    </div>
                    <button onClick={handleSubmit} disabled={loading || (requirements.length > 0 && requirements.filter(r => answers[r.id]).length < requirements.length)} className="bg-blue-600 text-white px-10 py-3 rounded-lg font-bold hover:bg-blue-700 shadow-lg transition-all disabled:opacity-50 disabled:bg-slate-200 flex items-center gap-2">
                        {loading ? <Loader2 className="animate-spin" size={18} /> : <><CheckCircle size={18}/> Submit Response</>}
                    </button>
                </div>
            </div>
        )}
      </main>
    </div>
  );
};

export default SupplierCompliancePortal;
