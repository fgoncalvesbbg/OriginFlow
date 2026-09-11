/**
 * The quality manager's draft queue (`/#/im-draft/queue`) — migration 179.
 *
 * WHY THIS PAGE EXISTS AT ALL. When a supplier uploads a draft, the system mints a review
 * link for Quality — and then has no way to deliver it. OriginFlow sends NO email:
 * `triggerEmailNotification` in notification.service.ts is a stub that suppresses every send
 * and returns success. So the link has to be *collected* rather than delivered, and this is
 * where. Quality bookmarks one URL and works the queue.
 *
 * WHY A SHARED CODE AND NOT A TOKEN PER PERSON. Quality does not work in OriginFlow and will
 * not log in for this. The pattern is the one SupplierCompliancePortalList already
 * establishes: a fixed, bookmarkable URL plus a shared secret typed into the page. One code
 * to hand out, rotatable in Admin, and nothing to administer per person.
 *
 * WHAT THIS DELIBERATELY EXPOSES, AND WHAT IT DOES NOT. Anyone holding the code can open any
 * draft AWAITING REVIEW. That is the accepted price of Quality not logging in. It is bounded
 * on purpose: the queue never returns the project list, never a project without a pending
 * draft, never a published manual, and never a storage path — only the drafts someone is
 * being asked to look at. The code itself is checked server-side against a pgcrypto hash and
 * rate-limited per IP BEFORE it is compared, so this screen is not a guessing oracle.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Loader2, Lock, ArrowRight, Clock, AlertCircle } from 'lucide-react';
import { KlarsteinLogo } from '../../components/KlarsteinBrand';
import { getQualityDraftQueue, type QueuedDraft } from '../../services/im/im-draft.service';

const IMDraftQueuePortal: React.FC = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [drafts, setDrafts] = useState<QueuedDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unlocked, setUnlocked] = useState(false);

  const open = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Please enter your access code.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const queue = await getQualityDraftQueue(code.trim());
      setDrafts(queue);
      setUnlocked(true);
    } catch (err: any) {
      // The function distinguishes a wrong code (403) from a server problem, and writes the
      // message for this screen. A throttled caller reads the same as a wrong code, which is
      // deliberate.
      setError(err?.message ?? 'Could not open the draft queue.');
      setDrafts([]);
      setUnlocked(false);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });

  const daysWaiting = (iso: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

  return (
    <div className="min-h-screen bg-light">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <KlarsteinLogo />
          <div className="border-l border-gray-200 pl-3">
            <h1 className="text-sm font-bold text-gray-900">Draft manuals for review</h1>
            <p className="text-[11px] text-gray-500">Quality check before the manual is written</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {!unlocked && (
          <form onSubmit={open} className="bg-white border border-gray-200 rounded-xl p-6 max-w-md mx-auto">
            <div className="flex items-center gap-2 mb-4">
              <Lock size={16} className="text-gray-400" />
              <h2 className="text-sm font-bold text-gray-900">Enter your access code</h2>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Your project manager can give you the code. It is the same one every time.
            </p>
            <input
              type="password"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Access code"
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {error && (
              <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">
                <AlertCircle size={14} className="shrink-0 mt-0.5" /> <span>{error}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              className="kl-cta w-full rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 size={14} className="animate-spin" /> Checking…</> : 'Continue'}
            </button>
          </form>
        )}

        {unlocked && (
          <>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-900">
                {drafts.length === 0
                  ? 'Nothing waiting for you'
                  : `${drafts.length} draft${drafts.length === 1 ? '' : 's'} waiting for you`}
              </h2>
              <button
                onClick={() => { setUnlocked(false); setDrafts([]); setCode(''); }}
                className="text-xs text-gray-500 hover:text-gray-800 underline"
              >
                Lock
              </button>
            </div>

            {drafts.length === 0 && (
              <div className="bg-white border border-dashed border-gray-300 rounded-xl py-12 text-center">
                <FileText size={24} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">
                  No supplier drafts are waiting for a quality check right now.
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Check back after a supplier uploads one.
                </p>
              </div>
            )}

            <div className="space-y-2">
              {drafts.map(d => {
                const waiting = daysWaiting(d.uploadedAt);
                return (
                  <button
                    key={d.token}
                    onClick={() => navigate(`/review/im-draft/${d.token}`)}
                    className="w-full text-left bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition flex items-center gap-3"
                  >
                    <FileText size={18} className="text-gray-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900 truncate">
                          {d.projectName ?? 'Untitled project'}
                        </span>
                        {d.projectCode && (
                          <span className="text-[10px] font-mono text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
                            {d.projectCode}
                          </span>
                        )}
                        {d.version != null && (
                          <span className="text-[10px] font-semibold text-gray-500">v{d.version}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{d.pageCount ? `${d.pageCount} pages · ` : ''}from {d.uploadedBy}</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock size={10} />
                          {waiting === 0 ? 'uploaded today' : `waiting ${waiting} day${waiting === 1 ? '' : 's'}`}
                          {' · '}{formatDate(d.uploadedAt)}
                        </span>
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-gray-400 shrink-0" />
                  </button>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default IMDraftQueuePortal;
