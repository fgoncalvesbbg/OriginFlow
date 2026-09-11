/**
 * The draft-manual upload block a SUPPLIER sees, shared by their project portal and their
 * dashboard so both surfaces say the same thing about the same request (migration 179).
 *
 * WHAT THE SUPPLIER IS BEING ASKED FOR. Their own draft of the instruction manual — the
 * document they would otherwise email. Uploading it here starts the quality check that used
 * to happen in somebody's inbox, and gives the technical writer a brief instead of a blank
 * page.
 *
 * THE UPLOAD IS THREE CALLS, NOT ONE, and the middle one does not come through OriginFlow:
 * the server mints a signed URL for a path IT chooses, the browser PUTs the file straight to
 * Storage, and the server then reads the bytes back to check them. A draft manual can be
 * 50MB and a Netlify Function body cannot. See uploadSupplierDraft.
 *
 * RE-UPLOADING IS NORMAL AND NEVER DESTRUCTIVE. Each upload is a new version; the previous
 * one and the notes written against it are kept, because a note pinned to v1 page 4 still
 * means something after v2 lands. So the card offers "Upload a new version" rather than
 * "Replace", which would be a lie about what happens.
 */

import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, FileText, Loader2, Upload } from 'lucide-react';
import {
  uploadSupplierDraft, MAX_DRAFT_PDF_BYTES,
  type PortalCredential, type SupplierDraftRequest,
} from '../../services/im/im-draft.service';

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—';

const STAGE_LABEL: Record<string, string> = {
  preparing: 'Preparing…',
  uploading: 'Uploading…',
  recording: 'Checking the file…',
};

interface Props {
  requests: readonly SupplierDraftRequest[];
  credential: PortalCredential;
  /** Shown on the dashboard, where requests from several projects sit in one list. */
  showProject?: boolean;
  /** Let the parent refresh its own copy of the rows after a successful upload. */
  onUploaded?: () => void;
}

export const SupplierIMDraftCard: React.FC<Props> = ({
  requests, credential, showProject = false, onUploaded,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stage, setStage] = useState<string>('');
  const [error, setError] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  if (requests.length === 0) return null;

  const upload = async (request: SupplierDraftRequest, file: File | undefined) => {
    if (!file) return;
    setError(e => ({ ...e, [request.id]: '' }));

    if (!name.trim()) {
      setError(e => ({ ...e, [request.id]: 'Please give your name first, so we know who sent it.' }));
      return;
    }
    if (file.size > MAX_DRAFT_PDF_BYTES) {
      setError(e => ({ ...e, [request.id]: 'That PDF is larger than the 50MB limit.' }));
      return;
    }

    setBusyId(request.id);
    try {
      const res = await uploadSupplierDraft(credential, request.id, file, name.trim(), s => setStage(s));
      setDone(d => ({ ...d, [request.id]: res.version }));
      onUploaded?.();
    } catch (e: any) {
      // The function writes its messages for this screen — an expired request, a file that
      // is not a PDF, an upload that never arrived.
      setError(er => ({ ...er, [request.id]: e?.message ?? 'The upload failed. Please try again.' }));
    } finally {
      setBusyId(null);
      setStage('');
      // Clear the picker so choosing the same file again still fires onChange.
      const input = inputs.current[request.id];
      if (input) input.value = '';
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-light/60">
        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
          <FileText size={15} className="text-gray-400" /> Draft instruction manual
        </h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Upload your draft manual as a PDF. Our quality team reviews it before we write the
          final version.
        </p>
      </div>

      <div className="px-4 py-3 border-b border-gray-100">
        <label className="block text-[11px] font-semibold text-gray-600 mb-1">Your name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Who is sending this?"
          className="w-full sm:max-w-xs border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <ul className="divide-y divide-gray-50">
        {requests.map(r => {
          const busy = busyId === r.id;
          const uploadedVersion = done[r.id] ?? r.latestVersion;
          const overdue = r.dueDate && new Date(r.dueDate) < new Date() && !uploadedVersion;
          return (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1">
                {showProject && (
                  <span className="text-sm font-semibold text-gray-900">
                    {r.projectCode ? `${r.projectCode} — ` : ''}{r.projectName ?? 'Project'}
                  </span>
                )}
                <span className="text-[11px] text-gray-500">
                  {r.templateType === 'warning_leaflet' ? 'Warning leaflet' : 'Instruction manual'}
                </span>
                {r.dueDate && (
                  <span className={`text-[11px] inline-flex items-center gap-1 ${overdue ? 'text-rose-600 font-semibold' : 'text-gray-500'}`}>
                    <Clock size={10} /> due {shortDate(r.dueDate)}
                  </span>
                )}
              </div>

              {r.note && <p className="text-[11px] text-gray-600 mb-1.5">{r.note}</p>}

              {uploadedVersion != null && (
                <p className="text-[11px] text-emerald-700 inline-flex items-center gap-1 mb-1.5">
                  <CheckCircle size={11} />
                  {done[r.id] != null
                    ? `Thank you — version ${uploadedVersion} received. Our quality team will review it.`
                    : `Version ${uploadedVersion} received${r.latestUploadedAt ? ` on ${shortDate(r.latestUploadedAt)}` : ''}.`}
                </p>
              )}

              {error[r.id] && (
                <p className="text-[11px] text-rose-700 inline-flex items-start gap-1 mb-1.5">
                  <AlertCircle size={11} className="shrink-0 mt-0.5" /> {error[r.id]}
                </p>
              )}

              <input
                ref={el => { inputs.current[r.id] = el; }}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => upload(r, e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => inputs.current[r.id]?.click()}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors disabled:opacity-60"
              >
                {busy
                  ? <><Loader2 size={12} className="animate-spin" /> {STAGE_LABEL[stage] ?? 'Working…'}</>
                  : <><Upload size={12} /> {uploadedVersion != null ? 'Upload a new version' : 'Upload draft PDF'}</>}
              </button>
              <span className="text-[10px] text-gray-400 ml-2">PDF, up to 50 MB</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default SupplierIMDraftCard;
