import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getComplianceRequests, getSuppliers, getCategories, getProjects, deleteComplianceRequest } from '../../services/apiService';
import { ComplianceRequest, Supplier, CategoryL3, ComplianceRequestStatus, Project, UserRole } from '../../types';
import { Plus, Search, Filter, ShieldCheck, ChevronRight, Calendar, BookOpen, Trash2 } from 'lucide-react';
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
          <button onClick={onConfirm} className="px-4 py-2 bg-rose-600 text-white hover:bg-red-700 rounded text-sm font-medium">Delete</button>
        </div>
      </div>
    </div>
  );
};

const ComplianceDashboard: React.FC = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState<ComplianceRequest[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Deletion State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [requestToDelete, setRequestToDelete] = useState<ComplianceRequest | null>(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const [reqs, supps, cats, projs] = await Promise.all([
      getComplianceRequests(),
      getSuppliers(),
      getCategories(),
      getProjects()
    ]);
    setRequests(reqs);
    setSuppliers(supps);
    setCategories(cats);
    setProjects(projs);
    setLoading(false);
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || 'Unknown';
  const getCategoryName = (id: string) => categories.find(c => c.id === id)?.name || 'Unknown';
  const getProjectBusinessId = (internalId: string) => {
    const p = projects.find(proj => proj.id === internalId);
    return p?.projectId || '-';
  };

  const filteredRequests = requests.filter(r => 
    r.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.requestId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status: ComplianceRequestStatus) => {
    switch (status) {
      case ComplianceRequestStatus.PENDING_SUPPLIER: return 'bg-amber-100 text-amber-800';
      case ComplianceRequestStatus.SUBMITTED: return 'bg-indigo-100 text-blue-800';
      case ComplianceRequestStatus.UNDER_REVIEW: return 'bg-purple-100 text-purple-800';
      case ComplianceRequestStatus.APPROVED: return 'bg-emerald-100 text-emerald-800';
      case ComplianceRequestStatus.REJECTED: return 'bg-rose-100 text-rose-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'No Deadline';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, { timeZone: 'UTC' });
  };

  const confirmDelete = (req: ComplianceRequest) => {
    setRequestToDelete(req);
    setDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!requestToDelete) return;
    try {
      await deleteComplianceRequest(requestToDelete.id);
      setRequests(requests.filter(r => r.id !== requestToDelete.id));
      setDeleteModalOpen(false);
      setRequestToDelete(null);
    } catch (e: any) {
      alert(`Failed to delete: ${e.message}`);
    }
  };

  return (
    <Layout>
      <ConfirmationModal 
        isOpen={deleteModalOpen}
        title="Delete TCF Request"
        message={`Are you sure you want to permanently delete the request "${requestToDelete?.requestId}" for ${requestToDelete?.projectName}? This action cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteModalOpen(false)}
      />

      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
            <ShieldCheck className="text-indigo-600" /> Compliance Dashboard
          </h2>
          <p className="text-muted mt-1">Manage TCF requests and product compliance.</p>
        </div>
        <div className="flex gap-3">
          <Link 
            to="/compliance/library"
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 hover:bg-light text-sm font-medium"
          >
            <BookOpen size={16} /> Library
          </Link>
          <Link 
            to="/compliance/create"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium"
          >
            <Plus size={16} /> New TCF Request
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow border border-gray-200 mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder="Search project or TCF ID..." 
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-light text-sm">
          <Filter size={16} /> Filter
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-light border-b border-gray-200">
            <tr>
              <th className="px-6 py-4 font-semibold text-gray-700">Request ID</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Project ID</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Project</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Supplier</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Category</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Deadline</th>
              <th className="px-6 py-4 font-semibold text-gray-700">Status</th>
              <th className="px-6 py-4 font-semibold text-gray-700"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted">Loading...</td></tr>
            ) : filteredRequests.length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted">No requests found.</td></tr>
            ) : (
              filteredRequests.map(req => (
                <tr key={req.id} className="hover:bg-light group">
                  <td className="px-6 py-4 font-medium text-primary">{req.requestId}</td>
                  <td className="px-6 py-4 font-mono text-xs text-muted">{getProjectBusinessId(req.projectId)}</td>
                  <td className="px-6 py-4 text-gray-700">{req.projectName}</td>
                  <td className="px-6 py-4 text-gray-600">{getSupplierName(req.supplierId)}</td>
                  <td className="px-6 py-4 text-gray-600">{getCategoryName(req.categoryId)}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {req.deadline ? (
                      <span className="flex items-center gap-1.5">
                        <Calendar size={14} className="text-gray-400" />
                        {formatDate(req.deadline)}
                      </span>
                    ) : <span className="text-gray-400 italic">None</span>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(req.status)}`}>
                      {req.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link 
                        to={`/compliance/request/${req.id}`}
                        className="text-indigo-600 hover:text-blue-800 font-medium inline-flex items-center"
                      >
                        View <ChevronRight size={16} />
                      </Link>
                      {user?.role === UserRole.ADMIN && (
                        <button 
                          onClick={() => confirmDelete(req)}
                          className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                          title="Delete Request"
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
    </Layout>
  );
};

export default ComplianceDashboard;