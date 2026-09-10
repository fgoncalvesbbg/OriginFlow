/**
 * Compliance requirement service
 * Manages compliance requirements and category attributes
 */

import { db, portalDb, orEmpty, mustRead, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ComplianceRequirement, ComplianceSection, CategoryAttribute, AttributeDataType } from '../../types';
import { generateUUID } from '../../utils';
import { PREDEFINED_ATTRIBUTE_GROUPS, compareAttributes } from '../../config/compliance.constants';
import type { ParsedAttributeRow } from '../../utils/attribute-csv-import.utils';
import { wizardConditionFromRow } from '../../utils/attribute-condition.utils';
import { buildSyncWrite, resolvesToGlobal, planAttributeSync, type SyncPlan, type SyncItem, type AttributeUsage } from './attribute-sync-plan';

/**
 * Get all compliance requirements
 */
const mapComplianceRequirementRows = (rows: any[]): ComplianceRequirement[] =>
    rows.map((r: any) => ({
        ...r,
        categoryId: r.category_id,
        assignedCategoryIds: r.assigned_category_ids ?? [],
        excludedCategoryIds: r.excluded_category_ids ?? [],
        condition: r.condition ?? null,
        conditionFeatureIds: r.condition_feature_ids,
        referenceCode: r.reference_code,
        regulationId: r.regulation_id ?? null,
        clauseId: r.clause_id ?? null,
        isMandatory: r.is_mandatory,
        appliesByDefault: r.applies_by_default,
        sortOrder: r.sort_order ?? 0,
        timingType: r.timing_type,
        timingWeeks: r.timing_weeks,
        selfDeclarationAccepted: r.self_declaration_accepted,
        testReportOrigin: r.test_report_origin
    }));

export const getComplianceRequirements = async (): Promise<ComplianceRequirement[]> => {
    if (!isLive) return [];
    // A deterministic base order (migration 175). `groupRequirementsBySection` re-sorts with
    // the sections list, which it needs and this read does not have — but anything that reads
    // requirements WITHOUT that helper now gets a defined list instead of Postgres's whim.
    const rows = await orEmpty(
        portalDb.select<Row>('compliance_requirements', {
            order: [
                { column: 'sort_order', ascending: true },
                { column: 'title', ascending: true },
            ],
        }),
        'getComplianceRequirements',
    );
    return mapComplianceRequirementRows(rows);
};

/**
 * Non-degrading read of the same rows. Use this ANYWHERE the result gates a write.
 *
 * `getComplianceRequirements` degrades a failed read to `[]`, which is right for its many
 * display callers and dangerous for a de-duplication check: an empty set reads as
 * "nothing exists yet", so an importer re-creates every requirement it meant to skip.
 * See the TCF requirement loop in regulation-import.service.ts.
 */
export const getComplianceRequirementsOrThrow = async (): Promise<ComplianceRequirement[]> => {
    if (!isLive) return [];
    const rows = await mustRead(portalDb.select<Row>('compliance_requirements'), 'getComplianceRequirementsOrThrow');
    return mapComplianceRequirementRows(rows);
};

/**
 * Save/update a compliance requirement
 */
export const saveRequirement = async (req: ComplianceRequirement): Promise<void> => {
    const payload: Row = {
        id: req.id,
        category_id: req.categoryId,
        // The LINK list (migration 173). Sent on every save, not only when it changed: an
        // upsert that omitted it would preserve whatever the row already had, which is right
        // for a partial edit and wrong here — the modal round-trips the whole requirement, so
        // an omission would silently resurrect a share the operator had just removed.
        assigned_category_ids: req.assignedCategoryIds ?? [],
        // Sent on every save for the same reason as the share list: the modal round-trips the
        // whole requirement, so omitting it would let PostgREST preserve an exclusion the
        // operator had just lifted.
        excluded_category_ids: req.excludedCategoryIds ?? [],
        section: req.section,
        title: req.title,
        description: req.description,
        is_mandatory: req.isMandatory,
        reference_code: req.referenceCode,
        // null, not undefined: unlinking a requirement from its regulation has to reach
        // the database as an explicit NULL, or the upsert silently keeps the old link.
        regulation_id: req.regulationId ?? null,
        // Cleared whenever the regulation changes, so a requirement can never cite a clause
        // belonging to a different document — there is no composite FK to catch that.
        clause_id: req.regulationId ? (req.clauseId ?? null) : null,
        applies_by_default: req.appliesByDefault,
        sort_order: req.sortOrder ?? 0,
        condition: req.condition ?? null,
        timing_type: req.timingType,
        timing_weeks: req.timingWeeks,
        self_declaration_accepted: req.selfDeclarationAccepted,
        test_report_origin: req.testReportOrigin
    };
    await db.upsert('compliance_requirements', payload);
};

