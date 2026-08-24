/**
 * Correcting one memory segment.
 *
 * Three different acts wear one button here, and the difference is not cosmetic:
 *
 *  - UNREVIEWED  → edit in place. Nothing has consumed this text and no reviewer has
 *                  signed it off, so there is no lineage worth preserving.
 *  - APPROVED    → NOT an edit. The governance trigger freezes an approved row's
 *                  linguistic payload, so a correction deprecates it and inserts an
 *                  unreviewed successor linked by `supersedes_id`. Published content keeps
 *                  a traceable lineage instead of silently changing meaning underneath it,
 *                  and the successor must itself be approved before it can auto-apply
 *                  again. The dialog says all of that rather than discovering it as an
 *                  error after the fact.
 *  - DEPRECATED  → read-only.
 *
 * The target is edited as raw placeholdered text, markers and all, because a translator
 * legitimately moves a marker for target word order. What is NOT negotiable is the marker
 * inventory, so `validateTmTargetText` runs on every keystroke and save stays disabled
 * while it objects — the same rule `reassembleFragment` applies at read time, enforced
 * where the person can still fix it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, Lock, Info } from 'lucide-react';
import { Button } from '../../common/Button';
import { Badge } from '../../common/Badge';
import {
  validateTmTargetText,
  updateUnreviewedTmSegment,
  replaceApprovedTmSegment,
  type TmSegmentRecord,
} from '../../../services';
import { MarkerText, markersIn } from './tm-markers';

interface Props {
  segment: TmSegmentRecord;
  onClose: () => void;
  /** Called after a successful write so the list can refetch. */
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-[11px] uppercase tracking-wide text-muted mb-1">{label}</div>
    <div className="text-sm text-gray-800 break-words">{children}</div>
  </div>
);

