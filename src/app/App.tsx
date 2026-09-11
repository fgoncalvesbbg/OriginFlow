
/** Root application component: defines the route table and wraps pages in providers/guards. */
import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ToastProvider, ToastContext } from '../context/ToastContext';
import { ConnectionProvider } from '../context/ConnectionContext';
import ProtectedRoute from '../components/ProtectedRoute';
import AdminRoute from '../components/AdminRoute';
import SuperAdminRoute from '../components/SuperAdminRoute';
import { ToastContainer } from '../components/common/Toast';
import { ConnectionBanner } from '../components/common/ConnectionBanner';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { checkComplianceDeadlines } from '../services';

// Pages
import Login from '../pages/Login';
import PMDashboard from '../pages/PMDashboard';
import TimelineDashboard from '../pages/TimelineDashboard';
import ProjectDetail from '../pages/ProjectDetail';
import CreateProject from '../pages/CreateProject';
import SupplierPortal from '../pages/SupplierPortal';
import AdminDashboard from '../pages/AdminDashboard';
import AdminTestEmail from '../pages/AdminTestEmail';
import SupplierDashboard from '../pages/SupplierDashboard';
import SuppliersList from '../pages/SuppliersList';
import AttributeViewer from '../pages/products/AttributeViewer';
import DocumentsRegistry from '../pages/documents/DocumentsRegistry';

// Compliance Pages
import ComplianceDashboard from '../pages/compliance/ComplianceDashboard';
import CreateComplianceRequest from '../pages/compliance/CreateComplianceRequest';
import ComplianceRequestDetail from '../pages/compliance/ComplianceRequestDetail';
import SupplierCompliancePortal from '../pages/compliance/SupplierCompliancePortal';
import SupplierCompliancePortalList from '../pages/compliance/SupplierCompliancePortalList';
import ComplianceLibrary from '../pages/compliance/ComplianceLibrary';

// Regulations — the single regulation library both the TCF and the IM read from
import RegulationsPage from '../pages/regulations/RegulationsPage';
import RegulationDetail from '../pages/regulations/RegulationDetail';

// IM Pages
import IMDashboard from '../pages/im/IMDashboard';
import IMTemplateEditor from '../pages/im/IMTemplateEditor';
import IMPreview from '../pages/im/IMPreview';
import IMSharedManual from '../pages/im/IMSharedManual';
import IMReviewPortal from '../pages/im/IMReviewPortal';
import DesignSpecReviewPortal from '../pages/design/DesignSpecReviewPortal';
import IMDraftReviewPortal from '../pages/im/IMDraftReviewPortal';
import IMDraftQueuePortal from '../pages/im/IMDraftQueuePortal';
import DesignSpecsDashboard from '../pages/design/DesignSpecsDashboard';
import RoadmapDashboard from '../pages/roadmap/RoadmapDashboard';
import IMBlockLibrary from '../pages/im/IMBlockLibrary';
import ProjectIMGenerator from '../pages/im/ProjectIMGenerator';

// Standalone Tools
import PdfToMarkdownPage from '../modules/pdf-to-markdown';

