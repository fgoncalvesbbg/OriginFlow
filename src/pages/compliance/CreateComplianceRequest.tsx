/** Form page for creating a new compliance request for a supplier/category. */
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import {
  getProjects, getSuppliers, getCategories, createComplianceRequest,
  getComplianceRequirements, isConditional,
  getRegulations, collectBlocks, getComplianceRequests,
} from '../../services';
import { Project, Supplier, CategoryL3, ComplianceRequirement, Regulation } from '../../types';
import { CategorySelect } from '../../components/common/CategorySelect';
import { getRequirementsForCategory } from '../../utils';
import TcfQuestionWizard from './TcfQuestionWizard';
import { AlertCircle, ArrowLeft, Loader2, Lock, ListChecks, Scale } from 'lucide-react';

/**
 * A human-readable TCF request id, e.g. "TCF-2026-483920".
 *
 * `requestId` has no DB-level uniqueness constraint — it is a display label, not the
 * routing key (that's the row's `id`) — so a collision would not break anything
 * structurally, but it WOULD show two different requests under the same label on reports,
 * emails and filenames. Guarded two ways: a 6-digit random component (a million-wide space,
 * versus the previous 4-digit one) and an explicit check against every request id already
 * in the system, retried until clear. The year is read live rather than hardcoded, so this
 * does not go stale the way the previous constant did after 2025.
 */
