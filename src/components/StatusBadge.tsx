import React from 'react';
import { StepStatus, DocStatus, ProjectOverallStatus } from '../types';

interface Props {
  status: StepStatus | DocStatus | ProjectOverallStatus | string;
  type: 'step' | 'doc' | 'project';
}

const getStatusStyles = (status: string, type: string) => {
  const base = "px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap";
  
  // Mappings
  switch (status) {
    case ProjectOverallStatus.IN_PROGRESS:
    case StepStatus.IN_PROGRESS:
    case DocStatus.WAITING_UPLOAD:
    case DocStatus.UNDER_REVIEW:
      return `${base} bg-blue-100 text-blue-800`;
    
    case ProjectOverallStatus.COMPLETED:
    case StepStatus.COMPLETED:
    case DocStatus.APPROVED:
    case DocStatus.UPLOADED:
      return `${base} bg-green-100 text-green-800`;
      
    case ProjectOverallStatus.ON_HOLD:
    case StepStatus.BLOCKED:
    case DocStatus.REJECTED:
    case ProjectOverallStatus.CANCELLED:
      return `${base} bg-red-100 text-red-800`;
    
    case ProjectOverallStatus.ARCHIVED:
      return `${base} bg-slate-200 text-slate-600 border border-slate-300`;
      
    case StepStatus.NOT_STARTED:
    case DocStatus.NOT_STARTED:
    default:
      return `${base} bg-slate-100 text-slate-600`;
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