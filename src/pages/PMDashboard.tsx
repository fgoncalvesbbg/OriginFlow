
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProjects, getSuppliers, getDashboardStats, updateProject, deleteProject } from '../services/apiService';
import { Project, Supplier, UserRole, DashboardStats, ProjectOverallStatus } from '../types';
import Layout from '../components/Layout';
import { StatusBadge } from '../components/StatusBadge';
import { ChevronRight, Search, Filter, Layout as LayoutIcon, Clock, FileText, Trash2, Archive, MoreHorizontal, AlertTriangle, RefreshCw, ShoppingBag, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const PMDashboard: React.FC = () => {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [stats, setStats] = useState<(DashboardStats & { newProposals: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [pData, sData, statsData] = await Promise.all([
        getProjects(), 
        getSuppliers(),
        getDashboardStats()
      ]);
      setProjects(pData);
      setSuppliers(sData);
      setStats(statsData as any);
    } catch (e: any) {
      console.error("Failed to load dashboard data", e);
      setErrorMsg(e.message || "Failed to load data.");
    } finally {
      setLoading(false);
    }
  };

  const filteredProjects = projects.filter(p => {
    if (!showArchived && p.status === ProjectOverallStatus.ARCHIVED) return false;
    if (showArchived && p.status !== ProjectOverallStatus.ARCHIVED) return false;

    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          p.projectId.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesSearch;
    // RLS policies on the database handle PM access control server-side
  });

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || 'Unknown';

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <Layout>
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-primary mb-1">Projects Dashboard</h1>
          <p className="text-sm text-muted">Overview of your product pipeline.</p>
        </div>
        {!showArchived && stats && stats.overdueCount > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-2 flex items-center gap-3 animate-pulse shadow">
            <AlertCircle className="text-rose-600" size={20} />
            <span className="text-sm font-bold text-rose-700">{stats.overdueCount} Critical Overdue Task{stats.overdueCount !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* ACTION WIDGETS */}
      {stats && !showArchived && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow flex items-center justify-between group hover:border-indigo-300 transition-colors">
            <div>
              <p className="text-sm font-medium text-muted mb-1">Active Projects</p>
              <h3 className="text-3xl font-bold text-primary">{stats.activeProjects}</h3>
            </div>
            <div className="p-4 bg-indigo-50 rounded-full text-indigo-600 group-hover:scale-110 transition-transform">
              <LayoutIcon size={24} />
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow flex items-center justify-between relative overflow-hidden group hover:border-indigo-200 transition-colors">
            {stats.pendingReviews > 0 && (
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
            )}
            <div>
              <p className="text-sm font-medium text-muted mb-1">Pending Reviews</p>
              <h3 className="text-3xl font-bold text-primary">{stats.pendingReviews}</h3>
              {stats.pendingReviews > 0 && (
                 <p className="text-xs text-amber-600 font-medium mt-1">Requires attention</p>
              )}
            </div>
            <div className={`p-4 rounded-full group-hover:scale-110 transition-transform ${stats.pendingReviews > 0 ? 'bg-amber-50 text-amber-600' : 'bg-light text-gray-400'}`}>
              <FileText size={24} />
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow flex items-center justify-between group hover:border-rose-200 transition-colors relative overflow-hidden">
            {stats.overdueCount > 0 && (
              <div className="absolute top-0 left-0 w-1 h-full bg-rose-600 animate-pulse"></div>
            )}
            <div>
              <p className="text-sm font-medium text-muted mb-1">Overdue Items</p>
              <h3 className={`text-3xl font-bold ${stats.overdueCount > 0 ? 'text-rose-600' : 'text-primary'}`}>{stats.overdueCount}</h3>
              {stats.overdueCount > 0 && (
                <p className="text-xs text-rose-600 font-bold mt-1">Immediate Action</p>
              )}
            </div>
            <div className={`p-4 rounded-full group-hover:scale-110 transition-transform ${stats.overdueCount > 0 ? 'bg-rose-50 text-rose-600' : 'bg-light text-gray-400'}`}>
              <AlertTriangle size={24} />
            </div>
          </div>

          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow flex flex-col group hover:border-indigo-300 transition-colors">
            <div className="flex items-center justify-between mb-3">
               <p className="text-sm font-medium text-muted flex items-center gap-1">
                 <Clock size={14} /> Near Deadlines (14d)
               </p>
               <span className={`text-xs px-2 py-0.5 rounded-full ${stats.upcomingDeadlines.length > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                 {stats.upcomingDeadlines.length}
               </span>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[80px] space-y-2 pr-1 custom-scrollbar">
              {stats.upcomingDeadlines.length === 0 ? (
                <div className="text-xs text-gray-400 italic py-2">No immediate deadlines.</div>
              ) : (
                stats.upcomingDeadlines.map(d => (
                  <Link key={d.id} to={d.type === 'tcf' ? `/compliance/request/${d.id}` : `/project/${d.projectId}`} className="flex items-start justify-between group/item cursor-pointer hover:bg-light p-1 rounded transition-colors">
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="text-[10px] font-bold text-gray-700 truncate group-hover/item:text-indigo-600">{d.title}</div>
                      <div className="text-[8px] text-gray-400 truncate uppercase tracking-tight">{d.projectName}</div>
                    </div>
                    <div className={`text-[9px] font-bold whitespace-nowrap flex flex-col items-end ${d.daysLeft < 0 ? 'text-rose-600 font-black' : d.daysLeft < 3 ? 'text-amber-600' : 'text-gray-600'}`}>
                      <span>{formatDate(d.deadline)}</span>
                      <span className="text-[8px] font-normal opacity-80 uppercase">
                        {d.daysLeft === 0 ? 'Today' : d.daysLeft < 0 ? 'Overdue' : `${d.daysLeft}d left`}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow border border-gray-200 mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text" 
            placeholder="Search projects or IDs..." 
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full sm:w-auto items-center">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer mr-2 select-none">
             <input 
               type="checkbox" 
               checked={showArchived} 
               onChange={(e) => { setShowArchived(e.target.checked); setActiveDropdown(null); }} 
               className="rounded text-indigo-600"
             />
             Show Archived
          </label>
          <Link 
            to="/create"
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow transition-all hover:scale-105"
          >
            + New Project
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden min-h-[400px]">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-light border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 font-semibold text-gray-700">Project</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Supplier</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Current Step</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Status</th>
                <th className="px-6 py-4 font-semibold text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                      <span>Loading projects...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted">
                    <div className="flex flex-col items-center gap-2 opacity-50">
                       <Search size={32} />
                       <span>No projects found.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProjects.map((project) => (
                  <tr key={project.id} className="hover:bg-light transition-colors group relative">
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-bold text-primary">{project.name}</div>
                        <div className="text-[10px] text-muted font-mono tracking-tight">{project.projectId}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {getSupplierName(project.supplierId)}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                        Step {project.currentStep}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={project.status} type="project" />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link 
                        to={`/project/${project.id}`} 
                        className="inline-flex items-center text-indigo-600 hover:text-blue-800 font-bold px-3 py-1.5 rounded-xl hover:bg-indigo-50 transition-all gap-1"
                      >
                        View <ChevronRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
};

export default PMDashboard;
