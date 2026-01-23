/**
 * Supplier service
 * Manages supplier information and portal tokens
 */

import { supabase, portalClient } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { Supplier } from '../../types';
import { mapSupplier } from '../../utils/mappers.utils';
import { handleError, generateUUID } from '../../utils';

/**
 * Get all suppliers
 */
export const getSuppliers = async (): Promise<Supplier[]> => {
    if (!isLive) return [];
    const { data, error } = await supabase.from('suppliers').select('*');
    if (error) {
        console.error("getSuppliers failed", error);
        return [];
    }
    return (data || []).map(mapSupplier);
};

/**
 * Get supplier by ID
 */
export const getSupplierById = async (id: string): Promise<Supplier | undefined> => {
    if (!id || !isLive) return undefined;
    const { data, error } = await supabase.from('suppliers').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return mapSupplier(data);
};

/**
 * Get supplier by portal token
 */
export const getSupplierByToken = async (token: string): Promise<Supplier | undefined> => {
    if (!isLive) return undefined;
    const { data, error } = await portalClient.from('suppliers').select('*').eq('portal_token', token).maybeSingle();
    if (error) return undefined;
    return data ? mapSupplier(data) : undefined;
};

/**
 * Create a new supplier
 */
export const createSupplier = async (name: string, code: string, email: string): Promise<Supplier> => {
    const { data, error } = await supabase.from('suppliers').insert({ name, code, email }).select().single();
    if (error) handleError(error, 'createSupplier');
    return mapSupplier(data);
};

/**
 * Update supplier information
 */
export const updateSupplier = async (id: string, updates: Partial<Supplier>): Promise<Supplier> => {
    const { data, error } = await supabase.from('suppliers').update({
        name: updates.name,
        code: updates.code,
        email: updates.email
    }).eq('id', id).select().single();
    if (error) handleError(error, 'updateSupplier');
    return mapSupplier(data);
};

/**
 * Ensure supplier has a portal token (create if doesn't exist)
 */
export const ensureSupplierToken = async (supplierId: string): Promise<string> => {
    const sup = await getSupplierById(supplierId);
    if (sup?.portalToken) return sup.portalToken;
    const token = generateUUID();
    await supabase.from('suppliers').update({ portal_token: token }).eq('id', supplierId);
    return token;
};
