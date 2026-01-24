import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import {
  getProfiles, updateUserRole,
  getSuppliers, createSupplier, ensureSupplierToken, updateSupplier,
  getCategories, getProductFeatures, saveCategory, saveProductFeature,
  deleteCategory, deleteProductFeature,
  getCategoryAttributes, saveCategoryAttribute, deleteCategoryAttribute,
  generateUUID,
  assignSupplierToPMs, getSupplierPMs,
  reassignProjectPM, getProjects
} from '../services/apiService';
import { User, UserRole, Supplier, CategoryL3, ProductFeature, CategoryAttribute } from '../types';
import { Users, Truck, ShieldCheck, Plus, CheckCircle, Link as LinkIcon, Edit2, ArrowLeft, Circle, Layers, Tag, Trash2, SlidersHorizontal, X, Save, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ConfirmationModal: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-primary mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-rose-600 text-white hover:bg-red-700 rounded text-sm font-medium">Delete</button>
        </div>
      </div>
    </div>
  );
};

const AdminDashboard: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'users' | 'suppliers' | 'categories' | 'projects'>('users');
  
  // Core Data
  const [users, setUsers] = useState<User[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [features, setFeatures] = useState<ProductFeature[]>([]);
  const [attributes, setAttributes] = useState<CategoryAttribute[]>([]);
  
  // Forms & UI State
  const [newSupName, setNewSupName] = useState('');
  const [newSupCode, setNewSupCode] = useState('');
  const [newSupEmail, setNewSupEmail] = useState('');
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedSupplierForPMAssignment, setSelectedSupplierForPMAssignment] = useState<string | null>(null);
  const [selectedPMsForSupplier, setSelectedPMsForSupplier] = useState<string[]>([]);
  const [pmAssignmentModalOpen, setPMAssignmentModalOpen] = useState(false);
  const [projectReassignmentModalOpen, setProjectReassignmentModalOpen] = useState(false);
  const [selectedProjectForReassignment, setSelectedProjectForReassignment] = useState<any>(null);
  const [newPMIdForProject, setNewPMIdForProject] = useState<string>('');

  // Category/Feature/Attribute Editing State
  const [selectedCategoryDetail, setSelectedCategoryDetail] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<'features' | 'attributes'>('features');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'category' | 'feature' | 'attribute' | 'supplier'>('category');
  const [editingItem, setEditingItem] = useState<any>(null);

  // Delete Modal State
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [u, s, c, f, a, p] = await Promise.all([
      getProfiles(),
      getSuppliers(),
      getCategories(),
      getProductFeatures(),
      getCategoryAttributes(),
      getProjects()
    ]);
    setUsers(u);
    setSuppliers(s);
    setCategories(c);
    setFeatures(f);
    setAttributes(a);
    setProjects(p);
  };

  // --- USER ACTIONS ---
  const toggleRole = async (userId: string, currentRole: UserRole) => {
    if (currentUser?.id === userId) {
        alert("You cannot change your own role to prevent accidental lockout.");
        return;
    }
    const newRole = currentRole === UserRole.ADMIN ? UserRole.PM : UserRole.ADMIN;
    await updateUserRole(userId, newRole);
    loadData();
  };

  // --- SUPPLIER ACTIONS ---
  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    await createSupplier(newSupName, newSupCode, newSupEmail);
    setNewSupName(''); setNewSupCode(''); setNewSupEmail('');
    loadData();
  };
  
  const handleCopyPortalLink = async (supplier: Supplier) => {
    try {
        const token = await ensureSupplierToken(supplier.id);
        if (token !== supplier.portalToken) {
           setSuppliers(prev => prev.map(s => s.id === supplier.id ? { ...s, portalToken: token } : s));
        }
        const baseUrl = window.location.href.split('#')[0];
        const url = `${baseUrl}#/supplier-dashboard/${token}`;
        navigator.clipboard.writeText(url);
        setCopiedTokenId(supplier.id);
        setTimeout(() => setCopiedTokenId(null), 2000);
    } catch (e: any) {
         console.error("Failed to get token", e);
         const msg = e.message || (typeof e === 'object' ? JSON.stringify(e) : String(e));
         alert(`Error generating token: ${msg}`);
    }
  };

  // --- PM ASSIGNMENT ACTIONS ---
  const openPMAssignmentModal = async (supplierId: string) => {
    setSelectedSupplierForPMAssignment(supplierId);
    const pms = await getSupplierPMs(supplierId);
    setSelectedPMsForSupplier(pms.map(p => p.id));
    setPMAssignmentModalOpen(true);
  };

  const handleSavePMAssignment = async () => {
    if (!selectedSupplierForPMAssignment) return;
    try {
      await assignSupplierToPMs(selectedSupplierForPMAssignment, selectedPMsForSupplier);
      setPMAssignmentModalOpen(false);
      setSelectedSupplierForPMAssignment(null);
      setSelectedPMsForSupplier([]);
      loadData();
      alert('PM assignments updated successfully');
    } catch (e: any) {
      alert(`Error saving PM assignments: ${e.message}`);
    }
  };

  const handleReassignProject = async (projectId: string, newPmId: string) => {
    try {
      await reassignProjectPM(projectId, newPmId);
      loadData();
      setProjectReassignmentModalOpen(false);
      setSelectedProjectForReassignment(null);
      setNewPMIdForProject('');
      alert('Project reassigned successfully');
    } catch (e: any) {
      alert(`Error reassigning project: ${e.message}`);
    }
  };

  const openProjectReassignmentModal = (project: any) => {
    setSelectedProjectForReassignment(project);
    setNewPMIdForProject(project.pmId);
    setProjectReassignmentModalOpen(true);
  };

  // --- CATEGORY & FEATURE ACTIONS ---
  const openAddModal = (type: 'category' | 'feature' | 'attribute') => {
    setModalType(type);
    if (type === 'category') {
      setEditingItem({ name: '', active: true, isFinalized: false });
    } else if (type === 'feature') {
        if (!selectedCategoryDetail) return;
        setEditingItem({ name: '', active: true, categoryId: selectedCategoryDetail });
    } else {
        if (!selectedCategoryDetail) return;
        setEditingItem({ name: '', categoryId: selectedCategoryDetail, dataType: 'text' });
    }
    setIsModalOpen(true);
  };

  const handleEditItem = (item: any, type: 'category' | 'feature' | 'attribute' | 'supplier') => {
    setModalType(type);
    setEditingItem({ ...item });
    setIsModalOpen(true);
  };

  const handleDeleteCategory = (id: string) => {
    setDeleteModal({
      isOpen: true,
      title: 'Delete Category',
      message: 'Are you sure you want to delete this category? This will permanently delete all associated requirements, features, attributes, and templates.',
      onConfirm: async () => {
        try {
          await deleteCategory(id);
          loadData();
        } catch (e: any) {
          alert(`Failed to delete category: ${e.message}`);
        }
        setDeleteModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteFeature = (id: string) => {
    setDeleteModal({
      isOpen: true,
      title: 'Delete Feature',
      message: 'Are you sure you want to delete this feature?',
      onConfirm: async () => {
        try {
          await deleteProductFeature(id);
          loadData();
        } catch (e: any) {
          alert(`Failed to delete feature: ${e.message}`);
        }
        setDeleteModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteAttribute = (id: string) => {
    setDeleteModal({
      isOpen: true,
      title: 'Delete Attribute',
      message: 'Are you sure you want to delete this attribute?',
      onConfirm: async () => {
        try {
          await deleteCategoryAttribute(id);
          loadData();
        } catch (e: any) {
          alert(`Failed to delete attribute: ${e.message}`);
        }
        setDeleteModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        if (modalType === 'category') {
          const item = editingItem as CategoryL3;
          await saveCategory({ ...item, id: item.id || generateUUID() });
        } else if (modalType === 'feature') {
          const item = editingItem as ProductFeature;
          await saveProductFeature({ ...item, id: item.id || generateUUID() });
        } else if (modalType === 'attribute') {
          const item = editingItem as CategoryAttribute;
          await saveCategoryAttribute({ ...item, id: item.id || generateUUID() });
        } else if (modalType === 'supplier') {
          await updateSupplier(editingItem.id, editingItem);
        }
        setIsModalOpen(false);
        loadData();
    } catch (e: any) {
        alert(`Error saving: ${e.message}`);
    }
  };

  const toggleCategoryFinalized = async (category: CategoryL3) => {
    const newStatus = !category.isFinalized;
    await saveCategory({ 
      ...category, 
      isFinalized: newStatus,
      finalizedAt: newStatus ? new Date().toISOString() : null
    });
    loadData();
  };

  // --- RENDERERS ---

  const renderCategoriesTab = () => {
    if (selectedCategoryDetail) {
        const category = categories.find(c => c.id === selectedCategoryDetail);
        
        return (
            <div>
                <button 
                    onClick={() => setSelectedCategoryDetail(null)} 
                    className="mb-6 text-sm text-muted hover:text-gray-800 flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 w-fit"
                >
                    <ArrowLeft size={16} /> Back to Categories
                </button>

                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-xl font-bold text-primary">{category?.name}</h3>
                        <div className="flex gap-4 mt-2">
                            <button 
                                onClick={() => setDetailView('features')}
                                className={`text-sm font-medium pb-2 border-b-2 transition-colors ${detailView === 'features' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}
                            >
                                Compliance Features
                            </button>
                            <button 
                                onClick={() => setDetailView('attributes')}
                                className={`text-sm font-medium pb-2 border-b-2 transition-colors ${detailView === 'attributes' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}
                            >
                                Sourcing Attributes
                            </button>
                        </div>
                    </div>
                    <button 
                        onClick={() => openAddModal(detailView === 'features' ? 'feature' : 'attribute')} 
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow"
                    >
                        <Plus size={16} /> Add {detailView === 'features' ? 'Feature' : 'Attribute'}
                    </button>
                </div>

                {detailView === 'features' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {features.filter(f => f.categoryId === selectedCategoryDetail).map(f => (
                            <div key={f.id} className="p-4 bg-white border border-gray-200 rounded-xl shadow hover:shadow-md flex justify-between items-center group">
                                <div>
                                    <div className="font-bold text-gray-800">{f.name}</div>
                                    <div className="text-xs text-gray-400 mt-1">ID: {f.id}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${f.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                                        {f.active ? 'Active' : 'Inactive'}
                                    </span>
                                    <button onClick={() => handleEditItem(f, 'feature')} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => handleDeleteFeature(f.id)} className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {features.filter(f => f.categoryId === selectedCategoryDetail).length === 0 && (
                            <div className="col-span-2 text-center py-10 text-gray-400 bg-light rounded-xl border border-dashed">
                                No features defined. Features are boolean flags used for Compliance logic.
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {attributes.filter(a => a.categoryId === selectedCategoryDetail).map(a => (
                            <div key={a.id} className="p-4 bg-white border border-gray-200 rounded-xl shadow hover:shadow-md flex justify-between items-center group">
                                <div>
                                    <div className="font-bold text-gray-800">{a.name}</div>
                                    <div className="text-xs text-muted mt-1 capitalize badge bg-gray-100 inline-block px-2 py-0.5 rounded border border-gray-200">Type: {a.dataType}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => handleEditItem(a, 'attribute')} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => handleDeleteAttribute(a.id)} className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {attributes.filter(a => a.categoryId === selectedCategoryDetail).length === 0 && (
                            <div className="col-span-2 text-center py-10 text-gray-400 bg-light rounded-xl border border-dashed">
                                No attributes defined. Attributes are data fields (Text/Number) used for RFQs.
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    // Categories List
    return (
        <div>
            <div className="flex justify-between items-center px-6 py-4 bg-light border-b border-gray-200">
                <h3 className="font-bold text-gray-800">Product Categories</h3>
                <button onClick={() => openAddModal('category')} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow">
                    <Plus size={16} /> Add Category
                </button>
            </div>
            <div className="divide-y divide-slate-100">
                {categories.map(c => {
                    const featCount = features.filter(f => f.categoryId === c.id).length;
                    const attrCount = attributes.filter(a => a.categoryId === c.id).length;
                    return (
                        <div key={c.id} className="p-4 hover:bg-light px-6 transition-colors">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div className="flex-1">
                                    <div className="font-medium text-primary flex items-center gap-2 text-lg">
                                        {c.name}
                                        {c.isFinalized && (
                                            <span title="Finalized (Requirements Locked)" className="text-indigo-600">
                                                <CheckCircle size={18} />
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-3 text-xs text-muted mt-1 items-center">
                                        <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-200">{featCount} Features</span>
                                        <span className="bg-gray-100 px-2 py-0.5 rounded border border-gray-200">{attrCount} Attributes</span>
                                        <span className={`px-2 py-0.5 rounded font-medium ${c.active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                                            {c.active ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-3">
                                    <button 
                                        onClick={() => { setSelectedCategoryDetail(c.id); setDetailView('features'); }}
                                        className="text-sm font-medium text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded border border-transparent hover:border-indigo-100 flex items-center gap-1"
                                    >
                                        <SlidersHorizontal size={14} /> Configure
                                    </button>

                                    <div className="h-6 w-px bg-gray-200 mx-1"></div>

                                    <button 
                                        onClick={() => toggleCategoryFinalized(c)}
                                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors ${
                                            c.isFinalized 
                                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' 
                                            : 'bg-white text-muted border-gray-200 hover:bg-light hover:text-gray-700'
                                        }`}
                                        title="Finalizing signals that requirements are complete"
                                    >
                                        {c.isFinalized ? 'Finalized' : 'Mark Final'}
                                    </button>
                                    
                                    <button 
                                        onClick={() => handleEditItem(c, 'category')}
                                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full"
                                    >
                                        <Edit2 size={16} />
                                    </button>

                                    <button 
                                        onClick={() => handleDeleteCategory(c.id)}
                                        className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full"
                                        title="Delete Category"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {categories.length === 0 && (
                    <div className="p-8 text-center text-gray-400">No categories found.</div>
                )}
            </div>
        </div>
    );
  };

  return (
    <Layout>
      <ConfirmationModal
        isOpen={deleteModal.isOpen}
        title={deleteModal.title}
        message={deleteModal.message}
        onConfirm={deleteModal.onConfirm}
        onCancel={() => setDeleteModal(prev => ({ ...prev, isOpen: false }))}
      />

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary flex items-center gap-2 mb-1">
          <ShieldCheck className="text-indigo-600" /> Admin Console
        </h1>
        <p className="text-sm text-muted">System configuration and master data management.</p>
      </div>

      <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
        <button onClick={() => setActiveTab('users')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'users' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Users size={18} /> Users & Roles
        </button>
        <button onClick={() => setActiveTab('suppliers')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'suppliers' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Truck size={18} /> Suppliers
        </button>
        <button onClick={() => { setActiveTab('categories'); setSelectedCategoryDetail(null); }} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'categories' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <Layers size={18} /> Product Categories
        </button>
        <button onClick={() => setActiveTab('projects')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'projects' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}>
          <ShoppingBag size={18} /> Projects
        </button>
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-200 min-h-[400px]">
        
        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div>
            <div className="px-6 py-4 bg-light border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800">Registered Users</h3>
              <span className="text-xs bg-gray-200 px-2 py-1 rounded text-gray-600">{users.length} Users</span>
            </div>
            <div className="divide-y divide-slate-100">
              {users.map(user => (
                <div key={user.id} className="p-4 flex items-center justify-between hover:bg-light px-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-bold text-xs">
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-medium text-primary">{user.name || 'No Name'}</div>
                      <div className="text-xs text-muted">{user.email}</div>
                    </div>
                  </div>
                  <button onClick={() => toggleRole(user.id, user.role)} className={`text-xs px-3 py-1 rounded-full font-bold transition-colors ${user.role === UserRole.ADMIN ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {user.role}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SUPPLIERS TAB */}
        {activeTab === 'suppliers' && (
          <div>
            <div className="px-6 py-4 bg-light border-b border-gray-200 flex justify-between items-center">
               <h3 className="font-bold text-gray-800">Supplier Database</h3>
            </div>
            <div className="p-6 border-b border-gray-100 bg-light/50">
              <h4 className="text-sm font-bold text-gray-700 mb-3">Add New Supplier</h4>
              <form onSubmit={handleCreateSupplier} className="flex flex-col sm:flex-row gap-3">
                 <input required placeholder="Supplier Name" className="border rounded px-3 py-2 text-sm flex-[2]" value={newSupName} onChange={e => setNewSupName(e.target.value)} />
                 <input required placeholder="Code (e.g. SUP-001)" className="border rounded px-3 py-2 text-sm flex-1" value={newSupCode} onChange={e => setNewSupCode(e.target.value)} />
                 <input placeholder="Contact Email" className="border rounded px-3 py-2 text-sm flex-1" value={newSupEmail} onChange={e => setNewSupEmail(e.target.value)} />
                 <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-purple-700 flex items-center justify-center gap-1">
                   <Plus size={16} /> Add
                 </button>
              </form>
            </div>
            <div className="divide-y divide-slate-100">
              {suppliers.map(sup => (
                <div key={sup.id} className="p-4 hover:bg-light px-6 flex justify-between items-center">
                  <div>
                    <div className="flex justify-between">
                      <div className="font-medium text-primary">{sup.name}</div>
                      <span className="ml-3 text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600 font-mono border border-gray-200">{sup.code}</span>
                    </div>
                    <div className="text-xs text-muted mt-1">{sup.email || 'No email provided'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                     <button 
                       onClick={() => handleEditItem(sup, 'supplier')}
                       className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                       title="Edit Supplier"
                     >
                       <Edit2 size={16} />
                     </button>
                     <button
                       onClick={() => handleCopyPortalLink(sup)}
                       className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors"
                       title="Copy Supplier Portal Link"
                     >
                       {copiedTokenId === sup.id ? <CheckCircle size={14} className="text-emerald-600" /> : <LinkIcon size={14} />}
                       {copiedTokenId === sup.id ? 'Link Copied' : 'Portal Link'}
                     </button>
                     <button
                       onClick={() => openPMAssignmentModal(sup.id)}
                       className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors"
                       title="Manage PM Assignments"
                     >
                       <SlidersHorizontal size={14} />
                       Assign PMs
                     </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CATEGORIES TAB */}
        {activeTab === 'categories' && (
            <div className="p-6">
                {renderCategoriesTab()}
            </div>
        )}

        {/* PROJECTS TAB */}
        {activeTab === 'projects' && (
          <div>
            <div className="px-6 py-4 bg-light border-b border-gray-200">
              <h3 className="font-bold text-gray-800">Project PM Management</h3>
            </div>
            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
              {projects.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">
                  No projects found
                </div>
              ) : (
                projects.map(proj => (
                  <div key={proj.id} className="p-4 hover:bg-light px-6 flex justify-between items-start">
                    <div className="flex-1">
                      <div className="font-medium text-primary">{proj.name}</div>
                      <div className="text-xs text-muted mt-1">
                        Project ID: {proj.projectId} • Supplier: {suppliers.find(s => s.id === proj.supplierId)?.name || 'Unknown'}
                      </div>
                      <div className="text-xs text-muted mt-1">
                        Current PM: <span className="font-medium text-gray-700">
                          {users.find(u => u.id === proj.pmId)?.name || 'Unassigned'}
                        </span>
                        {proj.createdBy && (
                          <>
                            {' '} • Created by: <span className="font-medium text-gray-700">
                              {users.find(u => u.id === proj.createdBy)?.name || 'Unknown'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => openProjectReassignmentModal(proj)}
                      className="flex items-center gap-1 text-xs border border-gray-200 rounded px-3 py-1.5 text-gray-600 hover:bg-light hover:text-indigo-600 transition-colors ml-4 whitespace-nowrap"
                      title="Reassign PM"
                    >
                      <SlidersHorizontal size={14} />
                      Change PM
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal for Categories/Features/Attributes/Suppliers */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-gray-800 capitalize">
                {editingItem?.id ? 'Edit' : 'Add'} {modalType}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSaveItem} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input 
                  required 
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
                  value={editingItem.name} 
                  onChange={e => setEditingItem({...editingItem, name: e.target.value})} 
                  placeholder={`e.g. ${modalType === 'category' ? 'Home Audio' : modalType === 'feature' ? 'Bluetooth' : modalType === 'attribute' ? 'Power' : 'Supplier Name'}`}
                />
              </div>

              {modalType === 'attribute' && (
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Data Type</label>
                      <select 
                        className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={editingItem.dataType}
                        onChange={e => setEditingItem({...editingItem, dataType: e.target.value})}
                      >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                      </select>
                  </div>
              )}

              {modalType === 'supplier' && (
                  <>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
                          <input 
                            required 
                            className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono" 
                            value={editingItem.code} 
                            onChange={e => setEditingItem({...editingItem, code: e.target.value})} 
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                          <input 
                            required 
                            type="email"
                            className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
                            value={editingItem.email || ''} 
                            onChange={e => setEditingItem({...editingItem, email: e.target.value})} 
                          />
                      </div>
                  </>
              )}
              
              {modalType !== 'attribute' && modalType !== 'supplier' && (
                <div className="flex items-center gap-2 cursor-pointer">
                    <input 
                    type="checkbox" 
                    className="w-4 h-4 text-indigo-600 rounded"
                    checked={editingItem.active}
                    onChange={e => setEditingItem({...editingItem, active: e.target.checked})}
                    id="activeCheck"
                    />
                    <label htmlFor="activeCheck" className="text-sm text-gray-700 select-none">Active</label>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium capitalize"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PM Assignment Modal */}
      {pmAssignmentModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-gray-800">Assign Product Managers</h3>
              <button onClick={() => setPMAssignmentModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Select which Product Managers can manage this supplier:
              </p>

              <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-md p-3 space-y-2">
                {users.filter(u => u.role === UserRole.PM).map(pm => (
                  <div key={pm.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`pm-${pm.id}`}
                      checked={selectedPMsForSupplier.includes(pm.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedPMsForSupplier([...selectedPMsForSupplier, pm.id]);
                        } else {
                          setSelectedPMsForSupplier(selectedPMsForSupplier.filter(id => id !== pm.id));
                        }
                      }}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                    <label htmlFor={`pm-${pm.id}`} className="text-sm text-gray-700 cursor-pointer flex-1">
                      {pm.name} ({pm.email})
                    </label>
                  </div>
                ))}
              </div>

              {selectedPMsForSupplier.length > 0 && (
                <div className="bg-indigo-50 border border-indigo-200 rounded p-3">
                  <p className="text-xs font-medium text-indigo-900 mb-2">Selected PMs:</p>
                  <div className="flex flex-wrap gap-2">
                    {users
                      .filter(u => selectedPMsForSupplier.includes(u.id))
                      .map(pm => (
                        <span key={pm.id} className="bg-indigo-200 text-indigo-900 text-xs px-2 py-1 rounded-full">
                          {pm.name}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  onClick={() => setPMAssignmentModalOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePMAssignment}
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium"
                >
                  Save Assignments
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project PM Reassignment Modal */}
      {projectReassignmentModalOpen && selectedProjectForReassignment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-gray-800">Reassign Project Manager</h3>
              <button onClick={() => setProjectReassignmentModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>

            <div className="space-y-4">
              <div className="bg-indigo-50 border border-indigo-200 rounded p-3">
                <p className="text-sm font-medium text-indigo-900">
                  {selectedProjectForReassignment.name}
                </p>
                <p className="text-xs text-indigo-700 mt-1">
                  Project ID: {selectedProjectForReassignment.projectId}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select New Product Manager
                </label>
                <select
                  value={newPMIdForProject}
                  onChange={(e) => setNewPMIdForProject(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="">-- Choose a PM --</option>
                  {users
                    .filter(u => u.role === UserRole.PM)
                    .map(pm => (
                      <option key={pm.id} value={pm.id}>
                        {pm.name} ({pm.email})
                      </option>
                    ))}
                </select>
              </div>

              {newPMIdForProject && newPMIdForProject !== selectedProjectForReassignment.pmId && (
                <div className="bg-amber-50 border border-amber-200 rounded p-3">
                  <p className="text-xs text-amber-900">
                    Current PM: <span className="font-medium">{users.find(u => u.id === selectedProjectForReassignment.pmId)?.name || 'Unassigned'}</span>
                  </p>
                  <p className="text-xs text-amber-900 mt-1">
                    New PM: <span className="font-medium">{users.find(u => u.id === newPMIdForProject)?.name}</span>
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  onClick={() => setProjectReassignmentModalOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (newPMIdForProject && selectedProjectForReassignment) {
                      handleReassignProject(selectedProjectForReassignment.id, newPMIdForProject);
                    } else {
                      alert('Please select a Product Manager');
                    }
                  }}
                  disabled={!newPMIdForProject}
                  className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Reassign PM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default AdminDashboard;