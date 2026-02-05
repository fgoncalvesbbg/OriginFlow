
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
import { AlertTriangle, CheckCircle, ShieldCheck, Calendar, Lock, ArrowRight, Loader2, Folder, Building, FileCheck, Clock, PenTool, Check, ChevronRight, X, HelpCircle } from 'lucide-react';

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

  // Filter and Sort State
  const [filterMode, setFilterMode] = useState<'all' | 'unanswered' | 'mandatory' | 'answered'>('unanswered');
  const [sortMode, setSortMode] = useState<'section' | 'mandatory'>('section');

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

      // Check if all "Cannot Confirm" responses have mandatory comments
      const cannotConfirmWithoutComments = requirements.filter(r =>
          answers[r.id] === ComplianceResponseStatus.CANNOT_COMPLY &&
          !comments[r.id]?.trim()
      );

      if (cannotConfirmWithoutComments.length > 0) {
          alert(`Please provide a comment for all "Cannot Confirm" responses. Missing comments for ${cannotConfirmWithoutComments.length} requirement(s).`);
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
          <div className="min-h-screen bg-light flex items-center justify-center p-4 font-sans text-primary">
              <div className="bg-white max-w-md w-full rounded-2xl shadow-xl overflow-hidden border border-gray-200 animate-in fade-in zoom-in duration-300">
                  <div className="bg-indigo-600 p-6 text-center">
                      <ShieldCheck className="w-12 h-12 text-white mx-auto mb-3 opacity-90" />
                      <h2 className="text-xl font-bold text-white">Compliance Portal</h2>
                      <p className="text-indigo-100 text-sm">Technical Compliance File Gateway</p>
                  </div>
                  <div className="p-8">
                      <form onSubmit={handleLogin}>
                          <div className="mb-6">
                              <label className="block text-xs font-bold text-muted uppercase tracking-wide mb-2">Security Access Code</label>
                              <div className="relative">
                                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                  <input 
                                    type="text" 
                                    autoFocus
                                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-center font-mono text-lg tracking-widest"
                                    placeholder="000000"
                                    maxLength={6}
                                    value={accessCodeInput}
                                    onChange={(e) => setAccessCodeInput(e.target.value.replace(/[^0-9]/g, ''))}
                                  />
                              </div>
                              <p className="text-[10px] text-gray-400 mt-2 text-center">Enter the 6-digit code from your TCF Invitation.</p>
                          </div>
                          {loginError && (
                              <div className="mb-6 bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs flex items-start gap-2">
                                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                  <span>{loginError}</span>
                              </div>
                          )}
                          <button type="submit" disabled={loading || accessCodeInput.length < 4} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                              {loading ? <Loader2 className="animate-spin" size={18} /> : <span>Access Portal <ArrowRight size={16} /></span>}
                          </button>
                      </form>
                  </div>
              </div>
          </div>
      );
  }

  if (loading && !submitted) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-light text-gray-400">
      <Loader2 className="animate-spin text-indigo-600 mb-4" size={32} />
      <p className="font-medium text-sm">Preparing checklist...</p>
    </div>
  );

  if (!req) return null;

  // Apply filters
  const filteredRequirements = requirements.filter(req => {
    const hasAnswer = !!answers[req.id];
    switch (filterMode) {
      case 'unanswered':
        return !hasAnswer;
      case 'answered':
        return hasAnswer;
      case 'mandatory':
        return req.isMandatory;
      case 'all':
      default:
        return true;
    }
  });

  // Apply sorting for mandatory-first mode
  const sortedRequirements = [...filteredRequirements].sort((a, b) => {
    if (sortMode === 'mandatory') {
      if (a.isMandatory !== b.isMandatory) {
        return a.isMandatory ? -1 : 1;
      }
    }
    return 0;
  });

  const groupedReqs = sortedRequirements.reduce((acc, r) => {
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

  // Calculate progress stats
  const totalReqs = requirements.length;
  const completedReqs = Object.keys(answers).length;
  const remainingReqs = totalReqs - completedReqs;
  const percentage = totalReqs > 0 ? Math.round((completedReqs / totalReqs) * 100) : 0;
  const unansweredCount = requirements.filter(r => !answers[r.id]).length;
  const answeredCount = completedReqs;
  const mandatoryCount = requirements.filter(r => r.isMandatory).length;

  // Tooltip Component
  const Tooltip: React.FC<{text: string, children: React.ReactNode}> = ({text, children}) => {
    const [show, setShow] = useState(false);

    return (
      <div className="relative inline-block">
        <button
          type="button"
          onMouseEnter={() => setShow(true)}
          onMouseLeave={() => setShow(false)}
          onClick={(e) => { e.preventDefault(); setShow(!show); }}
          className="text-gray-400 hover:text-indigo-600 transition-colors inline-flex items-center"
        >
          {children}
        </button>
        {show && (
          <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-normal">
            <div className="relative">
              {text}
              <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1">
                <div className="border-4 border-transparent border-t-gray-900" />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-light font-sans pb-20 text-primary">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2 rounded-xl text-indigo-700"><ShieldCheck size={24} /></div>
            <div>
                <h1 className="text-lg font-bold text-primary leading-tight">TCF Compliance Declaration</h1>
                <p className="text-[10px] text-muted font-mono">{req.requestId}</p>
            </div>
          </div>
          <div className="text-right">
             <div className="text-[10px] text-gray-400 uppercase tracking-wide font-bold">Project</div>
             <div className="text-sm font-bold text-gray-800">{req.projectName}</div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {submitted && (
            <div className="mb-8 bg-emerald-50 border border-emerald-200 rounded-xl p-10 text-center animate-in fade-in slide-in-from-top-4">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full text-emerald-600 mb-4"><CheckCircle size={32} /></div>
                <h1 className="text-3xl font-bold text-emerald-900 mb-2">Form Successfully Submitted</h1>
                <p className="text-emerald-800 max-w-md mx-auto">Your technical compliance response has been recorded. Our team will review the declaration.</p>
            </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow p-6 mb-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1"><Folder size={12}/> Product Category</div>
                <div className="font-medium text-primary">{category?.name || 'Standard'}</div>
            </div>
            <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1"><Calendar size={12}/> Global Deadline</div>
                <div className="font-medium">{req.deadline ? new Date(req.deadline).toLocaleDateString() : 'None'}</div>
            </div>
        </div>

        {/* Progress Overview Card */}
        {!submitted && (
          <div className="mb-6 bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <CheckCircle size={20} className="text-indigo-600" />
                Overall Progress
              </h3>
              <span className="text-2xl font-bold text-indigo-600">{percentage}%</span>
            </div>

            <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
              <div
                className="bg-gradient-to-r from-indigo-500 to-blue-500 h-3 rounded-full transition-all duration-500"
                style={{width: `${percentage}%`}}
              />
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-gray-800">{totalReqs}</div>
                <div className="text-xs text-gray-600 uppercase">Total</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-emerald-600">{completedReqs}</div>
                <div className="text-xs text-gray-600 uppercase">Completed</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-amber-600">{remainingReqs}</div>
                <div className="text-xs text-gray-600 uppercase">Remaining</div>
              </div>
            </div>
          </div>
        )}

        {/* Filter and Sort Bar */}
        {!submitted && (
          <div className="mb-6 bg-white border border-gray-200 rounded-xl shadow p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-700">Show:</span>

              <button
                onClick={() => setFilterMode('unanswered')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filterMode === 'unanswered'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Unanswered ({unansweredCount})
              </button>

              <button
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filterMode === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                All ({totalReqs})
              </button>

              <button
                onClick={() => setFilterMode('mandatory')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filterMode === 'mandatory'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Mandatory Only ({mandatoryCount})
              </button>

              <button
                onClick={() => setFilterMode('answered')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filterMode === 'answered'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Answered ({answeredCount})
              </button>

              <div className="h-6 w-px bg-gray-300 mx-1" />

              <span className="text-sm font-medium text-gray-700">Sort:</span>

              <button
                onClick={() => setSortMode('section')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  sortMode === 'section'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                By Section
              </button>

              <button
                onClick={() => setSortMode('mandatory')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  sortMode === 'mandatory'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Mandatory First
              </button>
            </div>
          </div>
        )}

        {/* Requirements Section - Read-only if submitted, editable otherwise */}
        <div className={`space-y-8 ${submitted ? 'opacity-60 pointer-events-none' : ''}`}>
                {sortedSections.map(section => {
                    const sectionReqs = groupedReqs[section];
                    const completedCount = sectionReqs.filter(r => answers[r.id]).length;
                    return (
                        <div key={section} className={`bg-white border rounded-xl shadow overflow-hidden ${submitted ? 'border-gray-100 bg-gray-50' : 'border-gray-200'}`}>
                            {/* Section Header with Progress */}
                            <div className="bg-gray-50 px-6 py-3 border-b border-gray-200 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Folder size={16} className="text-gray-400"/>
                                    <h3 className="font-bold text-gray-800 text-xs uppercase tracking-widest">{section}</h3>
                                </div>
                                <span className="text-xs font-bold text-gray-500">{completedCount} / {sectionReqs.length} Complete</span>
                            </div>

                            {/* Table Header */}
                            {/* Card-Based Layout */}
                            <div className="space-y-3 p-4">
                                {sectionReqs.map((r) => {
                                    const answer = answers[r.id];
                                    const borderColor = answer === ComplianceResponseStatus.COMPLY
                                        ? 'border-l-emerald-500'
                                        : answer === ComplianceResponseStatus.CANNOT_COMPLY
                                          ? 'border-l-rose-500'
                                          : 'border-l-transparent';
                                    const bgColor = answer === ComplianceResponseStatus.COMPLY
                                        ? 'bg-emerald-50/30'
                                        : answer === ComplianceResponseStatus.CANNOT_COMPLY
                                          ? 'bg-rose-50/30'
                                          : 'bg-white hover:bg-gray-50';

                                    return (
                                        <div
                                            key={r.id}
                                            className={`border-l-4 ${borderColor} ${bgColor} border border-gray-200 rounded-lg shadow-sm transition-all`}
                                        >
                                            <div className="p-4">
                                                {/* Header with Title and Buttons */}
                                                <div className="flex items-start justify-between gap-4 mb-3">
                                                    {/* Left: Title + Status */}
                                                    <div className="flex-1 flex items-start gap-3">
                                                        {/* Checkbox Status */}
                                                        <div
                                                            className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-1 transition-all ${
                                                                answer
                                                                    ? 'bg-indigo-600 border-indigo-600'
                                                                    : 'border-gray-300 bg-white'
                                                            }`}
                                                        >
                                                            {answer && <Check size={12} className="text-white" />}
                                                        </div>

                                                        {/* Title + Badges */}
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 flex-wrap mb-2">
                                                                <h4 className="font-semibold text-sm text-gray-800">{r.title}</h4>
                                                                {r.isMandatory && (
                                                                    <span className="text-[8px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold uppercase flex items-center gap-1">
                                                                        Required
                                                                        <Tooltip text="Required items MUST be completed for submission. Your response will be rejected if any required item is marked 'Cannot Confirm' without a valid business reason.">
                                                                            <HelpCircle size={10} />
                                                                        </Tooltip>
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Description */}
                                                            <p className="text-xs text-gray-600 leading-relaxed">{r.description}</p>
                                                        </div>
                                                    </div>

                                                    {/* Right: Response Buttons */}
                                                    <div className="flex gap-2 flex-shrink-0">
                                                        <button
                                                            onClick={() =>
                                                                !submitted &&
                                                                setAnswers({...answers, [r.id]: ComplianceResponseStatus.COMPLY})
                                                            }
                                                            disabled={submitted}
                                                            className={`flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                                                                answer === ComplianceResponseStatus.COMPLY
                                                                    ? 'bg-emerald-500 text-white'
                                                                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-emerald-50'
                                                            } ${submitted ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                        >
                                                            <Check size={14} />
                                                            Confirm
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                !submitted &&
                                                                setAnswers({
                                                                    ...answers,
                                                                    [r.id]: ComplianceResponseStatus.CANNOT_COMPLY
                                                                })
                                                            }
                                                            disabled={submitted}
                                                            className={`flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                                                                answer === ComplianceResponseStatus.CANNOT_COMPLY
                                                                    ? 'bg-rose-500 text-white'
                                                                    : 'bg-white border border-gray-300 text-gray-700 hover:bg-rose-50'
                                                            } ${submitted ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                        >
                                                            <X size={14} />
                                                            Cannot Confirm
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Rules Row with Tooltips */}
                                                <div className="flex items-center gap-4 text-xs text-gray-600 mb-2 flex-wrap">
                                                    {r.timingType && (
                                                        <div className="flex items-center gap-1">
                                                            <Clock size={12} className="text-amber-600" />
                                                            <span>
                                                                {r.timingType === 'POST_ETD'
                                                                    ? `ETD+${r.timingWeeks}w`
                                                                    : 'At ETD'}
                                                            </span>
                                                            <Tooltip text="This indicates when the test report or documentation must be completed relative to the Estimated Time of Delivery (ETD). 'At ETD' means it must be ready when the product ships. 'ETD+Xw' means X weeks after delivery.">
                                                                <HelpCircle size={12} />
                                                            </Tooltip>
                                                        </div>
                                                    )}
                                                    {r.testReportOrigin && (
                                                        <div className="flex items-center gap-1">
                                                            <Building size={12} className="text-blue-600" />
                                                            <span>
                                                                {r.testReportOrigin === 'supplier_inhouse'
                                                                    ? 'In-House'
                                                                    : '3rd Party'}
                                                            </span>
                                                            <Tooltip text="'In-House' means your own lab can perform the test. '3rd Party' means you must use an independent testing laboratory accredited for this specific test.">
                                                                <HelpCircle size={12} />
                                                            </Tooltip>
                                                        </div>
                                                    )}
                                                    {r.selfDeclarationAccepted !== undefined && (
                                                        <div className="flex items-center gap-1">
                                                            <FileCheck
                                                                size={12}
                                                                className={
                                                                    r.selfDeclarationAccepted
                                                                        ? 'text-green-600'
                                                                        : 'text-rose-600'
                                                                }
                                                            />
                                                            <span>
                                                                {r.selfDeclarationAccepted
                                                                    ? 'Self-Decl OK'
                                                                    : 'Lab Report Req'}
                                                            </span>
                                                            <Tooltip text="'Self-Decl OK' means you can provide a signed declaration confirming compliance without independent testing. 'Lab Report Req' means you must provide test results from a qualified laboratory.">
                                                                <HelpCircle size={12} />
                                                            </Tooltip>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Comment Section */}
                                                {answer === ComplianceResponseStatus.CANNOT_COMPLY && (
                                                    <div className="mt-3 pt-3 border-t border-gray-200">
                                                        <label className="block text-xs font-medium text-gray-700 mb-2">
                                                            Explanation Required <span className="text-rose-500">*</span>
                                                        </label>
                                                        <textarea
                                                            value={comments[r.id] || ''}
                                                            onChange={(e) =>
                                                                !submitted &&
                                                                setComments({...comments, [r.id]: e.target.value})
                                                            }
                                                            disabled={submitted}
                                                            className={`w-full px-3 py-2 text-xs border rounded-lg ${
                                                                !comments[r.id]?.trim()
                                                                    ? 'border-rose-300 bg-rose-50'
                                                                    : 'border-gray-300'
                                                            } focus:ring-2 focus:ring-indigo-500 outline-none resize-none`}
                                                            rows={2}
                                                            placeholder="Please explain why you cannot confirm this requirement..."
                                                        />
                                                        {!comments[r.id]?.trim() && (
                                                            <p className="text-xs text-rose-600 mt-1">
                                                                Comment is required for "Cannot Confirm" responses
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}

                <div className={`bg-white border rounded-xl shadow p-8 mt-8 ${submitted ? 'border-gray-100 bg-gray-50' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-2 mb-6 pb-2 border-b border-gray-100"><PenTool className={submitted ? 'text-gray-400' : 'text-indigo-600'} size={20} /><h3 className={`font-bold ${submitted ? 'text-gray-400' : 'text-gray-800'}`}>Final Declaration</h3></div>
                    <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 ${submitted ? 'opacity-60' : ''}`}>
                        <div>
                            <label className="block text-xs font-bold text-muted uppercase mb-1">Full Name <span className="text-red-500">*</span></label>
                            <input type="text" disabled={submitted} className={`w-full border rounded p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none ${submitted ? 'bg-gray-100 border-gray-100 cursor-not-allowed' : 'border-gray-300'}`} placeholder="Name of representative" value={respondentName} onChange={(e) => !submitted && setRespondentName(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-muted uppercase mb-1">Position <span className="text-red-500">*</span></label>
                            <input type="text" disabled={submitted} className={`w-full border rounded p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none ${submitted ? 'bg-gray-100 border-gray-100 cursor-not-allowed' : 'border-gray-300'}`} placeholder="e.g. Quality Manager" value={respondentPosition} onChange={(e) => !submitted && setRespondentPosition(e.target.value)} />
                        </div>
                    </div>
                </div>

                {!submitted && (
                    <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4 -mx-6 px-6 mt-12 shadow-[0_-10px_20px_-5px_rgba(0,0,0,0.05)] flex justify-between items-center z-10">
                        <div className="flex items-center gap-3">
                          <div className="w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-600 transition-all duration-700" style={{ width: `${requirements.length ? (requirements.filter(r => answers[r.id]).length / requirements.length) * 100 : 100}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-muted uppercase tracking-wide">{requirements.filter(r => answers[r.id]).length} / {requirements.length} Items Done</span>
                        </div>
                        <button onClick={handleSubmit} disabled={loading || (requirements.length > 0 && requirements.filter(r => answers[r.id]).length < requirements.length)} className="bg-indigo-600 text-white px-10 py-3 rounded-xl font-bold hover:bg-indigo-700 shadow-lg transition-all disabled:opacity-50 disabled:bg-gray-200 flex items-center gap-2">
                            {loading ? <Loader2 className="animate-spin" size={18} /> : <><CheckCircle size={18}/> Submit Response</>}
                        </button>
                    </div>
                )}
            </div>
      </main>
    </div>
  );
};

export default SupplierCompliancePortal;
