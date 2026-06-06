/**
 * IM dashboard "Viewer" tab — thin app-side glue around the detached `im-viewer` module.
 *
 * Lets an admin preview any generated manual in the customer-facing viewer, or paste an arbitrary
 * manifest/manual URL (which demonstrates that the viewer is fully decoupled — it renders whatever
 * link it is handed). The only coupling to the app is resolving a project's manifest URL; the
 * <IMViewer> component itself never touches app services.
 */

import React, { useMemo, useState } from 'react';
import { Eye, Link2 } from 'lucide-react';
import { getPublishedManifestUrl } from '../../services';
import type { ProjectIMSummary } from '../../services/im/project-im.service';
import { IMViewer, type ViewerSource } from '../../modules/im-viewer';

const keyOf = (im: ProjectIMSummary) => `${im.projectId}::${im.templateType}`;

export const IMViewerTab: React.FC<{ ims: ProjectIMSummary[] }> = ({ ims }) => {
  const generated = useMemo(() => ims.filter((im) => im.status === 'generated'), [ims]);
  const [selectedKey, setSelectedKey] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [source, setSource] = useState<ViewerSource | null>(null);

  const selectManual = (key: string) => {
    setSelectedKey(key);
    const im = generated.find((g) => keyOf(g) === key);
    if (!im) {
      setSource(null);
      return;
    }
    const manifestUrl = getPublishedManifestUrl(im.projectId, im.templateType);
    setSource(manifestUrl ? { manifestUrl } : null);
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
