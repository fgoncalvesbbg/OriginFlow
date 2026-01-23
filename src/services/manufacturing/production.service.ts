/**
 * Production/Manufacturing service
 * Manages production updates and ETD tracking
 */

import { portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { ProductionUpdate } from '../../types';
import { mapProductionUpdate } from '../../utils/mappers.utils';
import { handleError } from '../../utils/error.utils';
import { supabase } from '../core/supabase.client';

/**
 * Get all production updates for a specific project
 */
export const getProductionUpdates = async (projectId: string): Promise<ProductionUpdate[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('production_updates')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
    if (error) return [];
    return (data || []).map(mapProductionUpdate);
};

/**
 * Get all production updates across all projects
 */
export const getAllProductionUpdates = async (): Promise<ProductionUpdate[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('production_updates')
        .select('*')
        .order('created_at', { ascending: true });
    if (error) return [];
    return (data || []).map(mapProductionUpdate);
};

/**
 * Save a production update (ETD change, delay reason, etc.)
 */
export const saveProductionUpdate = async (update: Partial<ProductionUpdate>): Promise<ProductionUpdate> => {
    if (!update.newEtd) {
        throw new Error("New ETD date is required");
    }

    const { data, error } = await portalClient.rpc('submit_production_update', {
        p_project_id: update.projectId,
        p_previous_etd: update.previousEtd || null,
        p_new_etd: update.newEtd,
        p_is_on_time: update.isOnTime,
        p_delay_reason: update.delayReason || null,
        p_notes: update.notes || null,
        p_updated_by: update.updatedBy,
        p_is_supplier: update.isSupplierUpdate || false
    });

    if (error) handleError(error, 'saveProductionUpdate');

    let record = data;
    if (Array.isArray(data)) {
        if (data.length === 0) throw new Error("Production update returned no data");
        record = data[0];
    }

    if (!record) {
        throw new Error("Failed to save production update: No data returned from server.");
    }

    return mapProductionUpdate(record);
};
