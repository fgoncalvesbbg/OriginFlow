/**
 * Releasing a FINAL category — the one place the lock can be undone (migration 172).
 *
 * The reason field is not a formality and the dialog is built to say so: the Release button
 * stays disabled until the reason is long enough, the text is quoted back as "this goes on the
 * record", and the confirmation wording names the category rather than saying "this item".
 * A dialog that lets you click through with "asdf" produces a history nobody trusts.
 *
 * Both rules it enforces — ADMIN only, reason of at least ten characters — are enforced again
 * by the database, and the component says which is which. If the write is refused anyway (the
 * user's role changed under them, say) the error is shown here and the dialog stays open with
 * the typed reason intact, because losing the text would be the second annoyance in a row.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Unlock, X } from 'lucide-react';
import { RELEASE_REASON_MIN_LENGTH, isValidReleaseReason, releaseCategoryRequirements } from '../../services';

interface Props {
  categoryId: string;
  categoryName: string;
  /**
   * How many requirements the release will unfreeze, so the decision has a size. Optional
   * because not every caller has the requirement list loaded — the Admin console does not —
   * and an unknown count must read as unknown rather than as zero.
   */
  requirementCount?: number | null;
  onClose: () => void;
  /** Called after the release succeeds, so the caller can reload. */
  onReleased: () => void;
}

const ReleaseCategoryModal: React.FC<Props> = ({
  categoryId, categoryName, requirementCount, onClose, onReleased,
}) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const valid = isValidReleaseReason(reason);
  const remaining = RELEASE_REASON_MIN_LENGTH - reason.trim().length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await releaseCategoryRequirements(categoryId, reason);
      onReleased();
    } catch (err: any) {
      setError(err?.message ?? 'The release was refused.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200"
      >
        <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-4">
          <div>
            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              <Unlock size={18} className="text-amber-600" /> Release for editing
            </h3>
            <p className="text-xs text-muted mt-0.5">{categoryName}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full" title="Cancel">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-900 leading-relaxed">
              This unfreezes the list of{' '}
              <strong>
                {typeof requirementCount === 'number'
                  ? `${requirementCount} requirement${requirementCount !== 1 ? 's' : ''}`
                  : "this category's TCF requirements"}
              </strong>{' '}
              so requirements can be added and removed again. (Rewording an existing one never
              needed a release.) Your name, the time and the reason below are written to the
              category's history and cannot be edited or removed afterwards.
            </p>
          </div>

          <div>
            <label htmlFor="release-reason" className="block text-sm font-medium text-gray-700 mb-1">
              Why is this being released? <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="release-reason"
              ref={inputRef}
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={4}
              placeholder="e.g. EN 60335-2-14:2026 supersedes the cited edition — the LVD report requirement needs re-pointing before the next request goes out."
              className="w-full border border-gray-300 rounded-md p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-y"
            />
            <p className={`text-[11px] mt-1 ${valid ? 'text-muted' : 'text-amber-700'}`}>
              {valid
                ? 'This will be shown in the history exactly as written.'
                : `At least ${remaining} more character${remaining !== 1 ? 's' : ''} — the database requires a real reason, not a placeholder.`}
            </p>
          </div>

          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5 leading-relaxed">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-white">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md font-medium">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || saving}
            className="px-5 py-2 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-sm font-medium shadow flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
            {saving ? 'Releasing…' : 'Release category'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ReleaseCategoryModal;