/**
 * Delete a compliance requirement
 */
export const deleteRequirement = async (id: string): Promise<void> => {
    await db.delete('compliance_requirements', { where: { id } });
};

/**
 * Every section group, in the operator's order (migration 175).
 *
 * Returns the built-in six as well: they became rows in that migration precisely so they could
 * be reordered, and a caller that had to merge a constant with a table would be back to two
 * sources of truth for one list. `isBuiltIn` is how the library still tells them apart.
 */
export const getComplianceSections = async (): Promise<ComplianceSection[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        portalDb.select<Row>('compliance_sections', {
            order: [
                { column: 'sort_order', ascending: true },
                { column: 'created_at', ascending: true },
            ],
        }),
        'getComplianceSections',
    );
    return rows.map((s: any): ComplianceSection => ({
        name: s.name,
        sortOrder: s.sort_order ?? 0,
        isBuiltIn: s.is_builtin === true,
    }));
};

/**
 * Define a new section group (no-op if it already exists). Once added it is
 * offered for requirements in every category.
 *
 * Appended to the END of the list rather than left at the column default of 0, where every
 * custom section used to pile up and tie — which is how the library (creation order) and the
 * three other surfaces (alphabetical) came to disagree about where a custom section goes.
 */
export const addComplianceSection = async (name: string): Promise<void> => {
    const clean = name.trim();
    if (!clean) return;
    const existing = await getComplianceSections();
    if (existing.some(s => s.name.toLowerCase() === clean.toLowerCase())) return;
    const nextOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;
    await db.upsert(
        'compliance_sections',
        { name: clean, sort_order: nextOrder },
        { onConflict: 'name' },
    );
};

/**
 * Write a new section order. `orderedNames` is the whole list, top to bottom.
 *
 * Only the rows whose position actually changed are written — dragging one section otherwise
 * rewrites all eight. Sequential from 0, so the stored numbers stay contiguous and a later
 * insert-at-end is just `max + 1`.
 */
export const reorderComplianceSections = async (orderedNames: readonly string[]): Promise<void> => {
    if (!isLive) throw new Error('Database not configured.');
    const current = await getComplianceSections();
    const currentByName = new Map(current.map(s => [s.name, s.sortOrder]));
    for (const [index, name] of orderedNames.entries()) {
        if (currentByName.get(name) === index) continue;
        await db.updateWhere('compliance_sections', { sort_order: index }, { where: { name } });
    }
};

/**
 * Write a new requirement order within a section. `orderedIds` is the whole visible list.
 *
 * Writes one column and nothing else, which is what lets the history trigger recognise a pure
 * reorder and stay quiet about it (migration 175) — an `update` that also touched, say, the
 * title would be logged in full.
 *
 * Does not degrade: a half-applied reorder leaves a list in an order nobody chose, and the
 * caller reloads from the database afterwards so a failure is visible rather than cosmetic.
 */
export const reorderRequirements = async (
    plan: readonly { id: string; sortOrder: number }[],
): Promise<void> => {
    if (!isLive) throw new Error('Database not configured.');
    for (const item of plan) {
        await db.updateWhere(
            'compliance_requirements',
            { sort_order: item.sortOrder },
            { where: { id: item.id } },
        );
    }
};

/**
 * Remove a custom section group (does not touch requirements already using it).
 */
export const deleteComplianceSection = async (name: string): Promise<void> => {
    await db.delete('compliance_sections', { where: { name } });
};

/**
 * Add the two standard electrical-safety requirements to a category.
 *
 * DERIVED FROM THE REGULATION LIBRARY, not hardcoded alongside it. The pair used to be
 * created with no `regulationId` at all, which is the state the library now refuses for a
 * hand-written requirement — a preload that quietly seeded two unlinked rows would have been
 * a hole in that rule rather than an exception to it.
 *
 * So the regulations are looked up by reference code, and if the library does not have them
 * this REFUSES rather than falling back to unlinked rows. The message names what to add,
 * because "nothing happened" is the one outcome that teaches nobody anything.
 *
 * The reference codes are the EU directives' own identifiers, which is why matching on them
 * is safe: they are the stable part. The `title` a regulation carries is the full official
 * name and varies with how it was imported.
 */
