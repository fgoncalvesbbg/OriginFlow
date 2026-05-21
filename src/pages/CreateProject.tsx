
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getSuppliers, createProject, getProfiles, getCategories } from '../services';
import { Supplier, User, CategoryL3 } from '../types';
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const CreateProject: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    projectId: '',
    supplierId: '',
    pmId: '',
    categoryId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    const errs: string[] = [];
    Promise.all([
      getSuppliers().catch(err => { errs.push(`Suppliers: ${err.message}`); return [] as Supplier[]; }),
      getProfiles().catch(err => { errs.push(`Team members: ${err.message}`); return [] as User[]; }),
      getCategories().catch(err => { errs.push(`Categories: ${err.message}`); return [] as CategoryL3[]; }),
    ]).then(([suppliersData, usersData, catsData]) => {
      if (!mounted) return;
      setSuppliers(suppliersData);
      setUsers(usersData);
      setCategories(catsData);
      if (errs.length) setLoadErrors(errs);
    });
    return () => { mounted = false; };
  }, []);

  // Default PM to current user if available
  useEffect(() => {
    if (user && !formData.pmId) {
      setFormData(prev => ({ ...prev, pmId: user.id }));
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject(
        formData.name,
        formData.supplierId,
        formData.projectId,
        formData.pmId,
        formData.categoryId || undefined
      );
      navigate(`/project/${project.id}`);
    } catch (err: any) {
      console.error(err);
      const msg = err.message || JSON.stringify(err);
      if (msg.includes('project_id_code')) {
        setError("Database Schema Error: Column 'project_id_code' not found. Please run migration script '25_fix_project_creation_error.txt'.");
      } else {
        setError(msg);
      }
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <button onClick={() => navigate('/')} className="flex items-center text-muted hover:text-gray-800 mb-6 text-sm">
          <ArrowLeft size={16} className="mr-1" /> Back to Dashboard
        </button>

        <div className="bg-white rounded-xl shadow border border-gray-200 p-8">
          <h1 className="text-3xl font-bold text-primary mb-6">Create New Project</h1>

          {loadErrors.length > 0 && (
            <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded flex items-start gap-3">
              <AlertTriangle className="text-yellow-600 shrink-0 mt-0.5" size={18} />
              <div>
                <h3 className="text-sm font-bold text-yellow-800">Some data failed to load</h3>
                {loadErrors.map((e, i) => <p key={i} className="text-sm text-yellow-700 mt-1">{e}</p>)}
                <p className="text-xs text-yellow-600 mt-2">Check browser console and run migration 42 if dropdowns are empty.</p>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 bg-rose-50 border-l-4 border-red-500 p-4 rounded flex items-start gap-3">
              <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
              <div>
                <h3 className="text-sm font-bold text-rose-800">Creation Failed</h3>
                <p className="text-sm text-rose-700 mt-1">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
              <input
                required
                type="text"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="e.g. Smart Coffee Maker V2"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project ID</label>
              <input
                required
                type="text"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="e.g. PRJ-2025-003"
                value={formData.projectId}
                onChange={e => setFormData({...formData, projectId: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
              <select
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                value={formData.supplierId}
                onChange={e => setFormData({...formData, supplierId: e.target.value})}
              >
                <option value="">Select a supplier...</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
              {suppliers.length === 0 && <p className="text-xs text-amber-600 mt-1">No suppliers loaded — check console or run migration 42.</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign Project Manager</label>
              <select
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                value={formData.pmId}
                onChange={e => setFormData({...formData, pmId: e.target.value})}
              >
                <option value="">Select a PM...</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
              {users.length === 0 && <p className="text-xs text-amber-600 mt-1">No team members loaded — check console or run migration 42.</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Product Category
                <span className="text-gray-400 font-normal ml-1">(optional)</span>
              </label>
              <select
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                value={formData.categoryId}
                onChange={e => setFormData({...formData, categoryId: e.target.value})}
              >
                <option value="">— Select a category —</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Used to pre-select attributes and templates throughout the project lifecycle.</p>
            </div>

            <div className="pt-4 flex gap-4">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-light"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 flex-1 flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {submitting ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
};

export default CreateProject;
