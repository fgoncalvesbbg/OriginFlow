import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getSuppliers, getProjects, ensureSupplierToken, ensureSupplierAccessCode, regenerateSupplierAccessCode, updateSupplier } from '../services/apiService';
import { Supplier, Project, UserRole } from '../types';
import { Truck, ExternalLink, Search, Mail, Box, LayoutDashboard, Edit2, X, Save, Loader2, Copy, Key, RotateCcw } from 'lucide-react';
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

  // Access Code State
  const [selectedSupplierForCode, setSelectedSupplierForCode] = useState<Supplier | null>(null);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

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

  const handleShowAccessCode = async (supplier: Supplier) => {
      setSelectedSupplierForCode(supplier);
      setIsCodeModalOpen(true);
      if (!supplier.accessCode) {
          setGeneratingCode(true);
          try {
              const code = await ensureSupplierAccessCode(supplier.id);
              setSuppliers(prev => prev.map(s => s.id === supplier.id ? { ...s, accessCode: code } : s));
              setSelectedSupplierForCode(prev => prev ? { ...prev, accessCode: code } : null);
          } catch (e: any) {
              alert("Failed to generate access code: " + e.message);
          } finally {
              setGeneratingCode(false);
          }
      }
  };

  const handleRegenerateAccessCode = async () => {
      if (!selectedSupplierForCode) return;
      setGeneratingCode(true);
      try {
          const code = await regenerateSupplierAccessCode(selectedSupplierForCode.id);
          setSuppliers(prev => prev.map(s => s.id === selectedSupplierForCode.id ? { ...s, accessCode: code } : s));
          setSelectedSupplierForCode(prev => prev ? { ...prev, accessCode: code } : null);
          setCopiedCode(false);
      } catch (e: any) {
          alert("Failed to regenerate access code: " + e.message);
      } finally {
          setGeneratingCode(false);
      }
  };

  const handleCopyCode = () => {
      if (selectedSupplierForCode?.accessCode) {
          navigator.clipboard.writeText(selectedSupplierForCode.accessCode);
          setCopiedCode(true);
          setTimeout(() => setCopiedCode(false), 2000);
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
        <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
           <Truck className="text-indigo-600" /> Suppliers Directory
        </h2>
        <p className="text-muted mt-1">Manage and access supplier portals.</p>
      </div>

      <div className="bg-white p-4 rounded-xl shadow border border-gray-200 mb-6 flex items-center justify-between">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder="Search suppliers..." 
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="text-sm text-muted">
           {filteredSuppliers.length} Suppliers Found
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
           <div className="col-span-3 text-center py-12 text-gray-400">Loading suppliers...</div>
        ) : filteredSuppliers.length === 0 ? (
           <div className="col-span-3 text-center py-12 text-gray-400 border border-dashed rounded-xl bg-light">No suppliers found.</div>
        ) : (
           filteredSuppliers.map(supplier => {
             const activeCount = getActiveProjectCount(supplier.id);
             return (
               <div key={supplier.id} className="bg-white border border-gray-200 rounded-xl shadow hover:shadow-md transition-shadow p-6 flex flex-col group relative">
                  {canEdit && (
                      <button 
                        onClick={() => handleEdit(supplier)}
                        className="absolute top-4 right-4 p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Edit Supplier Info"
                      >
                          <Edit2 size={16} />
                      </button>
                  )}
                  
                  <div className="flex justify-between items-start mb-4">
                     <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center font-bold text-lg">
                        {supplier.name.charAt(0)}
                     </div>
                     <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded border border-gray-200">{supplier.code}</span>
                  </div>
                  
                  <h3 className="text-lg font-bold text-primary mb-1">{supplier.name}</h3>
                  <div className="flex items-center gap-2 text-sm text-muted mb-4">
                     <Mail size={14} /> {supplier.email}
                  </div>
                  
                  <div className="flex items-center gap-2 mb-6 bg-light p-3 rounded-xl border border-gray-100">
                     <Box size={16} className="text-gray-400" />
                     <span className="text-sm font-medium text-gray-700">{activeCount} Active Projects</span>
                  </div>

                  <div className="mt-auto space-y-2">
                     <button
                       onClick={() => handleOpenPortal(supplier)}
                       className="w-full flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-xl font-medium hover:bg-indigo-600 transition-colors"
                     >
                       <LayoutDashboard size={16} /> View Supplier Portal
                     </button>
                     <button
                       onClick={() => handleShowAccessCode(supplier)}
                       className="w-full flex items-center justify-center gap-2 bg-indigo-50 text-indigo-600 py-2 rounded-xl font-medium hover:bg-indigo-100 transition-colors border border-indigo-200"
                     >
                       <Key size={16} /> Access Code
                     </button>
                     <p className="text-xs text-center text-gray-400">
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
                  <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                      <h3 className="font-bold text-lg text-gray-800">Edit Supplier Info</h3>
                      <button onClick={() => setIsEditModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
                  </div>
                  <form onSubmit={handleUpdate} className="p-6 space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-muted uppercase mb-1">Company Name</label>
                          <input
                            required
                            className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={editingSupplier.name}
                            onChange={e => setEditingSupplier({...editingSupplier, name: e.target.value})}
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-muted uppercase mb-1">Supplier Code</label>
                          <input
                            required
                            className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                            value={editingSupplier.code}
                            onChange={e => setEditingSupplier({...editingSupplier, code: e.target.value})}
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-bold text-muted uppercase mb-1">Contact Email</label>
                          <input
                            required
                            type="email"
                            className="w-full border border-gray-300 rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={editingSupplier.email || ''}
                            onChange={e => setEditingSupplier({...editingSupplier, email: e.target.value})}
                          />
                      </div>
                      <div className="flex justify-end gap-3 pt-4">
                          <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl text-sm font-medium">Cancel</button>
                          <button
                            type="submit"
                            disabled={saving}
                            className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                          >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {saving ? 'Saving...' : 'Update Supplier'}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {/* Access Code Modal */}
      {isCodeModalOpen && selectedSupplierForCode && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 px-6 py-6 flex justify-between items-start">
                      <div>
                          <h3 className="font-bold text-lg text-white">Portal Access Code</h3>
                          <p className="text-indigo-100 text-sm mt-1">{selectedSupplierForCode.name}</p>
                      </div>
                      <button onClick={() => setIsCodeModalOpen(false)} className="text-indigo-200 hover:text-white"><X size={20}/></button>
                  </div>
                  <div className="p-6 space-y-4">
                      {generatingCode ? (
                          <div className="flex items-center justify-center py-8">
                              <Loader2 size={24} className="animate-spin text-indigo-600" />
                          </div>
                      ) : selectedSupplierForCode.accessCode ? (
                          <>
                              <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-4">
                                  <p className="text-xs text-gray-600 font-semibold uppercase mb-2">Access Code</p>
                                  <div className="flex items-center gap-3">
                                      <div className="text-4xl font-mono font-bold text-indigo-600 tracking-widest">
                                          {selectedSupplierForCode.accessCode}
                                      </div>
                                      <button
                                          onClick={handleCopyCode}
                                          className="p-2 bg-white border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-colors"
                                          title="Copy code to clipboard"
                                      >
                                          <Copy size={18} className={copiedCode ? "text-emerald-600" : "text-indigo-600"} />
                                      </button>
                                  </div>
                                  {copiedCode && <p className="text-xs text-emerald-600 mt-2 font-medium">Copied to clipboard!</p>}
                              </div>
                              <div className="bg-light rounded-xl p-4 space-y-3">
                                  <p className="text-sm text-gray-700">
                                      <strong>This code is required for suppliers to access:</strong>
                                  </p>
                                  <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                                      <li>Supplier Portal (all portals)</li>
                                      <li>Compliance requests (TCF)</li>
                                      <li>Document uploads</li>
                                      <li>RFQ submissions</li>
                                  </ul>
                                  <p className="text-xs text-muted mt-3">
                                      Share this code via email or other secure channel.
                                  </p>
                              </div>
                              <button
                                  onClick={handleRegenerateAccessCode}
                                  disabled={generatingCode}
                                  className="w-full flex items-center justify-center gap-2 bg-amber-50 text-amber-600 py-2.5 rounded-xl font-medium hover:bg-orange-100 transition-colors border border-amber-200 disabled:opacity-50"
                              >
                                  <RotateCcw size={16} /> Regenerate Code
                              </button>
                          </>
                      ) : (
                          <p className="text-gray-600 text-center">Failed to generate access code. Please try again.</p>
                      )}
                      <button
                          onClick={() => setIsCodeModalOpen(false)}
                          className="w-full px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors"
                      >
                          Done
                      </button>
                  </div>
              </div>
          </div>
      )}
    </Layout>
  );
};

export default SuppliersList;