/**
 * Regulatory checklist — the items, and what was confirmed (migrations 119 and 120).
 *
 * A regulation carries `checklist`: obligations a PERSON has to verify by hand, one per
 * line. Every regulation that applies to a template contributes its items to one combined
 * list, shown before a manual is published, where each item can be marked 'done' (taken
 * into account) or 'na' (not applicable to this manual). Nothing here blocks a publish —
 * an unconfirmed item is information, and a checklist that blocks only teaches people to
 * tick everything.
 *
 * THREE SCOPES, DELIBERATELY DIFFERENT:
 *   - the ITEMS come from the regulations, so they are the same for every template the
 *     regulation applies to and every manual built from it;
 *   - the TEMPLATE confirmations (migration 120) are the author's readiness gate: does
 *     what I built cover this obligation? Keyed by templateId;
 *   - the MANUAL confirmations (migration 119) are the publisher's, keyed (projectId,
 *     templateType), because "the declaration of conformity is enclosed" is a fact about
 *     one product's manual, not about the template.
 *
 * Neither confirmation is derived from the other, and the manual's is not pre-filled from
 * the template's. A template can cover an obligation that a manual then hides behind an
 * unmet condition, and a manual can satisfy one through project-only content the template
 * never had — so a tick inherited across that boundary would be a claim nobody made. The
 * template's decision is shown BESIDE the manual's as context instead.
 *
 * These items are NOT sent to the regulatory-check model. `im_template_regulations.notes`
 * is (it tells the model how to read the regulation); this is the opposite kind of thing —
 * what the check structurally cannot see, because it only ever reads serialized template
 * text, never the rating plate or what is in the box.
 */

import { db, withDeadline, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { tmHash128 } from '../im/im-tm-hash';
import { parseBulletLines } from './regulation-notes';
import type { TemplateRegulation } from '../../types';

const TAG = '[regulatory]';
const READ_TIMEOUT_MS = 12000;

export type ChecklistItemStatus = 'done' | 'na';

export interface ChecklistItemState {
  status: ChecklistItemStatus;
  note?: string;
  updatedBy?: string;
  updatedAt: string;
}

/** One line of one regulation's checklist, merged across every regulation that states it. */
export interface ChecklistItem {
  /** Content-derived, stable across edits to OTHER items and across reordering. */
  key: string;
  /** The wording as first encountered, which is what gets displayed. */
  text: string;
  /** Every regulation whose checklist contains this item (deduped by key). */
  regulationIds: string[];
  regulationReferences: string[];
}

/** Split a regulation's `checklist` column into items. Same convention as its notes. */
export const parseRegulationChecklist = (checklist?: string | null): string[] =>
  parseBulletLines(checklist);

/**
 * Stable identity for one checklist item, derived from its TEXT.
 *
 * Positional keys were the obvious alternative and are unsafe here: inserting a line
 * above item 3 would move item 3's confirmation onto a different obligation, silently,
 * in the one table where a false confirmation is most expensive. Content keying makes
 * inserting and reordering free, and rewording an item deliberately clears it — a
 * rewritten obligation has not been confirmed.
 *
 * The regulation id is NOT part of the key, so two regulations stating the same
 * obligation collapse to one item that is confirmed once (and shown under both).
 *
 * Normalization absorbs pure formatting: bullet markers, whitespace, case, and trailing
 * punctuation. `tmHash128` rather than a 32-bit hash because here the whole key IS the
 * hash — nothing discriminating is carried literally alongside it, so a collision would
 * merge two unrelated obligations' confirmations rather than degrade to a cache miss.
 */
export const checklistItemKey = (text: string): string =>
  tmHash128(
    (text ?? '')
      .replace(/^\s*[-*•]\s+/, '')
      .replace(/\s+/g, ' ')
      .replace(/[.;:,\s]+$/, '')
      .trim()
      .toLowerCase(),
  );

/**
 * The combined checklist for a template, in assignment order then item order.
 *
 * Takes the assignments as `getTemplateRegulations` returns them (explicit rows plus
 * category-derived entries, each with its library row stitched in), so callers do not
 * need to know how a regulation came to apply — only that it does.
 */
export const buildTemplateChecklist = (assignments: TemplateRegulation[]): ChecklistItem[] => {
  const byKey = new Map<string, ChecklistItem>();
  for (const a of assignments) {
    const reg = a.regulation;
    if (!reg) continue;
    for (const text of parseRegulationChecklist(reg.checklist)) {
      const key = checklistItemKey(text);
      // A blank-after-normalization line (e.g. a lone "-") is not an obligation.
      if (!key || !text.trim()) continue;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          key,
          text: text.trim(),
          regulationIds: [reg.id],
          regulationReferences: [reg.referenceCode],
        });
        continue;
      }
      if (!existing.regulationIds.includes(reg.id)) {
        existing.regulationIds.push(reg.id);
        existing.regulationReferences.push(reg.referenceCode);
      }
    }
  }
  return [...byKey.values()];
};

