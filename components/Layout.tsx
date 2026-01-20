
import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Plus, LogOut, Box, ShieldCheck, Bell, ShoppingBag, CalendarClock, Truck, BookOpen, Lock, AlertCircle } from 'lucide-react';
import { UserRole, Notification } from '../types';
import { Breadcrumbs } from './Breadcrumbs';
import { getNotifications, markNotificationRead, getDashboardStats } from '../services/apiService';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  
  // Notification State
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Poll for notifications and stats (Polling every 30s)
  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      try {
        const [notifData, statsData] = await Promise.all([
          getNotifications(),
          getDashboardStats()
        ]);
        setNotifications(notifData);
        setOverdueCount(statsData.overdueCount || 0);
      } catch (e) {
        console.error("Failed to fetch layout data", e);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const handleMarkRead = async (id: string) => {
    await markNotificationRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isActive = (path: string) => {
    return location.pathname === path ? "bg-slate-800 text-white shadow-md" : "text-slate-400 hover:bg-slate-800 hover:text-white";
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white hidden md:flex flex-col fixed h-full z-30 shadow-xl">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold flex items-center gap-2 tracking-tight">
            <Box className="w-6 h-6 text-blue-500" />
            OriginFlow
          </h1>
          <p className="text-xs text-slate-500 mt-1 pl-8">Beta v1.3</p>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-4">
          <Link to="/" className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${isActive('/')}`}>
            <LayoutDashboard size={18} />
            Dashboard
          </Link>
          
          <Link to="/timeline" className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${isActive('/timeline')}`}>
            <CalendarClock size={18} />
            Timeline
          </Link>

          <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Modules</div>
          
          <Link to="/sourcing" className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${location.pathname.startsWith('/sourcing') ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800"}`}>
            <ShoppingBag size={18} />
            Sourcing & RFQ
          </Link>

          <Link to="/suppliers" className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${isActive('/suppliers')}`}>
            <Truck size={18} />
            Suppliers
          </Link>

          <Link to="/compliance" className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${location.pathname.startsWith('/compliance') ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800"}`}>
            <ShieldCheck size={18} />
            Compliance
          </Link>

          <Link to="/im" className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${location.pathname.startsWith('/im') ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800"}`}>
            <BookOpen size={18} />
            Instruction Manuals
          </Link>

          {user?.role === UserRole.ADMIN && (
            <>
              <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Admin</div>
              <Link to="/admin" className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${isActive('/admin')}`}>
                <Lock size={18} />
                Admin Panel
              </Link>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg mb-4">
             <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white">
                {user?.name?.charAt(0) || 'U'}
             </div>
             <div className="overflow-hidden">
                <div className="text-xs font-bold truncate">{user?.name}</div>
                <div className="text-[10px] text-slate-400">{user?.role}</div>
             </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-2 w-full text-left text-xs font-medium text-slate-400 hover:text-red-400 transition-colors">
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 min-h-screen flex flex-col">
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center sticky top-0 z-20">
          <div className="flex-1">
             <Breadcrumbs />
          </div>
          
          {/* Notification Center */}
          <div className="relative flex items-center gap-4" ref={notifRef}>
            {overdueCount > 0 && (
              <Link to="/timeline" className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 rounded-full text-xs font-bold hover:bg-red-100 transition-colors border border-red-200">
                <AlertCircle size={14} />
                {overdueCount} Overdue
              </Link>
            )}

            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className={`relative p-2 rounded-full transition-colors focus:outline-none ${unreadCount > 0 || overdueCount > 0 ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' : 'text-slate-500 hover:bg-slate-100'}`}
            >
              <Bell size={20} className={overdueCount > 0 ? 'animate-pulse' : ''} />
              {(unreadCount > 0 || overdueCount > 0) && (
                <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full shadow-sm">
                  {unreadCount + overdueCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 top-full w-80 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-top-2 z-50">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                  <h3 className="text-sm font-bold text-slate-700">Notifications & Alerts</h3>
                  <span className="text-xs text-slate-400">{unreadCount + overdueCount} total</span>
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  {overdueCount > 0 && (
                    <div className="p-4 bg-red-50 border-b border-red-100">
                       <div className="flex items-start gap-2">
                          <AlertCircle size={16} className="text-red-600 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-red-800">Critical Deadlines Missed</p>
                            <p className="text-[10px] text-red-600 mt-0.5">You have {overdueCount} items past their due date.</p>
                            <Link to="/" onClick={() => setShowNotifications(false)} className="text-[10px] font-bold text-red-700 underline mt-1 inline-block">Review Now</Link>
                          </div>
                       </div>
                    </div>
                  )}

                  {notifications.length === 0 && overdueCount === 0 ? (
                    <div className="p-12 text-center text-slate-400 text-xs italic">No notifications</div>
                  ) : (
                    notifications.map(notif => (
                      <div 
                        key={notif.id} 
                        className={`p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${notif.isRead ? 'opacity-60' : 'bg-blue-50/30'}`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <p className="text-xs text-slate-800 leading-snug">{notif.message}</p>
                          {!notif.isRead && (
                            <button 
                              onClick={() => handleMarkRead(notif.id)} 
                              className="text-blue-600 hover:text-blue-800" 
                            >
                              <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                            </button>
                          )}
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <span className="text-[10px] text-slate-400">{new Date(notif.createdAt).toLocaleDateString()}</span>
                          {notif.link && (
                            <Link 
                              to={notif.link} 
                              onClick={() => { handleMarkRead(notif.id); setShowNotifications(false); }}
                              className="text-[10px] font-bold text-blue-600 hover:underline"
                            >
                              View Details
                            </Link>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-6 md:p-10 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
