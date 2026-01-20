
import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import ProtectedRoute from '../components/ProtectedRoute';
import AdminRoute from '../components/AdminRoute';
import { checkComplianceDeadlines } from '../services/apiService';

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

// Compliance Pages
import ComplianceDashboard from '../pages/compliance/ComplianceDashboard';
import CreateComplianceRequest from '../pages/compliance/CreateComplianceRequest';
import ComplianceRequestDetail from '../pages/compliance/ComplianceRequestDetail';
import SupplierCompliancePortal from '../pages/compliance/SupplierCompliancePortal';
import ComplianceLibrary from '../pages/compliance/ComplianceLibrary';

// IM Pages
import IMDashboard from '../pages/im/IMDashboard';
import IMTemplateEditor from '../pages/im/IMTemplateEditor';
import IMPreview from '../pages/im/IMPreview';
import ProjectIMGenerator from '../pages/im/ProjectIMGenerator';

// Sourcing Pages
import SourcingDashboard from '../pages/sourcing/SourcingDashboard';
import CreateRFQ from '../pages/sourcing/CreateRFQ';
import RFQDetail from '../pages/sourcing/RFQDetail';
import SupplierRFQPortal from '../pages/sourcing/SupplierRFQPortal';

const App: React.FC = () => {
  // Trigger background checks for deadlines on app mount
  useEffect(() => {
    checkComplianceDeadlines();
  }, []);

  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/supplier/:token" element={<SupplierPortal />} />
          <Route path="/supplier-dashboard/:token" element={<SupplierDashboard />} />
          <Route path="/compliance/supplier/:token" element={<SupplierCompliancePortal />} />
          <Route path="/sourcing/supplier/:token" element={<SupplierRFQPortal />} />
          <Route path="/im/preview/:templateId" element={<IMPreview />} />

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
          <Route path="/project/:projectId/im-generator" element={
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

          {/* Protected IM Module */}
          <Route path="/im" element={
            <ProtectedRoute>
              <IMDashboard />
            </ProtectedRoute>
          } />
          <Route path="/im/template/:categoryId" element={
            <ProtectedRoute>
              <IMTemplateEditor />
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
      </Router>
    </AuthProvider>
  );
};

export default App;
