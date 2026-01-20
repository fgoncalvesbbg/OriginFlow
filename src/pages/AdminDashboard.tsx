import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { 
  getProfiles, updateUserRole, 
  getSuppliers, createSupplier, ensureSupplierToken, updateSupplier,
  getCategories, getProductFeatures, saveCategory, saveProductFeature,
  deleteCategory, deleteProductFeature,
  getCategoryAttributes, saveCategoryAttribute, deleteCategoryAttribute,
  generateUUID
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
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded text-sm">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded text-sm font-medium">Delete</button>
        </div>
      </div>
    </div>
  );
};

const AdminDashboard: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'users' | 'suppliers' | 'categories'>('users');
  
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
    const [u, s, c, f, a] = await Promise.all([
      getProfiles(), 
      getSuppliers(),
      getCategories(),
      getProductFeatures(),
      getCategoryAttributes()
    ]);
    setUsers(u);
    setSuppliers(s);
    setCategories(c);
    setFeatures(f);
    setAttributes(a);
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
                    className="mb-6 text-sm text-slate-500 hover:text-slate-800 flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-slate-100 w-fit"
                >
                    <ArrowLeft size={16} /> Back to Categories
                </button>

                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-xl font-bold text-slate-900">{category?.name}</h3>
                        <div className="flex gap-4 mt-2">
                            <button 
                                onClick={() => setDetailView('features')}
                                className={`text-sm font-medium pb-2 border-b-2 transition-colors ${detailView === 'features' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                            >
                                Compliance Features
                            </button>
                            <button 
                                onClick={() => setDetailView('attributes')}
                                className={`text-sm font-medium pb-2 border-b-2 transition-colors ${detailView === 'attributes' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                            >
                                Sourcing Attributes
                            </button>
                        </div>
                    </div>
                    <button 
                        onClick={() => openAddModal(detailView === 'features' ? 'feature' : 'attribute')} 
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium shadow-sm"
                    >
                        <Plus size={16} /> Add {detailView === 'features' ? 'Feature' : 'Attribute'}
                    </button>
                </div>

                {detailView === 'features' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {features.filter(f => f.categoryId === selectedCategoryDetail).map(f => (
                            <div key={f.id} className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm hover:shadow-md flex justify-between items-center group">
                                <div>
                                    <div className="font-bold text-slate-800">{f.name}</div>
                                    <div className="text-xs text-slate-400 mt-1">ID: {f.id}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${f.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                                        {f.active ? 'Active' : 'Inactive'}
                                    </span>
                                    <button onClick={() => handleEditItem(f, 'feature')} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => handleDeleteFeature(f.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {features.filter(f => f.categoryId === selectedCategoryDetail).length === 0 && (
                            <div className="col-span-2 text-center py-10 text-slate-400 bg-slate-50 rounded-lg border border-dashed">
                                No features defined. Features are boolean flags used for Compliance logic.
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {attributes.filter(a => a.categoryId === selectedCategoryDetail).map(a => (
                            <div key={a.id} className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm hover:shadow-md flex justify-between items-center group">
                                <div>
                                    <div className="font-bold text-slate-800">{a.name}</div>
                                    <div className="text-xs text-slate-500 mt-1 capitalize badge bg-slate-100 inline-block px-2 py-0.5 rounded border border-slate-200">Type: {a.dataType}</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => handleEditItem(a, 'attribute')} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => handleDeleteAttribute(a.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {attributes.filter(a => a.categoryId === selectedCategoryDetail).length === 0 && (
                            <div className="col-span-2 text-center py-10 text-slate-400 bg-slate-50 rounded-lg border border-dashed">
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
            <div className="flex justify-between items-center px-6 py-4 bg-slate-50 border-b border-slate-200">
                <h3 className="font-bold text-slate-800">Product Categories</h3>
                <button onClick={() => openAddModal('category')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium shadow-sm">
                    <Plus size={16} /> Add Category
                </button>
            </div>
            <div className="divide-y divide-slate-100">
                {categories.map(c => {
                    const featCount = features.filter(f => f.categoryId === c.id).length;
                    const attrCount = attributes.filter(a => a.categoryId === c.id).length;
                    return (
                        <div key={c.id} className="p-4 hover:bg-slate-50 px-6 transition-colors">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div className="flex-1">
                                    <div className="font-medium text-slate-900 flex items-center gap-2 text-lg">
                                        {c.name}
                                        {c.isFinalized && (
                                            <span title="Finalized (Requirements Locked)" className="text-blue-600">
                                                <CheckCircle size={18} />
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-3 text-xs text-slate-500 mt-1 items-center">
                                        <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{featCount} Features</span>
                                        <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{attrCount} Attributes</span>
                                        <span className={`px-2 py-0.5 rounded font-medium ${c.active ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                                            {c.active ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-3">
                                    <button 
                                        onClick={() => { setSelectedCategoryDetail(c.id); setDetailView('features'); }}
                                        className="text-sm font-medium text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded border border-transparent hover:border-blue-100 flex items-center gap-1"
                                    >
                                        <SlidersHorizontal size={14} /> Configure
                                    </button>

                                    <div className="h-6 w-px bg-slate-200 mx-1"></div>

                                    <button 
                                        onClick={() => toggleCategoryFinalized(c)}
                                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors ${
                                            c.isFinalized 
                                            ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' 
                                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700'
                                        }`}
                                        title="Finalizing signals that requirements are complete"
                                    >
                                        {c.isFinalized ? 'Finalized' : 'Mark Final'}
                                    </button>
                                    
                                    <button 
                                        onClick={() => handleEditItem(c, 'category')}
                                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full"
                                    >
                                        <Edit2 size={16} />
                                    </button>

                                    <button 
                                        onClick={() => handleDeleteCategory(c.id)}
                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full"
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
                    <div className="p-8 text-center text-slate-400">No categories found.</div>
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

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheck className="text-purple-600" /> Admin Console
        </h2>
        <p className="text-slate-500">System configuration and master data management.</p>
      </div>

      <div className="flex border-b border-slate-200 mb-6 overflow-x-auto">
        <button onClick={() => setActiveTab('users')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'users' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          <Users size={18} /> Users & Roles
        </button>
        <button onClick={() => setActiveTab('suppliers')} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'suppliers' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          <Truck size={18} /> Suppliers
        </button>
        <button onClick={() => { setActiveTab('categories'); setSelectedCategoryDetail(null); }} className={`px-6 py-3 text-sm font-medium whitespace-nowrap border-b-2 flex items-center gap-2 ${activeTab === 'categories' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
          <Layers size={18} /> Product Categories
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[400px]">
        
        {/* USERS TAB */}
        {activeTab === 'users' && (
          <div>
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-800">Registered Users</h3>
              <span className="text-xs bg-slate-200 px-2 py-1 rounded text-slate-600">{users.length} Users</span>
            </div>
            <div className="divide-y divide-slate-100">
              {users.map(user => (
                <div key={user.id} className="p-4 flex items-center justify-between hover:bg-slate-50 px-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold text-xs">
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{user.name || 'No Name'}</div>
                      <div className="text-xs text-slate-500">{user.email}</div>
                    </div>
                  </div>
                  <button onClick={() => toggleRole(user.id, user.role)} className={`text-xs px-3 py-1 rounded-full font-bold transition-colors ${user.role === UserRole.ADMIN ? 'bg-purple-100 text-purple-700 hover:bg-purple-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
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
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
               <h3 className="font-bold text-slate-800">Supplier Database</h3>
            </div>
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
              <h4 className="text-sm font-bold text-slate-700 mb-3">Add New Supplier</h4>
              <form onSubmit={handleCreateSupplier} className="flex flex-col sm:flex-row gap-3">
                 <input required placeholder="Supplier Name" className="border rounded px-3 py-2 text-sm flex-[2]" value={newSupName} onChange={e => setNewSupName(e.target.value)} />
                 <input required placeholder="Code (e.g. SUP-001)" className="border rounded px-3 py-2 text-sm flex-1" value={newSupCode} onChange={e => setNewSupCode(e.target.value)} />
                 <input placeholder="Contact Email" className="border rounded px-3 py-2 text-sm flex-1" value={newSupEmail} onChange={e => setNewSupEmail(e.target.value)} />
                 <button type="submit" className="bg-purple-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-purple-700 flex items-center justify-center gap-1">
                   <Plus size={16} /> Add
                 </button>
              </form>
            </div>
            <div className="divide-y divide-slate-100">
              {suppliers.map(sup => (
                <div key={sup.id} className="p-4 hover:bg-slate-50 px-6 flex justify-between items-center">
                  <div>
                    <div className="flex justify-between">
                      <div className="font-medium text-slate-900">{sup.name}</div>
                      <span className="ml-3 text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono border border-slate-200">{sup.code}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{sup.email || 'No email provided'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                     <button 
                       onClick={() => handleEditItem(sup, 'supplier')}
                       className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                       title="Edit Supplier"
                     >
                       <Edit2 size={16} />
                     </button>
                     <button 
                       onClick={() => handleCopyPortalLink(sup)}
                       className="flex items-center gap-1 text-xs border border-slate-200 rounded px-3 py-1.5 text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors"
                       title="Copy Supplier Portal Link"
                     >
                       {copiedTokenId === sup.id ? <CheckCircle size={14} className="text-green-600" /> : <LinkIcon size={14} />}
                       {copiedTokenId === sup.id ? 'Link Copied' : 'Portal Link'}
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
      </div>

      {/* Add/Edit Modal for Categories/Features/Attributes/Suppliers */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-lg text-slate-800 capitalize">
                {editingItem?.id ? 'Edit' : 'Add'} {modalType}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSaveItem} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input 
                  required 
                  className="w-full border border-slate-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={editingItem.name} 
                  onChange={e => setEditingItem({...editingItem, name: e.target.value})} 
                  placeholder={`e.g. ${modalType === 'category' ? 'Home Audio' : modalType === 'feature' ? 'Bluetooth' : modalType === 'attribute' ? 'Power' : 'Supplier Name'}`}
                />
              </div>

              {modalType === 'attribute' && (
                  <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Data Type</label>
                      <select 
                        className="w-full border border-slate-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none"
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
                          <label className="block text-sm font-medium text-slate-700 mb-1">Code</label>
                          <input 
                            required 
                            className="w-full border border-slate-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" 
                            value={editingItem.code} 
                            onChange={e => setEditingItem({...editingItem, code: e.target.value})} 
                          />
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                          <input 
                            required 
                            type="email"
                            className="w-full border border-slate-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
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
                    className="w-4 h-4 text-blue-600 rounded"
                    checked={editingItem.active}
                    onChange={e => setEditingItem({...editingItem, active: e.target.checked})}
                    id="activeCheck"
                    />
                    <label htmlFor="activeCheck" className="text-sm text-slate-700 select-none">Active</label>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md text-sm font-medium capitalize"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default AdminDashboard;