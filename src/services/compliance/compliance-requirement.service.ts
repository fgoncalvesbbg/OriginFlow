/**
 * Compliance requirement service
 * Manages compliance requirements and category attributes
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ComplianceRequirement, CategoryAttribute } from '../../types';
import { handleError, generateUUID } from '../../utils';

/**
 * Get all compliance requirements
 */
export const getComplianceRequirements = async (): Promise<ComplianceRequirement[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.from('compliance_requirements').select('*');
    if (error) return [];
    return (data || []).map((r: any) => ({
        ...r,
        categoryId: r.category_id,
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
    const payload: any = {
        id: req.id,
        category_id: req.categoryId,
        section: req.section,
        title: req.title,
        description: req.description,
        is_mandatory: req.isMandatory,
        reference_code: req.referenceCode,
        applies_by_default: req.appliesByDefault,
        condition_feature_ids: req.conditionFeatureIds,
        timing_type: req.timingType,
        timing_weeks: req.timingWeeks,
        self_declaration_accepted: req.selfDeclarationAccepted,
        test_report_origin: req.testReportOrigin
    };
    const { error } = await supabase.from('compliance_requirements').upsert(payload);
    if (error) handleError(error, 'saveRequirement');
};

/**
 * Delete a compliance requirement
 */
export const deleteRequirement = async (id: string): Promise<void> => {
    await supabase.from('compliance_requirements').delete().eq('id', id);
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
    const { data, error } = await portalClient.from('category_attributes').select('*');
    if (error) return [];
    return (data || []).map((a: any) => ({
        id: a.id,
        categoryId: a.category_id,
        name: a.name,
        dataType: a.dataType
    }));
};

/**
 * Save/update a category attribute
 */
export const saveCategoryAttribute = async (attr: CategoryAttribute): Promise<void> => {
    const payload = {
        id: attr.id,
        category_id: attr.categoryId,
        name: attr.name,
        dataType: attr.dataType
    };
    const { error } = await supabase.from('category_attributes').upsert(payload);
    if (error) handleError(error, 'saveCategoryAttribute');
};

/**
 * Delete a category attribute
 */
export const deleteCategoryAttribute = async (id: string): Promise<void> => {
    await supabase.from('category_attributes').delete().eq('id', id);
};
