/**
 * IM placeholder intake wizard — answer store (migrations 142/143).
 *
 * Generalizes the SKU attribute-value overlay pattern already used for the bound-spec
 * table (`project-sku.service.ts` — `getEffectiveSkuValue` / `collapseSkuAttributeValues`)
 * to the wizard's own answer rows, which carry a status (pending / answered /
 * not_applicable) and a scope (project vs. one SKU) that a bare attribute value never did.
 *
 * `project_ims.placeholder_data` is NOT the source of truth here — `im_placeholder_answers`
 * is. `recomputePlaceholderData` rewrites the flat map from these rows after every answer
 * write so `im-resolver.ts` and everything downstream of it (publish, print, translation
 * memory) keeps reading exactly what it always has, with zero changes on their end. See
 * that function's doc comment for why a non-atomic, idempotent, always-total rewrite is
 * safe without a DB trigger.
 */
import { auth, db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import {
  AdhocPlaceholder,
  CategoryAttribute,
  PlaceholderAnswer,
  PlaceholderAnswerLogAction,
  PlaceholderAnswerLogEntry,
  PlaceholderAnswerScope,
  PlaceholderAnswerSource,
  PlaceholderAnswerStatus,
  WizardQuestion,
} from '../../types';
import { wizardConditionFromRow } from '../../utils/attribute-condition.utils';
import { getAttributesForCategory } from '../../utils';
import { getProjectById } from '../project/project.service';
import { getProjectSkus, collapseSkuAttributeValues } from '../project/project-sku.service';
import { getAttributeRequestsByProject } from '../project/project-attribute-request.service';
import { getCategoryAttributes } from '../compliance/compliance-requirement.service';
import { getIMSections } from './im-section.service';
import { getIMBlocks } from './im-block.service';
// Reuses the registry-lint's own section-scanning logic (im-content.utils.ts, wizard plan
// §3) rather than a second copy of "which placeholders/tokens does this section reference" —
// the one cross-layer (services → pages) import in this file, kept narrow (one pure helper
// + its structural type) and deliberate: duplicating DOM-walking logic here would drift the
// moment either copy changed.
import { collectSectionInputs, type BlocksById } from '../../pages/im/project-im-generator/im-content.utils';

// ---------------------------------------------------------------------------
// Row mappers — snake_case DB row -> camelCase type (see mapProjectSku, project-sku.service.ts:12)
// ---------------------------------------------------------------------------

export const mapPlaceholderAnswer = (r: any): PlaceholderAnswer => ({
  id: r.id,
  projectImId: r.project_im_id,
  placeholderKey: r.placeholder_key,
  scope: r.scope,
  projectSkuId: r.project_sku_id ?? null,
  status: r.status,
  value: r.value ?? null,
  source: r.source,
  skippedThenFilled: r.skipped_then_filled ?? false,
  answeredBy: r.answered_by ?? null,
  answeredAt: r.answered_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const mapAdhocPlaceholder = (r: any): AdhocPlaceholder => ({
  id: r.id,
  templateId: r.template_id,
  placeholderId: r.placeholder_id,
  label: r.label ?? '',
  type: r.type === 'image' ? 'image' : 'text',
  wizardTier: r.wizard_tier ?? 'optional',
  wizardHint: r.wizard_hint ?? null,
  wizardNote: r.wizard_note ?? null,
  wizardDefaultValue: r.wizard_default_value ?? null,
  wizardCondition: wizardConditionFromRow(r),
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const mapPlaceholderAnswerLogEntry = (r: any): PlaceholderAnswerLogEntry => ({
  id: r.id,
  projectImId: r.project_im_id ?? null,
  projectSkuId: r.project_sku_id ?? null,
  skuNumberSnapshot: r.sku_number_snapshot ?? '',
  placeholderKey: r.placeholder_key,
  scope: r.scope,
  action: r.action,
  oldValue: r.old_value ?? null,
  newValue: r.new_value ?? null,
  oldStatus: r.old_status ?? null,
  newStatus: r.new_status,
  changedBy: r.changed_by ?? null,
  changedByName: r.changed_by_name ?? '',
  createdAt: r.created_at,
});

// ---------------------------------------------------------------------------
// Overlay pattern — generalizes getEffectiveSkuValue / collapseSkuAttributeValues
// (project-sku.service.ts:112/131) from "SKU value vs. supplier submission" to
// "SKU-scope answer vs. project-scope answer". Pure — no DB access — so both are
// unit-tested directly (see im-placeholder-answer.service.test.ts), same convention as
// project-sku.service.test.ts.
// ---------------------------------------------------------------------------

/**
 * Effective value for one placeholder on one SKU: an ANSWERED sku-scope row overlays an
 * ANSWERED project-scope row. Unlike `getEffectiveSkuValue` there is no "latest submission"
 * sort to do — the partial unique indexes on `im_placeholder_answers` guarantee at most one
 * current row per (manual, key, scope[, sku]), so whichever row exists already IS the
 * current one. Returns '' when neither scope has an answered row (pending/not_applicable
 * never contribute a value).
 */
export const getEffectivePlaceholderValue = (
  projectSkuId: string,
  answers: PlaceholderAnswer[],
  placeholderKey: string,
): string => {
  const skuRow = answers.find(
    (a) => a.scope === 'sku' && a.projectSkuId === projectSkuId && a.placeholderKey === placeholderKey && a.status === 'answered',
  );
  if (skuRow) return skuRow.value ?? '';
  const projectRow = answers.find(
    (a) => a.scope === 'project' && a.placeholderKey === placeholderKey && a.status === 'answered',
  );
  return projectRow?.value ?? '';
};

/**
 * Collapse one placeholder's per-SKU effective values into a single display string —
 * generalizes `collapseSkuAttributeValues`'s per-attribute inner loop. Text/number keys:
 * distinct non-empty values joined with ", " (a single value when every bound SKU agrees).
 * Image keys (in `imageTypeKeys`): the first non-empty value, since image markup can't be
 * joined. Returns '' for an empty SKU list or when no bound SKU has an effective value.
 */
export const collapsePlaceholderAnswers = (
  boundSkuIds: string[],
  answers: PlaceholderAnswer[],
  placeholderKey: string,
  imageTypeKeys?: Set<string>,
): string => {
  if (boundSkuIds.length === 0) return '';
  const values = boundSkuIds
    .map((skuId) => getEffectivePlaceholderValue(skuId, answers, placeholderKey).trim())
    .filter(Boolean);
  if (values.length === 0) return '';
  if (imageTypeKeys?.has(placeholderKey)) return values[0];
  return Array.from(new Set(values)).join(', ');
};

// ---------------------------------------------------------------------------
// saveWizardAnswer — the wizard's single write path
// ---------------------------------------------------------------------------

export interface SaveWizardAnswerInput {
  value: string | null;
  status: PlaceholderAnswerStatus;
  source: PlaceholderAnswerSource;
  scope: PlaceholderAnswerScope;
  /** Required when scope === 'sku'; ignored (and cleared) for scope === 'project'. */
  projectSkuId?: string | null;
  changedBy?: string | null;
  changedByName?: string;
}

/**
 * Maps an old→new status transition to the log's `action` vocabulary.
 *
 *  - ...->'not_applicable'        = 'mark_not_applicable'
 *  - ...->'answered', first time  = 'answer'   (no prior row, or prior row was pending/not_applicable)
 *  - 'answered'->'answered'       = 'update'   (an already-answered value is being edited)
 *  - 'answered'->'pending'        = 'clear'    (the only reason to revert an answered value)
 *  - 'not_applicable'->'pending'  = 'unskip'   (reopening a question marked not applicable)
 *  - (none|'pending')->'pending'  = 'skip'
 *
 * Exported so the mapping itself is unit-testable independent of any DB call.
 */
export const inferAnswerAction = (
  oldStatus: PlaceholderAnswerStatus | undefined,
  newStatus: PlaceholderAnswerStatus,
): PlaceholderAnswerLogAction => {
  if (newStatus === 'not_applicable') return 'mark_not_applicable';
  if (newStatus === 'answered') return oldStatus === 'answered' ? 'update' : 'answer';
  // newStatus === 'pending'
  if (oldStatus === 'answered') return 'clear';
  if (oldStatus === 'not_applicable') return 'unskip';
  return 'skip';
};

/**
 * Upsert the current-state answer row and append one audit-log row, then recompute
 * `project_ims.placeholder_data` so every existing reader sees the change immediately.
 *
 * Checks `project_ims.is_finalized` FIRST and rejects before writing anything — the
 * existing finalize-lock trigger on `project_ims` cannot be relied on to fail last, because
 * this function writes to a DIFFERENT table (`im_placeholder_answers`) that carries no such
 * guard of its own (see the plan's "is_finalized ordering" risk note).
 *
 * `im_placeholder_answers` cannot be written via `db.upsert`/`onConflict`: both of its
 * unique indexes are PARTIAL (`WHERE scope = 'project'` / `WHERE scope = 'sku'`), and
 * PostgREST's `on_conflict` takes column names only — it cannot infer a partial index
 * (the same constraint recorded against `im_leaflet_issues` in migration 132). So this reads
 * the existing row by its natural key first, then inserts or updates by id, exactly like
 * `leaflet-coverage.service.ts` already does for the same reason.
 */
export const saveWizardAnswer = async (
  projectImId: string,
  placeholderKey: string,
  input: SaveWizardAnswerInput,
): Promise<PlaceholderAnswer> => {
  if (!isLive) throw new Error('Database not configured.');
  if (input.scope === 'sku' && !input.projectSkuId) {
    throw new Error('saveWizardAnswer: a sku-scope answer requires projectSkuId.');
  }

  const projectIm = await db.selectMaybeOne<{ id: string; is_finalized?: boolean }>('project_ims', {
    columns: 'id, is_finalized',
    where: { id: projectImId },
  });
  if (!projectIm) throw new Error('saveWizardAnswer: no such manual.');
  if (projectIm.is_finalized) {
    throw new Error('This manual is marked FINAL — unlock it before changing wizard answers.');
  }

  const where: Row = input.scope === 'sku'
    ? { project_im_id: projectImId, placeholder_key: placeholderKey, scope: 'sku', project_sku_id: input.projectSkuId }
    : { project_im_id: projectImId, placeholder_key: placeholderKey, scope: 'project' };

  const existingRow = await db.selectMaybeOne<Row>('im_placeholder_answers', { where });
  const existing = existingRow ? mapPlaceholderAnswer(existingRow) : null;
  const oldStatus = existing?.status;
  const oldValue = existing?.value ?? null;
  const newValue = input.value ?? null;
  const now = new Date().toISOString();

  const payload: Row = {
    project_im_id: projectImId,
    placeholder_key: placeholderKey,
    scope: input.scope,
    project_sku_id: input.scope === 'sku' ? input.projectSkuId : null,
    status: input.status,
    value: newValue,
    source: input.source,
    updated_at: now,
    // Sticky once true: an earlier answer-after-pending must not un-flip on a later edit.
    skipped_then_filled: existing?.skippedThenFilled || (oldStatus === 'pending' && input.status === 'answered'),
  };
  if (input.status === 'answered') {
    payload.answered_by = input.changedBy ?? null;
    payload.answered_at = now;
  }

  const saved = existing
    ? await db.update<Row>('im_placeholder_answers', payload, { where: { id: existing.id } })
    : await db.insert<Row>('im_placeholder_answers', payload);

  // Best-effort denormalised label for the log row — never blocks the save itself.
  let skuNumberSnapshot = '';
  if (input.scope === 'sku' && input.projectSkuId) {
    try {
      const skuRow = await db.selectMaybeOne<{ sku_number?: string }>('project_skus', {
        columns: 'sku_number',
        where: { id: input.projectSkuId },
      });
      skuNumberSnapshot = skuRow?.sku_number ?? '';
    } catch { /* denormalised label only — never blocks the save */ }
  }

  await db.insert('im_placeholder_answer_log', {
    project_im_id: projectImId,
    project_sku_id: input.scope === 'sku' ? input.projectSkuId : null,
    sku_number_snapshot: skuNumberSnapshot,
    placeholder_key: placeholderKey,
    scope: input.scope,
    action: inferAnswerAction(oldStatus, input.status),
    old_value: oldValue,
    new_value: newValue,
    old_status: oldStatus ?? null,
    new_status: input.status,
    changed_by: input.changedBy ?? null,
    changed_by_name: input.changedByName ?? '',
    created_at: now,
  });

  await recomputePlaceholderData(projectImId);

  return mapPlaceholderAnswer(saved);
};

// ---------------------------------------------------------------------------
// recomputePlaceholderData — keeps project_ims.placeholder_data in sync (plan §6)
// ---------------------------------------------------------------------------

const META_PREFIXES = ['cond_', 'secvis_', 'refvis_', '__meta_'];

/**
 * Rebuilds `project_ims.placeholder_data`, but ONLY for the keys this function actually
 * owns — everything else survives untouched:
 *
 *   collapseSkuAttributeValues(...)                                   // existing floor, unchanged
 *   ⊕ { [key]: value for ANSWERED project-scope rows }                // overlay
 *   ⊕ { [key]: collapsePlaceholderAnswers(...) for keys with sku-scope answers } // overlay again
 *
 * `ownedKeys` is the union of the floor's own keys (every attribute id
 * `collapseSkuAttributeValues` derives from bound-SKU data, plus SKU_ATTRIBUTE_ID) and every
 * placeholder key that has EVER had an answer row — answered, pending, or not_applicable.
 * That second half matters: a key whose answer was just CLEARED (status back to pending,
 * value null) still counts as owned, so its stale recomputed value is DROPPED below rather
 * than left behind — that is what makes "clear this answer" actually clear the flat value,
 * not just fail to refresh it.
 *
 * Everything NOT in `ownedKeys` — `__required_languages`, `__language_order`,
 * `__printed_languages`, `__field_bindings`, `__custom_logo`, `__custom_footer`,
 * `__cover_title` (see ProjectIMGenerator.tsx's COPYABLE_META_KEYS/__field_bindings and
 * PrintExportDialog.tsx's __cover_title), any cond_/secvis_/refvis_/__meta_* key (still
 * guarded explicitly below in case one were ever to collide with an owned key), and any
 * ad-hoc/PM-typed value for a placeholder this function has no answer row for (a legacy
 * `im_adhoc_placeholders`-less chip, or an attribute never referenced by any section) —
 * survives verbatim. Before this rewrite, step 4 copied forward ONLY the
 * cond_/secvis_/refvis_/__meta_* keys, silently destroying every other key in that list the
 * moment the wizard's first answer was saved.
 *
 * Always a full, idempotent rewrite of the OWNED keys — never a delta — which is what makes
 * this safe without a transaction: `DatabasePort` has no client-side transaction primitive,
 * so the read-then-write here is still two calls. The window between them is narrowed as far
 * as it can be without one: `existingData` is re-read immediately before the final
 * `db.update` below (not once at the top, alongside the project/SKU/answer fan-out above,
 * which can take a few hundred ms) so a concurrent write to a NON-owned key — the
 * generator's own 4s autosave, or the print dialog's cover-preference patch — lands first and
 * is merged onto rather than clobbered. The residual race (a write landing in the gap
 * between that re-read and the update below) is bounded to a single round trip and is safe:
 * it can only ever affect non-owned keys, since owned keys are always fully recomputed from
 * this function's own inputs above, never merged from the stale read — and the next write of
 * either kind self-heals it, same as the rest of this function's idempotent-rewrite design.
 */
export const recomputePlaceholderData = async (projectImId: string): Promise<void> => {
  if (!isLive) return;

  const projectImRow = await db.selectOne<Row>('project_ims', {
    columns: 'project_id, bound_sku_ids',
    where: { id: projectImId },
  });
  const projectId: string = projectImRow.project_id;

  const [answerRows, projectSkus, attrRequests, allAttributes] = await Promise.all([
    orEmpty(
      db.select<Row>('im_placeholder_answers', { where: { project_im_id: projectImId } }),
      'recomputePlaceholderData answers',
    ),
    getProjectSkus(projectId),
    getAttributeRequestsByProject(projectId),
    getCategoryAttributes(),
  ]);
  const answers = answerRows.map(mapPlaceholderAnswer);
  const imageAttrIds = new Set(allAttributes.filter((a) => a.dataType === 'image').map((a) => a.id));

  // Bound SKUs, falling back to every project SKU when nothing is bound — the same
  // "empty = all" convention project_ims.bound_sku_ids already uses everywhere else.
  const boundSkuIdList: string[] = projectImRow.bound_sku_ids ?? [];
  const bound = boundSkuIdList.length ? projectSkus.filter((s) => boundSkuIdList.includes(s.id)) : projectSkus;
  const effectiveSkus = bound.length ? bound : projectSkus;
  const effectiveSkuIds = effectiveSkus.map((s) => s.id);

  // 1. Existing floor — unchanged from today's resolution.
  const floor = collapseSkuAttributeValues(effectiveSkus, attrRequests, imageAttrIds);
  const next: Record<string, string> = { ...floor };

  // 2. Overlay every answered project-scope row.
  for (const a of answers) {
    if (a.scope === 'project' && a.status === 'answered' && a.value) {
      next[a.placeholderKey] = a.value;
    }
  }

  // 3. Overlay again with each key's sku-scope answers, collapsed across the bound SKUs.
  const skuScopedKeys = new Set(answers.filter((a) => a.scope === 'sku').map((a) => a.placeholderKey));
  for (const key of skuScopedKeys) {
    const collapsed = collapsePlaceholderAnswers(effectiveSkuIds, answers, key, imageAttrIds);
    if (collapsed) next[key] = collapsed;
  }

  // The exact set of keys this function has authority to (re)write — see the doc comment.
  const ownedKeys = new Set<string>([
    ...Object.keys(floor),
    ...answers.map((a) => a.placeholderKey),
  ]);

  // Race-narrowing re-read (see doc comment) — merge onto the freshest copy of the row's
  // placeholder_data, not the one that would have been read at the top of this function
  // before the project/SKU/answer fan-out above.
  const freshRow = await db.selectOne<Row>('project_ims', {
    columns: 'placeholder_data',
    where: { id: projectImId },
  });
  const existingData: Record<string, string> = freshRow.placeholder_data ?? {};

  const merged: Record<string, string> = {};
  // 4. Everything NOT owned survives verbatim.
  for (const [k, v] of Object.entries(existingData)) {
    if (!ownedKeys.has(k)) merged[k] = v;
  }
  // 5. Owned keys take only the freshly recomputed value — an owned key absent from `next`
  //    (its answer was cleared, and the SKU floor doesn't supply one either) is correctly
  //    dropped instead of resurrected from the stale read.
  Object.assign(merged, next);
  // 6. Explicit guard: cond_/secvis_/refvis_/__meta_* keys are owned by the old "Fill
  //    values" tab, never by this function — preserved even in the case one were ever to
  //    collide with an attribute id or placeholder key recomputed above.
  for (const [k, v] of Object.entries(existingData)) {
    if (META_PREFIXES.some((p) => k.startsWith(p))) merged[k] = v;
  }

  // Stamp `updated_by` with the acting user — the same source saveProjectIM uses — so this
  // write doesn't read as a foreign edit to the concurrency check in project-im.service.ts
  // (saveProjectIM only throws ProjectIMConflictError when the LAST writer differs from the
  // current user; leaving updated_by unset here made every recompute look like a foreign
  // write, so the user's very next autosave could spuriously see drift and throw).
  const user = await auth.getUser();
  const updatedBy = user?.email ?? user?.id ?? null;

  await db.update(
    'project_ims',
    { placeholder_data: merged, updated_at: new Date().toISOString(), updated_by: updatedBy },
    { where: { id: projectImId } },
  );
};

// ---------------------------------------------------------------------------
// getWizardQuestions — the merged, ordered question list (plan §4/§7)
// ---------------------------------------------------------------------------

/**
 * Builds the wizard's question list for one manual: every attribute-bound and ad-hoc
 * placeholder the template's sections actually reference (retired/unreferenced registry
 * rows are silently excluded — see the plan's "template edited after SKUs already have
 * answers" risk note), each carrying its tier/hint/dependency, which sections it appears
 * in, and its current answer (scoped to `projectSkuId` when given, else project-scope).
 *
 * Lazy hydration (plan §7): a question with a non-empty value already in
 * `project_ims.placeholder_data` but no answer row yet gets one inserted here
 * (`status: 'answered', source: 'carried_over'`) before the list is returned — there is no
 * migration-time backfill job.
 */
export const getWizardQuestions = async (
  templateId: string,
  projectId: string,
  projectSkuId?: string,
): Promise<WizardQuestion[]> => {
  if (!isLive) return [];

  const [project, sections, blocks, allAttributes, adhocRows, projectImRow] = await Promise.all([
    getProjectById(projectId),
    getIMSections(templateId),
    getIMBlocks(),
    getCategoryAttributes(),
    orEmpty(
      db.select<Row>('im_adhoc_placeholders', {
        where: { template_id: templateId },
        order: { column: 'sort_order', ascending: true },
      }),
      'getWizardQuestions adhoc',
    ),
    db.selectMaybeOne<Row>('project_ims', {
      columns: 'id, placeholder_data',
      where: { project_id: projectId, template_id: templateId },
    }),
  ]);

  const blocksById: BlocksById = {};
  for (const b of blocks) blocksById[b.id] = { content: b.content };

  const categoryId = project?.categoryId ?? null;
  // Registry order: attribute sort_order (getCategoryAttributes already sorts by group then
  // sort_order then name), then ad-hoc sort_order — each source's own authoring order.
  const categoryAttrs = categoryId ? getAttributesForCategory(allAttributes, categoryId) : allAttributes;
  const adhocPlaceholders = adhocRows.map(mapAdhocPlaceholder);

  // Which sections reference which key — findUnregisteredPlaceholders's own fragment-
  // collection logic, inverted: build the map instead of reporting misses against it.
  const sectionIdsByKey: Record<string, string[]> = {};
  for (const section of sections) {
    const { items, attrTokens } = collectSectionInputs(section, 'en', blocksById);
    const keysInSection = new Set<string>();
    for (const it of items) if (it.kind === 'placeholder') keysInSection.add(it.id);
    for (const tok of attrTokens) keysInSection.add(tok);
    for (const key of keysInSection) (sectionIdsByKey[key] ??= []).push(section.id);
  }

  const projectImId: string | undefined = projectImRow?.id;
  let answers = projectImId
    ? (await orEmpty(
        db.select<Row>('im_placeholder_answers', { where: { project_im_id: projectImId } }),
        'getWizardQuestions answers',
      )).map(mapPlaceholderAnswer)
    : [];

  // Only registry rows this template's sections actually use become questions.
  const candidates: Array<{ key: string; origin: 'attribute' | 'adhoc' }> = [
    ...categoryAttrs
      .filter((a) => (sectionIdsByKey[a.id]?.length ?? 0) > 0)
      .map((a) => ({ key: a.id, origin: 'attribute' as const })),
    ...adhocPlaceholders
      .filter((p) => (sectionIdsByKey[p.placeholderId]?.length ?? 0) > 0)
      .map((p) => ({ key: p.placeholderId, origin: 'adhoc' as const })),
  ];

  if (projectImId) {
    const placeholderData: Record<string, string> = projectImRow?.placeholder_data ?? {};
    const now = new Date().toISOString();
    const toInsert: Row[] = [];
    for (const c of candidates) {
      const hasProjectAnswer = answers.some((a) => a.scope === 'project' && a.placeholderKey === c.key);
      if (hasProjectAnswer) continue;
      const flatValue = placeholderData[c.key];
      if (!flatValue || !flatValue.trim()) continue;
      toInsert.push({
        project_im_id: projectImId,
        placeholder_key: c.key,
        scope: 'project',
        status: 'answered',
        value: flatValue,
        source: 'carried_over',
        created_at: now,
        updated_at: now,
      });
    }
    if (toInsert.length) {
      await db.insertMany('im_placeholder_answers', toInsert);
      answers = answers.concat(toInsert.map(mapPlaceholderAnswer));
    }
  }

  const currentAnswerFor = (key: string): PlaceholderAnswer | null => {
    if (projectSkuId) {
      const skuRow = answers.find((a) => a.scope === 'sku' && a.projectSkuId === projectSkuId && a.placeholderKey === key);
      if (skuRow) return skuRow;
    }
    return answers.find((a) => a.scope === 'project' && a.placeholderKey === key) ?? null;
  };

  const attrById: Record<string, CategoryAttribute> = {};
  for (const a of categoryAttrs) attrById[a.id] = a;
  const adhocByKey: Record<string, AdhocPlaceholder> = {};
  for (const p of adhocPlaceholders) adhocByKey[p.placeholderId] = p;

  return candidates.map((c): WizardQuestion => {
    if (c.origin === 'attribute') {
      const attr = attrById[c.key];
      return {
        key: attr.id,
        origin: 'attribute',
        label: attr.name,
        type: attr.dataType,
        tier: attr.wizardTier ?? 'optional',
        hint: attr.wizardHint ?? null,
        note: attr.wizardNote ?? null,
        defaultValue: attr.wizardDefaultValue ?? null,
        condition: attr.wizardCondition ?? null,
        attribute: attr,
        sectionIds: sectionIdsByKey[attr.id] ?? [],
        currentAnswer: currentAnswerFor(attr.id),
      };
    }
    const p = adhocByKey[c.key];
    return {
      key: p.placeholderId,
      origin: 'adhoc',
      label: p.label,
      type: p.type,
      tier: p.wizardTier,
      hint: p.wizardHint ?? null,
      note: p.wizardNote ?? null,
      defaultValue: p.wizardDefaultValue ?? null,
      condition: p.wizardCondition ?? null,
      sectionIds: sectionIdsByKey[p.placeholderId] ?? [],
      currentAnswer: currentAnswerFor(p.placeholderId),
    };
  });
};
