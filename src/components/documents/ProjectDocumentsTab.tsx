/**
 * The Documents tab inside a project (internal view).
 *
 * Answers the question a PM actually has, which the registry screen cannot: "which
 * documents apply to THIS project, and which of them can my supplier see?" Binding used to
 * be reachable only from the document's own drawer in /documents — a per-project decision
 * made from a per-document screen — so this is where it belongs.
 *
 * THE VISIBILITY COLUMN IS THE POINT
 * -----------------------------------
 * A bound document is not necessarily a document the supplier sees. All three of these
 * must hold, and each fails independently:
 *   - the document is supplier-facing (audience),
 *   - it has a finalised version,
 *   - it is bound to this project.
 * Binding satisfies only the third. A PM who binds an internal SOP, or binds a document
 * whose version nobody has finalised yet, gets no warning from the act of binding — so
 * every row says plainly whether the supplier can see it, rather than leaving the PM to
 * infer it from an audience badge.
 *
 * The same server route backs the supplier's own list (doc-portal.ts), so what this tab
 * calls "visible" is computed from the same rows the supplier's request reads.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getInternalProjectDocuments,
  getDocuments,
  bindDocumentToProject,
  unbindDocumentFromProject,
  bindTemplateDocumentsToProject,
  downloadDocument,
} from '../../services/documents';
import {
  DOCUMENT_TYPE_LABELS,
  type InternalProjectDocument,
  type RegisteredDocumentRow,
} from '../../types';
import {
  FileText, Download, Loader2, Trash2, Plus, Eye, EyeOff,
  ExternalLink, AlertTriangle, BookOpen, Wand2,
} from 'lucide-react';

interface Props {
  projectId: string;
  /** Toast hooks from the host page, so this component owns no notification policy. */
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

/**
 * Exactly the rule the server applies, restated for display. Kept as a named function so
 * it reads as one decision rather than as an inline condition that could drift a clause.
 */
const supplierCanSee = (entry: InternalProjectDocument): boolean =>
  entry.document.audience === 'supplier' && entry.finalVersion !== null;