export const addStandardRequirements = async (categoryId: string): Promise<void> => {
    const wanted = [
        { code: 'Directive 2014/35/EU', title: 'LVD Report', description: 'Low Voltage Directive compliance' },
        { code: 'Directive 2014/30/EU', title: 'EMC Report', description: 'Electromagnetic compatibility' },
    ];

    const regulations = await orEmpty(
        portalDb.select<Row>('regulations', { columns: 'id, reference_code' }),
        'addStandardRequirements.regulations',
    );
    const idByCode = new Map<string, string>(
        regulations.map((r: any) => [String(r.reference_code).trim().toLowerCase(), r.id as string]),
    );

    const missing = wanted.filter(w => !idByCode.has(w.code.toLowerCase()));
    if (missing.length > 0) {
        throw new Error(
            `The Regulation library is missing ${missing.map(m => m.code).join(' and ')}. `
            + 'Add them there first — every requirement has to cite the regulation it derives from.',
        );
    }

    // Appended in order, so the two land at the end of the section rather than tying on 0.
    const existing = await getComplianceRequirementsOrThrow();
    let order = existing
        .filter(r => r.categoryId === categoryId && !r.section)
        .reduce((max, r) => Math.max(max, r.sortOrder ?? 0), -1) + 1;

    for (const w of wanted) {
        await saveRequirement({
            id: generateUUID(),
            categoryId,
            title: w.title,
            description: w.description,
            isMandatory: true,
            appliesByDefault: true,
            regulationId: idByCode.get(w.code.toLowerCase()) ?? null,
            sortOrder: order++,
            conditionFeatureIds: [],
        });
    }
};

const mapCategoryAttributeRow = (a: any): CategoryAttribute => ({
    id: a.id,
    categoryId: a.category_id ?? null,
    assignedCategoryIds: a.assigned_category_ids ?? [],
    name: a.name,
    dataType: (a.data_type === 'number' ? 'decimal' : (a.data_type || 'text')) as AttributeDataType,
    validationRules: a.validation_rules ?? undefined,
    group: a.group ?? 'Category Specific',
    akeneoId: a.akeneo_id ?? undefined,
    // Absent column or NULL reads as visible: the flag only ever hides on purpose.
    supplierVisible: a.supplier_visible !== false,
    sortOrder: a.sort_order ?? 0,
    ptAttributeId: a.pt_attribute_id ?? null,
    eprelId: a.eprel_id ?? null,
    // Placeholder intake wizard registry (migration 142). Absent column reads as
    // 'optional'/undefined — no existing attribute is retroactively gated.
    wizardTier: a.wizard_tier ?? undefined,
    wizardHint: a.wizard_hint ?? null,
    wizardNote: a.wizard_note ?? null,
    wizardDefaultValue: a.wizard_default_value ?? null,
    wizardCondition: wizardConditionFromRow(a),
});

/**
 * Get all category attributes
 */
export const getCategoryAttributes = async (): Promise<CategoryAttribute[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(portalDb.select<Row>('category_attributes'), 'getCategoryAttributes');
    // Sorted once here so every consumer gets the same order without re-sorting.
    return rows.map(mapCategoryAttributeRow).sort(compareAttributes);
};

/**
 * Same read as getCategoryAttributes, but the failure is NOT degraded to an empty list.
 *
 * For callers about to WRITE based on "what already exists" — importCategoryAttributes and
 * replaceCategoryAttributes both match incoming rows against this list before deciding what
 * to create. A failed read masquerading as "no attributes exist yet" makes every incoming
 * row look new: importCategoryAttributes would create duplicates instead of reusing/linking
 * existing ones, and replaceCategoryAttributes would both duplicate-create AND treat nothing
 * as "still in the definition" (since its own diffing also depends on this same list read
 * elsewhere) — the same find-or-create failure mode Bug 1 exists to close, just on this table.
 * Kept private and used only by those two writers; every other caller (there are many, all
 * display) keeps the fault-tolerant getCategoryAttributes().
 */
