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
 * Production updates across a supplier's projects, for the portal dashboard.
 * Gated by portal token + access code via a SECURITY DEFINER RPC (anon no longer
 * reads production_updates directly).
 */
export const getProductionUpdatesForSupplier = async (token: string, code: string): Promise<ProductionUpdate[]> => {
    if (!isLive) return [];
    const { data, error } = await portalClient.rpc('get_production_updates_by_supplier', {
        p_supplier_token: token,
        p_code: code,
    });
    if (error) {
        console.error('getProductionUpdatesForSupplier error:', error);
        return [];
    }
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
export const saveProductionUpdate = async (
    update: Partial<ProductionUpdate>,
    auth?: { token: string; code: string }
): Promise<ProductionUpdate> => {
    if (!update.newEtd) {
        throw new Error("New ETD date is required");
    }

    let data: any;
    let error: any;

    if (update.isSupplierUpdate) {
        // Supplier portal (anon): gated by portal token + access code; the RPC
        // validates the project belongs to this supplier before writing.
        if (!auth?.token || !auth?.code) {
            throw new Error("Supplier production updates require portal authorization.");
        }
        ({ data, error } = await portalClient.rpc('submit_supplier_production_update', {
            p_supplier_token: auth.token,
            p_code: auth.code,
            p_project_id: update.projectId,
            p_previous_etd: update.previousEtd || null,
            p_new_etd: update.newEtd,
            p_is_on_time: update.isOnTime,
            p_delay_reason: update.delayReason || null,
            p_notes: update.notes || null,
            p_updated_by: update.updatedBy,
        }));
    } else {
        // PM (authenticated): uses the authenticated session, not the anon client.
        ({ data, error } = await supabase.rpc('submit_production_update', {
            p_project_id: update.projectId,
            p_previous_etd: update.previousEtd || null,
            p_new_etd: update.newEtd,
            p_is_on_time: update.isOnTime,
            p_delay_reason: update.delayReason || null,
            p_notes: update.notes || null,
            p_updated_by: update.updatedBy,
            p_is_supplier: false,
        }));
    }

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
