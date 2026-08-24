/**
 * Feedback reports — CRUD over the `feedback_reports` table (migration 128).
 * Any signed-in user can file a bug/feature report from the floating widget;
 * only an admin can read the queue and mark items done (enforced by RLS).
 */

import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { FeedbackReport, FeedbackReportType } from '../../types';

const mapRow = (row: any): FeedbackReport => ({
  id: row.id,
  type: row.type,
  message: row.message,
  pagePath: row.page_path ?? undefined,
  status: row.status,
  createdBy: row.created_by ?? undefined,
  createdByName: row.created_by_profile?.name ?? undefined,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at ?? undefined,
  resolvedBy: row.resolved_by ?? undefined,
});

export const createFeedbackReport = async (
  report: { type: FeedbackReportType; message: string; pagePath?: string },
  createdBy: string,
): Promise<void> => {
  await db.insertMany('feedback_reports', [{
    type: report.type,
    message: report.message,
    page_path: report.pagePath || null,
    created_by: createdBy,
  }]);
};

export const getFeedbackReports = async (): Promise<FeedbackReport[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('feedback_reports', {
      columns: '*, created_by_profile:profiles!created_by(id, name)',
      order: { column: 'created_at', ascending: false },
    }),
    '[feedback] getFeedbackReports',
  );
  return rows.map(mapRow);
};

export const setFeedbackReportStatus = async (
  id: string,
  status: 'open' | 'done',
  resolvedBy?: string,
): Promise<void> => {
  await db.updateWhere(
    'feedback_reports',
    {
      status,
      resolved_at: status === 'done' ? new Date().toISOString() : null,
      resolved_by: status === 'done' ? (resolvedBy ?? null) : null,
    },
    { where: { id } },
  );
};
