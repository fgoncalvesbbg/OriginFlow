/**
 * User-submitted bug reports / feature requests (migration 128).
 */

export type FeedbackReportType = 'bug' | 'feature';
export type FeedbackReportStatus = 'open' | 'done';

export interface FeedbackReport {
  id: string;
  type: FeedbackReportType;
  message: string;
  pagePath?: string;
  status: FeedbackReportStatus;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}
