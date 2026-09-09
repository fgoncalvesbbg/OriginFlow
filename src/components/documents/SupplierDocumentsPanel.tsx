/**
 * The Documents tab on a supplier's project page.
 *
 * Everything shown here has already passed the server-side visibility rule: a released
 * version, of a supplier-facing document, bound to a project this portal credential
 * speaks for. The component does no filtering of its own, and should not start — a
 * client-side filter over a list that already arrived is a filter that cannot fail
 * closed, and it would suggest the list is trustworthy without it.
 *
 * What is deliberately absent from the UI because it is absent from the data: the
 * SharePoint link, any non-final version, and any hint that other versions exist.
 */

import React, { useEffect, useState } from 'react';
import { getSupplierProjectDocuments, downloadDocument, type PortalCredentials } from '../../services/documents';
import { DOCUMENT_TYPE_LABELS, type SupplierProjectDocument } from '../../types';
import { FileText, Download, Loader2, BookOpen } from 'lucide-react';

interface Props {
  credentials: PortalCredentials;
  /** Narrows to one project. Omit on the supplier dashboard to show every project's documents. */
  projectId?: string;
  /**
   * project id -> display name, for the multi-project view. Supplied by the caller because
   * this component must not fetch projects: the whole point is that it reads ONE route
   * whose answer is already scoped to the caller's credential.
   *
   * The same document is often bound to several projects, so it appears once with every
   * project it applies to listed — showing it once per project would read as duplicates.
   */
  projectNames?: Record<string, string>;
}

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const SupplierDocumentsPanel: React.FC<Props> = ({ credentials, projectId, projectNames }) => {
  const [documents, setDocuments] = useState<SupplierProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await getSupplierProjectDocuments(credentials, projectId);
        if (mounted) setDocuments(result);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Could not load your documents.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
    // The credential object is rebuilt on every render by the parent, so depend on its
    // VALUES rather than its identity or this refetches forever.
  }, [credentials.projectToken, credentials.supplierToken, credentials.accessCode, projectId]);

  const download = async (versionId: string) => {
    setDownloadingId(versionId);
    try {
      await downloadDocument(versionId, credentials);
    } catch (e: any) {
      setError(e?.message || 'Could not start the download.');
    } finally {
      setDownloadingId(null);
    }
  };

  // Nothing bound yet is the normal state for a new project, so it reads as information
  // rather than as a problem. It is also what a supplier sees for a project that is not
  // theirs, which is the intended ambiguity.
  if (!loading && !error && documents.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow overflow-hidden">
        <div className="bg-light px-6 py-3 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
            <BookOpen size={15} /> Guidelines &amp; Specifications
          </h2>
        </div>
        <p className="px-6 py-8 text-sm text-muted text-center">
          {projectId
            ? 'No documents have been shared for this project yet.'
            : 'No documents have been shared with you yet.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow overflow-hidden">
      <div className="bg-light px-6 py-3 border-b border-gray-200">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
          <BookOpen size={15} /> Guidelines &amp; Specifications
        </h2>
        <p className="text-xs text-muted mt-0.5">
          The current released version of each document. Always download rather than reusing an
          older copy — these are updated.
        </p>
      </div>

      {error && <div className="px-6 py-3 bg-rose-50 text-rose-800 text-sm border-b border-rose-100">{error}</div>}

      {loading ? (
        <div className="px-6 py-8 text-center text-muted flex items-center justify-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading documents…
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {documents.map(entry => (
            <li key={entry.document.id} className="px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <FileText size={18} className="text-muted shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h3 className="font-semibold text-primary">{entry.document.title}</h3>
                  <p className="text-xs text-muted mt-0.5">
                    {DOCUMENT_TYPE_LABELS[entry.document.docType] ?? entry.document.docType}
                    {entry.finalVersion && ` · Version ${entry.finalVersion.label}`}
                    {entry.finalVersion?.pdfBytes ? ` · ${formatBytes(entry.finalVersion.pdfBytes)}` : ''}
                  </p>
                  {/* Only in the multi-project view: inside one project it would state
                      the obvious on every row. */}
                  {!projectId && projectNames && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {entry.projectIds
                        .map(id => projectNames[id])
                        .filter(Boolean)
                        .map(name => (
                          <span key={name} className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded">
                            {name}
                          </span>
                        ))}
                    </div>
                  )}

                  {entry.document.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {entry.document.tags.map(t => (
                        <span key={t} className="text-[10px] bg-gray-100 text-muted px-1.5 py-0.5 rounded border">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {entry.finalVersion && (
                <button
                  type="button"
                  onClick={() => download(entry.finalVersion!.id)}
                  disabled={downloadingId === entry.finalVersion.id}
                  className="inline-flex items-center gap-2 border border-gray-300 rounded-lg px-4 py-2 text-sm hover:bg-light disabled:opacity-50 shrink-0"
                >
                  {downloadingId === entry.finalVersion.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Download size={14} />}
                  Download PDF
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SupplierDocumentsPanel;