const mapRow = (r: any): ChecklistItemState => ({
  status: r.status as ChecklistItemStatus,
  note: r.note ?? undefined,
  updatedBy: r.updated_by ?? undefined,
  updatedAt: r.updated_at,
});

/** Every confirmation recorded for ONE project manual, keyed by `checklistItemKey`. */
export const getChecklistState = async (
  projectId: string,
  templateType: string,
): Promise<Record<string, ChecklistItemState>> => {
  if (!projectId || !isLive) return {};
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_regulatory_checklist_state', {
        columns: 'item_key,status,note,updated_by,updated_at',
        where: { project_id: projectId, template_type: templateType },
        signal,
      }),
      READ_TIMEOUT_MS,
      'getChecklistState',
    ),
    `${TAG} getChecklistState`,
  );
  const out: Record<string, ChecklistItemState> = {};
  for (const r of rows) out[r.item_key] = mapRow(r);
  return out;
};

/**
 * Record — or clear — the confirmation on one item.
 *
 * `status: null` deletes the row, because unreviewed is the absence of a row rather than
 * a third status value.
 */
export const setChecklistItemState = async (
  projectId: string,
  templateType: string,
  key: string,
  status: ChecklistItemStatus | null,
  opts: { note?: string; actor?: string } = {},
): Promise<void> => {
  if (!status) {
    await db.delete('im_regulatory_checklist_state', {
      where: { project_id: projectId, template_type: templateType, item_key: key },
    });
    return;
  }
  await db.upsert('im_regulatory_checklist_state', {
    project_id: projectId,
    template_type: templateType,
    item_key: key,
    status,
    note: opts.note?.trim() || null,
    ...(opts.actor !== undefined && { updated_by: opts.actor }),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id,template_type,item_key' });
};

export interface ChecklistSummary {
  total: number;
  done: number;
  /** Marked not applicable to this manual. */
  na: number;
  /** Neither confirmed nor dismissed — what "not reviewed" means. */
  open: number;
  /** True when every item has been decided one way or the other. */
  complete: boolean;
}

/** Counts for the badge and the publish dialog. Pure. */
export const summarizeChecklist = (
  items: ChecklistItem[],
  state: Record<string, ChecklistItemState>,
): ChecklistSummary => {
  let done = 0;
  let na = 0;
  for (const item of items) {
    const s = state[item.key]?.status;
    if (s === 'done') done += 1;
    else if (s === 'na') na += 1;
  }
  const total = items.length;
  const open = total - done - na;
  return { total, done, na, open, complete: total > 0 && open === 0 };
};

// ---------------------------------------------------------------------------
// Template scope (migration 120) — the author's readiness gate, deliberately a
// separate record from the per-manual one above. Same items, same keys, same two
// statuses; a different claim by a different person.
// ---------------------------------------------------------------------------

/** Every confirmation the template author has recorded, keyed by `checklistItemKey`. */
export const getTemplateChecklistState = async (
  templateId: string,
): Promise<Record<string, ChecklistItemState>> => {
  if (!templateId || !isLive) return {};
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_regulatory_checklist_template_state', {
        columns: 'item_key,status,note,updated_by,updated_at',
        where: { template_id: templateId },
        signal,
      }),
      READ_TIMEOUT_MS,
      'getTemplateChecklistState',
    ),
    `${TAG} getTemplateChecklistState`,
  );
  const out: Record<string, ChecklistItemState> = {};
  for (const r of rows) out[r.item_key] = mapRow(r);
  return out;
};

/**
 * Record — or clear — the template author's decision on one item.
 *
 * Not gated on `isFinalized`, matching the regulatory check itself: a released template is
 * the one most worth re-reviewing, and a tick records a review rather than changing content.
 */
export const setTemplateChecklistItemState = async (
  templateId: string,
  key: string,
  status: ChecklistItemStatus | null,
  opts: { note?: string; actor?: string } = {},
): Promise<void> => {
  if (!status) {
    await db.delete('im_regulatory_checklist_template_state', {
      where: { template_id: templateId, item_key: key },
    });
    return;
  }
  await db.upsert('im_regulatory_checklist_template_state', {
    template_id: templateId,
    item_key: key,
    status,
    note: opts.note?.trim() || null,
    ...(opts.actor !== undefined && { updated_by: opts.actor }),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'template_id,item_key' });
};