const getCategoryAttributesOrThrow = async (): Promise<CategoryAttribute[]> => {
    if (!isLive) return [];
    const rows = await mustRead(portalDb.select<Row>('category_attributes'), 'getCategoryAttributes:for-write');
    return rows.map(mapCategoryAttributeRow).sort(compareAttributes);
};

/**
 * Save/update a category attribute
 */
export const saveCategoryAttribute = async (
    attr: CategoryAttribute,
    opts: { forceScope?: 'global' | 'category' } = {},
): Promise<void> => {
    // OriginFlow's own rule is "a predefined group is global". ProductToolkit decouples the
    // two — it has a `scope` per attribute that is independent of its cluster — so a sync
    // needs to be able to say "category-scoped even though the group is a predefined one".
    // categoryId is the actual source of truth everywhere (getAttributesForCategory and the
    // Global/Shared badges all read it), so overriding it here is safe; the group is left
    // alone so the attribute still displays under its real cluster.
    const isPredefinedGroup = !!attr.group && PREDEFINED_ATTRIBUTE_GROUPS.includes(attr.group);
    const intendedCategoryId = opts.forceScope
        ? (opts.forceScope === 'global' ? null : (attr.categoryId ?? null))
        : (isPredefinedGroup ? null : (attr.categoryId ?? null));

    // Akeneo ID is the global identity of an attribute — the same code must not exist twice
    // across categories. If a save would introduce a code already owned by another attribute,
    // reuse that attribute instead of creating a duplicate (link it into the intended category,
    // or promote it to global). Editing an attribute's own fields (code unchanged) is untouched.
    const code = attr.akeneoId?.trim();
    if (code) {
        const dup = await reuseExistingByAkeneoId(code, attr.id, intendedCategoryId);
        if (dup) return;
    }

    const payload = {
        id: attr.id,
        category_id: intendedCategoryId,
        assigned_category_ids: attr.assignedCategoryIds ?? [],
        name: attr.name,
        data_type: attr.dataType,
        validation_rules: attr.validationRules ?? null,
        group: attr.group ?? 'Category Specific',
        akeneo_id: attr.akeneoId ?? null,
        supplier_visible: attr.supplierVisible !== false,
        sort_order: attr.sortOrder ?? 0,
        pt_attribute_id: attr.ptAttributeId ?? null,
        eprel_id: attr.eprelId ?? null,
    };
    await db.upsert('category_attributes', payload);
};

/**
 * If an attribute with `code` already exists under a DIFFERENT row than `selfId`, reuse it rather
 * than creating a duplicate: ensure it applies to `intendedCategoryId` (share it in, or promote to
 * global) and return true (caller should skip its own write). Returns false when there is no
 * conflict — i.e. this is the attribute that owns the code, or the code is unused.
 */
const reuseExistingByAkeneoId = async (
    code: string,
    selfId: string,
    intendedCategoryId: string | null,
): Promise<boolean> => {
    let rows: Row[];
    try {
        rows = await db.select<Row>('category_attributes', {
            columns: 'id, category_id, assigned_category_ids',
            where: { akeneo_id: code },
        });
    } catch {
        return false;
    }
    const selfOwnsCode = rows.some((r: any) => r.id === selfId);
    const others = rows.filter((r: any) => r.id !== selfId);
    if (selfOwnsCode || others.length === 0) return false; // no conflict → normal write

    const target = others[0];
    if (intendedCategoryId === null) {
        // Intended global: make the existing attribute global so it applies everywhere.
        if (target.category_id !== null) {
            await db.updateWhere('category_attributes', { category_id: null }, { where: { id: target.id } });
        }
    } else if (target.category_id !== null && target.category_id !== intendedCategoryId) {
        // Existing is scoped to another category: share it into the intended one (no duplicate).
        const assigned: string[] = target.assigned_category_ids ?? [];
        if (!assigned.includes(intendedCategoryId)) {
            await db.updateWhere(
                'category_attributes',
                { assigned_category_ids: [...assigned, intendedCategoryId] },
                { where: { id: target.id } },
            );
        }
    }
    // If target.category_id is null (already global) or already this category, it already applies.
    return true;
};

export interface ImportAttributesResult {
    created: number;
    linked: number;
    skipped: number;
}

