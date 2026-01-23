import React from 'react';
import { StepStatus, DocStatus, ProjectOverallStatus } from '../types';

interface Props {
  status: StepStatus | DocStatus | ProjectOverallStatus | string;
  type: 'step' | 'doc' | 'project';
}

const getStatusStyles = (status: string, type: string) => {
  const base = "px-2.5 py-1 rounded-xl text-xs font-medium whitespace-nowrap";

  // Mappings
  switch (status) {
    case ProjectOverallStatus.IN_PROGRESS:
    case StepStatus.IN_PROGRESS:
    case DocStatus.WAITING_UPLOAD:
    case DocStatus.UNDER_REVIEW:
      return `${base} bg-indigo-50 text-indigo-700 border border-indigo-200`;

    case ProjectOverallStatus.COMPLETED:
    case StepStatus.COMPLETED:
    case DocStatus.APPROVED:
    case DocStatus.UPLOADED:
      return `${base} bg-emerald-50 text-emerald-700 border border-emerald-200`;

    case ProjectOverallStatus.ON_HOLD:
    case StepStatus.BLOCKED:
    case DocStatus.REJECTED:
    case ProjectOverallStatus.CANCELLED:
      return `${base} bg-rose-50 text-rose-700 border border-rose-200`;

    case ProjectOverallStatus.ARCHIVED:
      return `${base} bg-gray-100 text-gray-600 border border-gray-300`;

    case StepStatus.NOT_STARTED:
    case DocStatus.NOT_STARTED:
    default:
      return `${base} bg-gray-50 text-gray-600 border border-gray-200`;
  }
};

const formatLabel = (str: string) => {
  return str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export const StatusBadge: React.FC<Props> = ({ status, type }) => {
  return (
    <span className={getStatusStyles(status, type)}>
      {formatLabel(status)}
    </span>
  );
};