const ProjectDocumentsTab: React.FC<Props> = ({ projectId, onSuccess, onError }) => {
  const [entries, setEntries] = useState<InternalProjectDocument[]>([]);
  const [registry, setRegistry] = useState<RegisteredDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [picking, setPicking] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  /** The registry list can fail on its own without the bound list failing. Tracked
   *  separately so the picker says why it is empty instead of claiming everything is
   *  already bound — which is what an unexplained empty list looks like. */
  const [registryError, setRegistryError] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      // The registry list is fetched alongside so the "bind" picker is populated without a
      // second round trip when the PM opens the tab intending to add something.
      const [bound, all] = await Promise.all([
        getInternalProjectDocuments(projectId),
        getDocuments().then(
          list => { setRegistryError(false); return list; },
          () => { setRegistryError(true); return [] as RegisteredDocumentRow[]; },
        ),
      ]);
      setEntries(bound);
      setRegistry(all);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load the documents for this project.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const boundIds = useMemo(() => new Set(entries.map(e => e.document.id)), [entries]);
  const available = useMemo(
    () => registry.filter(d => !boundIds.has(d.id)),
    [registry, boundIds],
  );

  const visibleCount = entries.filter(supplierCanSee).length;

  const bind = async () => {
    if (!picking) return;
    setBusyId(picking);
    try {
      await bindDocumentToProject(projectId, picking);
      setPicking('');
      await load();
      onSuccess('Document added to this project.');
    } catch (e: any) {
      onError(e?.message || 'Could not add the document.');
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Catch this project up with the default template's standard documents.
   *
   * Every project created from now on gets these at creation time (see createProject), so
   * this is for the ones that predate the template's links, or that predate the template
   * gaining a new one. Idempotent server-side, so it adds what is missing and leaves the
   * rest — including anything bound here by hand — alone.
   */
  const applyTemplate = async () => {
    setApplyingTemplate(true);
    try {
      const count = await bindTemplateDocumentsToProject(projectId);
      if (count === 0) {
        onError('The default project template has no standard documents linked yet. An admin sets those under Admin panel → Project Templates.');
        return;
      }
      await load();
      onSuccess(`Standard documents applied (${count} from the default template).`);
    } catch (e: any) {
      onError(e?.message || 'Could not apply the standard documents.');
    } finally {
      setApplyingTemplate(false);
    }
  };

  const unbind = async (documentId: string, title: string) => {
    if (!window.confirm(`Remove "${title}" from this project?\n\nThe document stays in the registry; it just stops applying here, and the supplier stops seeing it.`)) {
      return;
    }
    setBusyId(documentId);
    try {
      await unbindDocumentFromProject(projectId, documentId);
      setEntries(list => list.filter(e => e.document.id !== documentId));
      onSuccess('Document removed from this project.');
    } catch (e: any) {
      onError(e?.message || 'Could not remove the document.');
    } finally {
      setBusyId(null);
    }
  };

  const download = async (versionId: string) => {
    setDownloadingId(versionId);
    try {
      await downloadDocument(versionId);
    } catch (e: any) {
      onError(e?.message || 'Could not start the download.');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <BookOpen size={18} /> Applicable documents
            </h3>
            <p className="text-xs text-muted mt-0.5">
              SOPs, guidelines and specs bound to this project.
              {entries.length > 0 && (
                <> {visibleCount} of {entries.length} {visibleCount === 1 ? 'is' : 'are'} visible to the supplier.</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={applyTemplate}
              disabled={applyingTemplate}
              title="Add the standard documents the default project template hands down"
              className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {applyingTemplate
                ? <Loader2 size={14} className="animate-spin" />
                : <Wand2 size={14} />}
              Apply standard documents
            </button>
            <Link
              to="/documents"
              className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1.5"
            >
              <ExternalLink size={14} /> Manage registry
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-center text-muted flex items-center justify-center gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading documents…
          </div>
        ) : loadError ? (
          <div className="px-6 py-8 text-center text-rose-700 bg-rose-50 text-sm">{loadError}</div>
        ) : entries.length === 0 ? (
          <p className="px-6 py-10 text-sm text-muted text-center">
            No documents apply to this project yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map(entry => {
              const visible = supplierCanSee(entry);
              const isInternalDoc = entry.document.audience === 'internal';

              return (
                <li key={entry.document.id} className="px-6 py-4 flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <FileText size={18} className="text-muted shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <h4 className="font-semibold text-primary">{entry.document.title}</h4>
                      <p className="text-xs text-muted mt-0.5">
                        {DOCUMENT_TYPE_LABELS[entry.document.docType] ?? entry.document.docType}
                        {entry.finalVersion
                          ? ` · Version ${entry.finalVersion.label}`
                          : ' · No released version'}
                        {entry.finalVersion?.pdfBytes ? ` · ${formatBytes(entry.finalVersion.pdfBytes)}` : ''}
                      </p>

                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {visible ? (
                          <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded">
                            <Eye size={11} /> Supplier sees this
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded">
                            <EyeOff size={11} /> Not visible to supplier
                          </span>
                        )}

                        {/* The reason, not just the fact — the two causes need different
                            fixes and only one of them is this PM's to make. */}
                        {!visible && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle size={11} />
                            {isInternalDoc
                              ? 'Internal-only document'
                              : 'Waiting for an admin to finalise a version'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {entry.finalVersion?.hasPdf && (
                      <button
                        type="button"
                        onClick={() => download(entry.finalVersion!.id)}
                        disabled={downloadingId === entry.finalVersion.id}
                        className="inline-flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-1.5 text-sm hover:bg-light disabled:opacity-50"
                      >
                        {downloadingId === entry.finalVersion.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Download size={14} />}
                        PDF
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => unbind(entry.document.id, entry.document.title)}
                      disabled={busyId === entry.document.id}
                      className="text-muted hover:text-rose-600 disabled:opacity-40"
                      aria-label={`Remove ${entry.document.title} from this project`}
                      title="Remove from this project"
                    >
                      {busyId === entry.document.id
                        ? <Loader2 size={15} className="animate-spin" />
                        : <Trash2 size={15} />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && !loadError && (
          <div className="px-6 py-4 border-t border-gray-200 bg-light flex gap-2 flex-wrap">
            <select
              value={picking}
              onChange={e => setPicking(e.target.value)}
              className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              aria-label="Add a document to this project"
            >
              <option value="">
                {registryError ? 'Could not load the registry — reload to try again'
                  : registry.length === 0 ? 'No documents in the registry yet'
                  : available.length === 0 ? 'Every registered document is already here'
                  : 'Add a document…'}
              </option>
              {available.map(d => (
                <option key={d.id} value={d.id}>
                  {d.title} ({DOCUMENT_TYPE_LABELS[d.docType] ?? d.docType}
                  {d.audience === 'internal' ? ', internal' : ''})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={bind}
              disabled={!picking || busyId !== null}
              className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {busyId === picking && picking
                ? <Loader2 size={14} className="animate-spin" />
                : <Plus size={14} />}
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectDocumentsTab;
