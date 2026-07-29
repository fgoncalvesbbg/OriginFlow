/**
 * Production/Manufacturing service
 * Manages production updates and ETD tracking
 */

import { db, portalDb, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ProductionUpdate } from '../../types';
import { mapProductionUpdate } from '../../utils/mappers.utils';

/**
 * Get all production updates for a specific project
 */
export const getProductionUpdates = async (projectId: string): Promise<ProductionUpdate[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        db.select<Row>('production_updates', {
            where: { project_id: projectId },
            order: { column: 'created_at', ascending: false },
        }),
        'getProductionUpdates',
    );
    return rows.map(mapProductionUpdate);
};

/**
 * Production updates across a supplier's projects, for the portal dashboard.
 * Gated by portal token + access code via a SECURITY DEFINER routine (anon no longer
 * reads production_updates directly).
 */
export const getProductionUpdatesForSupplier = async (token: string, code: string): Promise<ProductionUpdate[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        portalDb.rpc<Row[]>('get_production_updates_by_supplier', {
            p_supplier_token: token,
            p_code: code,
        }),
        'getProductionUpdatesForSupplier',
    );
    return (rows || []).map(mapProductionUpdate);
};

/**
 * Get all production updates across all projects
 */
export const getAllProductionUpdates = async (): Promise<ProductionUpdate[]> => {
    if (!isLive) return [];
    const rows = await orEmpty(
        db.select<Row>('production_updates', { order: { column: 'created_at', ascending: true } }),
        'getAllProductionUpdates',
    );
    return rows.map(mapProductionUpdate);
};

/**
 * Save a production update (ETD change, delay reason, etc.)
 */
export const saveProductionUpdate = async (
    update: Partial<ProductionUpdate>,
    portalAuth?: { token: string; code: string }
): Promise<ProductionUpdate> => {
    if (!update.newEtd) {
        throw new Error("New ETD date is required");
    }

    let data: Row | Row[] | null;

    if (update.isSupplierUpdate) {
        // Supplier portal (anon): gated by portal token + access code; the routine
        // validates the project belongs to this supplier before writing.
        if (!portalAuth?.token || !portalAuth?.code) {
            throw new Error("Supplier production updates require portal authorization.");
        }
        data = await portalDb.rpc<Row | Row[] | null>('submit_supplier_production_update', {
            p_supplier_token: portalAuth.token,
            p_code: portalAuth.code,
            p_project_id: update.projectId,
            p_previous_etd: update.previousEtd || null,
            p_new_etd: update.newEtd,
            p_is_on_time: update.isOnTime,
            p_delay_reason: update.delayReason || null,
            p_notes: update.notes || null,
            p_updated_by: update.updatedBy,
        });
    } else {
        // PM (authenticated): uses the authenticated session, not the anon client.
        data = await db.rpc<Row | Row[] | null>('submit_production_update', {
            p_project_id: update.projectId,
            p_previous_etd: update.previousEtd || null,
            p_new_etd: update.newEtd,
            p_is_on_time: update.isOnTime,
            p_delay_reason: update.delayReason || null,
            p_notes: update.notes || null,
            p_updated_by: update.updatedBy,
            p_is_supplier: false,
        });
    }

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
