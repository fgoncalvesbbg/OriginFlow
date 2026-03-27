import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { convertProposalToRFQ, getSuppliers } from '../../services/apiService';
import { SupplierProposal, Supplier } from '../../types';
import { useToast } from '../../hooks';
import { useAuth } from '../../context/AuthContext';

interface ConvertProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  proposal: SupplierProposal | null;
  onSuccess: (rfqId: string) => void;
}

const ConvertProposalModal: React.FC<ConvertProposalModalProps> = ({ isOpen, onClose, proposal, onSuccess }) => {
  const { addToast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);

  useEffect(() => {
    if (isOpen && proposal) {
      setTitle(proposal.title);
      setDescription(proposal.description);
      setSelectedSupplierIds(new Set([proposal.supplierId])); // Include original proposer by default

      const loadSuppliers = async () => {
        try {
          const sups = await getSuppliers();
          setSuppliers(sups);
        } catch (e) {
          console.error('Failed to load suppliers', e);
        } finally {
          setLoadingSuppliers(false);
        }
      };
      loadSuppliers();
    }
  }, [isOpen, proposal]);

  const toggleSupplier = (id: string) => {
    const next = new Set(selectedSupplierIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSupplierIds(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !proposal) return;

    if (selectedSupplierIds.size === 0) {
      addToast('Please select at least one supplier.', 'error');
      return;
    }

    setLoading(true);

    try {
      const rfq = await convertProposalToRFQ(
        proposal.id,
        user.id,
        Array.from(selectedSupplierIds)
      );

      addToast('Proposal converted to RFQ successfully!', 'success');
      onClose();
      onSuccess(rfq.id);
    } catch (e: any) {
      console.error(e);
      addToast('Error converting proposal: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !proposal) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Convert Proposal to RFQ</h2>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Proposal Summary */}
          <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
            <h3 className="font-bold text-gray-900 mb-2">From: {proposal.supplierName}</h3>
            <p className="text-sm text-gray-700">Submitted: {new Date(proposal.createdAt).toLocaleDateString()}</p>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">RFQ Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
              disabled={loading}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
              disabled={loading}
            />
          </div>

          {/* Product Information */}
          {proposal.categoryId && (
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 className="font-bold text-gray-900 mb-3">Product Information</h3>
              {proposal.thumbnailUrl && (
                <div className="mb-4">
                  <img
                    src={proposal.thumbnailUrl}
                    alt="Product thumbnail"
                    className="w-full max-h-48 object-cover rounded-lg"
                  />
                </div>
              )}
              {proposal.attributes && proposal.attributes.length > 0 && (
                <div className="space-y-2">
                  {proposal.attributes.map((attr, idx) => (
                    <div key={idx} className="text-sm">
                      <span className="font-medium text-gray-700">{attr.name}:</span>
                      <span className="text-gray-600 ml-2">{attr.value}</span>
                    </div>
                  ))}
                </div>
              )}
              {proposal.attachments && proposal.attachments.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-sm font-medium text-gray-700 mb-2">Attachments ({proposal.attachments.length})</p>
                  <ul className="text-sm text-gray-600 space-y-1">
                    {proposal.attachments.map((att, idx) => (
                      <li key={idx}>• {att.name}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Supplier Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Select Suppliers to Invite <span className="text-rose-600">*</span>
            </label>
            {loadingSuppliers ? (
              <div className="text-center py-4 text-gray-500">Loading suppliers...</div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto border border-gray-300 rounded-lg p-3">
                {suppliers.map(sup => (
                  <label key={sup.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedSupplierIds.has(sup.id)}
                      onChange={() => toggleSupplier(sup.id)}
                      disabled={loading}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    <div className="flex-1 text-sm">
                      <div className="font-medium text-gray-900">{sup.name}</div>
                      <div className="text-gray-500 text-xs">{sup.code}</div>
                    </div>
                    {sup.id === proposal.supplierId && (
                      <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded">Original Proposer</span>
                    )}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-2">
              {selectedSupplierIds.size} supplier(s) selected
            </p>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || selectedSupplierIds.size === 0}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Converting...' : 'Convert to RFQ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ConvertProposalModal;