/**
 * Bulk-import parsed CSV rows as attributes for a category (see attribute-csv-import.utils).
 *
 * Never duplicates an attribute that already exists — existing definitions are reused as-is:
 *  - Match key depends on the scope. A GLOBAL row (any group but 'Category Specific')
 *    matches on normalized name within its group first, then on the Akeneo code — it must
 *    resolve to a single shared attribute, so it is never created twice however many
 *    categories are imported. A 'Category Specific' row matches on Akeneo code across all
 *    groups, else the normalized name within its group (that name match consumes at most one
 *    existing attribute per run). Note an Akeneo code can only ever belong to ONE attribute:
 *    saveCategoryAttribute enforces it, so sibling rows in a file that share a code all
 *    resolve to the same attribute rather than becoming distinct rows.
 *  - If a match already applies to this category (a global attribute, an attribute owned by
 *    this category, or one already shared into it) → nothing to do (skipped).
 *  - If a match exists but only in ANOTHER category → it is SHARED into this category via
 *    assigned_category_ids (linked), not re-created and not overwritten.
 *  - No match → a new attribute is created (global when the group is predefined, else scoped
 *    to this category).
 *
 * Persisting goes through saveCategoryAttribute / assignAttributeToCategory so the
 * null-category rule and the shared-assignment logic live in one place.
 */
export const importCategoryAttributes = async (
    categoryId: string,
    rows: ParsedAttributeRow[],
): Promise<ImportAttributesResult> => {
    const existing = await getCategoryAttributesOrThrow();
    const norm = (s: string) => (s ?? '').trim().toLowerCase();
    const result: ImportAttributesResult = { created: 0, linked: 0, skipped: 0 };
    const consumedIds = new Set<string>();

    for (const row of rows) {
        if (!row.name?.trim()) { result.skipped++; continue; }

        // PT states scope explicitly; only fall back to inferring it from the group when the
        // source does not say (a CSV row), which is what every pre-existing caller does.
        const isGlobal = row.scope ? row.scope === 'global' : PREDEFINED_ATTRIBUTE_GROUPS.includes(row.group);
        const code = row.akeneoId ? norm(row.akeneoId) : '';

        // Match an existing attribute.
        //
        // Every group except 'Category Specific' is global: one attribute serves every
        // category, so it must never be created twice. Those rows therefore match on name
        // within the group FIRST, and only then on the Akeneo code:
        //  - name-first means a coded incoming row still finds a code-less existing one
        //    (OriginFlow has plenty — all of Product Images, for instance), which a
        //    code-only match would miss and duplicate;
        //  - the code fallback still catches an upstream rename, where the name moved but
        //    the code did not;
        //  - the name match deliberately ignores `consumedIds`, so a second mention of the
        //    same global attribute in one file collapses onto it instead of creating a twin.
        //
        // 'Category Specific' rows keep the original rule — code is the identity across all
        // groups, one existing attribute consumed per row — because those are genuinely
        // per-category and a file may legitimately carry sibling rows sharing a code.
        const byName = (a: CategoryAttribute) =>
            a.group === row.group && norm(a.name) === norm(row.name);
        const byCode = (a: CategoryAttribute) => !!code && norm(a.akeneoId ?? '') === code;
        // pt_attribute_id is unique across the whole table, so it has to be checked before
        // anything else — an upstream rename changes the code, and recreating the row would
        // collide on the index rather than fail gracefully.
        const byPtId = (a: CategoryAttribute) =>
            row.ptAttributeId != null && a.ptAttributeId === row.ptAttributeId;

        // The code match deliberately ignores `consumedIds` in BOTH branches.
        // saveCategoryAttribute already enforces one-attribute-per-code (see
        // reuseExistingByAkeneoId): a second row carrying a code that is already taken is
        // silently not written. Letting such a row fall through to "create" therefore
        // counted a row that never existed, so the reported totals overstated the import.
        // Resolving it to the owning attribute instead makes the counts true.
        const match =
            (row.ptAttributeId != null ? existing.find(byPtId) : undefined) ??
            (isGlobal
                ? (existing.find(byName) ?? existing.find(byCode))
                : (code ? existing.find(byCode) : existing.find(a => !consumedIds.has(a.id) && byName(a))));

        if (match) {
            consumedIds.add(match.id);
            const appliesHere =
                match.categoryId === null ||
                match.categoryId === categoryId ||
                (match.assignedCategoryIds ?? []).includes(categoryId);
            if (appliesHere) {
                result.skipped++;
            } else {
                // Exists in another category — share it in rather than duplicating.
                await assignAttributeToCategory(match.id, categoryId);
                result.linked++;
            }
            continue;
        }

        // No existing attribute — create a fresh one.
        const validationRules: CategoryAttribute['validationRules'] = {};
        if (row.unit) validationRules.unit = row.unit;
        if (row.dataType === 'enum') validationRules.enumOptions = row.enumOptions ?? [];
        // Only ProductToolkit rows carry these; a CSV row never sets them.
        if (row.required) validationRules.required = true;
        if (row.note) validationRules.placeholder = row.note;

        const created: CategoryAttribute = {
            id: generateUUID(),
            categoryId: isGlobal ? null : categoryId,
            assignedCategoryIds: [],
            name: row.name,
            dataType: row.dataType,
            validationRules: Object.keys(validationRules).length ? validationRules : undefined,
            group: row.group,
            akeneoId: row.akeneoId,
            // ProductToolkit definitions carry no notion of supplier visibility, so an
            // imported attribute starts visible and is marked internal by hand.
            supplierVisible: row.supplierVisible !== false,
            // ProductToolkit definitions carry a sortOrder; a CSV row leaves it unset (0).
            sortOrder: row.sortOrder ?? 0,
            ptAttributeId: row.ptAttributeId ?? null,
            eprelId: row.eprelId ?? null,
        };
        await saveCategoryAttribute(created);
        existing.push(created); // so later rows in this run can match it (prevents in-file dupes)
        consumedIds.add(created.id);
        result.created++;
    }

    return result;
};

