/**
 * The draft-manual ask, as one more row in the supplier's phase checklist
 * (migrations 179/180).
 *
 * IT IS DELIBERATELY NOT SPECIAL. A supplier opening their portal sees a column of document
 * rows — status pill, title, description, a dashed box to drop a file into, and a green
 * panel once it has landed. The draft manual is one of those rows and nothing more: same
 * layout, same words, same states. An earlier version of this card had its own heading and
 * its own "Your name" field, and it read as a different kind of task in the middle of a list
 * of identical ones, which is the opposite of what it is.
 *
 * NOBODY IS ASKED WHO THEY ARE. No other upload in this portal does, and the credential
 * already identifies the company — the server reads the supplier's name off the project
 * (see `commitUpload`). That is also harder to get wrong than a free-text box.
 *
 * RE-UPLOADING IS NORMAL AND NEVER DESTRUCTIVE, which is why the button says "Replace File"
 * to match the other rows but the text underneath says which version landed: each upload is
 * a new version and the notes written against the previous one survive, because a note
 * pinned to v1 page 4 still means something after v2 arrives.
 */

import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, FileText, UploadCloud } from 'lucide-react';
import {
  uploadSupplierDraft, MAX_DRAFT_PDF_BYTES,
  type PortalCredential, type SupplierDraftRequest,
} from '../../services/im/im-draft.service';

const shortDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—';

interface Props {
  requests: readonly SupplierDraftRequest[];
  credential: PortalCredential;
  /** Let the parent refresh its own copy of the rows after a successful upload. */
  onUploaded?: () => void;
}

export const SupplierIMDraftCard: React.FC<Props> = ({ requests, credential, onUploaded }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [justUploaded, setJustUploaded] = useState<Record<string, number>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  if (requests.length === 0) return null;

  const upload = async (request: SupplierDraftRequest, file: File | undefined) => {
    if (!file) return;
    setError(e => ({ ...e, [request.id]: '' }));

    if (file.size > MAX_DRAFT_PDF_BYTES) {
      setError(e => ({ ...e, [request.id]: 'That PDF is larger than the 50 MB limit.' }));
      return;
    }

    setBusyId(request.id);
    try {
      const res = await uploadSupplierDraft(credential, request.id, file);
      setJustUploaded(d => ({ ...d, [request.id]: res.version }));
      onUploaded?.();
    } catch (e: any) {
      // The function writes its messages for this screen — an expired request, a file that
      // is not a PDF, an upload that never arrived.
      setError(er => ({ ...er, [request.id]: e?.message ?? 'The upload failed. Please try again.' }));
    } finally {
      setBusyId(null);
      // Clear the picker so choosing the same file again still fires onChange.
      const input = inputs.current[request.id];
      if (input) input.value = '';
    }
  };

  return (
    <>
      {requests.map(r => {
        const busy = busyId === r.id;
        const version = justUploaded[r.id] ?? r.latestVersion;
        const uploaded = version != null;
        const uploadedAt = justUploaded[r.id] != null ? new Date().toISOString() : r.latestUploadedAt;
        const overdue = !!r.dueDate && new Date(r.dueDate) < new Date() && !uploaded;

        return (
          <div key={r.id} className={`p-6 flex flex-col md:flex-row gap-6 ${uploaded ? 'bg-emerald-50/30' : ''}`}>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                {/* Same two-state pill the document rows use: nothing yet, or done. */}
                <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${
                  uploaded
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-gray-100 text-gray-600 border-gray-200'
                }`}>
                  {uploaded ? 'Uploaded' : 'Not Started'}
                </span>
                {r.dueDate && (
                  <span className={`text-xs font-medium flex items-center gap-1 ${overdue ? 'text-rose-600' : uploaded ? 'text-gray-400' : 'text-amber-600'}`}>
                    <Clock size={14} /> Due: {shortDate(r.dueDate)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className={`font-semibold text-lg ${uploaded ? 'text-emerald-900' : 'text-primary'}`}>
                  {r.templateType === 'warning_leaflet' ? 'Draft Warning Leaflet' : 'Draft Instruction Manual'}
                </h3>
              </div>
              <p className="text-sm text-muted mb-3">
                Your draft of the manual as a PDF. Our quality team reviews it before we write
                the final version.
              </p>

              {error[r.id] && (
                <div className="bg-rose-50 border border-rose-100 p-3 rounded text-sm text-rose-800 mt-3 flex items-start gap-2">
                  <AlertCircle size={15} className="shrink-0 mt-0.5" /> <span>{error[r.id]}</span>
                </div>
              )}
            </div>

            <div className="w-full md:w-72 shrink-0 flex flex-col justify-center bg-light rounded-xl border border-gray-100 p-4">
              <input
                ref={el => { inputs.current[r.id] = el; }}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => upload(r, e.target.files?.[0])}
              />

              {uploaded ? (
                <div className="text-center">
                  <CheckCircle className="mx-auto text-emerald-500 mb-2" size={32} />
                  <p className="text-sm font-medium text-primary">File Uploaded</p>
                  <p className="text-xs text-muted mt-1 mb-3">
                    Version {version} on {shortDate(uploadedAt)}
                  </p>
                  <button
                    type="button"
                    onClick={() => inputs.current[r.id]?.click()}
                    disabled={busy}
                    className="block w-full text-center py-2 px-4 border border-gray-300 rounded bg-white hover:bg-light text-sm transition-colors disabled:opacity-50"
                  >
                    {busy ? 'Uploading…' : 'Replace File'}
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => inputs.current[r.id]?.click()}
                    disabled={busy}
                    className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors border-gray-300 bg-white hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-60"
                  >
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      {busy ? (
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                      ) : (
                        <>
                          <UploadCloud className="w-8 h-8 mb-2 text-gray-400" />
                          <p className="text-sm text-muted font-medium">Click to upload</p>
                          <p className="text-xs text-gray-400">PDF only, up to 50 MB</p>
                        </>
                      )}
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
};

export default SupplierIMDraftCard;