const generateRequestId = (existingIds: ReadonlySet<string>): string => {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
    const candidate = `TCF-${year}-${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  // Implausible at a million-wide space, but never emit a known duplicate: fall back to a
  // component derived from the clock, which nothing else in this batch can also draw.
  return `TCF-${year}-${Date.now().toString(36).toUpperCase()}`;
};

const CreateComplianceRequest: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Data State
  const [projects, setProjects] = useState<Project[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /**
   * What the TCF question wizard decided (migration 174): the answers, and the requirement
   * set they formulated. Both are frozen onto the request on submit.
   *
   * Null until the wizard has been run. It is REQUIRED whenever the category has any
   * conditional requirement — the whole point is that a human answers the questions rather
   * than the screen guessing — and skipped entirely when nothing is conditional.
   *
   * Replaces the old `condValues` map of category-attribute answers. That version read its
   * required-answer list from the CONDITIONS but rendered its input fields from the surviving
   * ATTRIBUTES, so once the attributes were deleted there was a required answer with no field
   * to type it in and the Create button stayed disabled with nothing explaining why.
   */
  const [wizardResult, setWizardResult] = useState<
    { answers: Record<string, string>; requirementIds: string[] } | null
  >(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Form State
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || '');
  const [projectName, setProjectName] = useState('');
  const [requestId, setRequestId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        // Load data in parallel. We wrap each in a catch to log errors but ideally allow others to succeed if possible,
        // though for this form most are critical.
        // Category attributes are deliberately NOT loaded any more: TCF conditions gate on
        // compliance_questions (migration 174), and the wizard reads those itself.
        const [pData, sData, cData, rData, regData, existingRequests] = await Promise.all([
           getProjects(),
           getSuppliers(),
           getCategories(),
           getComplianceRequirements(),
           getRegulations(),
           getComplianceRequests(),
        ]);

        setProjects(pData);
        setSuppliers(sData);
        setCategories(cData);
        setRequirements(rData);
        setRegulations(regData);
        setRequestId(generateRequestId(new Set(existingRequests.map(r => r.requestId))));

      } catch (err: any) {
        console.error("Critical load error", err);
        setError("Failed to load required data. Please refresh.");
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Separate effect to handle pre-filling once projects are loaded
  useEffect(() => {
    const targetId = searchParams.get('projectId') || selectedProjectId;
    if (targetId && projects.length > 0) {
        const proj = projects.find(p => p.id === targetId);
        if (proj) {
            // Only update if not already set or if explicitly different to avoid loops
            if (selectedProjectId !== targetId) setSelectedProjectId(targetId);
            if (!projectName) setProjectName(proj.name);
            if (!supplierId) setSupplierId(proj.supplierId);
            // The project already has a category — prefill it, but only if nothing has
            // been chosen yet, so this never clobbers a deliberate change.
            if (!categoryId && proj.categoryId) setCategoryId(proj.categoryId);
        }
    }
  }, [projects, searchParams, selectedProjectId]); // Depend on projects loading

  // ---------------------------------------------------------------------------
  // Conditional requirements — what the wizard has to decide (migration 174)
  // ---------------------------------------------------------------------------
  /** Everything that reaches this category: owned, global, and shared with it (migration 173). */
  const candidates = useMemo(
    () => (categoryId ? getRequirementsForCategory(requirements, categoryId) : []),
    [requirements, categoryId],
  );
  /** Whether anything here is gated at all. Nothing conditional means no wizard to run. */
  const hasConditional = useMemo(() => candidates.some(isConditional), [candidates]);
  /**
   * The wizard is required exactly when something is conditional. Its answers decide what a
   * supplier is legally asked for, so the screen never guesses them and never silently
   * excludes a gated requirement — the two failure modes of the version this replaced.
   */
  const needsWizard = hasConditional && !wizardResult;

  /**
   * Expired regulations behind the requirements this request would carry (migration 140).
   *
   * Deliberately scoped to the CATEGORY, not to the conditions: a conditional requirement
   * that today's attribute values happen to exclude is still part of what this request
   * means, and a supplier can be asked for it later. Blocking on the wider set is the
   * cautious direction, and the message names the regulation either way.
   *
   * A request already sent is NOT affected — the supplier did nothing wrong, and stranding
   * their work to signal an internal library problem is the wrong trade. The internal
   * request detail flags those instead.
   */
  const regulationBlocks = useMemo(() => {
    if (!categoryId) return [];
    const byId = new Map(regulations.map(r => [r.id, r]));
    const cited = getRequirementsForCategory(requirements, categoryId)
      .map(r => (r.regulationId ? byId.get(r.regulationId) : null));
    return collectBlocks(cited, regulations);
  }, [categoryId, requirements, regulations]);

  /**
   * Changing the project or the category invalidates the wizard's answers.
   *
   * The formulated set belongs to one category's requirements; keeping it across a category
   * change would send a supplier a list assembled for a different product family — the
   * quietest possible way to get a compliance request wrong.
   *
   * Note there is no SKU prefill any more. The old version prefilled category-attribute
   * values from the project when every SKU agreed, which cannot carry over: a TCF question
   * ("Does it transmit radio?") is deliberately not a PIM field, so there is nothing to read
   * it from. Convenience was the whole benefit and a wrongly-prefilled compliance answer is
   * the whole cost.
   */
  useEffect(() => {
    setWizardResult(null);
  }, [categoryId, selectedProjectId]);

  const handleProjectSelect = (pid: string) => {
    setSelectedProjectId(pid);
    const proj = projects.find(p => p.id === pid);
    if (proj) {
      setProjectName(proj.name);
      setSupplierId(proj.supplierId);
      // Prefill from the project's own category — still editable afterwards, this just
      // saves re-entering a fact the project record already holds.
      if (proj.categoryId) setCategoryId(proj.categoryId);
    } else {
       if (pid === '') {
           // Clear if unselected
           setProjectName('');
           setSupplierId('');
       }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsWizard) {
        alert('Answer the applicability questions first — they decide which requirements this supplier is asked for.');
        setWizardOpen(true);
        return;
    }
    // Guarded here as well as on the disabled button: this handler is the one that actually
    // writes the request, and a gate that only lives in a disabled attribute is not a gate.
    if (regulationBlocks.length > 0) {
        alert(
            [
                'This request cannot be created yet:',
                '',
                ...regulationBlocks.map(b => `• ${b.message}`),
                '',
                'Fix it in the Regulations library, then come back.',
            ].join('\n'),
        );
        return;
    }
    setSubmitting(true);

    try {
        // Both halves of the wizard's output are stored: the answers as the EVIDENCE, and the
        // requirement ids as the SET. With nothing conditional there is no wizard, and the
        // set is simply everything that applies by default.
        const answers = wizardResult?.answers ?? {};
        const requirementIds = wizardResult?.requirementIds
            ?? candidates.filter(r => r.appliesByDefault !== false).map(r => r.id);
        const created = await createComplianceRequest(
            selectedProjectId, projectName, requestId, supplierId, categoryId, [],
            deadline || undefined, answers, requirementIds,
        );

        // Land on the request just created, not the project — otherwise the operator has
        // to re-find it (it was buried in the project's own compliance list before).
        navigate(`/compliance/request/${created.id}`);
    } catch (e: any) {
        console.error("Submit Error:", e);
        // Fix: Stringify object if message is not present
        const msg = e.message || (typeof e === 'object' ? JSON.stringify(e, Object.getOwnPropertyNames(e)) : String(e));
        alert(`Error creating request: ${msg}`);
        setSubmitting(false);
    }
  };

  if (loading) return (
      <Layout>
          <div className="flex flex-col items-center justify-center h-64 text-muted">
              <Loader2 className="animate-spin mb-2" size={32} />
              <p>Loading projects & templates...</p>
          </div>
      </Layout>
  );

  if (error) return (
      <Layout>
          <div className="flex flex-col items-center justify-center h-64 text-red-500">
              <AlertCircle className="mb-2" size={32} />
              <p>{error}</p>
              <button onClick={() => window.location.reload()} className="mt-4 text-indigo-600 underline">Retry</button>
          </div>
      </Layout>
  );

  return (
    <Layout>
      {wizardOpen && categoryId && (
        <TcfQuestionWizard
          candidates={candidates}
          categoryName={categories.find(c => c.id === categoryId)?.name ?? 'This category'}
          /* Re-opening keeps what was already answered, so "Review answers" is a review and
             not a re-type. */
          initialAnswers={wizardResult?.answers}
          onClose={() => setWizardOpen(false)}
          onComplete={result => { setWizardResult(result); setWizardOpen(false); }}
        />
      )}

      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center text-muted hover:text-gray-800 mb-6 text-sm">
          <ArrowLeft size={16} className="mr-1" /> Back
        </button>

        <h1 className="text-3xl font-bold text-primary mb-6">Create TCF Request</h1>
        
        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow border border-gray-200 space-y-6">
          
          <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex gap-3 items-start text-sm text-blue-800 mb-6">
             <Lock size={18} className="shrink-0 mt-0.5" />
             <div>
               <span className="font-bold">Security Note:</span> A random 6-digit Access Code will be generated automatically. You must share this code with the supplier along with the link.
             </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             <div className="col-span-2">
               <label className="block text-sm font-medium text-gray-700 mb-1">Link to Existing Project (Optional)</label>
               <select 
                className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                onChange={(e) => handleProjectSelect(e.target.value)}
                value={selectedProjectId}
               >
                 <option value="">-- No Project (Standalone Request) --</option>
                 {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.projectId})</option>)}
               </select>
               {projects.length === 0 && <p className="text-xs text-gray-400 mt-1">No active projects found.</p>}
             </div>

             <div>
               <label className="block text-sm font-medium text-gray-700 mb-1">TCF Request ID</label>
               <input required type="text" className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 outline-none" value={requestId} onChange={e => setRequestId(e.target.value)} />
             </div>

             <div>
               <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
               <input
                 required={!selectedProjectId}
                 disabled={!!selectedProjectId}
                 type="text"
                 className={`w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 outline-none ${
                   selectedProjectId ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''
                 }`}
                 value={projectName}
                 onChange={e => setProjectName(e.target.value)}
                 placeholder="e.g. New Product Launch"
                 title={selectedProjectId ? 'Derived from the linked project.' : undefined}
               />
               {selectedProjectId && (
                 <p className="text-xs text-gray-400 mt-1">Derived from the linked project.</p>
               )}
             </div>

             <div>
               <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
               <select required className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 outline-none" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                 <option value="">Select Supplier</option>
                 {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
               </select>
             </div>

             <div>
               <label className="block text-sm font-medium text-gray-700 mb-1">Product Category</label>
               <CategorySelect
                 categories={categories}
                 value={categoryId}
                 onChange={setCategoryId}
                 placeholder="Select Category"
                 required
                 className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
               />
               {categories.length === 0 && <p className="text-xs text-red-500 mt-1">No categories found. Please create one in Admin.</p>}
             </div>

             <div>
               <label className="block text-sm font-medium text-gray-700 mb-1">Submission Deadline</label>
               <input 
                 type="date" 
                 className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 outline-none" 
                 value={deadline} 
                 onChange={e => setDeadline(e.target.value)} 
               />
             </div>
          </div>

          {/* Applicability questions (migration 174). Only shown when something in this
              category is actually gated — an empty panel on the other ~130 categories would
              be noise, and a panel that renders nothing while still blocking the button is
              precisely the bug this replaced. */}
          {categoryId && hasConditional && (
            <div className={`rounded-xl p-5 border ${
              wizardResult ? 'bg-emerald-50/50 border-emerald-200' : 'bg-indigo-50/60 border-indigo-100'
            }`}>
              <div className="flex items-start gap-3">
                <ListChecks size={18} className={`shrink-0 mt-0.5 ${wizardResult ? 'text-emerald-600' : 'text-indigo-600'}`} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm text-gray-800">Applicability questions</h3>
                  {wizardResult ? (
                    <p className="text-xs text-gray-600 mt-0.5">
                      Answered — <strong>{wizardResult.requirementIds.length} requirement
                      {wizardResult.requirementIds.length !== 1 ? 's' : ''}</strong> will be
                      requested. This set is frozen onto the request when you create it.
                    </p>
                  ) : (
                    <p className="text-xs text-gray-600 mt-0.5">
                      Some requirements in this category only apply to certain products. Answer
                      a few questions and we will formulate the right set.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  className={`shrink-0 px-4 py-2 rounded-md text-sm font-medium shadow ${
                    wizardResult
                      ? 'bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {wizardResult ? 'Review answers' : 'Answer questions'}
                </button>
              </div>
            </div>
          )}

          {regulationBlocks.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-start gap-2">
                <Scale size={16} className="text-rose-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-rose-900">
                    {regulationBlocks.length === 1
                      ? 'An expired regulation is blocking this request'
                      : `${regulationBlocks.length} expired regulations are blocking this request`}
                  </h3>
                  <p className="text-xs text-rose-800 mt-1">
                    This category asks suppliers for evidence against{' '}
                    {regulationBlocks.length === 1 ? 'a regulation that is' : 'regulations that are'}{' '}
                    no longer valid. Requests already sent are unaffected.
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {regulationBlocks.map(b => (
                      <li key={b.regulationId} className="text-xs text-rose-800">
                        <Link
                          to={`/regulations/${b.regulationId}`}
                          className="font-mono font-bold underline hover:text-rose-950"
                        >
                          {b.referenceCode}
                        </Link>
                        {' — '}{b.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-4">
            <button type="button" onClick={() => navigate(-1)} className="px-6 py-2 text-gray-600 hover:bg-light mr-3 rounded">Cancel</button>
            <button
              type="submit"
              disabled={submitting || needsWizard || regulationBlocks.length > 0}
              title={
                regulationBlocks.length > 0 ? 'An expired regulation must be replaced first'
                : needsWizard ? 'Answer the applicability questions first'
                : undefined
              }
              className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? 'Creating...' : 'Create & Generate Code'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default CreateComplianceRequest;