/**
 * Dependent-record counts per attribute, via the attribute_usage() probe (migration 138).
 * Everything a sync could strand: SKU values, supplier submissions, review flags and IM
 * block conditions. Returns {} rather than throwing if the probe is unavailable — a missing
 * count must not block the review, but the caller should treat {} as "unknown", not "zero".
 */
export const getAttributeUsage = async (
    ids: string[],
): Promise<Record<string, AttributeUsage>> => {
    if (!isLive || ids.length === 0) return {};
    try {
        const rows = await portalDb.rpc<any[]>('attribute_usage', { p_ids: ids });
        const out: Record<string, AttributeUsage> = {};
        for (const r of rows ?? []) {
            out[r.attribute_id] = {
                skuValues: Number(r.sku_values) || 0,
                requestValues: Number(r.request_values) || 0,
                reviewFlags: Number(r.review_flags) || 0,
                imRefs: Number(r.im_refs) || 0,
            };
        }
        return out;
    } catch (e) {
        console.error('getAttributeUsage failed', e);
        return {};
    }
};

export interface ApplySyncResult {
    created: number;
    updated: number;
    skipped: number;
}

/**
 * True when writing `item` would demote an existing GLOBAL attribute to category scope —
 * the 'scope-demotion' risk planAttributeSync flags as 'breaking'. A global already applies
 * to every category, including whichever one is being synced/replaced, so there is nothing
 * to gain by narrowing it — and doing so silently strips it (and every value captured under
 * it) from every OTHER category that relies on it. The fix mirrors how a sibling-owned
 * attribute is already handled: leave ownership alone rather than rewrite it.
 */
const wouldDemoteGlobal = (item: SyncItem): boolean =>
    item.existing?.categoryId === null && !!item.incoming && !resolvesToGlobal(item.incoming);

/**
 * Apply a reviewed ProductToolkit sync plan.
 *
 * Only the items the reviewer ticked are written, and only creates/updates — an 'absent'
 * attribute is never deleted here. Deleting is what strands data, so it stays a deliberate,
 * separate act (the Replace import, or removing the row by hand) rather than something a
 * sync can do on its own.
 *
 * An update writes back to the EXISTING attribute id, so every SKU value, supplier
 * submission, review flag and IM block condition that references it keeps resolving.
 * `forceScope` carries ProductToolkit's own scope through, overriding OriginFlow's
 * "predefined group means global" inference — see saveCategoryAttribute.
 */
