/**
 * The two design spec blocks a SUPPLIER sees, shared by their project portal and their
 * dashboard so both surfaces say the same thing about the same round.
 *
 * Purely presentational: the parent has already loaded the rows with its own credential
 * (both surfaces load everything in one pass and neither wants a second waterfall), and
 * passes them down. The one thing these components do reach out for is the final's signed
 * URL, which cannot be prefetched — it lives five minutes and is minted per click.
 *
 * WHY DEAD ROUNDS ARE STILL DRAWN. A supplier's question months later is "what did we review
 * and when", and a list that quietly drops the answer is worse than one that greys it. A
 * revoked or expired round is therefore rendered with its dates and no link — the link would
 * be refused server-side anyway, and offering it would be a lie about what they can still do.
 */

import React, { useState } from 'react';
import {
  AlertCircle, CheckCircle, Clock, Download, ExternalLink, FileText, Loader2, Lock,
} from 'lucide-react';
import { designSpecReviewUrl, fetchSupplierDesignSpecFinalUrl } from '../../services/design';
import type { PortalCredentials } from '../../services/documents';
import {
  isRoundClosed,
  type SupplierDesignSpecFinal, type SupplierDesignSpecRound,
} from '../../types/design-spec.types';

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—';

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/** Why a round cannot be opened, in the supplier's words. Null while it still can be. */
const closedReason = (r: SupplierDesignSpecRound): string | null => {
  if (r.revokedAt) return `Closed by Klarstein on ${shortDate(r.revokedAt)}`;
  if (r.expiresAt && new Date(r.expiresAt) <= new Date()) {
    return `Expired on ${shortDate(r.expiresAt)}`;
  }
  return null;
};

interface RoundsProps {
  rounds: readonly SupplierDesignSpecRound[];
  /** Shown on the dashboard, where rounds from several projects sit in one list. */
  showProject?: boolean;
}

/** Design spec drafts sent to this supplier to mark up. */
export const DesignSpecRoundsCard: React.FC<RoundsProps> = ({ rounds, showProject = false }) => {
  if (rounds.length === 0) return null;

  return (
    <div className="divide-y divide-slate-100">
      {rounds.map(r => {
        const closed = isRoundClosed(r);
        const reason = closedReason(r);
        return (
          <div
            key={r.shareId}
            className={`p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${closed ? 'opacity-60' : ''}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <FileText size={15} className="text-indigo-500 shrink-0" />
                <span className="font-semibold text-primary break-words">
                  {r.specCode} · v{r.version}
                </span>
                {r.versionKind === 'draft' && (
                  <span className="text-[10px] uppercase tracking-wide font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                    Draft
                  </span>
                )}
                {r.submittedAt && (
                  <span className="text-[10px] uppercase tracking-wide font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
                    Submitted
                  </span>
                )}
              </div>
              <p className="text-sm text-muted mt-1 break-words">
                {r.specTitle}
                {showProject && <span className="text-gray-400"> · {r.projectName}</span>}
              </p>
              {r.versionNote && (
                <p className="text-xs text-gray-500 mt-1 italic break-words">“{r.versionNote}”</p>
              )}
              <p className="text-xs text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>Sent {shortDate(r.sentAt)}</span>
                {r.pageCount != null && <span>{r.pageCount} pages</span>}
                {r.label && <span className="text-gray-400">for {r.label}</span>}
                {/* Only worth saying while it is still true — a passed date is `reason`. */}
                {!closed && r.expiresAt && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <Clock size={12} /> Open until {shortDate(r.expiresAt)}
                  </span>
                )}
              </p>
              {r.submittedAt && (
                <p className="text-xs text-emerald-700 mt-1">
                  Review submitted {shortDate(r.submittedAt)}
                  {r.submittedBy ? ` by ${r.submittedBy}` : ''}
                  {!closed && ' — you can still add notes.'}
                </p>
              )}
            </div>

            <div className="sm:w-44 shrink-0">
              {closed ? (
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Lock size={13} /> {reason}
                </span>
              ) : (
                <a
                  href={designSpecReviewUrl(r.token)}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition"
                >
                  <ExternalLink size={14} />
                  {r.submittedAt ? 'Reopen review' : 'Open review'}
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface FinalsProps {
  finals: readonly SupplierDesignSpecFinal[];
  /** The credential this surface was opened with; used to sign the download. */
  credentials: PortalCredentials;
  showProject?: boolean;
}

/**
 * The issued design spec — or a placeholder saying it is not issued yet.
 *
 * The placeholder is the point. Before this existed the final simply appeared one day, with
 * nothing beforehand telling the factory where to look for it.
 */
export const DesignSpecFinalCard: React.FC<FinalsProps> = ({
  finals, credentials, showProject = false,
}) => {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (finals.length === 0) return null;

  const open = async (versionId: string) => {
    setOpeningId(versionId);
    setError('');
    try {
      const url = await fetchSupplierDesignSpecFinalUrl(versionId, credentials);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setError(e?.message || 'Could not open that design spec.');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div>
      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border-b border-rose-100 text-rose-800 text-sm px-4 py-2">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {finals.map(f => {
          const issued = f.finalVersionId != null;
          return (
            <div
              key={f.specId}
              className={`p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${issued ? 'bg-emerald-50/30' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {issued
                    ? <CheckCircle size={15} className="text-emerald-600 shrink-0" />
                    : <Clock size={15} className="text-gray-400 shrink-0" />}
                  <span className={`font-semibold break-words ${issued ? 'text-emerald-900' : 'text-gray-600'}`}>
                    {f.specCode}
                    {issued && f.version != null ? ` · v${f.version} FINAL` : ''}
                  </span>
                </div>
                <p className="text-sm text-muted mt-1 break-words">
                  {f.specTitle}
                  {showProject && <span className="text-gray-400"> · {f.projectName}</span>}
                </p>
                <p className="text-xs text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {issued ? (
                    <>
                      <span>Issued {shortDate(f.issuedAt)}</span>
                      {f.pageCount != null && <span>{f.pageCount} pages</span>}
                      {f.byteSize != null && <span>{formatBytes(f.byteSize)}</span>}
                    </>
                  ) : (
                    <span>
                      Not issued yet. The approved specification will appear here — build only
                      to a version marked FINAL.
                    </span>
                  )}
                </p>
              </div>

              <div className="sm:w-44 shrink-0">
                {issued ? (
                  <button
                    type="button"
                    onClick={() => void open(f.finalVersionId as string)}
                    disabled={openingId === f.finalVersionId}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition"
                  >
                    {openingId === f.finalVersionId
                      ? <><Loader2 size={14} className="animate-spin" /> Opening…</>
                      : <><Download size={14} /> Open final spec</>}
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <Clock size={13} /> Awaiting sign-off
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
