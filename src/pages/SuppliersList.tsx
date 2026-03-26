import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getSuppliers, getProjects, regenerateSupplierAccessCode, updateSupplier } from '../services';
import { Supplier, Project } from '../types';
import { Truck, Search, Mail, Box, LayoutDashboard, Edit2, X, Save, Loader2, Copy, RotateCcw } from 'lucide-react';
import { useToast } from '../hooks/useToast';

const SuppliersList: React.FC = () => {
  const { success, error } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Edit State
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Access Code State - track which suppliers are generating codes
  const [generatingCodeFor, setGeneratingCodeFor] = useState<string | null>(null);
  const [copiedCodeFor, setCopiedCodeFor] = useState<string | null>(null);

  // Confirmation state for regeneration
  const [regenerateConfirm, setRegenerateConfirm] = useState<string | null>(null);

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

  const handleOpenPortal = (supplier: Supplier) => {
    if (!supplier.portalToken) {
      error('Portal token not configured. Please refresh the page and try again.');
      return;
    }
    const url = `${window.location.origin}/#/supplier-dashboard/${supplier.portalToken}`;
    window.open(url, '_blank');
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

  const confirmRegenerateAccessCode = async (supplierId: string) => {
    setGeneratingCodeFor(supplierId);
    try {
      const code = await regenerateSupplierAccessCode(supplierId);
      setSuppliers(prev => prev.map(s => s.id === supplierId ? { ...s, accessCode: code } : s));
      success('New access code generated successfully. Make sure to share it with the supplier.');
      setCopiedCodeFor(null);
      setRegenerateConfirm(null);
    } catch (e: any) {
      console.error("Access code regeneration failed:", e);
      error('Failed to regenerate access code. Please try again.');
    } finally {
      setGeneratingCodeFor(null);
    }
  };

  const handleCopyCode = (supplierId: string, accessCode: string) => {
    navigator.clipboard.writeText(accessCode);
    setCopiedCodeFor(supplierId);
    success('Access code copied to clipboard');
    setTimeout(() => setCopiedCodeFor(null), 2000);
  };

  const handleCopyPortalLink = (supplier: Supplier) => {
    if (!supplier.portalToken) {
      error('Portal token not available');
      return;
    }
    const link = `${window.location.origin}/#/supplier-dashboard/${supplier.portalToken}`;
    navigator.clipboard.writeText(link);
    success('Portal link copied to clipboard');
  };

  const handleEmailSupplier = async (supplier: Supplier) => {
    if (!supplier.email) {
      error('Supplier email not available');
      return;
    }

    if (!supplier.portalToken) {
      error('Portal token not available');
      return;
    }

    const portalLink = `${window.location.origin}/#/supplier-dashboard/${supplier.portalToken}`;
    const subject = 'Your OriginFlow Supplier Portal Access';
    const emailBody = `Hello ${supplier.name},

You now have access to the OriginFlow Supplier Portal. Use the information below to log in:

Portal Link:
${portalLink}

Access Code:
${supplier.accessCode}

Please keep your access code safe and don't share it with others. If you have any questions, please reach out to your Project Manager.

Best regards,
OriginFlow Team`;

    const mailtoLink = `mailto:${supplier.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailtoLink;
  };

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
           <Truck className="text-indigo-600" /> Suppliers Directory
        </h1>
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
                  <button
                    onClick={() => handleEdit(supplier)}
                    className="absolute top-4 right-4 p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                    title="Edit Supplier Info"
                  >
                      <Edit2 size={16} />
                  </button>
                  
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

                  <div className="mt-auto space-y-3">
                     <button
                       onClick={() => handleOpenPortal(supplier)}
                       className="w-full flex items-center justify-center gap-2 bg-primary text-white py-2.5 rounded-xl font-medium hover:bg-indigo-600 transition-colors"
                     >
                       <LayoutDashboard size={16} /> View Supplier Portal
                     </button>

                     {/* Access Code Section */}
                     <div className="bg-indigo-50 rounded-xl p-3 border border-indigo-200 space-y-2">
                       <p className="text-xs font-semibold text-indigo-700 uppercase">Portal Access Code</p>
                       {supplier.accessCode ? (
                         <>
                           <div className="flex items-center gap-2">
                             <div className="flex-1 font-mono font-bold text-lg text-indigo-600 tracking-widest">
                               {supplier.accessCode}
                             </div>
                             <button
                               onClick={() => handleCopyCode(supplier.id, supplier.accessCode!)}
                               title="Copy code"
                               className="p-1.5 bg-white rounded hover:bg-indigo-100 transition-colors"
                             >
                               <Copy size={14} className={copiedCodeFor === supplier.id ? "text-green-600" : "text-indigo-600"} />
                             </button>
                           </div>
                           <div className="grid grid-cols-2 gap-2">
                             <button
                               onClick={() => handleCopyPortalLink(supplier)}
                               className="text-xs font-medium text-blue-700 py-1 px-2 bg-white border border-blue-200 rounded hover:bg-blue-50 transition-colors flex items-center justify-center gap-1"
                               title="Copy portal link"
                             >
                               <Copy size={12} />
                               Copy Link
                             </button>
                             <button
                               onClick={() => handleEmailSupplier(supplier)}
                               className="text-xs font-medium text-green-700 py-1 px-2 bg-white border border-green-200 rounded hover:bg-green-50 transition-colors flex items-center justify-center gap-1"
                               title="Email supplier"
                             >
                               <Mail size={12} />
                               Email
                             </button>
                           </div>
                           <button
                             onClick={() => setRegenerateConfirm(supplier.id)}
                             disabled={generatingCodeFor === supplier.id}
                             className="w-full text-xs font-medium text-amber-700 py-1 px-2 bg-white border border-amber-200 rounded hover:bg-amber-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                             title="Requires confirmation"
                           >
                             <RotateCcw size={12} />
                             {generatingCodeFor === supplier.id ? 'Generating...' : 'Regenerate'}
                           </button>
                         </>
                       ) : (
                         <p className="text-xs text-gray-500 text-center py-2">Access code is being generated...</p>
                       )}
                     </div>
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

      {/* Regenerate Confirmation Modal */}
      {regenerateConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-amber-50 px-6 py-4 border-b border-amber-200 flex justify-between items-start">
              <div>
                <h3 className="font-bold text-lg text-amber-900">Regenerate Access Code?</h3>
                <p className="text-sm text-amber-700 mt-1">
                  {suppliers.find(s => s.id === regenerateConfirm)?.name}
                </p>
              </div>
              <button
                onClick={() => setRegenerateConfirm(null)}
                className="text-amber-400 hover:text-amber-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-700">
                The supplier's current access code will be invalidated. Make sure to share the new code with them immediately.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setRegenerateConfirm(null)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => confirmRegenerateAccessCode(regenerateConfirm)}
                  disabled={generatingCodeFor === regenerateConfirm}
                  className="px-4 py-2 bg-amber-600 text-white hover:bg-amber-700 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {generatingCodeFor === regenerateConfirm ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <RotateCcw size={16} />
                      Regenerate Code
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </Layout>
  );
};

export default SuppliersList;