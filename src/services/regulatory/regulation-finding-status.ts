/**
 * Triage status for regulatory-check findings — solved / skipped / wrong.
 *
 * Stored in `im_regulatory_finding_status` (migration 118) rather than inside the report,
 * because `im_regulatory_checks` has no UPDATE policy by design: the report is the
 * immutable evidence of what the model said, and this is the mutable human opinion about
 * it. Keeping them apart preserves both.
 *
 * Rows are keyed by CONTENT, not by check run, so a decision survives re-running the check
 * — which is the normal way to confirm a fix worked. See `findingKey` for what that costs.
 */

import { db, withDeadline, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { RegulatoryFinding } from '../../types';

const TAG = '[regulatory]';
const READ_TIMEOUT_MS = 12000;

export type FindingStatus = 'solved' | 'skipped' | 'wrong';

export interface FindingStatusEntry {
  status: FindingStatus;
  note?: string;
  updatedBy?: string;
  updatedAt: string;
}

/** Collapse whitespace and case so trivial reformatting does not orphan a decision. */
const normalize = (value?: string) =>
  (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Small, fast, non-cryptographic string hash (FNV-1a, 32-bit) rendered as hex.
 *
 * Only used to keep the key short — the discriminating parts of the key (regulation and
 * anchor) are carried literally, so a hash collision could at worst merge two findings
 * that share a regulation AND an anchor but differ in wording. That is vanishingly
 * unlikely at the handful-of-findings-per-template scale, and no cryptographic property is
 * needed. Deliberately not `crypto.subtle`, which is async and would make every caller
 * await a digest for no benefit.
 */
const hash32 = (value: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/**
 * A stable identity for one finding, used to carry its triage decision across check runs.
 *
 * Built from the regulation, the anchor, and the requirement/issue text. Whitespace and
 * case are normalized, so reformatting is harmless; a genuine REWORDING by the model
 * produces a different key and the finding reappears untriaged. That is the deliberate
 * trade: fuzzy matching could silently carry a "solved" mark onto a different problem,
 * which for a compliance tool is far worse than deciding one finding twice.
 *
 * `severity` and `suggestedChange` are excluded on purpose — the model may legitimately
 * re-rate or re-word its advice for what is recognisably the same problem.
 */
export const findingKey = (finding: Pick<RegulatoryFinding,
  'regulationId' | 'sectionId' | 'refId' | 'requirement' | 'issue'>): string => {
  const anchor = finding.refId || finding.sectionId || '-';
  return `${finding.regulationId}:${anchor}:${hash32(
    `${normalize(finding.requirement)}|${normalize(finding.issue)}`)}`;
};

const mapRow = (r: any): FindingStatusEntry => ({
  status: r.status as FindingStatus,
  note: r.note ?? undefined,
  updatedBy: r.updated_by ?? undefined,
  updatedAt: r.updated_at,
});

/** Every triage decision recorded for a template, keyed by `findingKey`. */
export const getFindingStatuses = async (
  templateId: string,
): Promise<Record<string, FindingStatusEntry>> => {
  if (!templateId || !isLive) return {};
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_regulatory_finding_status', {
        columns: 'finding_key,status,note,updated_by,updated_at',
        where: { template_id: templateId },
        signal,
      }),
      READ_TIMEOUT_MS,
      'getFindingStatuses',
    ),
    `${TAG} getFindingStatuses`,
  );
  const out: Record<string, FindingStatusEntry> = {};
  for (const r of rows) out[r.finding_key] = mapRow(r);
  return out;
};

/**
 * Record — or clear — the decision on one finding.
 *
 * `status: null` deletes the row, because untriaged is the absence of a row rather than a
 * fourth status value.
 */
export const setFindingStatus = async (
  templateId: string,
  key: string,
  status: FindingStatus | null,
  opts: { note?: string; actor?: string } = {},
): Promise<void> => {
  if (!status) {
    await db.delete('im_regulatory_finding_status', {
      where: { template_id: templateId, finding_key: key },
    });
    return;
  }
  await db.upsert('im_regulatory_finding_status', {
    template_id: templateId,
    finding_key: key,
    status,
    note: opts.note?.trim() || null,
    ...(opts.actor !== undefined && { updated_by: opts.actor }),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'template_id,finding_key' });
};
