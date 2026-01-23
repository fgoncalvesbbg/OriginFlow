
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

const routeLabels: Record<string, string> = {
  'create': 'New Project',
  'compliance': 'Compliance',
  'library': 'Library',
  'admin': 'Admin Console',
  'project': 'Project',
  'request': 'TCF Request',
};

// Paths that correspond to actual pages we can link to
const navigablePaths = new Set([
  '/compliance',
  '/admin',
  '/compliance/library',
  '/'
]);

export const Breadcrumbs: React.FC = () => {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter((x) => x);

  // Don't show breadcrumbs on the main dashboard (root)
  if (pathnames.length === 0) return null;

  return (
    <nav className="flex items-center text-xs text-muted mb-6 animate-in fade-in slide-in-from-left-2 duration-300">
      <Link
        to="/"
        className="hover:text-indigo-600 flex items-center gap-1 transition-colors hover:bg-gray-100 px-2 py-1 rounded"
      >
        <Home size={14} />
        <span className="hidden sm:inline font-medium">Dashboard</span>
      </Link>

      {pathnames.map((value, index) => {
        const to = `/${pathnames.slice(0, index + 1).join('/')}`;
        const isLast = index === pathnames.length - 1;

        // Heuristic: If it contains numbers or dashes and is long, it's likely an ID
        const isId = value.length > 10 || /\d/.test(value) && value.includes('-');

        let label = routeLabels[value] || value.replace(/-/g, ' ');

        // Contextual renaming for IDs
        if (isId) {
          const prev = pathnames[index - 1];
          if (prev === 'project') label = 'Project Details';
          else if (prev === 'request') label = 'Request Details';
          else label = 'Details';
        }

        const canLink = !isLast && !isId && navigablePaths.has(to);

        return (
          <React.Fragment key={to}>
            <ChevronRight size={12} className="mx-1 text-gray-300" />
            {isLast ? (
              <span className="font-semibold text-primary capitalize truncate max-w-[200px] px-1">
                {label}
              </span>
            ) : canLink ? (
              <Link
                to={to}
                className="hover:text-indigo-600 capitalize transition-colors hover:bg-gray-100 px-2 py-1 rounded"
              >
                {label}
              </Link>
            ) : (
              <span className="capitalize text-gray-400 px-1">
                {label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
