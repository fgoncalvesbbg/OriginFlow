import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getSuppliers, getProjects, ensureSupplierToken, updateSupplier } from '../services/apiService';
import { Supplier, Project, UserRole } from '../types';
import { Truck, ExternalLink, Search, Mail, Box, LayoutDashboard, Edit2, X, Save, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const SuppliersList: React.FC = () => {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Edit State
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [sData, pData] = await Promise.all([getSuppliers(), getProjects()]);
      setSuppliers(sData);
      setProjects(pData);
      setLoading(false);
    };
    load();
  }, []);

  const getActiveProjectCount = (supplierId: string) => {
    return projects.filter(p => p.supplierId === supplierId && p.status !== 'archived' && p.status !== 'cancelled').length;
  };

  const handleOpenPortal = async (supplier: Supplier) => {
    try {
        const token = await ensureSupplierToken(supplier.id);
        setSuppliers(prev => prev.map(s => s.id === supplier.id ? { ...s, portalToken: token } : s));
        const url = `#/supplier-dashboard/${token}`;
        window.open(url, '_blank');
    } catch (e: any) {
        console.error("Failed to access supplier portal", e);
        const msg = e.message || (typeof e === 'object' ? JSON.stringify(e) : String(e));
        alert(`Failed to generate access token: ${msg}`);
    }
  };

  const handleEdit = (supplier: Supplier) => {
      setEditingSupplier({ ...supplier });
      setIsEditModalOpen(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingSupplier) return;
      setSaving(true);
      try {
          const updated = await updateSupplier(editingSupplier.id, editingSupplier);
          setSuppliers(prev => prev.map(s => s.id === updated.id ? updated : s));
          setIsEditModalOpen(false);
      } catch (e: any) {
          alert("Failed to update supplier: " + e.message);
      } finally {
          setSaving(false);
      }
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const canEdit = user?.role === UserRole.ADMIN || user?.role === UserRole.PM;

  return (
    <Layout>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
           <Truck className="text-blue-600" /> Suppliers Directory
        </h2>
        <p className="text-slate-500 mt-1">Manage and access supplier portals.</p>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-6 flex items-center justify-between">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search suppliers..." 
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="text-sm text-slate-500">
           {filteredSuppliers.length} Suppliers Found
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
           <div className="col-span-3 text-center py-12 text-slate-400">Loading suppliers...</div>
        ) : filteredSuppliers.length === 0 ? (
           <div className="col-span-3 text-center py-12 text-slate-400 border border-dashed rounded-lg bg-slate-50">No suppliers found.</div>
        ) : (
           filteredSuppliers.map(supplier => {
             const activeCount = getActiveProjectCount(supplier.id);
             return (
               <div key={supplier.id} className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow p-6 flex flex-col group relative">
                  {canEdit && (
                      <button 
                        onClick={() => handleEdit(supplier)}
                        className="absolute top-4 right-4 p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        title="Edit Supplier Info"
                      >
                          <Edit2 size={16} />
                      </button>
                  )}
                  
                  <div className="flex justify-between items-start mb-4">
                     <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center font-bold text-lg">
                        {supplier.name.charAt(0)}
                     </div>
                     <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded border border-slate-200">{supplier.code}</span>
                  </div>
                  
                  <h3 className="text-lg font-bold text-slate-900 mb-1">{supplier.name}</h3>
                  <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
                     <Mail size={14} /> {supplier.email}
                  </div>
                  
                  <div className="flex items-center gap-2 mb-6 bg-slate-50 p-3 rounded-lg border border-slate-100">
                     <Box size={16} className="text-slate-400" />
                     <span className="text-sm font-medium text-slate-700">{activeCount} Active Projects</span>
                  </div>

                  <div className="mt-auto">
                     <button 
                       onClick={() => handleOpenPortal(supplier)}
                       className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white py-2.5 rounded-lg font-medium hover:bg-blue-600 transition-colors"
                     >
                       <LayoutDashboard size={16} /> View Supplier Portal
                     </button>
                     <p className="text-xs text-center text-slate-400 mt-2">
                       Opens the view exactly as seen by the supplier.
                     </p>
                  </div>
               </div>
             );
           })
        )}
      </div>

      {/* Edit Modal */}
      {isEditModalOpen && editingSupplier && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                      <h3 className="font-bold text-lg text-slate-800">Edit Supplier Info</h3>
                      <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                  </div>
                  <form onSubmit={handleUpdate} className="p-6 space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Company Name</label>
                          <input 
                            required 
                            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                            value={editingSupplier.name} 
                            onChange={e => setEditingSupplier({...editingSupplier, name: e.target.value})} 
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier Code</label>
                          <input 
                            required 
                            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" 
                            value={editingSupplier.code} 
                            onChange={e => setEditingSupplier({...editingSupplier, code: e.target.value})} 
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contact Email</label>
                          <input 
                            required 
                            type="email"
                            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                            value={editingSupplier.email || ''} 
                            onChange={e => setEditingSupplier({...editingSupplier, email: e.target.value})} 
                          />
                      </div>
                      <div className="flex justify-end gap-3 pt-4">
                          <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium">Cancel</button>
                          <button 
                            type="submit" 
                            disabled={saving}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                          >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {saving ? 'Saving...' : 'Update Supplier'}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </Layout>
  );
};

export default SuppliersList;