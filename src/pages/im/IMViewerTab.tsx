/**
 * IM dashboard "Viewer" tab — thin app-side glue around the detached `im-viewer` module.
 *
 * Lets an admin preview any generated manual in the customer-facing viewer, or paste an arbitrary
 * manifest/manual URL (which demonstrates that the viewer is fully decoupled — it renders whatever
 * link it is handed). The only coupling to the app is resolving a project's manifest URL; the
 * <IMViewer> component itself never touches app services.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Link2, Share2, Copy, Check, X, Ban, Loader2, User as UserIcon, Clock } from 'lucide-react';
import { getPublishedManifestUrl, createIMShare, getIMShareUrl, getIMShares, revokeIMShare } from '../../services';
import { isShareExpired, type IMShare } from '../../services/im/im-share.service';
import type { ProjectIMSummary } from '../../services/im/project-im.service';
import { IMViewer, type ViewerSource } from '../../modules/im-viewer';

const keyOf = (im: ProjectIMSummary) => `${im.projectId}::${im.templateType}`;

export const IMViewerTab: React.FC<{ ims: ProjectIMSummary[] }> = ({ ims }) => {
  const generated = useMemo(() => ims.filter((im) => im.status === 'generated'), [ims]);
  const [selectedKey, setSelectedKey] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [source, setSource] = useState<ViewerSource | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');
  const [copied, setCopied] = useState(false);
  // Every active (non-revoked) share link for the selected manual — public links are
  // only manageable if they can be seen; this list is where they get revoked.
  const [shares, setShares] = useState<IMShare[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // Two-step revoke: first click arms, second click confirms (cleared on selection change).
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);
  // New-link options: purpose/recipient label + optional TTL (days; '' = never expires).
  const [shareLabel, setShareLabel] = useState('');
  const [shareExpiryDays, setShareExpiryDays] = useState<'' | '7' | '30' | '90'>('');

  const selectedManual = generated.find((g) => keyOf(g) === selectedKey) ?? null;

  const loadShares = async (im: ProjectIMSummary) => {
    setShares(null);
    try {
      setShares(await getIMShares(im.projectId, im.templateType));
    } catch (e) {
      console.error('[IMViewerTab] loading share links failed:', e);
      setShares([]);
    }
  };

  useEffect(() => {
    setConfirmRevokeId(null);
    if (selectedManual) void loadShares(selectedManual);
    else setShares(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const selectManual = (key: string) => {
    setSelectedKey(key);
    setShareUrl('');
    setShareError('');
    const im = generated.find((g) => keyOf(g) === key);
    if (!im) {
      setSource(null);
      return;
    }
    const manifestUrl = getPublishedManifestUrl(im.projectId, im.templateType);
    setSource(manifestUrl ? { manifestUrl } : null);
  };

  const createShareLink = async () => {
    if (!selectedManual) return;
    setSharing(true);
    setShareError('');
    setCopied(false);
    try {
      const expiresAt = shareExpiryDays
        ? new Date(Date.now() + Number(shareExpiryDays) * 24 * 60 * 60 * 1000).toISOString()
        : null;
      const share = await createIMShare(selectedManual.projectId, selectedManual.templateType, {
        label: shareLabel,
        expiresAt,
      });
      setShareUrl(getIMShareUrl(share.token));
      setShareLabel('');
      // The new link shows up in the managed list immediately.
      setShares((prev) => (prev ? [share, ...prev] : [share]));
    } catch (e: any) {
      setShareError(e?.message ?? 'Failed to create share link.');
    } finally {
      setSharing(false);
    }
  };

  const handleRevoke = async (share: IMShare) => {
    if (confirmRevokeId !== share.id) {
      setConfirmRevokeId(share.id);
      return;
    }
    setRevokingId(share.id);
    setConfirmRevokeId(null);
    try {
      await revokeIMShare(share.id);
      setShares((prev) => (prev ? prev.filter((s) => s.id !== share.id) : prev));
      // If the revoked link is the one just minted above, stop showing it as shareable.
      if (shareUrl && shareUrl === getIMShareUrl(share.token)) setShareUrl('');
    } catch (e: any) {
      setShareError(e?.message ?? 'Failed to revoke the link.');
    } finally {
      setRevokingId(null);
    }
  };

  const copyLink = async (share: IMShare) => {
    try {
      await navigator.clipboard.writeText(getIMShareUrl(share.token));
      setCopiedShareId(share.id);
      setTimeout(() => setCopiedShareId(null), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — user can still select the text field manually */ }
  };

  const loadUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    setSelectedKey('');
    // Heuristic: a manifest path lists languages; anything else is treated as a single manual.
    setSource(url.endsWith('manifest.json') ? { manifestUrl: url } : { manualUrl: url });
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 mb-5">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Generated manual</label>
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[280px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={selectedKey}
            onChange={(e) => selectManual(e.target.value)}
          >
            <option value="">Select a manual…</option>
            {generated.map((im) => (
              <option key={keyOf(im)} value={keyOf(im)}>
                {im.projectName} — {im.templateName ?? im.templateType}
              </option>
            ))}
          </select>
        </div>

        {selectedManual && (
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Link label (who it's for)</label>
              <input
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="e.g. DE distributor"
                value={shareLabel}
                onChange={(e) => setShareLabel(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Expires</label>
              <select
                className="border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={shareExpiryDays}
                onChange={(e) => setShareExpiryDays(e.target.value as '' | '7' | '30' | '90')}
              >
                <option value="">Never</option>
                <option value="7">In 7 days</option>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
              </select>
            </div>
            <button
              onClick={createShareLink}
              disabled={sharing}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Share2 size={14} /> {sharing ? 'Creating link…' : 'Create shareable link'}
            </button>
          </div>
        )}

        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs font-semibold text-gray-500 mb-1">…or paste a manifest / manual URL</label>
          <div className="flex gap-2">
            <input
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="https://…/manifest.json"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadUrl(); }}
            />
            <button
              onClick={loadUrl}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
            >
              <Link2 size={14} /> Load
            </button>
          </div>
        </div>
      </div>

      {(shareUrl || shareError) && (
        <div className="flex items-center gap-2 mb-5 -mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-sm">
          {shareError ? (
            <span className="text-red-600">{shareError}</span>
          ) : (
            <>
              <Share2 size={14} className="text-indigo-500 shrink-0" />
              <input
                readOnly
                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1 text-xs text-gray-700"
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={copyShareUrl}
                className="flex items-center gap-1 px-2 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </>
          )}
          <button
            onClick={() => { setShareUrl(''); setShareError(''); }}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Active share links for the selected manual — visible so they can be revoked.
          Note: a link always serves the CURRENT published content (it resolves the live
          manifest), so a re-publish silently changes what recipients see. */}
      {selectedManual && (
        <div className="mb-5 bg-white border border-gray-200 rounded-xl p-4">
          <h4 className="text-xs font-bold text-gray-500 uppercase mb-1 flex items-center gap-1.5">
            <Share2 size={13} /> Active share links{shares ? ` (${shares.length})` : ''}
          </h4>
          <p className="text-[11px] text-gray-400 mb-3">
            Public, no-login links. Revoking stops the link resolving immediately. Links always
            show the latest published version.
          </p>
          {shares === null ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><Loader2 size={14} className="animate-spin" /> Loading links…</div>
          ) : shares.length === 0 ? (
            <div className="text-sm text-gray-400 py-1">No active share links for this manual.</div>
          ) : (
            <div className="border rounded-lg divide-y">
              {shares.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      {s.label && <span className="shrink-0 text-xs font-semibold text-gray-700">{s.label}</span>}
                      {isShareExpired(s) && (
                        <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">Expired</span>
                      )}
                      <span className="text-xs font-mono text-gray-500 truncate" title={getIMShareUrl(s.token)}>
                        {getIMShareUrl(s.token)}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1"><Clock size={10} /> {new Date(s.createdAt).toLocaleString()}</span>
                      {s.createdBy && <span className="flex items-center gap-1"><UserIcon size={10} /> {s.createdBy}</span>}
                      {s.expiresAt && !isShareExpired(s) && <span>expires {new Date(s.expiresAt).toLocaleDateString()}</span>}
                      {/* Access log (migration 109): every successful public resolution bumps these. */}
                      {s.useCount > 0 && s.lastUsedAt ? (
                        <span className="text-gray-500">
                          opened {s.useCount}× · last {new Date(s.lastUsedAt).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="italic">never opened</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => copyLink(s)}
                    className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 border rounded hover:bg-gray-50 text-gray-600"
                  >
                    {copiedShareId === s.id ? <Check size={12} /> : <Copy size={12} />} {copiedShareId === s.id ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={() => handleRevoke(s)}
                    disabled={revokingId === s.id}
                    className={`shrink-0 flex items-center gap-1 text-xs px-2 py-1 border rounded disabled:opacity-50 ${
                      confirmRevokeId === s.id
                        ? 'border-rose-400 bg-rose-600 text-white hover:bg-rose-700'
                        : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                    }`}
                  >
                    {revokingId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                    {confirmRevokeId === s.id ? 'Click to confirm' : 'Revoke'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Viewer */}
      {source ? (
        <div className="border border-gray-200 rounded-xl overflow-hidden h-[calc(100vh-300px)] min-h-[480px] bg-white shadow-sm">
          <IMViewer source={source} />
        </div>
      ) : (
        <div className="border border-dashed border-gray-300 rounded-xl h-[360px] flex flex-col items-center justify-center text-gray-400 gap-2">
          <Eye size={28} className="opacity-40" />
          <p className="text-sm">Select a generated manual or paste a published URL to preview it.</p>
          {generated.length === 0 && (
            <p className="text-xs">No generated manuals yet — generate one from a project first.</p>
          )}
        </div>
      )}
    </div>
  );
};