export const TmSegmentEditModal: React.FC<Props> = ({ segment, onClose, onSaved, onError }) => {
  const [targetText, setTargetText] = useState(segment.targetText);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const readOnly = segment.status === 'deprecated';
  const isCorrection = segment.status === 'approved';

  useEffect(() => {
    setTargetText(segment.targetText);
    setReason('');
  }, [segment.id, segment.targetText]);

  const verdict = useMemo(() => validateTmTargetText(targetText, segment), [targetText, segment]);
  const changed = targetText !== segment.targetText;
  const reasonMissing = isCorrection && !reason.trim();
  const canSave = !readOnly && changed && verdict.ok && !reasonMissing && !saving;

  const requiredMarkers = useMemo(() => markersIn(segment.placeholderedSource), [segment.placeholderedSource]);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (isCorrection) {
        await replaceApprovedTmSegment(segment.id, targetText, reason.trim());
        onSaved(
          'Correction stored. The approved segment is deprecated and its replacement is waiting '
          + 'for approval — it will not auto-apply until then.',
        );
      } else {
        await updateUnreviewedTmSegment(segment.id, targetText);
        onSaved('Segment updated.');
      }
      onClose();
    } catch (e: any) {
      onError(e?.message || 'Could not save the segment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[88vh] animate-in fade-in zoom-in duration-200">
        <div className="flex items-start justify-between p-6 pb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {readOnly ? 'Segment' : isCorrection ? 'Correct approved segment' : 'Edit segment'}
            </h3>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge tone="gray">{segment.sourceLocale} → {segment.targetLocale}</Badge>
              <Badge tone={segment.status === 'approved' ? 'emerald' : segment.status === 'deprecated' ? 'rose' : 'amber'}>
                {segment.status}
              </Badge>
              <Badge tone="gray">{segment.origin}</Badge>
              {segment.usageCount > 0 && <Badge tone="indigo">used {segment.usageCount}×</Badge>}
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-gray-700" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 pb-6 overflow-y-auto space-y-4">
          {isCorrection && (
            <div className="flex gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold">This does not edit the segment.</strong> An approved
                segment is immutable so that published manuals keep a traceable lineage. Saving will
                deprecate this row and create an <strong>unreviewed replacement</strong>, which has to be
                approved before it can be applied automatically again.
              </div>
            </div>
          )}
          {readOnly && (
            <div className="flex gap-2.5 p-3 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700">
              <Lock size={16} className="shrink-0 mt-0.5" />
              <div>
                This segment was deprecated{segment.deprecatedAt ? ' on ' + segment.deprecatedAt.slice(0, 10) : ''} and
                is no longer editable or retrievable.
                {segment.deprecatedReason && <> Reason: <em>{segment.deprecatedReason}</em></>}
              </div>
            </div>
          )}

          <Field label="Source">
            <div className="p-3 rounded-lg bg-light border border-gray-200 font-normal leading-relaxed">
              <MarkerText text={segment.placeholderedSource} />
            </div>
          </Field>

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-[11px] uppercase tracking-wide text-muted">Target ({segment.targetLocale})</div>
              {requiredMarkers.length > 0 && (
                <div className="text-[11px] text-muted">
                  must keep every marker — order may change
                </div>
              )}
            </div>
            <textarea
              value={targetText}
              onChange={(e) => setTargetText(e.target.value)}
              readOnly={readOnly}
              rows={5}
              spellCheck
              className={`w-full border p-2.5 rounded-md text-sm font-mono leading-relaxed outline-none focus:ring-2 ${
                readOnly
                  ? 'bg-gray-50 text-gray-600 border-gray-200'
                  : verdict.ok
                    ? 'border-gray-300 focus:ring-indigo-500'
                    : 'border-rose-300 bg-rose-50/40 focus:ring-rose-400'
              }`}
            />
            {!verdict.ok && (
              <p className="mt-1.5 text-sm text-rose-700 flex gap-1.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                {verdict.reason}
              </p>
            )}
            {verdict.ok && changed && (
              <div className="mt-2 p-2.5 rounded-lg bg-light border border-gray-200 text-sm leading-relaxed">
                <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Preview</div>
                <MarkerText text={targetText} />
              </div>
            )}
          </div>

          {isCorrection && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason for the correction <span className="text-rose-600">*</span>
              </label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. wrong technical term — 'Sicherung' should be 'Schutzschalter'"
                className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <p className="mt-1 text-xs text-muted">
                Stored on the deprecated row. This is the audit trail for why published wording changed.
              </p>
            </div>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-muted hover:text-gray-700 select-none">
              Provenance and keys
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3 p-3 rounded-lg bg-light border border-gray-200">
              <Field label="Origin">{segment.origin}</Field>
              <Field label="Container">{segment.container ?? '—'}</Field>
              <Field label="Domain">
                {segment.domainCategoryId ?? '—'}
                {segment.domainContentType ? ' · ' + segment.domainContentType : ''}
              </Field>
              <Field label="Placeholder safe">{segment.placeholderSafe ? 'yes' : 'no'}</Field>
              <Field label="Created">
                {segment.createdAt?.slice(0, 10) ?? '—'}{segment.createdBy ? ' · ' + segment.createdBy : ''}
              </Field>
              <Field label="Reviewed">
                {segment.reviewedAt?.slice(0, 10) ?? 'never'}{segment.reviewedBy ? ' · ' + segment.reviewedBy : ''}
              </Field>
              <Field label="Versions">
                seg {segment.segmentationVersion} · norm {segment.normalizationVersion} · ph {segment.placeholderVersion}
              </Field>
              <Field label="Last used">{segment.lastUsedAt?.slice(0, 10) ?? 'never'}</Field>
              {segment.regulatoryRefs.length > 0 && (
                <Field label="Regulatory refs">{segment.regulatoryRefs.join(', ')}</Field>
              )}
              {segment.sourceRef && <Field label="Source file">{segment.sourceRef}</Field>}
              {segment.supersedesId && (
                <Field label="Supersedes">
                  <span className="font-mono text-xs">{segment.supersedesId}</span>
                </Field>
              )}
              <Field label="Raw source">
                <span className="font-mono text-xs break-all">{segment.rawSource}</span>
              </Field>
            </div>
          </details>

          {segment.regulatoryRefs.length > 0 && !readOnly && (
            <div className="flex gap-2.5 p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-sm text-indigo-900">
              <Info size={16} className="shrink-0 mt-0.5" />
              <div>
                This segment carries a regulatory reference ({segment.regulatoryRefs.join(', ')}). It is only
                ever auto-applied on an exact in-context match, and the wording may be prescribed — check the
                regulation before changing it.
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-6 pt-4 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && (
            <Button variant={isCorrection ? 'danger' : 'primary'} onClick={handleSave} disabled={!canSave} loading={saving}>
              {isCorrection ? 'Deprecate and replace' : 'Save changes'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
