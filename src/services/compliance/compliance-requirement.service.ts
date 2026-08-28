/**
 * Compliance requirement service
 * Manages compliance requirements and category attributes
 */

import { db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ComplianceRequirement, CategoryAttribute, AttributeDataType } from '../../types';
import { generateUUID } from '../../utils';
import { PREDEFINED_ATTRIBUTE_GROUPS } from '../../config/compliance.constants';
import type { ParsedAttributeRow } from '../../utils/attribute-csv-import.utils';

/**
 * Get all compliance requirements
 */
export const getComplianceRequirements = async (): Promise<ComplianceRequirement[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(portalDb.select<Row>('compliance_requirements'), 'getComplianceRequirements');
    return rows.map((r: any) => ({
        ...r,
        categoryId: r.category_id,
        condition: r.condition ?? null,
        conditionFeatureIds: r.condition_feature_ids,
        referenceCode: r.reference_code,
        isMandatory: r.is_mandatory,
        appliesByDefault: r.applies_by_default,
        timingType: r.timing_type,
        timingWeeks: r.timing_weeks,
        selfDeclarationAccepted: r.self_declaration_accepted,
        testReportOrigin: r.test_report_origin
    }));
};

/**
 * Save/update a compliance requirement
 */
export const saveRequirement = async (req: ComplianceRequirement): Promise<void> => {
    const payload: Row = {
        id: req.id,
        category_id: req.categoryId,
        section: req.section,
        title: req.title,
        description: req.description,
        is_mandatory: req.isMandatory,
        reference_code: req.referenceCode,
        applies_by_default: req.appliesByDefault,
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
 * Custom section groups (built-in sections live in COMPLIANCE_SECTIONS). Returns
 * the user-defined section names so they can be offered for every category.
 */
export const getComplianceSections = async (): Promise<string[]> => {
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
    return rows.map((s: any) => s.name as string);
};

/**
 * Define a new section group (no-op if it already exists). Once added it is
 * offered for requirements in every category.
 */
export const addComplianceSection = async (name: string): Promise<void> => {
    const clean = name.trim();
    if (!clean) return;
    await db.upsert('compliance_sections', { name: clean }, { onConflict: 'name' });
};

/**
 * Remove a custom section group (does not touch requirements already using it).
 */
export const deleteComplianceSection = async (name: string): Promise<void> => {
    await db.delete('compliance_sections', { where: { name } });
};

/**
 * Add standard compliance requirements to a category
 */
export const addStandardRequirements = async (categoryId: string): Promise<void> => {
    const defaults: ComplianceRequirement[] = [
        { id: generateUUID(), categoryId, title: "LVD Report", description: "Low Voltage Directive Compliance", isMandatory: true, appliesByDefault: true, conditionFeatureIds: [] },
        { id: generateUUID(), categoryId, title: "EMC Report", description: "Electromagnetic Compatibility", isMandatory: true, appliesByDefault: true, conditionFeatureIds: [] }
    ];
    for (const d of defaults) await saveRequirement(d);
};

/**
 * Get all category attributes
 */
export const getCategoryAttributes = async (): Promise<CategoryAttribute[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(portalDb.select<Row>('category_attributes'), 'getCategoryAttributes');
    return rows.map((a: any) => ({
        id: a.id,
        categoryId: a.category_id ?? null,
        assignedCategoryIds: a.assigned_category_ids ?? [],
        name: a.name,
        dataType: (a.data_type === 'number' ? 'decimal' : (a.data_type || 'text')) as AttributeDataType,
        validationRules: a.validation_rules ?? undefined,
        group: a.group ?? 'Category Specific',
        akeneoId: a.akeneo_id ?? undefined,
    }));
};

/**
 * Save/update a category attribute
 */
export const saveCategoryAttribute = async (attr: CategoryAttribute): Promise<void> => {
    const isPredefinedGroup = !!attr.group && PREDEFINED_ATTRIBUTE_GROUPS.includes(attr.group);
    const intendedCategoryId = isPredefinedGroup ? null : (attr.categoryId ?? null);

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
 *  - Match key: Akeneo code (case-insensitive) within the same group, else the normalized
 *    name. A given existing attribute is consumed at most once per run, so a file that reuses
 *    a code (e.g. package_1_contents ×3) still creates the distinct rows it needs.
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
    const existing = await getCategoryAttributes();
    const norm = (s: string) => (s ?? '').trim().toLowerCase();
    const result: ImportAttributesResult = { created: 0, linked: 0, skipped: 0 };
    const consumedIds = new Set<string>();

    for (const row of rows) {
        if (!row.name?.trim()) { result.skipped++; continue; }

        const isGlobal = PREDEFINED_ATTRIBUTE_GROUPS.includes(row.group);
        const code = row.akeneoId ? norm(row.akeneoId) : '';

        // Match an existing attribute. Akeneo ID is the GLOBAL identity — if the row has a code,
        // match by code across ALL attributes regardless of group (a code must map to one
        // attribute). Without a code, fall back to name within the same group.
        const match = existing.find(a =>
            !consumedIds.has(a.id) &&
            (code
                ? norm(a.akeneoId ?? '') === code
                : a.group === row.group && norm(a.name) === norm(row.name)),
        );

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
        // Only ProductToolkit rows carry this; a CSV row never sets it, so nothing changes there.
        if (row.required) validationRules.required = true;

        const created: CategoryAttribute = {
            id: generateUUID(),
            categoryId: isGlobal ? null : categoryId,
            assignedCategoryIds: [],
            name: row.name,
            dataType: row.dataType,
            validationRules: Object.keys(validationRules).length ? validationRules : undefined,
            group: row.group,
            akeneoId: row.akeneoId,
        };
        await saveCategoryAttribute(created);
        existing.push(created); // so later rows in this run can match it (prevents in-file dupes)
        consumedIds.add(created.id);
        result.created++;
    }

    return result;
};

export interface ReplaceAttributesResult extends ImportAttributesResult {
    /** Attributes owned by this category that were deleted outright. */
    deleted: number;
    /** Attributes owned elsewhere that were un-shared from this category rather than deleted. */
    unshared: number;
    /** Deleted rows, kept so the caller can report (and a human can reverse) what went. */
    removed: { id: string; name: string; akeneoId?: string }[];
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
): Promise<ReplaceAttributesResult> => {
    const existing = await getCategoryAttributes();
    const owned = existing.filter(a => a.categoryId === categoryId);
    const sharedIn = existing.filter(
        a => a.categoryId !== null && a.categoryId !== categoryId && (a.assignedCategoryIds ?? []).includes(categoryId),
    );

    for (const a of owned) await deleteCategoryAttribute(a.id);
    for (const a of sharedIn) await unassignAttributeFromCategory(a.id, categoryId);

    const imported = await importCategoryAttributes(categoryId, rows);
    return {
        ...imported,
        deleted: owned.length,
        unshared: sharedIn.length,
        removed: owned.map(a => ({ id: a.id, name: a.name, akeneoId: a.akeneoId })),
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
