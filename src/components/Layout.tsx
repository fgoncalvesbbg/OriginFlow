
/** App shell: sidebar/topbar navigation, notifications, and the routed page outlet. */
import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Plus, LogOut, Box, ShieldCheck, Bell, ShoppingBag, CalendarClock, Truck, BookOpen, Lock, AlertCircle, Table2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { UserRole, Notification } from '../types';
import { Breadcrumbs } from './Breadcrumbs';
import { getNotifications, markNotificationRead, getDashboardStats } from '../services';

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

  // Collapse the whole nav rail to reclaim screen width; persisted across sessions.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem('originflow.sidebarCollapsed') === '1',
  );
  const toggleSidebar = () => setSidebarCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem('originflow.sidebarCollapsed', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

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

  // One nav vocabulary for every rail item: active = Action Indigo fill; inactive = soft gray that
  // brightens on hover. Keyboard focus is always visible (ring), never silently removed.
  const navItemClass = (active: boolean) =>
    `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
      active ? "bg-accent text-white shadow-md" : "text-gray-400 hover:bg-gray-800 hover:text-white"
    }`;

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="flex min-h-screen bg-light">
      {/* Sidebar */}
      <aside className={`w-64 bg-primary text-white flex-col fixed h-full z-30 shadow-lg ${sidebarCollapsed ? 'hidden' : 'hidden md:flex'}`}>
        <div className="p-6 border-b border-gray-700">
          <h1 className="text-xl font-bold flex items-center gap-2 tracking-tight">
            <Box className="w-6 h-6 text-indigo-400" />
            OriginFlow
          </h1>
          <p className="text-xs text-gray-400 mt-1 pl-8">Beta V1.5</p>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-4">
          <Link to="/" className={navItemClass(location.pathname === '/')}>
            <LayoutDashboard size={18} />
            Dashboard
          </Link>

          <Link to="/timeline" className={navItemClass(location.pathname === '/timeline')}>
            <CalendarClock size={18} />
            Timeline
          </Link>

          <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Modules</div>

          <Link to="/sourcing" className={navItemClass(location.pathname.startsWith('/sourcing'))}>
            <ShoppingBag size={18} />
            Sourcing & RFQ
          </Link>

          <Link to="/suppliers" className={navItemClass(location.pathname === '/suppliers')}>
            <Truck size={18} />
            Suppliers
          </Link>

          <Link to="/compliance" className={navItemClass(location.pathname.startsWith('/compliance'))}>
            <ShieldCheck size={18} />
            Compliance
          </Link>

          <Link to="/im" className={navItemClass(location.pathname.startsWith('/im'))}>
            <BookOpen size={18} />
            Instruction Manuals
          </Link>

          <Link to="/attributes" className={navItemClass(location.pathname.startsWith('/attributes'))}>
            <Table2 size={18} />
            Attribute Viewer
          </Link>

          {user?.role === UserRole.ADMIN && (
            <>
              <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Admin</div>
              <Link to="/admin" className={navItemClass(location.pathname === '/admin')}>
                <Lock size={18} />
                Admin Panel
              </Link>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-gray-700">
          <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-xl mb-4">
             <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-white">
                {user?.name?.charAt(0) || 'U'}
             </div>
             <div className="overflow-hidden">
                <div className="text-xs font-bold truncate">{user?.name}</div>
                <div className="text-[10px] text-gray-400">{user?.role}</div>
             </div>
          </div>
          <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-2 w-full text-left text-xs font-medium text-gray-400 rounded-lg hover:text-rose-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 min-h-screen flex flex-col transition-[margin] ${sidebarCollapsed ? 'md:ml-0' : 'md:ml-64'}`}>
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center sticky top-0 z-20 shadow">
          <div className="flex-1 flex items-center gap-3 min-w-0">
             <button
               onClick={toggleSidebar}
               aria-label={sidebarCollapsed ? 'Show navigation' : 'Hide navigation'}
               title={sidebarCollapsed ? 'Show navigation' : 'Hide navigation'}
               className="hidden md:inline-flex p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent shrink-0"
             >
               {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
             </button>
             <div className="min-w-0 flex-1"><Breadcrumbs /></div>
          </div>

          {/* Notification Center */}
          <div className="relative flex items-center gap-4" ref={notifRef}>
            {overdueCount > 0 && (
              <Link to="/timeline" className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 rounded-full text-xs font-bold hover:bg-rose-100 transition-colors border border-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">
                <AlertCircle size={14} />
                {overdueCount} Overdue
              </Link>
            )}

            <button
              onClick={() => setShowNotifications(!showNotifications)}
              aria-label="Notifications"
              aria-expanded={showNotifications}
              className={`relative p-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${unreadCount > 0 || overdueCount > 0 ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Bell size={20} className={overdueCount > 0 ? 'animate-pulse' : ''} />
              {(unreadCount > 0 || overdueCount > 0) && (
                <span className="absolute top-0 right-0 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full shadow">
                  {unreadCount + overdueCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-2 top-full w-80 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden animate-scaleIn z-50">
                <div className="px-4 py-3 border-b border-gray-100 bg-light flex justify-between items-center">
                  <h3 className="text-sm font-bold text-primary">Notifications & Alerts</h3>
                  <span className="text-xs text-muted">{unreadCount + overdueCount} total</span>
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  {overdueCount > 0 && (
                    <div className="p-4 bg-rose-50 border-b border-rose-100">
                       <div className="flex items-start gap-2">
                          <AlertCircle size={16} className="text-rose-600 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-rose-800">Critical Deadlines Missed</p>
                            <p className="text-[10px] text-rose-600 mt-0.5">You have {overdueCount} items past their due date.</p>
                            <Link to="/" onClick={() => setShowNotifications(false)} className="text-[10px] font-bold text-rose-700 underline mt-1 inline-block">Review Now</Link>
                          </div>
                       </div>
                    </div>
                  )}

                  {notifications.length === 0 && overdueCount === 0 ? (
                    <div className="p-12 text-center text-muted text-xs italic">No notifications</div>
                  ) : (
                    notifications.map(notif => (
                      <div
                        key={notif.id}
                        className={`p-4 border-b border-gray-50 last:border-0 hover:bg-light transition-colors ${notif.isRead ? 'opacity-60' : 'bg-indigo-50/30'}`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <p className="text-xs text-primary leading-snug">{notif.message}</p>
                          {!notif.isRead && (
                            <button
                              onClick={() => handleMarkRead(notif.id)}
                              aria-label="Mark notification as read"
                              className="rounded-full p-1 -m-1 text-indigo-600 hover:text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              <div className="w-2 h-2 bg-indigo-600 rounded-full" aria-hidden="true"></div>
                            </button>
                          )}
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <span className="text-[10px] text-muted">{new Date(notif.createdAt).toLocaleDateString()}</span>
                          {notif.link && (
                            <Link
                              to={notif.link}
                              onClick={() => { handleMarkRead(notif.id); setShowNotifications(false); }}
                              className="text-[10px] font-bold text-indigo-600 hover:underline"
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
