

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getCategories, getIMTemplates, createIMTemplate, updateIMTemplate } from '../../services/apiService';
import { CategoryL3, IMTemplate } from '../../types';
import { BookOpen, Plus, FileText, ArrowRight, CheckCircle2, Lock, Unlock } from 'lucide-react';

const IMDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [templates, setTemplates] = useState<IMTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [cats, temps] = await Promise.all([getCategories(), getIMTemplates()]);
    setCategories(cats);
    setTemplates(temps);
    setLoading(false);
  };

  const handleCreate = async (cat: CategoryL3) => {
    setCreatingId(cat.id);
    try {
      await createIMTemplate(cat.id, `${cat.name} Manual Template`);
      navigate(`/im/template/${cat.id}`);
    } catch (e: any) {
      console.error(e);
      alert(`Failed to create template: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
      setCreatingId(null);
    }
  };

  const handleToggleFinalized = async (template: IMTemplate) => {
    setTogglingId(template.id);
    const newStatus = !template.isFinalized;
    try {
      await updateIMTemplate(template.id, { 
        isFinalized: newStatus,
        finalizedAt: newStatus ? new Date().toISOString() : undefined
      });
      await loadData();
    } catch (e) {
      alert("Failed to update template status.");
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) return <Layout><div>Loading...</div></Layout>;

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
           <BookOpen className="text-indigo-600" /> Instruction Manuals
        </h1>
        <p className="text-muted mt-1">Manage IM content templates for product categories.</p>
      </div>

      <h3 className="text-lg font-bold text-gray-800 mb-4">Category Templates</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
         {categories.map(cat => {
           const template = templates.find(t => t.categoryId === cat.id);
           
           return (
             <div key={cat.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow flex flex-col justify-between hover:shadow-md transition-all group relative">
                {template?.isFinalized && (
                  <div className="absolute top-4 right-4 bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 shadow animate-in fade-in">
                    <CheckCircle2 size={12} /> FINALIZED
                  </div>
                )}
                <div>
                   <h3 className="text-lg font-bold text-gray-800 mb-2">{cat.name}</h3>
                   <div className="text-xs text-muted mb-4">
                      {template ? (
                        <div className="flex flex-col gap-1">
                          <span className={`flex items-center gap-1 ${template.isFinalized ? 'text-emerald-600' : 'text-indigo-600'}`}>
                            <FileText size={12} /> {template.isFinalized ? 'Template Finalized' : 'Template Active'}
                          </span>
                          {template.finalizedAt && <span className="text-[10px] text-gray-400">Finalized: {new Date(template.finalizedAt).toLocaleDateString()}</span>}
                        </div>
                      ) : (
                        <span className="text-gray-400">No template defined</span>
                      )}
                   </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                   {template ? (
                     <>
                        <Link 
                          to={`/im/template/${cat.id}`}
                          className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-blue-800"
                        >
                          Edit Template <ArrowRight size={14} />
                        </Link>
                        
                        <button 
                          onClick={() => handleToggleFinalized(template)}
                          disabled={togglingId === template.id}
                          className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded transition-colors ${
                            template.isFinalized 
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' 
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                          }`}
                        >
                          {togglingId === template.id ? 'Updating...' : (
                            template.isFinalized ? <><Unlock size={12}/> Reopen</> : <><Lock size={12}/> Mark Final</>
                          )}
                        </button>
                     </>
                   ) : (
                     <button 
                       onClick={() => handleCreate(cat)}
                       disabled={creatingId === cat.id}
                       className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-indigo-600 disabled:opacity-50"
                     >
                       {creatingId === cat.id ? 'Creating...' : <><Plus size={16} /> Create Template</>}
                     </button>
                   )}
                </div>
             </div>
           );
         })}
         
         {categories.length === 0 && (
            <div className="col-span-3 text-center py-12 text-gray-400 bg-light border border-dashed border-gray-200 rounded-xl">
               No product categories defined. Go to Admin Console to add categories.
            </div>
         )}
      </div>
    </Layout>
  );
};

export default IMDashboard;