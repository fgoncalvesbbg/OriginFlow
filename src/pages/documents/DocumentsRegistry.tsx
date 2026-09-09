/**
 * SOP & Documents — the internal registry screen.
 *
 * A registry and a distributor, not an authoring tool: nothing here edits a document. The
 * editable original stays in SharePoint (that is what the link on each version is), and
 * OriginFlow records the versions and stores the released PDF.
 *
 * The one privileged action on this screen is the FINAL tick, and it is admin-only in
 * three places that must agree: the checkbox is disabled here, the route is gated in
 * doc-registry.ts, and the state change is one transaction in the database
 * (doc_finalize_version). The UI gate is the courtesy; the route is the control.
 *
 * Everything on this page goes through /api/doc/* — see services/documents for why there
 * is no Supabase query in sight.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../hooks/useToast';
import {
  getDocuments,
  createDocument,
  updateDocument,
  getVersions,
  createVersion,
  finalizeVersion,
  unfinalizeVersion,
  getProjectBindings,
  bindDocumentToProject,
  unbindDocumentFromProject,
  latestVersionUrl,
  downloadDocument,
  getProjects,
} from '../../services';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  UserRole,
  type DocumentAudience,
  type DocumentType,
  type DocumentVersion,
  type DocumentVersionEvent,
  type Project,
  type RegisteredDocumentRow,
} from '../../types';
import {
  FileText, Filter, Plus, Search, X, Loader2, Link2, Download, Upload,
  ExternalLink, Copy, CheckCircle2, Circle, Trash2, FolderPlus, ShieldAlert,
} from 'lucide-react';

const AUDIENCE_STYLES: Record<DocumentAudience, string> = {
  internal: 'bg-slate-100 text-slate-700 border-slate-200',
  supplier: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '—';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const formatDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const DocumentsRegistry: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const isAdmin = user?.role === UserRole.ADMIN;

  const [documents, setDocuments] = useState<RegisteredDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Filters. `search` is debounced into `q` so typing does not fire a request per keystroke.
  const [typeFilter, setTypeFilter] = useState<DocumentType | ''>('');
  const [audienceFilter, setAudienceFilter] = useState<DocumentAudience | ''>('');
  const [tagFilter, setTagFilter] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  const [selected, setSelected] = useState<RegisteredDocumentRow | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setDocuments(await getDocuments({
        type: typeFilter || undefined,
        audience: audienceFilter || undefined,
        tag: tagFilter || undefined,
        q: q || undefined,
      }));
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load the document registry.');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, audienceFilter, tagFilter, q]);

  useEffect(() => { void load(); }, [load]);

  /** Every tag in view, so the tag filter is a real list rather than a guess. */
  const knownTags = useMemo(
    () => [...new Set(documents.flatMap(d => d.tags))].sort(),
    [documents],
  );

  const clearFilters = () => {
    setTypeFilter('');
    setAudienceFilter('');
    setTagFilter('');
    setSearch('');
  };
  const hasFilters = Boolean(typeFilter || audienceFilter || tagFilter || search);

  return (
    <Layout>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
              <FileText size={24} /> SOP &amp; Documents
            </h1>
            <p className="text-sm text-muted mt-1">
              Internal SOPs and supplier-facing specs. Edit the source in SharePoint; register the
              released PDF here.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90"
          >
            <Plus size={16} /> New document
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 text-muted text-sm">
            <Filter size={16} /> Filter
          </div>

          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as DocumentType | '')}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
            aria-label="Document type"
          >
            <option value="">All types</option>
            {DOCUMENT_TYPES.map(t => (
              <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
            ))}
          </select>

          <select
            value={audienceFilter}
            onChange={e => setAudienceFilter(e.target.value as DocumentAudience | '')}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
            aria-label="Audience"
          >
            <option value="">All audiences</option>
            <option value="internal">Internal only</option>
            <option value="supplier">Supplier-facing</option>
          </select>

          <select
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
            aria-label="Tag"
          >
            <option value="">All tags</option>
            {knownTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search titles…"
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-1.5 text-sm"
            />
          </div>

          {hasFilters && (
            <button type="button" onClick={clearFilters} className="text-sm text-muted hover:text-primary inline-flex items-center gap-1">
              <X size={14} /> Clear
            </button>
          )}
        </div>

        {/* List */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-muted flex items-center justify-center gap-2">
              <Loader2 size={18} className="animate-spin" /> Loading registry…
            </div>
          ) : loadError ? (
            <div className="p-10 text-center text-rose-700 bg-rose-50">{loadError}</div>
          ) : documents.length === 0 ? (
            <div className="p-10 text-center text-muted">
              {hasFilters ? 'No documents match these filters.' : 'No documents registered yet.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-light border-b border-gray-200 text-left">
                <tr className="text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Audience</th>
                  <th className="px-4 py-3 font-semibold">Tags</th>
                  <th className="px-4 py-3 font-semibold">Released</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documents.map(doc => (
                  <tr
                    key={doc.id}
                    onClick={() => setSelected(doc)}
                    className="cursor-pointer hover:bg-light transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-primary">{doc.title}</td>
                    <td className="px-4 py-3 text-muted">{DOCUMENT_TYPE_LABELS[doc.docType]}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded border ${AUDIENCE_STYLES[doc.audience]}`}>
                        {doc.audience === 'supplier' ? 'Supplier-facing' : 'Internal'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {doc.tags.map(t => (
                          <span key={t} className="text-[11px] bg-gray-100 text-muted px-1.5 py-0.5 rounded border">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {doc.finalVersion ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 size={14} /> {doc.finalVersion.label}
                        </span>
                      ) : (
                        <span className="text-muted">Not released</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {creating && (
        <NewDocumentModal
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await load(); success('Document registered.'); }}
          onError={toastError}
        />
      )}

      {selected && (
        <DocumentDrawer
          document={selected}
          isAdmin={isAdmin}
          onClose={() => setSelected(null)}
          onChanged={load}
          onSuccess={success}
          onError={toastError}
        />
      )}
    </Layout>
  );
};

// ===========================================================================
// New document
// ===========================================================================

const NewDocumentModal: React.FC<{
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  onError: (m: string) => void;
}> = ({ onClose, onCreated, onError }) => {
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocumentType>('sop');
  const [audience, setAudience] = useState<DocumentAudience>('internal');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createDocument({
        title: title.trim(),
        docType,
        audience,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      await onCreated();
    } catch (err: any) {
      onError(err?.message || 'Could not register the document.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl w-full max-w-lg shadow-xl">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-primary">New document</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-primary"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Title</span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              autoFocus
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Packaging Guideline"
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Type</span>
              <select
                value={docType}
                onChange={e => setDocType(e.target.value as DocumentType)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-gray-700">Audience</span>
              <select
                value={audience}
                onChange={e => setAudience(e.target.value as DocumentAudience)}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="internal">Internal only</option>
                <option value="supplier">Supplier-facing</option>
              </select>
            </label>
          </div>

          {/* Said plainly, because it is the decision that matters most on this form and it
              is not obvious from the word "audience" alone. */}
          <p className="text-xs text-muted bg-light border border-gray-200 rounded-lg p-3">
            {audience === 'supplier'
              ? 'Suppliers will see the released version of this document in any project it is bound to. They never see draft versions or the SharePoint link.'
              : 'No supplier will ever see this document, in any project, released or not.'}
          </p>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Tags</span>
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="comma separated, e.g. packaging, eu"
            />
          </label>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-light">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />} Register
          </button>
        </div>
      </form>
    </div>
  );
};

// ===========================================================================
// Document drawer — versions, the final tick, bindings
// ===========================================================================

const DocumentDrawer: React.FC<{
  document: RegisteredDocumentRow;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onSuccess: (m: string) => void;
  onError: (m: string) => void;
}> = ({ document: doc, isAdmin, onClose, onChanged, onSuccess, onError }) => {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [events, setEvents] = useState<DocumentVersionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [audience, setAudience] = useState<DocumentAudience>(doc.audience);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getVersions(doc.id);
      setVersions(result.versions);
      setEvents(result.events);
    } catch (e: any) {
      onError(e?.message || 'Could not load the versions.');
    } finally {
      setLoading(false);
    }
  }, [doc.id, onError]);

  useEffect(() => { void load(); }, [load]);

  /**
   * The final tick. Un-ticking removes the version from every supplier's view instantly,
   * so it is confirmed rather than immediate — the button is one click and hard to undo
   * in the sense that matters (a supplier who is mid-download loses the link).
   */
  const toggleFinal = async (version: DocumentVersion) => {
    if (version.isFinal) {
      const ok = window.confirm(
        `Un-finalise "${version.label}"?\n\nSuppliers will immediately stop seeing this document in their projects, and the "latest" link will stop resolving until another version is finalised.`,
      );
      if (!ok) return;
    }

    setBusyVersionId(version.id);
    try {
      if (version.isFinal) {
        await unfinalizeVersion(version.id);
        onSuccess(`"${version.label}" is no longer released.`);
      } else {
        await finalizeVersion(version.id);
        onSuccess(`"${version.label}" is now the released version.`);
      }
      await load();
      await onChanged();
    } catch (e: any) {
      onError(e?.message || 'Could not change the released version.');
    } finally {
      setBusyVersionId(null);
    }
  };

  const changeAudience = async (next: DocumentAudience) => {
    const previous = audience;
    setAudience(next);
    try {
      await updateDocument(doc.id, { audience: next });
      await onChanged();
      onSuccess(next === 'supplier' ? 'Document is now supplier-facing.' : 'Document is now internal only.');
    } catch (e: any) {
      setAudience(previous);
      onError(e?.message || 'Could not change the audience.');
    }
  };

  const copyLatestLink = async () => {
    try {
      await navigator.clipboard.writeText(latestVersionUrl(doc.id));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError('Could not copy the link.');
    }
  };

  const eventsByVersion = useMemo(() => {
    const map = new Map<string, DocumentVersionEvent[]>();
    for (const e of events) {
      map.set(e.versionId, [...(map.get(e.versionId) || []), e]);
    }
    return map;
  }, [events]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <aside className="relative bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl">
        <header className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between gap-4 z-10">
          <div>
            <h2 className="font-bold text-primary text-lg">{doc.title}</h2>
            <p className="text-xs text-muted mt-0.5">
              {DOCUMENT_TYPE_LABELS[doc.docType]}
              {doc.tags.length > 0 && ` · ${doc.tags.join(', ')}`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-primary"><X size={18} /></button>
        </header>

        <div className="p-6 space-y-8">
          {/* Audience + the stable link */}
          <section className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-700">Audience</span>
              <select
                value={audience}
                onChange={e => changeAudience(e.target.value as DocumentAudience)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
              >
                <option value="internal">Internal only</option>
                <option value="supplier">Supplier-facing</option>
              </select>
              {audience === 'internal' && (
                <span className="text-xs text-slate-600 inline-flex items-center gap-1">
                  <ShieldAlert size={13} /> No supplier can see this, bound or not
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyLatestLink}
                className="inline-flex items-center gap-2 text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-light"
              >
                {copied ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy "latest version" link'}
              </button>
              <span className="text-xs text-muted">Always resolves to the current released PDF.</span>
            </div>
          </section>

          {/* Versions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Versions</h3>
              {!isAdmin && <span className="text-xs text-muted">Only an admin can change the released version.</span>}
            </div>

            {loading ? (
              <div className="py-8 text-center text-muted flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            ) : versions.length === 0 ? (
              <p className="text-sm text-muted py-4">No versions registered yet.</p>
            ) : (
              <ul className="space-y-3">
                {versions.map(v => (
                  <li
                    key={v.id}
                    className={`border rounded-xl p-4 ${v.isFinal ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200'}`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        disabled={!isAdmin || busyVersionId === v.id || (!v.isFinal && !v.hasPdf)}
                        onClick={() => toggleFinal(v)}
                        title={
                          !isAdmin ? 'Admins only'
                            : !v.hasPdf && !v.isFinal ? 'Upload the released PDF first'
                            : v.isFinal ? 'Un-finalise this version' : 'Make this the released version'
                        }
                        className="mt-0.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label={v.isFinal ? 'Un-finalise' : 'Finalise'}
                      >
                        {busyVersionId === v.id
                          ? <Loader2 size={20} className="animate-spin text-muted" />
                          : v.isFinal
                            ? <CheckCircle2 size={20} className="text-emerald-600" />
                            : <Circle size={20} className="text-gray-300 hover:text-gray-400" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-primary">{v.label}</span>
                          {v.isFinal && (
                            <span className="text-[11px] bg-emerald-600 text-white px-1.5 py-0.5 rounded">FINAL</span>
                          )}
                          {v.supersededBy && (
                            <span className="text-[11px] bg-gray-100 text-muted px-1.5 py-0.5 rounded border">Superseded</span>
                          )}
                        </div>

                        <p className="text-xs text-muted mt-1">
                          Registered {formatDate(v.createdAt)}
                          {v.hasPdf && ` · ${formatBytes(v.pdfBytes)}`}
                          {v.finalizedAt && ` · released ${formatDate(v.finalizedAt)}`}
                        </p>

                        {v.pdfSha256 && (
                          <p className="text-[11px] text-gray-400 font-mono mt-1 truncate" title={v.pdfSha256}>
                            sha256 {v.pdfSha256.slice(0, 16)}…
                          </p>
                        )}

                        <div className="flex items-center gap-3 mt-3 flex-wrap">
                          {v.hasPdf && (
                            <button
                              type="button"
                              onClick={() => downloadDocument(v.id).catch(e => onError(e?.message || 'Download failed.'))}
                              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                            >
                              <Download size={14} /> Released PDF
                            </button>
                          )}
                          {/* INTERNAL ONLY. This link never reaches a supplier — the
                              supplier DTO has no field for it. */}
                          {v.sharepointLink && (
                            <a
                              href={v.sharepointLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary"
                            >
                              <ExternalLink size={14} /> Edit in SharePoint
                            </a>
                          )}
                        </div>

                        {(eventsByVersion.get(v.id) || []).length > 0 && (
                          <ul className="mt-3 pt-3 border-t border-gray-100 space-y-1">
                            {(eventsByVersion.get(v.id) || []).map(e => (
                              <li key={e.id} className="text-[11px] text-muted">
                                {e.event === 'finalized' ? 'Finalised' : 'Un-finalised'} {formatDate(e.at)}
                                {e.note && ` — ${e.note}`}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <NewVersionForm
            documentId={doc.id}
            onCreated={async () => { await load(); await onChanged(); onSuccess('Version registered.'); }}
            onError={onError}
          />

          <BindingsPanel documentId={doc.id} onError={onError} onSuccess={onSuccess} />
        </div>
      </aside>
    </div>
  );
};

// ===========================================================================
// New version
// ===========================================================================

const NewVersionForm: React.FC<{
  documentId: string;
  onCreated: () => void | Promise<void>;
  onError: (m: string) => void;
}> = ({ documentId, onCreated, onError }) => {
  const [label, setLabel] = useState('');
  const [sharepointLink, setSharepointLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<'idle' | 'preparing' | 'uploading' | 'registering'>('idle');

  const busy = stage !== 'idle';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    try {
      await createVersion({
        documentId,
        label: label.trim(),
        sharepointLink: sharepointLink.trim() || null,
        file,
        onProgress: setStage,
      });
      setLabel('');
      setSharepointLink('');
      setFile(null);
      await onCreated();
    } catch (err: any) {
      onError(err?.message || 'Could not register the version.');
    } finally {
      setStage('idle');
    }
  };

  return (
    <form onSubmit={submit} className="border border-gray-200 rounded-xl p-4 bg-light space-y-3">
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider flex items-center gap-2">
        <Upload size={15} /> Register a version
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-gray-700">Label</span>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            required
            placeholder="v4, 2026-03, Rev C…"
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
            <Link2 size={12} /> SharePoint link <span className="text-muted font-normal">(internal only)</span>
          </span>
          <input
            value={sharepointLink}
            onChange={e => setSharepointLink(e.target.value)}
            type="url"
            placeholder="https://…"
            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-gray-700">Released PDF</span>
        <input
          type="file"
          accept="application/pdf"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          required
          className="mt-1 w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:text-sm"
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Stored immutably. The file is verified to be a real PDF on the server, not by its name.
        </p>
        <button
          type="submit"
          disabled={busy || !file || !label.trim()}
          className="px-4 py-2 text-sm bg-primary text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2 shrink-0"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {stage === 'preparing' ? 'Preparing…'
            : stage === 'uploading' ? 'Uploading…'
            : stage === 'registering' ? 'Verifying…'
            : 'Add version'}
        </button>
      </div>
    </form>
  );
};

// ===========================================================================
// Bindings — which projects this document applies to
// ===========================================================================

const BindingsPanel: React.FC<{
  documentId: string;
  onSuccess: (m: string) => void;
  onError: (m: string) => void;
}> = ({ documentId, onSuccess, onError }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [boundProjectIds, setBoundProjectIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState('');

  /**
   * Bindings are stored per project, and the API reads them per project, so building
   * "which projects is THIS document on" means asking each project. Fine at OriginFlow's
   * scale (tens of live projects) and it keeps the authorization honest: each of those
   * calls is scoped by the caller's own project visibility, so a PM sees this document
   * bound to their projects and not to someone else's.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getProjects();
      setProjects(all);
      const results = await Promise.all(
        all.map(async p => {
          try {
            const bindings = await getProjectBindings(p.id);
            return bindings.some(b => b.document.id === documentId) ? p.id : null;
          } catch {
            return null;
          }
        }),
      );
      setBoundProjectIds(results.filter((id): id is string => Boolean(id)));
    } catch (e: any) {
      onError(e?.message || 'Could not load the project bindings.');
    } finally {
      setLoading(false);
    }
  }, [documentId, onError]);

  useEffect(() => { void load(); }, [load]);

  const bind = async () => {
    if (!picking) return;
    setBusy(true);
    try {
      await bindDocumentToProject(picking, documentId);
      setBoundProjectIds(ids => [...new Set([...ids, picking])]);
      setPicking('');
      onSuccess('Document bound to the project.');
    } catch (e: any) {
      onError(e?.message || 'Could not bind the document.');
    } finally {
      setBusy(false);
    }
  };

  const unbind = async (projectId: string) => {
    setBusy(true);
    try {
      await unbindDocumentFromProject(projectId, documentId);
      setBoundProjectIds(ids => ids.filter(id => id !== projectId));
      onSuccess('Document unbound from the project.');
    } catch (e: any) {
      onError(e?.message || 'Could not unbind the document.');
    } finally {
      setBusy(false);
    }
  };

  const bound = projects.filter(p => boundProjectIds.includes(p.id));
  const available = projects.filter(p => !boundProjectIds.includes(p.id));

  return (
    <section>
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-1 flex items-center gap-2">
        <FolderPlus size={15} /> Projects
      </h3>
      <p className="text-xs text-muted mb-3">
        A supplier-facing document appears in the Documents tab of every project it is bound to.
      </p>

      {loading ? (
        <div className="py-4 text-muted text-sm flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading projects…
        </div>
      ) : (
        <>
          {bound.length === 0 ? (
            <p className="text-sm text-muted mb-3">Not bound to any project yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-gray-200 rounded-xl mb-3">
              {bound.map(p => (
                <li key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-primary truncate">{p.name}</div>
                    <div className="text-xs text-muted">{p.projectId}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => unbind(p.id)}
                    disabled={busy}
                    className="text-muted hover:text-rose-600 disabled:opacity-40 shrink-0"
                    aria-label={`Unbind from ${p.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <select
              value={picking}
              onChange={e => setPicking(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Bind to a project…</option>
              {available.map(p => (
                <option key={p.id} value={p.id}>{p.projectId} — {p.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={bind}
              disabled={!picking || busy}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-light disabled:opacity-50"
            >
              Bind
            </button>
          </div>
        </>
      )}
    </section>
  );
};

export default DocumentsRegistry;
