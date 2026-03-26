
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getSuppliers, createRFQ, getCategories, getCategoryAttributes } from '../../services';
import { Supplier, CategoryL3, CategoryAttribute, RFQAttributeValue, RFQAttachment } from '../../types';
import { ArrowLeft, Loader2, Users, Layers, Image as ImageIcon, Upload, Paperclip, X, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const CreateRFQ: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [allAttributes, setAllAttributes] = useState<CategoryAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // RFQ Fields
  const [title, setTitle] = useState('');
  const [rfqId, setRfqId] = useState(`RFQ-2025-${Math.floor(Math.random()*1000).toString().padStart(3,'0')}`);
  const [description, setDescription] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<Set<string>>(new Set());
  
  // File States
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [attachments, setAttachments] = useState<RFQAttachment[]>([]);

  // Dynamic Attributes State
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({}); // AttrID -> Value
  const [attributeTypes, setAttributeTypes] = useState<Record<string, 'fixed' | 'range' | 'text'>>({}); // AttrID -> Type choice

  useEffect(() => {
    const load = async () => {
        const [s, c, a] = await Promise.all([getSuppliers(), getCategories(), getCategoryAttributes()]);
        setSuppliers(s);
        setCategories(c);
        setAllAttributes(a);
        setLoading(false);
    };
    load();
  }, []);

  const toggleSupplier = (id: string) => {
      const next = new Set(selectedSupplierIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedSupplierIds(next);
  };

  const handleCategoryChange = (catId: string) => {
      setSelectedCategory(catId);
      // Reset attributes for new category
      const catAttrs = allAttributes.filter(a => a.categoryId === catId);
      const initialTypes: Record<string, any> = {};
      const initialValues: Record<string, string> = {};
      
      catAttrs.forEach(attr => {
          initialTypes[attr.id] = attr.dataType === 'number' ? 'fixed' : 'text';
          initialValues[attr.id] = '';
      });
      
      setAttributeTypes(initialTypes);
      setAttributeValues(initialValues);
  };

  const handleAttributeTypeChange = (attrId: string, type: 'fixed' | 'range') => {
      setAttributeTypes(prev => ({ ...prev, [attrId]: type }));
      // Clear value when switching type to avoid confusion
      setAttributeValues(prev => ({ ...prev, [attrId]: '' }));
  };

  // File Helpers
  const handleThumbnailUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onloadend = () => {
              setThumbnailUrl(reader.result as string);
          };
          reader.readAsDataURL(file);
      }
  };

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onloadend = () => {
              const newAttachment: RFQAttachment = {
                  name: file.name,
                  url: reader.result as string,
                  type: file.type || 'application/octet-stream'
              };
              setAttachments(prev => [...prev, newAttachment]);
          };
          reader.readAsDataURL(file);
      }
  };

  const removeAttachment = (index: number) => {
      setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user) return;
      if (selectedSupplierIds.size === 0) {
          alert("Please select at least one supplier.");
          return;
      }
      setSubmitting(true);
      
      // Prepare Attributes Payload
      const attributesPayload: RFQAttributeValue[] = [];
      const currentCatAttributes = allAttributes.filter(a => a.categoryId === selectedCategory);
      
      currentCatAttributes.forEach(attr => {
          const val = attributeValues[attr.id];
          if (val) {
              attributesPayload.push({
                  attributeId: attr.id,
                  name: attr.name,
                  value: val,
                  type: attributeTypes[attr.id]
              });
          }
      });

      try {
          // Ensure we pass undefined if selectedCategory is an empty string
          const categoryParam = selectedCategory && selectedCategory !== '' ? selectedCategory : undefined;

          const rfq = await createRFQ(
              title, 
              rfqId, 
              description, 
              Array.from(selectedSupplierIds), 
              user.id, 
              categoryParam,
              attributesPayload,
              thumbnailUrl,
              attachments
          );
          navigate(`/sourcing/${rfq.id}`);
      } catch (e: any) {
          console.error(e);
          alert("Error creating RFQ: " + e.message);
      } finally {
          setSubmitting(false);
      }
  };

  const currentCatAttributes = allAttributes.filter(a => a.categoryId === selectedCategory);

  if (loading) return <Layout><div>Loading...</div></Layout>;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <button onClick={() => navigate('/sourcing')} className="flex items-center text-muted hover:text-gray-800 mb-6 text-sm">
          <ArrowLeft size={16} className="mr-1" /> Back to Sourcing
        </button>

        <h1 className="text-3xl font-bold text-primary mb-6">Create New RFQ</h1>
        
        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl shadow border border-gray-200 space-y-8">
            
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">RFQ Title</label>
                    <input 
                        required 
                        className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="e.g. Wireless Earbuds Gen 2 Sourcing"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">RFQ ID</label>
                    <input 
                        required 
                        className="w-full border border-gray-300 rounded p-2 bg-light font-mono text-sm"
                        value={rfqId}
                        onChange={e => setRfqId(e.target.value)}
                    />
                </div>
            </div>

            {/* Product Image & Attachments */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Reference Image (Thumbnail)</label>
                    <div className="flex items-start gap-4">
                        <div className="w-32 h-32 bg-light border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center overflow-hidden relative">
                            {thumbnailUrl ? (
                                <img src={thumbnailUrl} alt="Thumbnail" className="w-full h-full object-cover" />
                            ) : (
                                <ImageIcon className="text-gray-300" size={32} />
                            )}
                            <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleThumbnailUpload} />
                        </div>
                        <div className="flex-1 text-xs text-muted">
                            <p>Upload a reference image for the product.</p>
                            <p className="mt-1">Format: JPG, PNG.</p>
                            {thumbnailUrl && <button type="button" onClick={() => setThumbnailUrl('')} className="text-rose-600 mt-2 hover:underline">Remove</button>}
                        </div>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Attachments (Specs, Drawings)</label>
                    <div className="space-y-2">
                        {attachments.map((file, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-light p-2 rounded border border-gray-200 text-sm">
                                <span className="flex items-center gap-2 truncate max-w-[200px]">
                                    <FileText size={14} className="text-gray-400" /> {file.name}
                                </span>
                                <button type="button" onClick={() => removeAttachment(idx)} className="text-gray-400 hover:text-rose-600"><X size={14}/></button>
                            </div>
                        ))}
                        
                        <label className="flex items-center justify-center gap-2 w-full p-2 border border-dashed border-indigo-300 bg-indigo-50 text-indigo-600 rounded cursor-pointer hover:bg-indigo-100 transition-colors text-sm font-medium">
                            <Upload size={14} /> Add Attachment
                            <input type="file" className="hidden" onChange={handleAttachmentUpload} />
                        </label>
                    </div>
                </div>
            </div>

            {/* Category & Attributes */}
            <div className="bg-light p-6 rounded-xl border border-gray-200">
                <div className="mb-6">
                    <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                        <Layers size={16} /> Product Category
                    </label>
                    <select 
                        className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                        value={selectedCategory}
                        onChange={(e) => handleCategoryChange(e.target.value)}
                    >
                        <option value="">-- Select a Category --</option>
                        {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <p className="text-xs text-muted mt-1">Selecting a category loads specific technical attributes.</p>
                </div>

                {selectedCategory && currentCatAttributes.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in">
                        {currentCatAttributes.map(attr => (
                            <div key={attr.id} className="bg-white p-4 rounded border border-gray-200 shadow">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-sm font-bold text-gray-800">{attr.name}</label>
                                    {attr.dataType === 'number' && (
                                        <div className="flex bg-gray-100 rounded p-0.5 text-[10px] font-bold">
                                            <button 
                                                type="button"
                                                onClick={() => handleAttributeTypeChange(attr.id, 'fixed')}
                                                className={`px-2 py-0.5 rounded transition-colors ${attributeTypes[attr.id] === 'fixed' ? 'bg-white shadow text-indigo-600' : 'text-muted'}`}
                                            >
                                                Fixed
                                            </button>
                                            <button 
                                                type="button"
                                                onClick={() => handleAttributeTypeChange(attr.id, 'range')}
                                                className={`px-2 py-0.5 rounded transition-colors ${attributeTypes[attr.id] === 'range' ? 'bg-white shadow text-indigo-600' : 'text-muted'}`}
                                            >
                                                Range
                                            </button>
                                        </div>
                                    )}
                                </div>
                                
                                {attributeTypes[attr.id] === 'range' ? (
                                    <input 
                                        type="text"
                                        className="w-full border border-gray-300 rounded p-2 text-sm focus:border-indigo-500 outline-none"
                                        placeholder="e.g. 100-200"
                                        value={attributeValues[attr.id] || ''}
                                        onChange={e => setAttributeValues({...attributeValues, [attr.id]: e.target.value})}
                                    />
                                ) : (
                                    <input 
                                        type={attr.dataType === 'number' ? 'number' : 'text'}
                                        className="w-full border border-gray-300 rounded p-2 text-sm focus:border-indigo-500 outline-none"
                                        placeholder={attr.dataType === 'number' ? 'e.g. 100' : 'Specification...'}
                                        value={attributeValues[attr.id] || ''}
                                        onChange={e => setAttributeValues({...attributeValues, [attr.id]: e.target.value})}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                )}
                
                {selectedCategory && currentCatAttributes.length === 0 && (
                    <div className="text-center py-4 text-gray-400 italic text-sm">
                        No specific attributes defined for this category yet.
                    </div>
                )}
            </div>

            {/* Description */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Additional Specifications / Description</label>
                <textarea 
                    required
                    className="w-full border border-gray-300 rounded p-3 h-32 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    placeholder="Describe other requirements, materials, standards, etc..."
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                />
            </div>

            {/* Suppliers */}
            <div className="border-t border-gray-100 pt-6">
                <label className="block text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                    <Users size={16} /> Select Suppliers to Invite
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-60 overflow-y-auto pr-2">
                    {suppliers.map(s => (
                        <div 
                            key={s.id} 
                            onClick={() => toggleSupplier(s.id)}
                            className={`p-3 border rounded-xl cursor-pointer transition-colors flex items-center gap-3 ${selectedSupplierIds.has(s.id) ? 'bg-indigo-50 border-indigo-200' : 'hover:bg-light border-gray-200'}`}
                        >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedSupplierIds.has(s.id) ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300 bg-white'}`}>
                                {selectedSupplierIds.has(s.id) && <div className="w-2 h-2 bg-white rounded-full" />}
                            </div>
                            <div>
                                <div className="text-sm font-medium text-gray-800">{s.name}</div>
                                <div className="text-xs text-muted">{s.code}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex justify-end pt-4 gap-3">
                <button type="button" onClick={() => navigate('/sourcing')} className="px-6 py-2 text-gray-600 hover:bg-light rounded">Cancel</button>
                <button type="submit" disabled={submitting} className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                    {submitting && <Loader2 size={16} className="animate-spin" />}
                    {submitting ? 'Creating...' : 'Create & Send Invites'}
                </button>
            </div>
        </form>
      </div>
    </Layout>
  );
};

export default CreateRFQ;