export const applyAttributeSync = async (
    plan: SyncPlan,
    categoryId: string,
    includedKeys: Set<string>,
): Promise<ApplySyncResult> => {
    if (!isLive) throw new Error('Database not configured.');
    const result: ApplySyncResult = { created: 0, updated: 0, skipped: 0 };

    for (const item of plan.items) {
        if (!includedKeys.has(item.key) || (item.action !== 'create' && item.action !== 'update')) {
            result.skipped++;
            continue;
        }
        const write = buildSyncWrite(item, categoryId);
        if (!write) { result.skipped++; continue; }

        // Owned by a sibling category: share it in rather than rewriting it. Rewriting would
        // move category_id here, taking the attribute away from the category that owns it.
        const owner = item.existing?.categoryId;
        if (owner && owner !== categoryId) {
            await assignAttributeToCategory(item.existing!.id, categoryId);
            result.updated++;
            continue;
        }

        // Existing is GLOBAL and the incoming row would demote it to this category: it
        // already applies here (and everywhere else), so leave it untouched rather than
        // stripping it from every other category — see wouldDemoteGlobal.
        if (wouldDemoteGlobal(item)) {
            result.updated++;
            continue;
        }

        const isCreate = item.action === 'create';
        await saveCategoryAttribute(
            { ...write, id: write.id || generateUUID() },
            { forceScope: resolvesToGlobal(item.incoming!) ? 'global' : 'category' },
        );
        if (isCreate) result.created++; else result.updated++;
    }
    return result;
};

export interface ReplaceAttributesResult extends ImportAttributesResult {
    /** Attributes owned by this category that were deleted outright. */
    deleted: number;
    /** Attributes owned elsewhere that were un-shared from this category rather than deleted. */
    unshared: number;
    /** Attributes matched to the definition and rewritten in place, keeping their id. */
    updated: number;
    /** Global attributes deleted — only when includeGlobals was asked for. Affects EVERY category. */
    deletedGlobals: number;
    /** Deleted rows, kept so the caller can report (and a human can reverse) what went. */
    removed: { id: string; name: string; akeneoId?: string; wasGlobal: boolean }[];
}

/**
 * Replace a category's attribute set with `rows` — the "the source of truth is upstream,
 * what's here is wrong" import, as opposed to the additive `importCategoryAttributes`.
 *
 * What it clears is deliberately narrower than "everything visible on this category":
 *  - Attributes OWNED by this category (category_id = categoryId) are deleted.
 *  - Attributes owned by another category but SHARED into this one are un-shared, not
 *    deleted — the owning category still needs them.
 *  - GLOBAL attributes (category_id IS NULL, the predefined groups) are left completely
 *    alone. They apply to every category, so deleting one here would silently strip it from
 *    all of them. If the incoming rows carry those codes they resolve as "already here".
 *
 * DESTRUCTIVE AND NOT TRANSACTIONAL. Deletes go through the same per-row REST calls as the
 * rest of this service, so a mid-run failure can leave the category partly cleared — the
 * fix is to re-run, since the import half is idempotent. Values already captured against a
 * deleted attribute are NOT migrated: project_skus.attribute_values entries reference
 * attributeId, there is no foreign key, and a re-import mints new ids. Check a category has
 * no SKU values riding on its attributes before replacing it.
 */
