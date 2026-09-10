/**
 * A project's design spec: versions, review rounds, notes and the issue/cancel decisions.
 *
 * Rendered as the project's Design Spec tab, which is also where the All Design Specs board
 * links to — one spec per project means the project IS the spec's page, and a second
 * top-level detail route would just be a different way to reach the same thing.
 *
 * WHAT IS SHARED AND WHAT IS NOT. Every read and write below goes through the shared review
 * layer (`src/services/review/`) or the design spec services on top of it, so link expiry,
 * revocation, note triage and replies behave identically here and in the IM. The triage UI
 * itself is local rather than lifted from the IM's `ReviewCommentsPanel`, because that panel
 * exists to be a pointer INTO the manual editor — it jumps to a chapter and highlights a
 * quote — and none of that has a counterpart on a PDF. Consolidating the two is a follow-up,
 * not a pretence.
 *
 * EVERY MUTATION IS ALSO GATED IN THE DATABASE. `canEdit` here only hides controls the
 * caller cannot use; `is_design_editor()` on each table is the boundary.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Ban, Check, CheckCircle2, ClipboardList, Copy, Download, ExternalLink,
  Eye, FileUp, Link2, Loader2, Lock, MessageSquare, Plus, RotateCcw, Trash2, Undo2, Unlock,
} from 'lucide-react';
// From the design module's own barrel, not the flat one: `setReviewCommentStatus` and
// `addReviewReply` are shared with the IM and are already exported there under IM-shaped
// types, and one flat barrel cannot carry both spellings.
import {
  getDesignSpecByProject, getDesignSpecVersions, getDesignSpecSkuIds, createDesignSpec,
  addDesignSpecVersion, issueDesignSpecFinal, unlockDesignSpec, cancelDesignSpec,
  reopenDesignSpec, setDesignSpecSkus, canEditDesignSpecs,
  uploadDesignSpecVersion, fetchDesignSpecFile,
  sendDesignSpecForReview, getDesignSpecReviewLinks, revokeDesignSpecReviewLink,
  designSpecReviewUrl,
  getDesignSpecNotes, getDesignSpecNoteReplies, setReviewCommentStatus, addReviewReply,
} from '../../services/design';
import { getProjectSkus, getProjectById, getSupplierById } from '../../services';
import type { DesignSpec, DesignSpecVersion } from '../../types/design-spec.types';
import type { ProjectSku } from '../../types';
import type { ReviewComment, ReviewCommentStatus, ReviewReply, ReviewShare } from '../../types/review.types';
import { anchorLabel, anchorExcerpt, orderByAnchor } from '../../modules/review-portal';
import { reviewImageUrl } from '../../services/review';
import { formatReviewStamp, reviewStampTitle } from '../im/project-im-generator/review-comments.utils';
import {
  designSpecStatusOf, designSpecStatusClasses, designSpecStatusLabel, designSpecNextAction,
  currentVersionOf, isReviewClosed, DESIGN_SPEC_STATUS_META,
  type DesignSpecRoundInput,
} from './design-spec-status';
// Imported eagerly: this file is already only reached from a project page, and the viewer
// keeps pdf.js behind its own React.lazy boundary — so nothing heavy rides along.
import DesignSpecVersionViewer from './DesignSpecVersionViewer';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';

interface ProjectDesignSpecPanelProps {
  projectId: string;
  projectName: string;
}

const STATUS_LABEL: Record<ReviewCommentStatus, string> = {
  open: 'Open',
  done: 'Done',
  wont_fix: 'Not changing',
};

const ProjectDesignSpecPanel: React.FC<ProjectDesignSpecPanelProps> = ({ projectId, projectName }) => {
  const [spec, setSpec] = useState<DesignSpec | null>(null);
  const [versions, setVersions] = useState<DesignSpecVersion[]>([]);
  const [linksByVersion, setLinksByVersion] = useState<Map<string, ReviewShare[]>>(new Map());
  const [notes, setNotes] = useState<ReviewComment[]>([]);
  const [replies, setReplies] = useState<Map<string, ReviewReply[]>>(new Map());
  const [skus, setSkus] = useState<ProjectSku[]>([]);
  const [linkedSkuIds, setLinkedSkuIds] = useState<Set<string>>(new Set());
  const [canEdit, setCanEdit] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);

  const [uploadKind, setUploadKind] = useState<'draft' | 'final'>('draft');
  const [uploadNote, setUploadNote] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * The project's supplier, when it has one — the only party whose portal a link can be
   * published to. Null for a project with no supplier assigned yet, which hides the tick
   * rather than offering a destination that does not exist.
   */
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(null);

  const [sendFor, setSendFor] = useState<DesignSpecVersion | null>(null);
  const [sendLabel, setSendLabel] = useState('');
  /** The previous round's link this one continues, so that reviewer sees their own notes. */
  const [sendSupersedes, setSendSupersedes] = useState('');
  /**
   * Publish this link in the supplier's own portal (migration 170).
   *
   * Defaults ON, because the supplier is who a design spec round is for nine times in ten and
   * a default of OFF would mean the portal stayed empty and nobody noticed. It must be turned
   * OFF for a link meant for anyone else — an internal reviewer, a vendor with no portal —
   * because whoever holds a round's token IS that reviewer: they see that reviewer's earlier
   * notes and write new ones in their name.
   */
  const [sendToPortal, setSendToPortal] = useState(true);

  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');

  /** Which version the viewer overlay opened on, or null when it is closed. */
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await getDesignSpecByProject(projectId);
    setSpec(found);
    setCanEdit(await canEditDesignSpecs());

    // Read through the project rather than taking a supplier id as a prop: this panel is
    // mounted from the project page and from the board, and only one of those knows it.
    const project = await getProjectById(projectId);
    const supplierRow = project?.supplierId ? await getSupplierById(project.supplierId) : undefined;
    setSupplier(supplierRow ? { id: supplierRow.id, name: supplierRow.name } : null);

    if (!found) {
      setVersions([]);
      setNotes([]);
      setLinksByVersion(new Map());
      return;
    }

    const [vs, skuIds, projectSkus, noteRows] = await Promise.all([
      getDesignSpecVersions(found.id),
      getDesignSpecSkuIds(found.id),
      getProjectSkus(projectId),
      getDesignSpecNotes(projectId),
    ]);
    setVersions(vs);
    setLinkedSkuIds(new Set(skuIds));
    setSkus(projectSkus);
    setNotes(noteRows);
    setReplies(await getDesignSpecNoteReplies(noteRows));

    // Links are per version, so this is one read per version. Specs carry a handful of
    // versions, not hundreds — and the alternative is a shared-layer query that returns
    // every project's links to filter client-side.
    const map = new Map<string, ReviewShare[]>();
    for (const v of vs) {
      map.set(v.id, await getDesignSpecReviewLinks(found, v));
    }
    setLinksByVersion(map);
  }, [projectId]);

  useEffect(() => {
    void load()
      .catch(e => {
        console.error('[ProjectDesignSpecPanel] load failed:', e);
        setNotice({ kind: 'error', text: 'Could not load the design spec.' });
      })
      .finally(() => setLoading(false));
  }, [load]);

  /** Run a mutation, surface its message, and reload. */
  const run = async (key: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      await load();
      if (okText) setNotice({ kind: 'ok', text: okText });
    } catch (e: any) {
      // The database's messages are written to be read — the lock, the cancel, the
      // cross-project SKU guard all raise sentences.
      console.error(`[ProjectDesignSpecPanel] ${key} failed:`, e);
      setNotice({ kind: 'error', text: e?.message ?? 'That did not work. Please try again.' });
    } finally {
      setBusy(null);
    }
  };

  const current = useMemo(
    () => versions.find(v => v.version === currentVersionOf(versions)) ?? null,
    [versions],
  );

  /**
   * The current version's round, in the shape the status derivation wants.
   *
   * Built from the links and notes already loaded rather than from `getDesignSpecRounds`,
   * which is a whole-board query — this panel has the exact rows in hand.
   */
  const round: DesignSpecRoundInput | undefined = useMemo(() => {
    if (!current) return undefined;
    const links = linksByVersion.get(current.id) ?? [];
    if (links.length === 0) return undefined;
    return {
      hasLiveLink: true,
      allSubmitted: links.every(l => l.submittedAt != null),
      openCount: notes.filter(n => n.subjectId === current.id && n.status === 'open').length,
    };
  }, [current, linksByVersion, notes]);

  const status = spec
    ? designSpecStatusOf(
      { state: spec.state, finalVersionId: spec.finalVersionId, versions },
      round,
    )
    : 'backlog';

  const pickFile = () => fileInputRef.current?.click();

  const onFilePicked = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !spec) return;
    const nextVersion = (currentVersionOf(versions) ?? 0) + 1;
    await run('upload', async () => {
      const uploaded = await uploadDesignSpecVersion(spec.id, file, uploadKind, {
        specCode: spec.specCode,
        version: nextVersion,
        projectLabel: projectName,
      });
      await addDesignSpecVersion(spec.id, {
        kind: uploadKind,
        storagePath: uploaded.storagePath,
        stampedPath: uploaded.stampedPath,
        pageCount: uploaded.pageCount,
        byteSize: uploaded.byteSize,
        note: uploadNote,
      });
      setUploadNote('');
    }, `v${nextVersion} uploaded.`);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const openFile = async (version: DesignSpecVersion) => {
    await run(`open:${version.id}`, async () => {
      const file = await fetchDesignSpecFile(version.id);
      // A new tab, not a download: the signed URL is short-lived, and a designer's next move
      // is to read it beside the notes.
      window.open(file.url, '_blank', 'noopener');
    });
  };

  const copyLink = async (token: string) => {
    const url = designSpecReviewUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ kind: 'ok', text: 'Review link copied. OriginFlow does not send email — paste it to the supplier yourself.' });
    } catch {
      // Clipboard is blocked in some contexts; showing the URL is the fallback that always
      // works.
      setNotice({ kind: 'ok', text: url });
    }
  };

  const toggleSku = async (skuId: string) => {
    if (!spec) return;
    const next = new Set(linkedSkuIds);
    if (next.has(skuId)) next.delete(skuId); else next.add(skuId);
    await run('skus', () => setDesignSpecSkus(spec.id, projectId, [...next]));
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Loading design spec…</div>;
  }

  // ---- no spec yet ----
  if (!spec) {
    return (
      <div className="p-6">
        <div className="border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <ClipboardList size={28} className="mx-auto text-gray-300 mb-3" />
          <h3 className="text-sm font-bold text-gray-700">No design spec for this project</h3>
          <p className="text-xs text-gray-500 mt-1 mb-4 max-w-md mx-auto">
            A design spec is the PDF the design team sends to the supplier for markup, then
            reissues as a final. One per project.
          </p>
          {canEdit ? (
            <Button
              loading={busy === 'create'}
              leftIcon={<Plus size={14} />}
              onClick={() => void run('create', () => createDesignSpec(projectId, `${projectName} — design spec`), 'Design spec created.')}
            >
              Start a design spec
            </Button>
          ) : (
            <p className="text-xs text-gray-400">Only the design team can start one.</p>
          )}
          {notice && (
            <p className={`mt-3 text-xs ${notice.kind === 'error' ? 'text-rose-600' : 'text-emerald-600'}`}>
              {notice.text}
            </p>
          )}
        </div>
      </div>
    );
  }

  const nextAction = designSpecNextAction(
    { state: spec.state, finalVersionId: spec.finalVersionId, versions },
    round,
    null,
  );
  const orderedNotes = orderByAnchor(notes);

  /**
   * Links on OTHER versions, newest version first — the candidates for "this is the next
   * round for that reviewer".
   *
   * Other versions only: chaining a link to another link on the SAME version would say the
   * reviewer already reviewed the thing they are being sent, and the database's chain guard
   * has no opinion about that.
   */
  const earlierLinks = sendFor
    ? [...versions]
      .filter(v => v.id !== sendFor.id)
      .sort((a, b) => b.version - a.version)
      .flatMap(v => (linksByVersion.get(v.id) ?? []).map(link => ({ link, version: v.version })))
    : [];

  return (
    <div className="p-6 space-y-5">
      {/* ---- header ---- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-500">{spec.specCode}</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-medium ${designSpecStatusClasses(status, round)}`}>
              {designSpecStatusLabel(status, round)}
            </span>
          </div>
          <h2 className="text-lg font-bold text-primary mt-1">{spec.title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {DESIGN_SPEC_STATUS_META[status].hint}
            {nextAction && <> · <span className="text-gray-600">{nextAction}</span></>}
          </p>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {spec.state === 'cancelled' ? (
              <Button
                variant="ghost" size="sm" loading={busy === 'reopen'} leftIcon={<RotateCcw size={13} />}
                onClick={() => void run('reopen', () => reopenDesignSpec(spec.id), 'Design spec reopened.')}
              >
                Reopen
              </Button>
            ) : (
              <Button
                variant="ghost" size="sm" loading={busy === 'cancel'} leftIcon={<Ban size={13} />}
                onClick={() => {
                  if (!window.confirm('Cancel this design spec? Every live review link is revoked, so suppliers lose access immediately. Versions and notes are kept.')) return;
                  void run('cancel', async () => {
                    const { linksRevoked } = await cancelDesignSpec(spec.id);
                    setNotice({
                      kind: 'ok',
                      text: linksRevoked > 0
                        ? `Cancelled. ${linksRevoked} live review link${linksRevoked === 1 ? '' : 's'} revoked.`
                        : 'Cancelled.',
                    });
                  });
                }}
              >
                Cancel spec
              </Button>
            )}
            {spec.finalVersionId && (
              <Button
                variant="ghost" size="sm" loading={busy === 'unlock'} leftIcon={<Unlock size={13} />}
                onClick={() => void run('unlock', () => unlockDesignSpec(spec.id), 'Unlocked — you can add another version.')}
              >
                Unlock
              </Button>
            )}
          </div>
        )}
      </div>

      {notice && (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm ${notice.kind === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {notice.kind === 'error' ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0" />}
          <span className="break-all">{notice.text}</span>
        </div>
      )}

      {/* ---- upload ---- */}
      {canEdit && !spec.finalVersionId && spec.state !== 'cancelled' && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
            Upload v{(currentVersionOf(versions) ?? 0) + 1}
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {(['draft', 'final'] as const).map(kind => (
                <button
                  key={kind}
                  onClick={() => setUploadKind(kind)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize ${uploadKind === kind ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  {kind}
                </button>
              ))}
            </div>
            <input
              value={uploadNote}
              onChange={e => setUploadNote(e.target.value)}
              placeholder="What changed? (optional)"
              className="flex-1 min-w-[200px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={e => void onFilePicked(e.target.files)} />
            <Button size="sm" loading={busy === 'upload'} leftIcon={<FileUp size={13} />} onClick={pickFile}>
              Choose PDF
            </Button>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            {uploadKind === 'draft'
              ? 'A draft is stamped “DRAFT · FOR REVIEW ONLY” before a reviewer can see it. Your original is kept untouched.'
              : 'A final is served exactly as you made it, and issuing it locks the spec.'}
          </p>
        </div>
      )}

      {/* ---- versions ---- */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <h3 className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-500 border-b border-gray-200">
          Versions
        </h3>
        {versions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">Nothing uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {versions.map(v => {
              const links = linksByVersion.get(v.id) ?? [];
              const isFinal = spec.finalVersionId === v.id;
              const versionNotes = notes.filter(n => n.subjectId === v.id);
              return (
                <li key={v.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={v.kind === 'final' ? 'emerald' : 'gray'}>v{v.version} {v.kind}</Badge>
                    {isFinal && <Badge tone="emerald" icon={<Lock size={10} />}>Issued</Badge>}
                    <span className="text-[11px] text-gray-400">
                      {v.pageCount != null && `${v.pageCount} page${v.pageCount === 1 ? '' : 's'} · `}
                      {formatReviewStamp(v.uploadedAt).short}
                      {v.uploadedBy && ` · ${v.uploadedBy}`}
                    </span>
                    <div className="flex-1" />
                    <Button
                      variant="ghost" size="sm" leftIcon={<Eye size={12} />}
                      onClick={() => setViewingVersionId(v.id)}
                      title="Read the pages with this version's notes pinned on them"
                    >
                      View
                    </Button>
                    <Button
                      variant="ghost" size="sm" loading={busy === `open:${v.id}`}
                      leftIcon={<Download size={12} />} onClick={() => void openFile(v)}
                      title="Open the unstamped original in a new tab"
                    >
                      Original
                    </Button>
                    {canEdit && spec.state !== 'cancelled' && (
                      <>
                        {!spec.finalVersionId && (
                          <Button
                            variant="ghost" size="sm" leftIcon={<Link2 size={12} />}
                            onClick={() => {
                              setSendFor(v); setSendLabel(''); setSendSupersedes('');
                              // Back to the default every time: a round unticked for an
                              // internal reviewer must not silently stay unticked for the
                              // supplier's round that follows it.
                              setSendToPortal(true);
                            }}
                          >
                            Send for review
                          </Button>
                        )}
                        {v.kind === 'final' && !spec.finalVersionId && (
                          <Button
                            size="sm" loading={busy === `issue:${v.id}`} leftIcon={<Lock size={12} />}
                            onClick={() => {
                              if (!window.confirm(`Issue v${v.version} as the final? This locks the spec — no further versions until it is unlocked.`)) return;
                              void run(`issue:${v.id}`, () => issueDesignSpecFinal(spec.id, v.id), `v${v.version} issued as the final.`);
                            }}
                          >
                            Issue as final
                          </Button>
                        )}
                      </>
                    )}
                  </div>

                  {v.note && <p className="text-xs text-gray-500 mt-1.5">{v.note}</p>}

                  {/* Review rounds on this version. The label is what makes several
                      concurrent reviewers tellable apart, and the round is closed only when
                      every one of them has submitted. */}
                  {links.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {links.map(l => (
                        <li key={l.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                          {l.submittedAt
                            ? <Check size={12} className="text-emerald-600" />
                            : <Loader2 size={12} className="text-sky-500" />}
                          <span className="text-gray-700 font-medium">{l.label || 'Unlabelled link'}</span>
                          {/* Says where this link is reachable from, so "did they get it?"
                              does not depend on remembering whether the tick was on. */}
                          {l.supplierId && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100"
                              title="Published in the supplier's portal — they can open it without an email."
                            >
                              in portal
                            </span>
                          )}
                          <span className="text-gray-400">
                            {l.submittedAt
                              ? `submitted${l.submittedBy ? ` by ${l.submittedBy}` : ''} · ${formatReviewStamp(l.submittedAt).short}`
                              : `sent ${formatReviewStamp(l.createdAt).short}`}
                          </span>
                          <button onClick={() => void copyLink(l.token)} className="text-gray-400 hover:text-indigo-600" title="Copy the reviewer's link">
                            <Copy size={11} />
                          </button>
                          <a href={designSpecReviewUrl(l.token)} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-indigo-600" title="Open the reviewer's view">
                            <ExternalLink size={11} />
                          </a>
                          {canEdit && (
                            <button
                              onClick={() => void run(`revoke:${l.id}`, () => revokeDesignSpecReviewLink(l.id), 'Link revoked — the PDF behind it is unreachable.')}
                              className="text-gray-400 hover:text-rose-600"
                              title="Revoke this link"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </li>
                      ))}
                      {links.every(l => l.submittedAt != null) && (
                        <li className="text-[11px] text-emerald-700 font-medium">
                          Every reviewer has submitted — this round is closed.
                        </li>
                      )}
                    </ul>
                  )}
                  {versionNotes.length > 0 && (
                    // The count is the natural way in to the viewer: someone reading "4 notes
                    // against this version" is asking where they are.
                    <button
                      onClick={() => setViewingVersionId(v.id)}
                      className="text-[11px] text-gray-400 hover:text-indigo-600 mt-1.5 underline decoration-dotted underline-offset-2"
                    >
                      {versionNotes.length} note{versionNotes.length === 1 ? '' : 's'} against this version
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---- version viewer ---- */}
      {viewingVersionId && versions.some(v => v.id === viewingVersionId) && (
        <DesignSpecVersionViewer
          specCode={spec.specCode}
          specTitle={spec.title}
          versions={versions}
          notes={notes}
          initialVersionId={viewingVersionId}
          finalVersionId={spec.finalVersionId}
          canEdit={canEdit}
          // The viewer writes verdicts straight through the shared review layer, so the panel
          // has to re-read rather than guess: `load` is the same reload every mutation here
          // ends with, which keeps the two lists from disagreeing about a note's status.
          onChanged={load}
          onClose={() => setViewingVersionId(null)}
        />
      )}

      {/* ---- send dialog ---- */}
      {sendFor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 px-4" onClick={() => setSendFor(null)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-primary mb-1">
              Send v{sendFor.version} for review
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              A labelled link, live for 30 days. Add one per reviewer — the round closes only
              once every live link has been submitted.
            </p>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1">
              Who is this for?
            </label>
            <input
              autoFocus
              value={sendLabel}
              onChange={e => setSendLabel(e.target.value)}
              placeholder="e.g. Factory A, Packaging vendor"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            {earlierLinks.length > 0 && (
              <>
                <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1 mt-3">
                  Is this the next round for someone?
                </label>
                <select
                  value={sendSupersedes}
                  onChange={e => setSendSupersedes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  <option value="">No — a fresh reviewer</option>
                  {earlierLinks.map(({ link, version }) => (
                    <option key={link.id} value={link.id}>
                      {link.label || 'Unlabelled link'} · v{version}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Pick the link you sent that same reviewer last time. They will see what they
                  asked for then, on this version's pages. Pick nobody and they see only this
                  round — which is what you want for a reviewer who has not seen the spec.
                </p>
              </>
            )}

            {supplier && (
              <label className="flex items-start gap-2 mt-3 p-2 rounded bg-indigo-50 border border-indigo-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendToPortal}
                  onChange={e => setSendToPortal(e.target.checked)}
                  className="mt-0.5 accent-indigo-600"
                />
                <span className="text-[11px] text-indigo-900">
                  <strong>Show this round in {supplier.name}'s portal.</strong> They will find it
                  under the project's development phase without waiting for an email. Untick it
                  if this link is for anyone else — whoever opens it reviews AS the recipient
                  and sees that recipient's earlier notes.
                </span>
              </label>
            )}

            <p className="text-[11px] text-amber-700 bg-amber-50 rounded p-2 mt-3">
              {supplier && sendToPortal
                ? `OriginFlow sends no email, but ${supplier.name} will see this round in their portal. Copy the link too if you want to chase them.`
                : 'OriginFlow sends no email. Copy the link and send it to the reviewer yourself.'}
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" size="sm" onClick={() => setSendFor(null)}>Cancel</Button>
              <Button
                size="sm"
                loading={busy === 'send'}
                onClick={() => {
                  const version = sendFor;
                  const supersedes = sendSupersedes;
                  const publish = sendToPortal;
                  setSendFor(null);
                  void run('send', async () => {
                    const share = await sendDesignSpecForReview(spec, version, {
                      label: sendLabel.trim(),
                      supersedesId: supersedes || null,
                      supplierId: publish && supplier ? supplier.id : null,
                    });
                    await copyLink(share.token);
                  });
                }}
              >
                Create link
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ---- notes ---- */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <h3 className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-500 border-b border-gray-200 flex items-center gap-2">
          <MessageSquare size={12} /> Supplier notes
          {notes.length > 0 && (
            <Badge tone={notes.some(n => n.status === 'open') ? 'amber' : 'gray'}>
              {notes.filter(n => n.status === 'open').length} open of {notes.length}
            </Badge>
          )}
        </h3>
        {orderedNotes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">
            No notes yet. They appear here as reviewers leave them.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {orderedNotes.map(n => {
              const stamp = formatReviewStamp(n.createdAt);
              const excerpt = anchorExcerpt(n.anchor);
              const thread = replies.get(n.id) ?? [];
              const resolved = n.status !== 'open';
              return (
                <li key={n.id} className={`px-4 py-3 ${resolved ? 'opacity-60' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                      {anchorLabel(n.anchor)}
                    </span>
                    {n.subjectVersion != null && <Badge tone="gray">v{n.subjectVersion}</Badge>}
                    <Badge tone={n.status === 'open' ? 'amber' : n.status === 'done' ? 'emerald' : 'gray'}>
                      {STATUS_LABEL[n.status]}
                    </Badge>
                    <span className="text-[10px] text-gray-400">
                      {n.authorName}
                      {stamp.short && <> · <time dateTime={n.createdAt} title={reviewStampTitle(stamp)}>{stamp.short}</time></>}
                    </span>
                  </div>
                  {excerpt && (
                    <blockquote className="text-[11px] text-gray-500 italic border-l-2 border-gray-200 pl-2 mb-1.5">
                      {excerpt}
                    </blockquote>
                  )}
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.body}</p>
                  {n.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {n.attachments.map(a => (
                        <a key={a.path} href={reviewImageUrl(a.path)} target="_blank" rel="noreferrer" title="Open full size">
                          <img src={reviewImageUrl(a.path)} alt="" className="h-14 w-14 object-cover rounded border border-gray-200 hover:border-indigo-300" />
                        </a>
                      ))}
                    </div>
                  )}

                  {thread.length > 0 && (
                    <div className="mt-2 space-y-1.5 border-l-2 border-indigo-100 pl-2">
                      {thread.map(r => (
                        <div key={r.id}>
                          <span className="text-[10px] font-semibold text-gray-600">{r.authorName}</span>
                          {r.authorUserId && <span className="text-[10px] text-indigo-500"> · team</span>}
                          <p className="text-[11px] text-gray-600 whitespace-pre-wrap">{r.body}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {canEdit && (
                    replyingTo === n.id ? (
                      <div className="mt-2">
                        <textarea
                          autoFocus rows={2} value={replyBody} onChange={e => setReplyBody(e.target.value)}
                          maxLength={4000}
                          placeholder="Answer the reviewer — they see this on their next visit."
                          className="w-full border border-gray-300 rounded p-1.5 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                        <div className="flex items-center gap-2 mt-1">
                          <Button variant="ghost" size="sm" onClick={() => { setReplyingTo(null); setReplyBody(''); }}>Cancel</Button>
                          <Button
                            size="sm" loading={busy === `reply:${n.id}`} disabled={!replyBody.trim()}
                            onClick={() => void run(`reply:${n.id}`, async () => {
                              await addReviewReply(n.id, replyBody.trim());
                              setReplyBody('');
                              setReplyingTo(null);
                            })}
                          >
                            Reply
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Button variant="ghost" size="sm" onClick={() => { setReplyingTo(n.id); setReplyBody(''); }}>
                          Reply
                        </Button>
                        {n.status === 'open' ? (
                          <>
                            <Button
                              variant="ghost" size="sm" leftIcon={<Check size={12} />}
                              loading={busy === `status:${n.id}`}
                              onClick={() => void run(`status:${n.id}`, () => setReviewCommentStatus(n.id, 'done'))}
                            >
                              Done
                            </Button>
                            <Button
                              variant="ghost" size="sm" leftIcon={<Ban size={12} />}
                              loading={busy === `status:${n.id}`}
                              onClick={() => void run(`status:${n.id}`, () => setReviewCommentStatus(n.id, 'wont_fix'))}
                            >
                              Not changing
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost" size="sm" leftIcon={<Undo2 size={12} />}
                            loading={busy === `status:${n.id}`}
                            onClick={() => void run(`status:${n.id}`, () => setReviewCommentStatus(n.id, 'open'))}
                          >
                            Reopen
                          </Button>
                        )}
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---- SKUs ---- */}
      {skus.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
            SKUs this spec covers
          </h3>
          <p className="text-[11px] text-gray-400 mb-2">
            Leave all unticked if the spec covers the whole project.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {skus.map(sku => {
              const on = linkedSkuIds.has(sku.id);
              return (
                <button
                  key={sku.id}
                  disabled={!canEdit || busy === 'skus'}
                  onClick={() => void toggleSku(sku.id)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors disabled:opacity-60 ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                  title={sku.skuTitle}
                >
                  {sku.skuNumber}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDesignSpecPanel;
