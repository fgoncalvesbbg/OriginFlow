
/**
 * Route guard for modules still under test: renders children only for Super Admins.
 *
 * Fails closed — anything other than a loaded user carrying the flag is redirected,
 * including the brief window before the profile resolves. A module behind this guard
 * is also absent from the sidebar (Layout reads the same list in
 * config/moduleAccess.config), so this guard is what stops a shared or typed URL.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: React.ReactNode;
}

const SuperAdminRoute: React.FC<Props> = ({ children }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-light text-gray-400">Loading session...</div>;
  }

  // Redirect rather than render a "no access" page: an unreleased module should
  // read as not existing yet, not as something the user is being kept out of.
  if (!user?.isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default SuperAdminRoute;
