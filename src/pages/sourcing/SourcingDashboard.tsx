import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getRFQs, getAllSupplierProposals, deleteRFQ } from '../../services/apiService';
import { RFQ, RFQStatus, SupplierProposal, UserRole } from '../../types';
import { ShoppingBag, Plus, Search, ChevronRight, Clock, FileText, Paperclip, Download, Trash2, MoreHorizontal } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

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
          <button onClick={onConfirm} className="px-4 py-2 bg-rose-600 text-white hover:bg-red-700 rounded text-sm font-medium">Delete RFQ</button>
        </div>
      </div>
    </div>
  );
};

const SourcingDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'rfq' | 'proposals'>('rfq');
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [proposals, setProposals] = useState<SupplierProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Deletion State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [rfqToDelete, setRfqToDelete] = useState<RFQ | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [rfqData, proposalData] = await Promise.all([
          getRFQs(),
          getAllSupplierProposals()
      ]);
      setRfqs(rfqData);
      setProposals(proposalData);
    } catch (e) {
      console.error("Failed to load sourcing data", e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRFQ = async () => {
    if (!rfqToDelete) return;
    try {
        await deleteRFQ(rfqToDelete.id);
        setRfqs(prev => prev.filter(r => r.id !== rfqToDelete.id));
        setDeleteModalOpen(false);
        setRfqToDelete(null);
    } catch (e: any) {
        alert(`Failed to delete RFQ: ${e.message}`);
    }
  };

  const confirmDelete = (e: React.MouseEvent, rfq: RFQ) => {
    e.stopPropagation();
    setRfqToDelete(rfq);
    setDeleteModalOpen(true);
  };

  const filteredRfqs = rfqs.filter(r => 
    r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.rfqId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredProposals = proposals.filter(p => 
    p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.supplierName || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: RFQStatus) => {
      switch(status) {
          case RFQStatus.OPEN: return <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold uppercase">Open</span>;
          case RFQStatus.CLOSED: return <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold uppercase">Closed</span>;
          case RFQStatus.AWARDED: return <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-bold uppercase">Awarded</span>;
          default: return null;
      }
  };

  const canDelete = user?.role === UserRole.ADMIN || user?.role === UserRole.PM;

  return (
    <Layout>
      <ConfirmationModal 
        isOpen={deleteModalOpen}
        title="Delete RFQ?"
        message={`Are you sure you want to permanently delete "${rfqToDelete?.title}"? All supplier quotes associated with this RFQ will also be deleted. This action cannot be undone.`}
        onConfirm={handleDeleteRFQ}
        onCancel={() => setDeleteModalOpen(false)}
      />

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
            <ShoppingBag className="text-indigo-600" /> Sourcing & RFQ
          </h1>
          <p className="text-muted mt-1">Manage RFQs and review unsolicited supplier proposals.</p>
        </div>
        <Link 
          to="/sourcing/create"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow"
        >
          <Plus size={16} /> Create New RFQ
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
          <button 
            onClick={() => setActiveTab('rfq')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'rfq' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}
          >
              Active RFQs
          </button>
          <button 
            onClick={() => setActiveTab('proposals')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'proposals' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted hover:text-gray-700'}`}
          >
              Supplier Proposals
          </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow border border-gray-200 mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder={activeTab === 'rfq' ? "Search RFQs..." : "Search proposals..."}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="text-sm text-muted">
            {activeTab === 'rfq' ? filteredRfqs.length : filteredProposals.length} Records
        </div>
      </div>

      {/* RFQ List */}
      {activeTab === 'rfq' && (
        <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden min-h-[400px]">
            <table className="w-full text-left text-sm">
            <thead className="bg-light border-b border-gray-200">
                <tr>
                <th className="px-6 py-4 font-semibold text-gray-700">RFQ ID</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Title</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Status</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Date Created</th>
                <th className="px-6 py-4 font-semibold text-gray-700"></th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {loading ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-muted">Loading RFQs...</td></tr>
                ) : filteredRfqs.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-muted">No RFQs found. Create one to get started.</td></tr>
                ) : (
                filteredRfqs.map(rfq => (
                    <tr key={rfq.id} className="hover:bg-light group cursor-pointer" onClick={() => window.location.hash = `/sourcing/${rfq.id}`}>
                    <td className="px-6 py-4 font-mono text-muted">{rfq.rfqId}</td>
                    <td className="px-6 py-4 font-medium text-primary">{rfq.title}</td>
                    <td className="px-6 py-4">{getStatusBadge(rfq.status)}</td>
                    <td className="px-6 py-4 text-gray-600 flex items-center gap-2">
                        <Clock size={14} className="text-gray-400" />
                        {new Date(rfq.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                            <Link to={`/sourcing/${rfq.id}`} className="text-indigo-600 hover:text-blue-800 font-medium inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                View <ChevronRight size={16} />
                            </Link>
                            {canDelete && (
                                <button 
                                    onClick={(e) => confirmDelete(e, rfq)}
                                    className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                    title="Delete RFQ"
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>
                    </td>
                    </tr>
                ))
                )}
            </tbody>
            </table>
        </div>
      )}

      {/* Proposals List */}
      {activeTab === 'proposals' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {loading ? (
                  <div className="col-span-3 text-center py-12 text-gray-400">Loading Proposals...</div>
              ) : filteredProposals.length === 0 ? (
                  <div className="col-span-3 text-center py-12 text-gray-400 bg-light rounded-xl border border-dashed">No unsolicited proposals received yet.</div>
              ) : (
                  filteredProposals.map(prop => (
                      <div key={prop.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow flex flex-col">
                          <div className="flex justify-between items-start mb-4">
                              <div>
                                  <h3 className="font-bold text-gray-800">{prop.title}</h3>
                                  <p className="text-xs text-muted mt-1">From: {prop.supplierName || 'Unknown Supplier'}</p>
                              </div>
                              <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded font-medium uppercase">{prop.status}</span>
                          </div>
                          <p className="text-sm text-gray-600 mb-6 line-clamp-3 flex-1">{prop.description}</p>
                          <div className="flex justify-between items-center mt-auto pt-4 border-t border-gray-100">
                              <span className="text-xs text-gray-400">{new Date(prop.createdAt).toLocaleDateString()}</span>
                              {prop.fileUrl && (
                                  <a 
                                    href={prop.fileUrl} 
                                    download={prop.title}
                                    className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-blue-800 hover:bg-indigo-50 px-3 py-1.5 rounded transition-colors"
                                  >
                                      <Download size={14} /> Download
                                  </a>
                              )}
                          </div>
                      </div>
                  ))
              )}
          </div>
      )}
    </Layout>
  );
};

export default SourcingDashboard;