export const replaceCategoryAttributes = async (
    categoryId: string,
    rows: ParsedAttributeRow[],
    opts: { includeGlobals?: boolean } = {},
): Promise<ReplaceAttributesResult> => {
    if (!isLive) throw new Error('Database not configured.');

    // Match FIRST, then remove only what the import does not account for.
    //
    // This used to delete every category-owned attribute and re-import, which handed each one
    // a brand new uuid even when the same attribute came straight back. Every SKU value,
    // supplier submission, review flag and IM condition references an attribute by id, so a
    // Replace silently stranded all of them — the very outcome the sync planner exists to
    // prevent. Reusing the planner keeps ids stable for anything still in the definition.
    const all = await getCategoryAttributesOrThrow();
    const applies = all.filter(a =>
        a.categoryId === categoryId ||
        a.categoryId === null ||
        (a.assignedCategoryIds ?? []).includes(categoryId));

    // Match against EVERY attribute, not just this category's: a PT attribute shared with a
    // sibling category must be linked in, never recreated (its pt_attribute_id is unique).
    const plan = planAttributeSync(all, rows, {}, categoryId);

    // 1. Write everything the definition still contains, in place.
    let created = 0, updated = 0;
    for (const item of plan.items) {
        if (item.action !== 'create' && item.action !== 'update') continue;
        const write = buildSyncWrite(item, categoryId);
        if (!write) continue;

        // An attribute owned by a SIBLING category that this definition also lists: leave its
        // ownership and fields alone and just make sure it is shared in. Rewriting it would
        // move category_id to the importing category and quietly take it away from its owner.
        const owner = item.existing?.categoryId;
        if (owner && owner !== categoryId) {
            await assignAttributeToCategory(item.existing!.id, categoryId);
            updated++;
            continue;
        }

        // Existing is GLOBAL and this definition's row would demote it to category scope
        // (planAttributeSync's 'scope-demotion' breaking risk): it already applies to this
        // category — and every other one — so leave it exactly as it is instead of narrowing
        // it down and silently stripping it from every category that isn't this one.
        if (wouldDemoteGlobal(item)) {
            updated++;
            continue;
        }

        await saveCategoryAttribute(
            { ...write, id: write.id || generateUUID() },
            { forceScope: resolvesToGlobal(item.incoming!) ? 'global' : 'category' },
        );
        if (item.action === 'create') created++; else updated++;
    }

    // 2. Remove what it does not. Anything the planner paired with an incoming row is kept,
    //    however it was matched, so a rename never looks like "delete the old, add a new".
    // Only rows the definition actually accounts for count as matched. An 'absent' item also
    // carries `existing` — it is the attribute the definition DROPPED — so including it here
    // would mark every leftover as matched and quietly delete nothing at all.
    const matched = new Set(
        plan.items
            .filter(i => i.action === 'create' || i.action === 'update' || i.action === 'unchanged')
            .map(i => i.existing?.id)
            .filter(Boolean) as string[],
    );
    const leftovers = applies.filter(a => !matched.has(a.id));

    const removed: ReplaceAttributesResult['removed'] = [];
    let deleted = 0, unshared = 0, deletedGlobals = 0;

    for (const a of leftovers) {
        if (a.categoryId === categoryId) {
            await deleteCategoryAttribute(a.id);
            removed.push({ id: a.id, name: a.name, akeneoId: a.akeneoId, wasGlobal: false });
            deleted++;
        } else if (a.categoryId === null) {
            // A global belongs to every category, so deleting one here removes it EVERYWHERE.
            // Off by default: "not in this category's definition" is not the same as "unused".
            if (!opts.includeGlobals) continue;
            await deleteCategoryAttribute(a.id);
            removed.push({ id: a.id, name: a.name, akeneoId: a.akeneoId, wasGlobal: true });
            deletedGlobals++;
        } else {
            // Owned by a sibling category and shared in — un-share, never delete.
            await unassignAttributeFromCategory(a.id, categoryId);
            unshared++;
        }
    }

    return {
        created,
        updated,
        linked: 0,                       // a replace matches in place; nothing is "shared in"
        skipped: plan.counts.unchanged,  // already identical to the definition
        deleted,
        unshared,
        deletedGlobals,
        removed,
    };
};

/**
 * Delete a category attribute
 */
export const deleteCategoryAttribute = async (id: string): Promise<void> => {
    await db.delete('category_attributes', { where: { id } });
};

/**
 * Assign an existing attribute to an additional category (shared assignment)
 */
export const assignAttributeToCategory = async (attributeId: string, categoryId: string): Promise<void> => {
    const row = await db.selectOne<Row>('category_attributes', {
        columns: 'assigned_category_ids',
        where: { id: attributeId },
    });
    const current: string[] = row?.assigned_category_ids ?? [];
    if (current.includes(categoryId)) return;
    await db.updateWhere(
        'category_attributes',
        { assigned_category_ids: [...current, categoryId] },
        { where: { id: attributeId } },
    );
};

/**
 * Promote a category-scoped attribute to a global/predefined attribute.
 * Clears its category_id so it applies to every category, keeping its group.
 */
export const makeAttributeGlobal = async (attributeId: string): Promise<void> => {
    await db.updateWhere('category_attributes', { category_id: null }, { where: { id: attributeId } });
};

/**
 * Remove a shared assignment of an attribute from a category
 */
export const unassignAttributeFromCategory = async (attributeId: string, categoryId: string): Promise<void> => {
    const row = await db.selectOne<Row>('category_attributes', {
        columns: 'assigned_category_ids',
        where: { id: attributeId },
    });
    const current: string[] = row?.assigned_category_ids ?? [];
    await db.updateWhere(
        'category_attributes',
        { assigned_category_ids: current.filter(id => id !== categoryId) },
        { where: { id: attributeId } },
    );
};
