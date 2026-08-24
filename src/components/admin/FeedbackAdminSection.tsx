/**
 * Feedback admin — the queue of bug reports / feature requests filed from the
 * floating widget (migration 128). Read/write is admin-only (enforced by RLS);
 * this is just triage: mark an item done once it's handled, or reopen it.
 */
import React, { useEffect, useState } from 'react';
import { Bug, Lightbulb, CheckCircle2, RotateCcw, Loader2 } from 'lucide-react';
import { getFeedbackReports, setFeedbackReportStatus } from '../../services';
import type { FeedbackReport } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useRefetchOnFocus } from '../../hooks';

const FeedbackAdminSection: React.FC = () => {
  const { user } = useAuth();
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setReports(await getFeedbackReports()); }
    catch (e) { console.error('[FeedbackAdminSection] loading reports failed:', e); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useRefetchOnFocus(load);

  const toggleStatus = async (report: FeedbackReport) => {
    setUpdatingId(report.id);
    try {
      const nextStatus = report.status === 'open' ? 'done' : 'open';
      await setFeedbackReportStatus(report.id, nextStatus, user?.id);
      await load();
    } catch (e: any) {
      alert(`Failed to update report: ${e?.message ?? e}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const visible = reports.filter(r => filter === 'all' || r.status === filter);
  const openCount = reports.filter(r => r.status === 'open').length;

  return (
    <div>
      <div className="px-6 py-4 bg-light border-b border-gray-200 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-gray-800">Feedback</h3>
          <p className="text-xs text-muted mt-0.5">
            Bug reports and feature requests filed from the "Feedback" widget, bottom-right of every page.
          </p>
        </div>
        <div className="flex items-center rounded-md border border-gray-200 bg-white p-0.5 shadow-sm">
          {(['open', 'done', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded capitalize ${filter === f ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {f === 'open' ? `Open${openCount ? ` (${openCount})` : ''}` : f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="px-6 py-10 text-center text-gray-400 text-sm">Loading feedback…</div>
      ) : visible.length === 0 ? (
        <div className="px-6 py-10 text-center text-gray-400 text-sm">
          {filter === 'open' ? 'No open items — nice and clear.' : 'Nothing here yet.'}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {visible.map(r => (
            <div key={r.id} className={`px-6 py-4 flex items-start gap-3 ${r.status === 'done' ? 'opacity-60' : ''}`}>
              <div
                className={`mt-0.5 shrink-0 p-1.5 rounded-lg ${r.type === 'bug' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}
                title={r.type === 'bug' ? 'Bug report' : 'Feature request'}
              >
                {r.type === 'bug' ? <Bug size={15} /> : <Lightbulb size={15} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{r.message}</p>
                <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
                  <span>{r.createdByName ?? 'Unknown user'}</span>
                  <span>·</span>
                  <span>{new Date(r.createdAt).toLocaleString()}</span>
                  {r.pagePath && (
                    <>
                      <span>·</span>
                      <span className="font-mono truncate" title={r.pagePath}>{r.pagePath}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => toggleStatus(r)}
                disabled={updatingId === r.id}
                title={r.status === 'open' ? 'Mark as done' : 'Reopen'}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                  r.status === 'open'
                    ? 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                    : 'text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {updatingId === r.id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : r.status === 'open' ? (
                  <CheckCircle2 size={13} />
                ) : (
                  <RotateCcw size={13} />
                )}
                {r.status === 'open' ? 'Mark done' : 'Reopen'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FeedbackAdminSection;
