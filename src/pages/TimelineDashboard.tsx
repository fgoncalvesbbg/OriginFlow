
import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { getProjects, getAllProductionUpdates, getSuppliers } from '../services/apiService';
import { Project, ProductionUpdate, Supplier } from '../types';
import { CalendarClock, ChevronRight, AlertTriangle, Truck, Factory, Flag, FileText, CheckCircle, AlertCircle, Calendar } from 'lucide-react';

const TimelineDashboard: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [updates, setUpdates] = useState<ProductionUpdate[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Date Range Calculation
  const [minDate, setMinDate] = useState<Date>(new Date());
  const [maxDate, setMaxDate] = useState<Date>(new Date());
  const [totalDays, setTotalDays] = useState(0);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [pData, uData, sData] = await Promise.all([
        getProjects(),
        getAllProductionUpdates(),
        getSuppliers()
      ]);
      
      // Filter only active projects with at least one milestone
      const activeProjects = pData.filter(p => 
          p.status !== 'archived' && p.status !== 'cancelled'
      );
      
      setProjects(activeProjects);
      setUpdates(uData);
      setSuppliers(sData);

      // Calculate global min/max dates
      let earliest = new Date();
      let latest = new Date();
      latest.setMonth(latest.getMonth() + 3); // Default buffer

      activeProjects.forEach(p => {
          const m = p.milestones;
          if (m) {
              const dates = [
                  m.poPlacement, m.massProduction, m.etd, m.eta
              ].filter(d => d).map(d => new Date(d!));
              
              dates.forEach(d => {
                  if (d < earliest) earliest = d;
                  if (d > latest) latest = d;
              });
          }
      });

      // Add buffer
      earliest.setDate(earliest.getDate() - 15);
      latest.setDate(latest.getDate() + 30);

      setMinDate(earliest);
      setMaxDate(latest);
      setTotalDays((latest.getTime() - earliest.getTime()) / (1000 * 3600 * 24));

    } catch (e) {
      console.error("Failed to load timeline", e);
    } finally {
      setLoading(false);
    }
  };

  const getSupplierName = (id: string) => suppliers.find(s => s.id === id)?.name || 'Unknown';

  const getPositionPercentage = (dateStr?: string) => {
      if (!dateStr) return -1;
      const date = new Date(dateStr);
      const diff = date.getTime() - minDate.getTime();
      const days = diff / (1000 * 3600 * 24);
      return (days / totalDays) * 100;
  };

  // Helper to get original ETD from updates history
  const getOriginalEtd = (projectId: string) => {
      const projectUpdates = updates
        .filter(u => u.projectId === projectId && u.newEtd)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      
      if (projectUpdates.length > 0) {
          return projectUpdates[0].previousEtd || projectUpdates[0].newEtd;
      }
      return null;
  };

  // Alert Logic for 6wk, 4wk, 2wk windows
  const alerts = useMemo(() => {
    const list: { project: Project, type: string, days: number, date: Date, color: string }[] = [];
    const today = new Date();
    
    projects.forEach(p => {
      if (p.status === 'in_progress' && p.milestones?.etd) {
        const etd = new Date(p.milestones.etd);
        const diffTime = etd.getTime() - today.getTime();
        const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Logic: Broaden windows slightly to ensure they are caught (e.g., 6 weeks is roughly 42 days)
        // 6 Weeks: 38-45 days
        // 4 Weeks: 24-31 days
        // 2 Weeks: 10-17 days
        
        if (days >= 38 && days <= 45) {
            list.push({ project: p, type: '6-Week Production Check', days, date: etd, color: 'bg-blue-100 text-blue-800 border-blue-200' });
        } else if (days >= 24 && days <= 31) {
            list.push({ project: p, type: '4-Week QA Booking', days, date: etd, color: 'bg-orange-100 text-orange-800 border-orange-200' });
        } else if (days >= 10 && days <= 17) {
            list.push({ project: p, type: '2-Week Logistics Confirm', days, date: etd, color: 'bg-red-100 text-red-800 border-red-200' });
        }
      }
    });
    return list.sort((a,b) => a.days - b.days);
  }, [projects]);

  const renderTimeAxis = () => {
      const months = [];
      const curr = new Date(minDate);
      curr.setDate(1); // Start at beginning of month

      while (curr <= maxDate) {
          const left = getPositionPercentage(curr.toISOString());
          const nextMonth = new Date(curr);
          nextMonth.setMonth(curr.getMonth() + 1);
          const width = getPositionPercentage(nextMonth.toISOString()) - left;

          if (left >= 0 && left <= 100) {
              months.push(
                  <div 
                    key={curr.toISOString()} 
                    className="absolute border-l border-slate-200 h-full flex items-end pb-2 pl-2 text-xs font-bold text-slate-400 uppercase tracking-wider"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                      {curr.toLocaleDateString('en-US', { month: 'short' })}
                  </div>
              );
          }
          curr.setMonth(curr.getMonth() + 1);
      }
      return months;
  };

  const renderCurrentDateLine = () => {
      const now = new Date().toISOString();
      const pos = getPositionPercentage(now);
      if (pos < 0 || pos > 100) return null;
      return (
          <div 
            className="absolute top-0 bottom-0 border-l-2 border-red-400 border-dashed z-10 pointer-events-none"
            style={{ left: `${pos}%` }}
          >
              <div className="bg-red-400 text-white text-[10px] px-1 rounded absolute -top-2 -left-4">Today</div>
          </div>
      );
  };

  return (
    <Layout>
      <div className="flex justify-between items-end mb-6">
        <div>
            <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <CalendarClock className="text-blue-600" /> Project Timeline
            </h2>
            <p className="text-slate-500 mt-1">Gantt view of production milestones and delivery schedules.</p>
        </div>
        <div className="flex gap-2 text-xs">
            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-500 rounded-sm"></div> Timeline</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rotate-45 bg-green-500"></div> PO</div>
            <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-orange-500"></div> Production</div>
            <div className="flex items-center gap-1"><Truck size={12} className="text-indigo-600"/> ETD</div>
            <div className="flex items-center gap-1"><Flag size={12} className="text-red-600"/> ETA</div>
        </div>
      </div>

      {/* Alerts Section */}
      {alerts.length > 0 && (
          <div className="mb-8 animate-in fade-in slide-in-from-top-4">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <AlertCircle size={16} className="text-orange-500" /> Upcoming Checkpoints
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {alerts.map((alert, idx) => (
                      <div key={idx} className={`p-4 rounded-lg border shadow-sm flex flex-col justify-between ${alert.color}`}>
                          <div>
                              <div className="flex justify-between items-start mb-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-80 border border-current px-1.5 py-0.5 rounded">{alert.type}</span>
                                  <Link to={`/project/${alert.project.id}`} className="hover:opacity-75"><ChevronRight size={16} /></Link>
                              </div>
                              <h4 className="font-bold text-sm mb-1 truncate">{alert.project.name}</h4>
                              <div className="flex items-center gap-2 text-xs opacity-90">
                                  <Calendar size={12} /> ETD: {alert.date.toLocaleDateString()}
                              </div>
                          </div>
                          <div className="mt-3 pt-3 border-t border-black/10 flex justify-between items-center">
                              <span className="text-xs font-bold">{alert.days} days left</span>
                              <span className="text-[10px] uppercase tracking-wide opacity-75">Action Required</span>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {loading ? (
          <div className="p-12 text-center text-slate-400">Loading timeline...</div>
      ) : (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col h-[600px]">
              {/* Header Row */}
              <div className="flex border-b border-slate-200 bg-slate-50 min-h-[50px]">
                  <div className="w-64 p-4 font-bold text-slate-700 shrink-0 border-r border-slate-200 z-20 bg-slate-50">Project</div>
                  <div className="flex-1 relative overflow-hidden">
                      {renderTimeAxis()}
                  </div>
              </div>

              {/* Gantt Body */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
                  {renderCurrentDateLine()}
                  
                  {projects.map((project, idx) => {
                      const m = project.milestones || {};
                      
                      // Determine Start/End of bar
                      // Start: PO -> Mass Prod -> Created At
                      const start = m.poPlacement || m.massProduction || project.createdAt;
                      // End: ETA -> ETD -> Start + 30 days
                      const end = m.eta || m.etd; 
                      
                      const startPos = getPositionPercentage(start);
                      let endPos = getPositionPercentage(end);
                      
                      // Fallback width if no end date
                      if (endPos === -1 || endPos <= startPos) endPos = startPos + 10; 

                      const width = endPos - startPos;
                      
                      // Markers
                      const poPos = getPositionPercentage(m.poPlacement);
                      const mpPos = getPositionPercentage(m.massProduction);
                      const etdPos = getPositionPercentage(m.etd);
                      const etaPos = getPositionPercentage(m.eta);
                      
                      // History Check
                      const originalEtd = getOriginalEtd(project.id);
                      const originalEtdPos = originalEtd && originalEtd !== m.etd ? getPositionPercentage(originalEtd) : -1;
                      const isDelayed = originalEtdPos !== -1 && etdPos > originalEtdPos;

                      return (
                          <div key={project.id} className="flex border-b border-slate-100 hover:bg-slate-50 transition-colors group h-16">
                              {/* Left Column */}
                              <div className="w-64 p-3 border-r border-slate-200 shrink-0 bg-white z-10 relative">
                                  <Link to={`/project/${project.id}`} className="font-bold text-sm text-slate-800 hover:text-blue-600 block truncate mb-0.5">
                                      {project.name}
                                  </Link>
                                  <div className="text-xs text-slate-500 truncate">{getSupplierName(project.supplierId)}</div>
                                  
                                  {/* Document Readiness Mini-Bar */}
                                  <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex" title="Document Readiness">
                                      <div className="h-full bg-green-500" style={{ width: `${(project.currentStep / 3) * 100}%` }}></div>
                                  </div>
                              </div>

                              {/* Chart Area */}
                              <div className="flex-1 relative h-full">
                                  {/* Grid Lines (Vertical) */}
                                  <div className="absolute inset-0 flex pointer-events-none">
                                      {/* Can render light vertical lines for months if needed here */}
                                  </div>

                                  {/* Main Duration Bar */}
                                  {startPos >= 0 && (
                                      <div 
                                        className="absolute h-2 top-7 rounded-full bg-blue-100"
                                        style={{ left: `${startPos}%`, width: `${width}%` }}
                                      >
                                          <div className="h-full bg-blue-500 opacity-20 w-full rounded-full"></div>
                                      </div>
                                  )}

                                  {/* Original ETD Ghost Marker (if moved) */}
                                  {isDelayed && (
                                      <div 
                                        className="absolute top-5 -ml-2 opacity-40 grayscale flex flex-col items-center group/marker z-0"
                                        style={{ left: `${originalEtdPos}%` }}
                                      >
                                          <Truck size={16} className="text-slate-400" />
                                          <div className="hidden group-hover/marker:block absolute bottom-full mb-1 bg-black text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-50">
                                              Original ETD: {new Date(originalEtd!).toLocaleDateString()}
                                          </div>
                                      </div>
                                  )}

                                  {/* PO Marker */}
                                  {poPos >= 0 && (
                                      <div 
                                        className="absolute top-6 -ml-1.5 flex flex-col items-center group/marker cursor-pointer z-10"
                                        style={{ left: `${poPos}%` }}
                                      >
                                          <div className="w-3 h-3 bg-green-500 rotate-45 shadow-sm border border-white"></div>
                                          <div className="hidden group-hover/marker:block absolute bottom-full mb-1 bg-black text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-50">
                                              PO: {new Date(m.poPlacement!).toLocaleDateString()}
                                          </div>
                                      </div>
                                  )}

                                  {/* Mass Production Marker */}
                                  {mpPos >= 0 && (
                                      <div 
                                        className="absolute top-6 -ml-1.5 flex flex-col items-center group/marker cursor-pointer z-10"
                                        style={{ left: `${mpPos}%` }}
                                      >
                                          <div className="w-3 h-3 bg-orange-500 rounded-full shadow-sm border border-white"></div>
                                          <div className="hidden group-hover/marker:block absolute bottom-full mb-1 bg-black text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-50">
                                              MP Start: {new Date(m.massProduction!).toLocaleDateString()}
                                          </div>
                                      </div>
                                  )}

                                  {/* ETD Marker */}
                                  {etdPos >= 0 && (
                                      <div 
                                        className="absolute top-5 -ml-2 flex flex-col items-center group/marker cursor-pointer z-20"
                                        style={{ left: `${etdPos}%` }}
                                      >
                                          <Truck size={16} className={`text-indigo-600 drop-shadow-sm ${isDelayed ? 'text-red-600' : ''}`} />
                                          <div className="hidden group-hover/marker:block absolute bottom-full mb-1 bg-black text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-50">
                                              ETD: {new Date(m.etd!).toLocaleDateString()} {isDelayed && '(Delayed)'}
                                          </div>
                                      </div>
                                  )}

                                  {/* ETA Marker */}
                                  {etaPos >= 0 && (
                                      <div 
                                        className="absolute top-5 -ml-2 flex flex-col items-center group/marker cursor-pointer z-10"
                                        style={{ left: `${etaPos}%` }}
                                      >
                                          <Flag size={16} className="text-red-600 drop-shadow-sm" />
                                          <div className="hidden group-hover/marker:block absolute bottom-full mb-1 bg-black text-white text-[10px] px-2 py-1 rounded whitespace-nowrap z-50">
                                              ETA: {new Date(m.eta!).toLocaleDateString()}
                                          </div>
                                      </div>
                                  )}
                              </div>
                          </div>
                      );
                  })}
              </div>
          </div>
      )}
    </Layout>
  );
};

export default TimelineDashboard;
