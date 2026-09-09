/**
 * Admin console → Project Templates → Standard documents.
 *
 * The documents a template HANDS DOWN, as opposed to the ones it ASKS FOR.
 *
 * The phase editor next to this one defines `template_documents`: slots that createProject()
 * stamps into `project_documents` as "not_started" and the project then chases until
 * somebody uploads a file. That is the right shape for an RFQ specification or a supplier
 * quote — one per project, produced by that project.
 *
 * A packaging guideline is not that. It already exists, it is owned centrally, and every
 * project must see the CURRENT release of it. So linking one here writes a
 * `template_doc_bindings` row, and createProject() turns that into a `doc_bindings` row on
 * the new project — a binding that names the document and never a version, so publishing a
 * new release in /documents updates every project at once with nothing to re-point.
 *
 * WHY THIS COMPONENT FETCHES RATHER THAN USING `db`
 * -------------------------------------------------
 * Its two tables are server-only (migration 159): RLS default-deny with the PostgREST
 * grants revoked, because doc_versions mixes an internal-only sharepoint_link into rows a
 * supplier may otherwise read. So it goes through /api/doc like the rest of the registry —
 * see the header of services/documents/document.service.ts. That is also why it is its own
 * component instead of more state in ProjectTemplateAdminSection, which is a `db` consumer
 * throughout.
 *
 * Reads need an internal user; both writes are admin-only server-side.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getTemplateDocumentLinks,
  linkDocumentToTemplate,
  unlinkDocumentFromTemplate,
  getDocuments,
} from '../../services/documents';
import {
  DOCUMENT_TYPE_LABELS,
  type RegisteredDocumentRow,
  type TemplateDocumentLink,
} from '../../types';
import { AlertTriangle, BookOpen, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react';
import { ConfirmationModal } from '../common/ConfirmationModal';

interface Props {
  templateId: string;
  /** Shown on the card so the admin knows whether this affects the next project created. */
  isDefault: boolean;
}

const TemplateStandardDocuments: React.FC<Props> = ({ templateId, isDefault }) => {
  const [links, setLinks] = useState<TemplateDocumentLink[]>([]);
  const [registry, setRegistry] = useState<RegisteredDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  /** The registry list can fail while the link list succeeds. Tracked apart so the picker
   *  says why it is empty rather than implying everything is already linked. */
  const [registryError, setRegistryError] = useState(false);
  const [picking, setPicking] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<TemplateDocumentLink | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [linked, all] = await Promise.all([
        getTemplateDocumentLinks(templateId),
        getDocuments().then(
          list => { setRegistryError(false); return list; },
          () => { setRegistryError(true); return [] as RegisteredDocumentRow[]; },
        ),
      ]);
      setLinks(linked);
      setRegistry(all);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load the standard documents for this template.');
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => { void load(); }, [load]);

  const linkedIds = useMemo(() => new Set(links.map(l => l.id)), [links]);
  const available = useMemo(() => registry.filter(d => !linkedIds.has(d.id)), [registry, linkedIds]);

  const add = async () => {
    if (!picking) return;
    setBusyId(picking);
    try {
      await linkDocumentToTemplate(templateId, picking);
      setPicking('');
      await load();
    } catch (e: any) {
      alert(`Failed to add the document: ${e?.message ?? e}`);
    } finally {
      setBusyId(null);
    }
  };

  const confirmUnlink = async () => {
    if (!unlinkTarget) return;
    const documentId = unlinkTarget.id;
    setBusyId(documentId);
    try {
      await unlinkDocumentFromTemplate(templateId, documentId);
      setUnlinkTarget(null);
      setLinks(list => list.filter(l => l.id !== documentId));
    } catch (e: any) {
      alert(`Failed to remove the document: ${e?.message ?? e}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
      <div className="px-4 py-2.5 bg-light border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h5 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
            <BookOpen size={15} /> Standard documents
          </h5>
          <p className="text-[11px] text-muted mt-0.5 max-w-2xl">
            Registry documents attached to every {isDefault ? 'new project' : 'project created from this template'}.
            Each project always shows the <strong>current released version</strong> — publish a new
            version in the registry and every project follows automatically. Unlike the phase
            documents below, these are not upload slots: nobody has to fill them in.
          </p>
        </div>
        <Link to="/documents" className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1.5 shrink-0">
          <ExternalLink size={13} /> Manage registry
        </Link>
      </div>

      {loading ? (
        <div className="px-4 py-6 text-center text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading standard documents…
        </div>
      ) : loadError ? (
        <div className="px-4 py-5 text-center text-rose-700 bg-rose-50 text-sm">{loadError}</div>
      ) : (
        <>
          {links.length === 0 ? (
            <p className="px-4 py-5 text-xs text-muted text-center">
              No standard documents linked yet. Add one below — for example the packaging guidelines.
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {links.map(doc => (
                <div key={doc.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <BookOpen size={14} className="text-gray-300 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-gray-800 truncate">{doc.title}</div>
                      <div className="text-[11px] text-muted truncate">
                        {DOCUMENT_TYPE_LABELS[doc.docType] ?? doc.docType}
                        {doc.finalVersion
                          ? ` · Version ${doc.finalVersion.label}`
                          : ' · No released version'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Both of these are reasons a linked document will not reach the
                        supplier, and each needs a different fix — one is an audience
                        setting, the other is an unfinalised version. Neither stops the
                        link from working for internal users, so they are warnings. */}
                    {doc.audience === 'internal' && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                        Internal
                      </span>
                    )}
                    {!doc.finalVersion && (
                      <span
                        className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1"
                        title="Nobody has finalised a version, so projects will show it with nothing to download and no supplier will see it."
                      >
                        <AlertTriangle size={10} /> Not released
                      </span>
                    )}
                    <button
                      onClick={() => setUnlinkTarget(doc)}
                      disabled={busyId === doc.id}
                      title="Remove from this template"
                      className="p-1 text-gray-400 hover:text-rose-600 disabled:opacity-40"
                    >
                      {busyId === doc.id
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Trash2 size={13} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-4 py-3 border-t border-gray-100 bg-light flex gap-2 flex-wrap">
            <select
              value={picking}
              onChange={e => setPicking(e.target.value)}
              className="flex-1 min-w-[220px] border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white"
              aria-label="Add a registry document to this template"
            >
              <option value="">
                {registryError ? 'Could not load the registry — reload to try again'
                  : registry.length === 0 ? 'No documents in the registry yet'
                  : available.length === 0 ? 'Every registered document is already linked'
                  : 'Add a registry document…'}
              </option>
              {available.map(d => (
                <option key={d.id} value={d.id}>
                  {d.title} ({DOCUMENT_TYPE_LABELS[d.docType] ?? d.docType}
                  {d.audience === 'internal' ? ', internal' : ''}
                  {d.finalVersion ? '' : ', not released'})
                </option>
              ))}
            </select>
            <button
              onClick={add}
              disabled={!picking || busyId !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {busyId === picking && picking
                ? <Loader2 size={13} className="animate-spin" />
                : <Plus size={14} />}
              Add
            </button>
          </div>
        </>
      )}

      <ConfirmationModal
        variant="danger"
        isOpen={!!unlinkTarget}
        title={`Remove "${unlinkTarget?.title}" from this template?`}
        message="New projects created from this template will no longer get it. Projects that already have it keep it — remove it there from the project's Documents tab. The document itself stays in the registry."
        onConfirm={confirmUnlink}
        onCancel={() => setUnlinkTarget(null)}
      />
    </div>
  );
};

export default TemplateStandardDocuments;