// Sourcing Pages
import SourcingDashboard from '../pages/sourcing/SourcingDashboard';
import CreateRFQ from '../pages/sourcing/CreateRFQ';
import RFQDetail from '../pages/sourcing/RFQDetail';
import SupplierRFQPortal from '../pages/sourcing/SupplierRFQPortal';
import SupplierAttributePortal from '../pages/SupplierAttributePortal';
import SupplierAttributeBatchPortal from '../pages/SupplierAttributeBatchPortal';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  // Trigger background checks for deadlines once a session is actually in hand.
  // Firing this on bare mount sent the query before the Supabase client had hydrated its
  // token (and on every public/supplier route, where there is no session at all), so
  // PostgREST answered 401 "permission denied for table compliance_requests" — anon has no
  // SELECT grant. The check is internal-only, so gate it on the authenticated session.
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    checkComplianceDeadlines();
  }, [isLoading, isAuthenticated]);

  const toastContext = React.useContext(ToastContext);

  return (
    <>
      <ConnectionBanner />
      <Router>
        {/* Inner boundary INSIDE the router: a crash in one page shows the fallback
            without tearing down the router or the auth/connection/toast providers,
            so navigation and "Try Again" still work (the outer boundary in <App/>
            would otherwise unmount the whole app on any single-page error). */}
        <ErrorBoundary>
          <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/supplier/:token" element={<SupplierPortal />} />
          <Route path="/supplier-dashboard/:token" element={<SupplierDashboard />} />
          <Route path="/compliance/supplier/:token" element={<SupplierCompliancePortal />} />
          <Route path="/compliance/supplier-portal" element={<SupplierCompliancePortalList />} />
          <Route path="/sourcing/supplier/:token" element={<SupplierRFQPortal />} />
          <Route path="/im/preview/:templateId" element={<IMPreview />} />
          <Route path="/share/im/:token" element={<IMSharedManual />} />
          {/* Supplier review portals. One route per subject kind rather than a single
              /review/:token that resolves the token to decide — resolving is what stamps
              last_used_at and use_count ("the portal was opened"), so a dispatcher would
              have to resolve once to choose a portal and the portal would resolve again,
              double-counting every visit. The link builders already know the subject:
              getIMReviewUrl and designSpecReviewUrl. */}
          <Route path="/review/im/:token" element={<IMReviewPortal />} />
          <Route path="/review/design-spec/:token" element={<DesignSpecReviewPortal />} />
          {/* The supplier draft intake (migration 179). The markup round is the same shared
              shell as the two above, so it gets its own route for the same reason they do.
              The queue is the odd one out — a FIXED url with no token, because a quality
              manager has to be able to bookmark it. It is gated by a shared access code
              checked server-side; see the note in IMDraftQueuePortal. */}
          <Route path="/review/im-draft/:token" element={<IMDraftReviewPortal />} />
          <Route path="/im-draft/queue" element={<IMDraftQueuePortal />} />
          <Route path="/attribute-request/:token" element={<SupplierAttributePortal />} />
          <Route path="/attribute-request-batch/:batchToken" element={<SupplierAttributeBatchPortal />} />

          {/* Protected PM Routes */}
          <Route path="/" element={
            <ProtectedRoute>
              <PMDashboard />
            </ProtectedRoute>
          } />
          
          <Route path="/timeline" element={
            <ProtectedRoute>
              <TimelineDashboard />
            </ProtectedRoute>
          } />

          <Route path="/create" element={
            <ProtectedRoute>
              <CreateProject />
            </ProtectedRoute>
          } />
          <Route path="/project/:id" element={
            <ProtectedRoute>
              <ProjectDetail />
            </ProtectedRoute>
          } />
          
          <Route path="/suppliers" element={
            <ProtectedRoute>
              <SuppliersList />
            </ProtectedRoute>
          } />

          {/* Super-Admin-only while the merged module is under test. The prefix list in
              config/moduleAccess.config gates the sidebar too, so the nav entry and this guard
              can never disagree. */}
          <Route path="/attributes" element={
            <ProtectedRoute>
              <SuperAdminRoute>
                <AttributeViewer />
              </SuperAdminRoute>
            </ProtectedRoute>
          } />

          {/* Design Specs — open to every signed-in user. The access model is entirely in
              RLS: the DESIGNER role and the is_design_editor() write policies decide who can
              change a spec, and can_see_project() decides whose specs each viewer reads. The
              spec DETAIL lives on the project's own Design Spec tab — one spec per project
              makes the project its page. */}
          <Route path="/design-specs" element={
            <ProtectedRoute>
              <DesignSpecsDashboard />
            </ProtectedRoute>
          } />

          {/* Roadmap Creator — Super-Admin-only while the port is under construction (the
              Step-Up Chart, History and Summary tabs are not built yet). Same prefix list as
              /attributes gates the sidebar, so the nav entry and this guard cannot disagree.
              The real write model is RLS: is_roadmap_editor() from migration 167, which is
              admins and PMs; the reference tables have no write policy at all. Remove the
              prefix from moduleAccess.config to launch it. */}
          <Route path="/roadmap" element={
            <ProtectedRoute>
              <SuperAdminRoute>
                <RoadmapDashboard />
              </SuperAdminRoute>
            </ProtectedRoute>
          } />

          {/* SKU Catalog was merged into the Attribute Viewer (Phase 3 of
              docs/originflow-attribute-viewer-merge-plan.md): one transposed grid over
              project_skus instead of two that both wrote the same column. Every capability it
              carried — add, delete, values-sheet upload, roster paste, finalize/unlock, the
              change log, the row export, the changed-only filter — now lives on /attributes.
              The redirect stays because /products is a URL people have bookmarked. */}
          <Route path="/products" element={<Navigate to="/attributes" replace />} />

          {/* SOP & Documents — the registry for internal SOPs and supplier-facing specs.
              Open to every internal user: a PM needs the packaging guideline as much as an
              admin does. The one privileged action (the FINAL tick) is gated inside the
              page and, properly, on the route that performs it. */}
          <Route path="/documents" element={
            <ProtectedRoute>
              <DocumentsRegistry />
            </ProtectedRoute>
          } />

          {/* Sourcing Module */}
          <Route path="/sourcing" element={
            <ProtectedRoute>
              <SourcingDashboard />
            </ProtectedRoute>
          } />
          <Route path="/sourcing/create" element={
            <ProtectedRoute>
              <CreateRFQ />
            </ProtectedRoute>
          } />
          <Route path="/sourcing/:id" element={
            <ProtectedRoute>
              <RFQDetail />
            </ProtectedRoute>
          } />

          {/* Project IM Generator */}
          <Route path="/project/:projectId/im-generator/:templateType?" element={
            <ProtectedRoute>
              <ProjectIMGenerator />
            </ProtectedRoute>
          } />
          
          {/* Protected Compliance Module */}
          <Route path="/compliance" element={
            <ProtectedRoute>
              <ComplianceDashboard />
            </ProtectedRoute>
          } />
          <Route path="/compliance/library" element={
            <ProtectedRoute>
              <ComplianceLibrary />
            </ProtectedRoute>
          } />
          <Route path="/compliance/create" element={
            <ProtectedRoute>
              <CreateComplianceRequest />
            </ProtectedRoute>
          } />
          <Route path="/compliance/request/:id" element={
            <ProtectedRoute>
              <ComplianceRequestDetail />
            </ProtectedRoute>
          } />

          {/* Protected Regulations Module — the shared regulation brain (migration 139).
              Top level rather than under /compliance or /im because both read from it;
              filing it under either would have made it look owned by that one. */}
          <Route path="/regulations" element={
            <ProtectedRoute>
              <RegulationsPage />
            </ProtectedRoute>
          } />
          <Route path="/regulations/:regulationId" element={
            <ProtectedRoute>
              <RegulationDetail />
            </ProtectedRoute>
          } />

          {/* Protected IM Module */}
          <Route path="/im" element={
            <ProtectedRoute>
              <IMDashboard />
            </ProtectedRoute>
          } />
          <Route path="/im/template/:categoryId/:templateType?" element={
            <ProtectedRoute>
              <IMTemplateEditor />
            </ProtectedRoute>
          } />
          <Route path="/im/library" element={
            <ProtectedRoute>
              <IMBlockLibrary />
            </ProtectedRoute>
          } />


          {/* Standalone Tools */}
          <Route path="/tools/pdf-to-markdown" element={
            <ProtectedRoute>
              <PdfToMarkdownPage />
            </ProtectedRoute>
          } />

          {/* Admin Routes */}
          <Route path="/admin" element={
            <ProtectedRoute>
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            </ProtectedRoute>
          } />
          <Route path="/admin/test-email" element={
            <ProtectedRoute>
              <AdminRoute>
                <AdminTestEmail />
              </AdminRoute>
            </ProtectedRoute>
          } />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </Router>
      {toastContext && <ToastContainer toasts={toastContext.toasts} onClose={toastContext.removeToast} />}
    </>
  );
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConnectionProvider>
          <ToastProvider>
            <AppContent />
          </ToastProvider>
        </ConnectionProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
