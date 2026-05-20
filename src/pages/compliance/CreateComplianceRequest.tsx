import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getProjects, getSuppliers, getCategories, createComplianceRequest } from '../../services';
import { Project, Supplier, CategoryL3 } from '../../types';
import { AlertCircle, ArrowLeft, Loader2, Lock } from 'lucide-react';

const CreateComplianceRequest: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Data State
  const [projects, setProjects] = useState<Project[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form State
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get('projectId') || '');
  const [projectName, setProjectName] = useState('');
  const [requestId, setRequestId] = useState(`TCF-2025-${Math.floor(Math.random()*10000).toString().padStart(4, '0')}`);
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
        const [pData, sData, cData] = await Promise.all([
           getProjects(),
           getSuppliers(),
           getCategories(),
        ]);

        setProjects(pData);
        setSuppliers(sData);
        setCategories(cData);

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
        }
    }
  }, [projects, searchParams, selectedProjectId]); // Depend on projects loading

  const handleProjectSelect = (pid: string) => {
    setSelectedProjectId(pid);
    const proj = projects.find(p => p.id === pid);
    if (proj) {
      setProjectName(proj.name);
      setSupplierId(proj.supplierId);
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
    setSubmitting(true);

    try {
        await createComplianceRequest(selectedProjectId, projectName, requestId, supplierId, categoryId, [], deadline || undefined);
        
        if (selectedProjectId) {
           navigate(`/project/${selectedProjectId}`);
        } else {
           navigate('/compliance');
        }
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
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center text-muted hover:text-gray-800 mb-6 text-sm">
          <ArrowLeft size={16} className="mr-1" /> Back
        </button>

        <h1 className="text-3xl font-bold text-primary mb-6">Create Compliance Request</h1>
        
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
               <input required type="text" className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 outline-none" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="e.g. New Product Launch" />
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
               <select required className="w-full border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-indigo-500 outline-none" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                 <option value="">Select Category</option>
                 {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
               </select>
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

          <div className="flex justify-end pt-4">
            <button type="button" onClick={() => navigate(-1)} className="px-6 py-2 text-gray-600 hover:bg-light mr-3 rounded">Cancel</button>
            <button type="submit" disabled={submitting} className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
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