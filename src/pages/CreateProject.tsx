
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getSuppliers, createProject, getProfiles } from '../services/apiService';
import { Supplier, User } from '../types';
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const CreateProject: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    projectId: '',
    supplierId: '',
    pmId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSuppliers().then(setSuppliers);
    getProfiles().then(setUsers);
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
      const project = await createProject(formData.name, formData.supplierId, formData.projectId, formData.pmId);
      navigate(`/project/${project.id}`);
    } catch (err: any) {
      console.error(err);
      // Handle Supabase error messages
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
