/**
 * PublishDiffModal — the "What changed?" drill-down behind a stale badge.
 *
 * Shows which sections a re-publish would change ("Changed since v4: Safety
 * Instructions (DE, FR), Cleaning (all languages)"), computed on open by
 * im-publish-diff.service from the stored publish snapshots vs a fresh
 * re-resolve. Read-only: the actual re-publish stays where it was (dashboard
 * bulk action / generator publish).
 */

import React, { useEffect, useState } from 'react';
import { X, Loader2, GitCompareArrows } from 'lucide-react';
import type { IMTemplateType } from '../../types';
import { getPublishDiff, type PublishDiff, type PublishDiffEntry } from '../../services';

interface PublishDiffModalProps {
  projectId: string;
  templateType: IMTemplateType;
  /** Heading context, e.g. the project name. */
  title?: string;
  onClose: () => void;
}

const KIND_STYLE: Record<PublishDiffEntry['kind'], { label: string; cls: string }> = {
  changed: { label: 'Changed', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  added: { label: 'Added', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  removed: { label: 'Removed', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  moved: { label: 'Moved', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const PublishDiffModal: React.FC<PublishDiffModalProps> = ({ projectId, templateType, title, onClose }) => {
  const [diff, setDiff] = useState<PublishDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getPublishDiff(projectId, templateType)
      .then((d) => { if (alive) setDiff(d); })
      .catch((e) => { console.error('[PublishDiffModal] diff failed:', e); if (alive) setError(e instanceof Error ? e.message : 'Comparing failed.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, templateType]);

  const langsLabel = (entry: PublishDiffEntry): string =>
    diff && diff.checkedLanguages.length > 1 && entry.languages.length === diff.checkedLanguages.length
      ? 'all languages'
      : entry.languages.join(', ');

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <GitCompareArrows size={17} /> What changed since the last publish?
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 overflow-auto text-sm">
          {title && <div className="text-xs text-gray-500 mb-2">{title}</div>}

          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 py-6 justify-center">
              <Loader2 size={16} className="animate-spin" /> Comparing the published files with the current content…
            </div>
          ) : error ? (
            <div className="text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
          ) : !diff ? (
            <div className="text-gray-500 py-4">
              Nothing has been published for this manual yet — there is no previous version to compare against.
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-3">
                Compared against {diff.version != null ? <>the published <strong>v{diff.version}</strong></> : 'the last publish'}
                {diff.publishedAt && <> ({new Date(diff.publishedAt).toLocaleDateString()})</>}
                {' '}in {diff.checkedLanguages.join(', ') || '—'}. Re-publishing applies everything listed below.
              </p>

              {diff.unpublishedLanguages.length > 0 && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
                  Never published yet (everything in {diff.unpublishedLanguages.length === 1 ? 'it' : 'them'} is new):{' '}
                  <strong>{diff.unpublishedLanguages.join(', ')}</strong>
                </div>
              )}

              {diff.entries.length === 0 ? (
                <div className="text-gray-500 py-2">
                  No section-level differences found — the published output already matches the current content
                  {diff.unpublishedLanguages.length > 0 ? ' in the compared languages.' : '.'}
                </div>
              ) : (
                <div className="border rounded-lg divide-y">
                  {diff.entries.map((e) => (
                    <div key={`${e.sectionId}|${e.kind}`} className="flex items-center gap-2.5 px-3 py-2">
                      <span className={`shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${KIND_STYLE[e.kind].cls}`}>
                        {KIND_STYLE[e.kind].label}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-gray-800" title={e.title}>{e.title}</span>
                      <span className="shrink-0 text-[11px] text-gray-500 uppercase">{langsLabel(e)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end px-5 py-3 border-t">
          <button onClick={onClose} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
};

export default PublishDiffModal;
