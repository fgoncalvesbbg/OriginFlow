/** Colored status pill for step/document/project statuses. Thin wrapper over the Badge primitive. */
import React from 'react';
import { StepStatus, DocStatus, ProjectOverallStatus } from '../types';
import { Badge, BadgeTone } from './common/Badge';

interface Props {
  status: StepStatus | DocStatus | ProjectOverallStatus | string;
  type: 'step' | 'doc' | 'project';
}

/** Map a domain status onto the shared status-tone vocabulary (see DESIGN.md). */
const toneForStatus = (status: string): BadgeTone => {
  switch (status) {
    case ProjectOverallStatus.IN_PROGRESS:
    case StepStatus.IN_PROGRESS:
    case DocStatus.WAITING_UPLOAD:
    case DocStatus.UNDER_REVIEW:
      return 'indigo';

    case ProjectOverallStatus.COMPLETED:
    case StepStatus.COMPLETED:
    case DocStatus.APPROVED:
    case DocStatus.UPLOADED:
      return 'emerald';

    case ProjectOverallStatus.ON_HOLD:
    case StepStatus.BLOCKED:
    case DocStatus.REJECTED:
    case ProjectOverallStatus.CANCELLED:
      return 'rose';

    case ProjectOverallStatus.ARCHIVED:
    case StepStatus.NOT_STARTED:
    case DocStatus.NOT_STARTED:
    default:
      return 'gray';
  }
};

const formatLabel = (str: string) => str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

export const StatusBadge: React.FC<Props> = ({ status }) => (
  <Badge tone={toneForStatus(status)}>{formatLabel(status)}</Badge>
);
