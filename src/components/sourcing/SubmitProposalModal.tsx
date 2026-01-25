import React, { useState, useEffect } from 'react';
import { X, Loader2, Layers, Image as ImageIcon, Upload, FileText } from 'lucide-react';
import { createEnhancedSupplierProposal, getCategories, getCategoryAttributes } from '../../services/apiService';
import { CategoryL3, CategoryAttribute, RFQAttributeValue, RFQAttachment } from '../../types';
import { useToast } from '../../hooks';

interface SubmitProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplierId: string;
  onSuccess: () => void;
}

const SubmitProposalModal: React.FC<SubmitProposalModalProps> = ({ isOpen, onClose, supplierId, onSuccess }) => {
  const { success, error: showError } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [allAttributes, setAllAttributes] = useState<CategoryAttribute[]>([]);

  // Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('');
  const [attachments, setAttachments] = useState<RFQAttachment[]>([]);

  // Dynamic attributes state
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
  const [attributeTypes, setAttributeTypes] = useState<Record<string, 'fixed' | 'range' | 'text'>>({});

  useEffect(() => {
    if (isOpen) {
      const load = async () => {
        try {
          const [c, a] = await Promise.all([getCategories(), getCategoryAttributes()]);
          setCategories(c);
          setAllAttributes(a);
        } catch (e) {
          console.error('Failed to load categories', e);
        } finally {
          setLoading(false);
        }
      };
      load();
    }
  }, [isOpen]);

  const handleCategoryChange = (catId: string) => {
    setSelectedCategory(catId);
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
    setAttributeValues(prev => ({ ...prev, [attrId]: '' }));
  };

  const handleThumbnailUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        showError('File too large. Max 5MB.');
        return;
      }
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
      if (file.size > 5 * 1024 * 1024) {
        showError('File too large. Max 5MB per file.');
        return;
      }
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
    if (!title.trim()) {
      showError('Please enter a proposal title.');
      return;
    }

    setSubmitting(true);

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
      const categoryParam = selectedCategory && selectedCategory !== '' ? selectedCategory : undefined;

      await createEnhancedSupplierProposal(
        supplierId,
        title,
        description,
        categoryParam,
        attributesPayload,
        thumbnailUrl,
        attachments
      );

      success('Proposal submitted successfully!');
      resetForm();
      onClose();
      onSuccess();
    } catch (e: any) {
      console.error(e);
      const errorMessage = e?.message || (typeof e === 'string' ? e : 'An error occurred');
      showError('Error submitting proposal: ' + errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setSelectedCategory('');
    setThumbnailUrl('');
    setAttachments([]);
    setAttributeValues({});
    setAttributeTypes({});
  };

  const currentCatAttributes = allAttributes.filter(a => a.categoryId === selectedCategory);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Submit New Proposal</h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Info */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Proposal Title <span className="text-rose-600">*</span>
            </label>
            <input
              required
              type="text"
              className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="e.g., New Ultra-Fast Wireless Charger"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
              rows={3}
              placeholder="Describe your product, its features, and why it would be valuable..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Product Image */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Reference Image (Optional)</label>
            <div className="flex items-start gap-4">
              <div className="w-24 h-24 bg-light border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center overflow-hidden relative flex-shrink-0">
                {thumbnailUrl ? (
                  <img src={thumbnailUrl} alt="Thumbnail" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="text-gray-300" size={24} />
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={handleThumbnailUpload}
                  disabled={submitting}
                />
              </div>
              <div className="flex-1 text-xs text-gray-600">
                <p>Upload a product photo</p>
                <p className="mt-1 text-gray-500">JPG or PNG, max 5MB</p>
                {thumbnailUrl && (
                  <button
                    type="button"
                    onClick={() => setThumbnailUrl('')}
                    className="text-rose-600 mt-2 hover:underline text-xs"
                  >
                    Remove image
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Category & Attributes */}
          <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
            <label className="block text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
              <Layers size={16} className="text-indigo-600" /> Product Category (Optional)
            </label>
            <select
              className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
              value={selectedCategory}
              onChange={(e) => handleCategoryChange(e.target.value)}
              disabled={submitting}
            >
              <option value="">-- Select a Category (Optional) --</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {currentCatAttributes.length > 0 && (
              <div className="mt-4 space-y-4 pt-4 border-t border-indigo-200">
                {currentCatAttributes.map(attr => (
                  <div key={attr.id}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{attr.name}</label>

                    {attr.dataType === 'number' && (
                      <div className="flex gap-2 mb-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            checked={attributeTypes[attr.id] === 'fixed'}
                            onChange={() => handleAttributeTypeChange(attr.id, 'fixed')}
                            disabled={submitting}
                          />
                          Fixed Value
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            checked={attributeTypes[attr.id] === 'range'}
                            onChange={() => handleAttributeTypeChange(attr.id, 'range')}
                            disabled={submitting}
                          />
                          Range (Min-Max)
                        </label>
                      </div>
                    )}

                    <input
                      type={attr.dataType === 'number' ? 'text' : 'text'}
                      className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder={attr.dataType === 'number' && attributeTypes[attr.id] === 'range' ? 'e.g., 100-200' : 'Enter value'}
                      value={attributeValues[attr.id] || ''}
                      onChange={(e) => setAttributeValues(prev => ({ ...prev, [attr.id]: e.target.value }))}
                      disabled={submitting}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attachments */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Attachments (Optional)</label>
            <div className="space-y-2">
              {attachments.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between bg-light p-2 rounded border border-gray-200 text-sm">
                  <span className="flex items-center gap-2 truncate max-w-[300px]">
                    <FileText size={14} className="text-gray-400" /> {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    disabled={submitting}
                    className="text-gray-400 hover:text-rose-600"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}

              <label className="flex items-center justify-center gap-2 w-full p-3 border border-dashed border-indigo-300 bg-indigo-50 text-indigo-600 rounded-lg cursor-pointer hover:bg-indigo-100 transition-colors text-sm font-medium">
                <Upload size={16} /> Add Attachment
                <input
                  type="file"
                  className="hidden"
                  onChange={handleAttachmentUpload}
                  disabled={submitting}
                />
              </label>
              <p className="text-xs text-gray-500">Max 5MB per file. Specs, drawings, certificates, etc.</p>
            </div>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 size={16} className="animate-spin" />}
              {submitting ? 'Submitting...' : 'Submit Proposal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SubmitProposalModal;
