
/** App shell: sidebar/topbar navigation, the project inbox drawer, and the routed page outlet. */
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, LogOut, ShieldCheck, Inbox, ShoppingBag, CalendarClock, Truck, BookOpen, Lock, AlertCircle, Table2, PanelLeftClose, PanelLeftOpen, Menu, X, FileDown, FileText, Scale, ClipboardList, Map, type LucideIcon } from 'lucide-react';
import { UserRole } from '../types';
import { isSuperAdminOnlyPath } from '../config/moduleAccess.config';
import { Breadcrumbs } from './Breadcrumbs';
import { Logo } from './Logo';
import { KlarsteinLogo } from './KlarsteinBrand';
import { FeedbackWidget } from './feedback/FeedbackWidget';
import { ProjectInboxPanel } from './inbox/ProjectInboxPanel';
import { InboxProvider } from './inbox/InboxContext';
import { getDashboardStats } from '../services';
import { useProjectInbox } from '../hooks';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  
  // The project inbox is the single notification surface: the topbar button opens the
  // drawer, and both read the same snapshot (see hooks/useProjectInbox).
  const inbox = useProjectInbox(user?.id ?? null);
  const [overdueCount, setOverdueCount] = useState(0);
  // Open/closed survives navigation and reloads — a PM working through the list should not
  // have to reopen it on every page.
  const [inboxOpen, setInboxOpen] = useState<boolean>(
    () => localStorage.getItem('originflow.inboxOpen') === '1',
  );
  const setInbox = (next: boolean) => {
    setInboxOpen(next);
    try { localStorage.setItem('originflow.inboxOpen', next ? '1' : '0'); } catch { /* ignore */ }
  };

  // Collapse the whole nav rail to reclaim screen width; persisted across sessions.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem('originflow.sidebarCollapsed') === '1',
  );
  const toggleSidebar = () => setSidebarCollapsed(prev => {
    const next = !prev;
    try { localStorage.setItem('originflow.sidebarCollapsed', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  // Mobile nav is an overlay drawer (the rail is off-canvas below md); close it on navigation.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  // The overdue pill is the only thing the topbar still needs from the dashboard stats;
  // everything else it used to poll for now comes from the inbox snapshot.
  useEffect(() => {
    if (!user) return;
    const fetchStats = async () => {
      try {
        const stats = await getDashboardStats();
        setOverdueCount(stats.overdueCount || 0);
      } catch (e) {
        console.error("Failed to fetch layout stats", e);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [user]);

  // Stable identity so consumers re-render on inbox changes, not on every Layout render.
  const inboxContext = useMemo(() => ({ inbox, openInbox: () => setInbox(true) }), [inbox]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Icon-rail collapse hides labels on desktop only; the mobile drawer always shows full labels.
  const railCollapsed = sidebarCollapsed;

  // One nav vocabulary for every rail item: active = Action Steel fill; inactive = soft gray that
  // brightens on hover. Keyboard focus is always visible (ring), never silently removed.
  const navItemClass = (active: boolean) =>
    `flex items-center gap-3 py-3 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
      railCollapsed ? 'px-4 md:px-0 md:justify-center' : 'px-4'
    } ${active ? 'bg-accent text-white shadow-md' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`;

  // Modules still under test are hidden from everyone but a Super Admin. The list of
  // gated paths lives in config/moduleAccess.config, which SuperAdminRoute reads too —
  // so hiding a nav entry always comes with a guard on the route behind it.
  const isSuperAdmin = user?.isSuperAdmin === true;
  const visibleToUser = (item: { to: string }) => isSuperAdmin || !isSuperAdminOnlyPath(item.to);

  const NAV_MAIN: { to: string; label: string; Icon: LucideIcon; match: (p: string) => boolean }[] = [
    { to: '/', label: 'Dashboard', Icon: LayoutDashboard, match: p => p === '/' },
    { to: '/timeline', label: 'Timeline', Icon: CalendarClock, match: p => p === '/timeline' },
  ];
  const NAV_MODULES: { to: string; label: string; Icon: LucideIcon; match: (p: string) => boolean }[] = [
    { to: '/sourcing', label: 'Sourcing & RFQ', Icon: ShoppingBag, match: p => p.startsWith('/sourcing') },
    { to: '/suppliers', label: 'Suppliers', Icon: Truck, match: p => p === '/suppliers' },
    { to: '/compliance', label: 'Compliance', Icon: ShieldCheck, match: p => p.startsWith('/compliance') },
    { to: '/regulations', label: 'Regulations', Icon: Scale, match: p => p.startsWith('/regulations') },
    { to: '/im', label: 'Instruction Manuals', Icon: BookOpen, match: p => p.startsWith('/im') },
    { to: '/documents', label: 'SOP & Documents', Icon: FileText, match: p => p.startsWith('/documents') },
    { to: '/design-specs', label: 'Design Specs', Icon: ClipboardList, match: p => p.startsWith('/design-specs') },
    { to: '/attributes', label: 'Attribute Viewer', Icon: Table2, match: p => p.startsWith('/attributes') },
    { to: '/roadmap', label: 'Roadmap Creator', Icon: Map, match: p => p.startsWith('/roadmap') },
  ];
  const NAV_TOOLS: { to: string; label: string; Icon: LucideIcon; match: (p: string) => boolean }[] = [
    { to: '/tools/pdf-to-markdown', label: 'PDF → Markdown', Icon: FileDown, match: p => p.startsWith('/tools/pdf-to-markdown') },
  ];

  const renderNavLink = ({ to, label, Icon, match }: { to: string; label: string; Icon: LucideIcon; match: (p: string) => boolean }) => {
    // Only a Super Admin ever reaches this for a gated item, and they should be able
    // to tell at a glance which modules their colleagues cannot see yet.
    const gated = isSuperAdminOnlyPath(to);
    return (
      <Link
        key={to}
        to={to}
        className={navItemClass(match(location.pathname))}
        title={gated ? `${label} — Super Admin only` : (railCollapsed ? label : undefined)}
      >
        <Icon size={18} className="shrink-0" />
        <span className={railCollapsed ? 'md:hidden' : ''}>{label}</span>
        {gated && (
          <Lock size={12} className={`shrink-0 ml-auto opacity-60 ${railCollapsed ? 'md:hidden' : ''}`} aria-label="Super Admin only" />
        )}
      </Link>
    );
  };

  // Section eyebrow, hidden on the desktop icon-rail (still shown in the mobile drawer).
  const sectionLabel = (text: string) => (
    <div className={`pt-6 pb-2 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest ${railCollapsed ? 'md:hidden' : ''}`}>{text}</div>
  );

  return (
    <div className="flex min-h-screen bg-light">
      {/* Mobile drawer backdrop */}
      {mobileNavOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      )}

      {/* Sidebar — off-canvas drawer on mobile, fixed rail on md+ (icon-rail when collapsed). */}
      <aside className={`bg-primary text-white flex-col fixed h-full z-40 shadow-lg transition-[width] ${mobileNavOpen ? 'flex w-64' : 'hidden'} md:flex ${railCollapsed ? 'md:w-16' : 'md:w-64'}`}>
        <div className={`kl-keyline-dark p-4 flex items-center gap-3 ${railCollapsed ? 'md:justify-center' : ''}`}>
          <Logo size={30} className="shrink-0" />
          <div className={`min-w-0 ${railCollapsed ? 'md:hidden' : ''}`}>
            {/* The wordmark is the heading here — an <img> with alt text, so the rail still
                contributes one. `variant="light"` inverts it for the dark ground. */}
            <h1 className="leading-none">
              <KlarsteinLogo height={15} variant="light" />
            </h1>
            <p className="text-[10px] text-gray-400 mt-1.5">OriginFlow · Beta V1.5</p>
          </div>
          {/* Close affordance inside the mobile drawer */}
          <button onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" className="md:hidden ml-auto p-1.5 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-2 overflow-y-auto">
          {NAV_MAIN.filter(visibleToUser).map(renderNavLink)}
          {sectionLabel('Modules')}
          {NAV_MODULES.filter(visibleToUser).map(renderNavLink)}
          {sectionLabel('Tools')}
          {NAV_TOOLS.filter(visibleToUser).map(renderNavLink)}
          {user?.role === UserRole.ADMIN && (
            <>
              {sectionLabel('Admin')}
              {renderNavLink({ to: '/admin', label: 'Admin Panel', Icon: Lock, match: p => p === '/admin' })}
            </>
          )}
        </nav>

        <div className="p-4 border-t border-gray-700">
          <div className={`flex items-center gap-3 p-3 bg-gray-800/50 rounded-xl mb-4 ${railCollapsed ? 'md:justify-center md:bg-transparent md:p-0 md:mb-2' : ''}`}>
             <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-xs font-bold text-white shrink-0" title={user?.name}>
                {user?.name?.charAt(0) || 'U'}
             </div>
             <div className={`overflow-hidden ${railCollapsed ? 'md:hidden' : ''}`}>
                <div className="text-xs font-bold truncate">{user?.name}</div>
                <div className="text-[10px] text-gray-400">{isSuperAdmin ? 'SUPER ADMIN' : user?.role}</div>
             </div>
          </div>
          <button onClick={handleLogout} title={railCollapsed ? 'Sign out' : undefined} className={`flex items-center gap-3 py-2 w-full text-xs font-medium text-gray-400 rounded-lg hover:text-rose-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${railCollapsed ? 'px-4 md:px-0 md:justify-center' : 'px-4 text-left'}`}>
            <LogOut size={16} className="shrink-0" />
            <span className={railCollapsed ? 'md:hidden' : ''}>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`flex-1 min-h-screen flex flex-col transition-[margin,padding] ${
          railCollapsed ? 'md:ml-16' : 'md:ml-64'
        } ${inboxOpen ? 'lg:pr-[400px]' : ''}`}
      >
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center sticky top-0 z-20 shadow">
          <div className="flex-1 flex items-center gap-3 min-w-0">
             <button
               onClick={() => setMobileNavOpen(true)}
               aria-label="Open navigation"
               className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent shrink-0"
             >
               <Menu size={20} />
             </button>
             <button
               onClick={toggleSidebar}
               aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
               title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
               className="hidden md:inline-flex p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent shrink-0"
             >
               {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
             </button>
             <div className="min-w-0 flex-1"><Breadcrumbs /></div>
          </div>

          {/* Project inbox trigger — the app's only notification surface. */}
          <div className="flex items-center gap-4">
            {overdueCount > 0 && (
              <Link to="/timeline" className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 rounded-full text-xs font-bold hover:bg-rose-100 transition-colors border border-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400">
                <AlertCircle size={14} />
                {overdueCount} Overdue
              </Link>
            )}

            <button
              onClick={() => setInbox(!inboxOpen)}
              aria-label="Project inbox"
              aria-expanded={inboxOpen}
              title={
                inbox.badgeCount > 0
                  ? `${inbox.reviewCount} awaiting your review, ${inbox.waitingCount} awaiting supplier`
                  : 'Project inbox'
              }
              className={`relative p-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                inboxOpen
                  ? 'bg-accent text-white'
                  : inbox.badgeCount > 0
                    ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                    : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              <Inbox size={20} />
              {/* Counts only what the PM can act on — review items and their own unread
                  mail. "Waiting on supplier" is shown in the drawer but never badged: a
                  number the PM cannot clear by working is just a permanent alarm. */}
              {inbox.badgeCount > 0 && (
                <span className="absolute top-0 right-0 min-w-4 h-4 px-1 bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full shadow">
                  {inbox.badgeCount > 99 ? '99+' : inbox.badgeCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="p-6 md:p-10 overflow-y-auto">
          {/* Pages read the same snapshot the drawer lists, so a dashboard counter and the
              drawer can never disagree about what is open. */}
          <InboxProvider value={inboxContext}>
            {children}
          </InboxProvider>
        </div>
      </main>

      <ProjectInboxPanel open={inboxOpen} onClose={() => setInbox(false)} inbox={inbox} />

      <FeedbackWidget />
    </div>
  );
};

export default Layout;
